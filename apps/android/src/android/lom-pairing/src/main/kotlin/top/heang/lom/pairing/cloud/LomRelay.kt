package top.heang.lom.pairing.cloud

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.ConnectivityManager
import android.net.Network
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import top.heang.lom.pairing.PairingFailure
import top.heang.lom.pairing.RelayBackoff

enum class RelayStatus { OFFLINE, CONNECTING, ONLINE }

/** Whether any of the app's activities is visible; updated by [LomPairingInitProvider]. */
internal object LomForeground { val visible = MutableStateFlow(false) }

/** Keeps this phone connected to `/v1/relay` while it is paired (R02 §2.1, first-version subset):
 * the cloud derives online status from it and pushes `device.revoked` when the desktop removes us. */
internal class LomRelay(
    private val context: Context,
    private val api: HttpPairingApi,
    private val store: KeystorePairingStore,
    baseClient: OkHttpClient,
    private val scope: CoroutineScope,
) {
    private val client = baseClient.newBuilder().pingInterval(20, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.MILLISECONDS).callTimeout(0, TimeUnit.MILLISECONDS).build()
    private val status = MutableStateFlow(RelayStatus.OFFLINE)
    val state: StateFlow<RelayStatus> = status.asStateFlow()
    private val wake = Channel<Unit>(Channel.CONFLATED)
    private var started = false
    @Volatile private var activeSocket: WebSocket? = null
    @Volatile private var defaultNetwork: Network? = null

    init {
        val cm = context.getSystemService(ConnectivityManager::class.java)
        cm?.registerDefaultNetworkCallback(object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                if (network == defaultNetwork) return
                defaultNetwork = network; activeSocket?.cancel(); client.connectionPool.evictAll(); wake.trySend(Unit)
            }
            override fun onLost(network: Network) {
                if (network != defaultNetwork) return
                defaultNetwork = null; activeSocket?.cancel(); wake.trySend(Unit)
            }
        })
        // Screen on / unlocked: reconnect now rather than at the end of a backoff that may have slept through.
        val screen = object : BroadcastReceiver() { override fun onReceive(c: Context, i: Intent) { wake.trySend(Unit) } }
        val filter = IntentFilter(Intent.ACTION_SCREEN_ON).apply { addAction(Intent.ACTION_USER_PRESENT) }
        if (android.os.Build.VERSION.SDK_INT >= 33) context.registerReceiver(screen, filter, Context.RECEIVER_NOT_EXPORTED)
        else context.registerReceiver(screen, filter)
    }

    @Synchronized fun start() {
        if (!LomPairing.CLOUD_ENABLED) return
        if (started) return
        started = true
        scope.launch {
            var job: Job? = null
            // Connected while paired and either the background service runs or the app is on screen: a refused
            // foreground service must not also cut the connection the user is looking at.
            combine(store.state, LomConnectionService.running, LomForeground.visible) { paired, running, visible ->
                paired != null && (running || visible)
            }.distinctUntilChanged().collect { paired ->
                job?.cancel()
                job?.join()
                job = if (paired) scope.launch { loop() } else null
                if (!paired) status.value = RelayStatus.OFFLINE
            }
        }
    }

    private suspend fun loop() {
        var attempt = 0
        while (scope.isActive) {
            val paired = store.load() ?: return
            status.value = RelayStatus.CONNECTING
            try {
                val token = api.relayToken(paired)
                if (session(paired.host, token)) attempt = 0
            } catch (e: CancellationException) { throw e
            } catch (e: PairingFailure) {
                android.util.Log.w("LomRelay", "token failed: ${e.code}")
                if (e.code == "relay.device_revoked") { revoked(); return }
            } catch (e: Exception) {
                // Anything else must not end the loop: a dead loop means the phone stays offline until the app restarts.
                android.util.Log.w("LomRelay", "connect failed: ${e.javaClass.simpleName}")
            }
            status.value = RelayStatus.OFFLINE
            val wait = RelayBackoff.delayMillis(attempt++, Math.random() * 2 - 1)
            withTimeoutOrNull(wait) { wake.receive() }
        }
    }

    /** One WebSocket session; returns true if it was established before it closed. */
    private suspend fun session(host: String, token: String): Boolean {
        val closed = CompletableDeferred<Boolean>()
        var opened = false
        val request = Request.Builder().url("wss://$host/v1/relay").header("Authorization", "Bearer $token").build()
        val ws = client.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                opened = true
                status.value = RelayStatus.ONLINE
            }
            override fun onMessage(webSocket: WebSocket, text: String) {
                val type = runCatching { JSONObject(text).optString("type") }.getOrDefault("")
                if (type == "device.revoked") scope.launch { revoked() }
                if (type == "task.rpc" && text.length <= 512 * 1024) scope.launch {
                    try { LomRemote.receive(context, store, JSONObject(text))?.let { webSocket.send(it.toString()) } }
                    catch (e: CancellationException) { throw e }
                    catch (e: Exception) { android.util.Log.w("LomRemote", "Invalid remote message") }
                }
            }
            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) { closed.complete(opened); webSocket.close(if(code==1005) 1000 else code, null) }
            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) { closed.complete(opened) }
            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                android.util.Log.w("LomRelay", "socket failed: ${t.javaClass.simpleName}, HTTP ${response?.code}")
                closed.complete(opened)
            }
        })
        activeSocket = ws
        try {
            return closed.await()
        } finally {
            activeSocket = null
            ws.cancel()
        }
    }

    /** The desktop removed this phone: drop the credential, keep sessions, persona, skills, memory. */
    private suspend fun revoked() {
        store.clear()
        status.value = RelayStatus.OFFLINE
    }
}
