package top.heang.lom.pairing.cloud

import android.content.Context
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import top.heang.lom.pairing.CloudPairingGateway
import top.heang.lom.pairing.PairedState
import top.heang.lom.pairing.PairingChallenge
import top.heang.lom.pairing.PairingFailure
import top.heang.lom.pairing.PairingGateway
import top.heang.lom.pairing.PairingHost
import top.heang.lom.pairing.PairingInput

/** Process-wide pairing runtime: cloud adapter, stored credential and relay connection. */
class LomPairing private constructor(context: Context) : PairingHost {
    companion object {
        /** The only cloud host this build trusts; a scanned QR cannot add hosts (R01 §5.5). */
        const val HOST = "example.invalid"
        const val CLOUD_ENABLED = false

        @Volatile private var instance: LomPairing? = null
        fun get(context: Context): LomPairing = instance ?: synchronized(this) {
            instance ?: LomPairing(context.applicationContext).also { instance = it }
        }
    }

    private val app = context
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val http = HttpPairingApi.client()
    private val api = HttpPairingApi(http)
    private val store by lazy { KeystorePairingStore(app) }
    private val relay by lazy { LomRelay(app, api, store, http, scope) }
    private val cloud by lazy {
        val identity = try { LomIdentity.loadOrCreate(app) } catch (e: Exception) {
            android.util.Log.w("LomPairing", "identity unavailable: ${e.javaClass.simpleName}")
            throw PairingFailure("pairing.identity_unavailable")
        }
        CloudPairingGateway(api, identity, store, HOST)
    }

    val paired: StateFlow<PairedState?> get() = store.state
    val relayStatus: StateFlow<RelayStatus> get() = relay.state

    val connectionProblem get() = LomConnectionService.problem
    fun backgroundEnabled() = LomConnectionService.enabled(app)
    fun setBackgroundEnabled(enabled: Boolean) = LomConnectionService.setEnabled(app, enabled)
    fun start() {
        if (!CLOUD_ENABLED) return // Public build never restores cloud credentials.
        scope.launch { relay.start() }
        if (paired.value != null) LomConnectionService.start(app)
    }

    override val pairingAllowedHosts: Set<String> = emptySet()

    /** Identity creation touches Keystore and disk, so it happens on the IO dispatcher. */
    override fun createPairingGateway(): PairingGateway = object : PairingGateway {
        private suspend fun inner() = withContext(Dispatchers.IO) {
            check(CLOUD_ENABLED) { "Cloud pairing is unavailable in the public build" }
            cloud
        }
        override suspend fun claim(input: PairingInput): PairingChallenge = inner().claim(input)
        override suspend fun confirm(handle: String) = inner().confirm(handle).also { start() }
        override suspend fun cancel(handle: String) = inner().cancel(handle)
    }

    /** Unpair from this phone. Fails (instead of pretending) when the cloud cannot be reached,
     * so the desktop never keeps showing a phone that believes it is unpaired. */
    suspend fun unpair() {
        if (!CLOUD_ENABLED) { store.clear(); return }
        val state = store.load() ?: return
        try {
            api.unpairSelf(state)
        } catch (e: CancellationException) { throw e
        } catch (e: PairingFailure) {
            if (e.code != "relay.device_revoked") throw e
        }
        store.clear()
    }
}

/** Starts the relay for an already-paired phone when the app process starts. */
class LomPairingInitProvider : android.content.ContentProvider() {
    override fun onCreate(): Boolean {
        context?.let { ctx ->
            val pairing = LomPairing.get(ctx)
            pairing.start()
            (ctx.applicationContext as? android.app.Application)?.registerActivityLifecycleCallbacks(object : android.app.Application.ActivityLifecycleCallbacks {
                private var started = 0
                override fun onActivityResumed(activity: android.app.Activity) { pairing.start() }
                override fun onActivityCreated(a: android.app.Activity, b: android.os.Bundle?) {}
                override fun onActivityStarted(a: android.app.Activity) { LomForeground.visible.value = ++started > 0 }
                override fun onActivityPaused(a: android.app.Activity) {}
                override fun onActivityStopped(a: android.app.Activity) { started = (started - 1).coerceAtLeast(0); LomForeground.visible.value = started > 0 }
                override fun onActivitySaveInstanceState(a: android.app.Activity, b: android.os.Bundle) {}
                override fun onActivityDestroyed(a: android.app.Activity) {}
            })
        }
        return true
    }
    override fun query(u: android.net.Uri, p: Array<String>?, s: String?, a: Array<String>?, o: String?) = null
    override fun getType(uri: android.net.Uri): String? = null
    override fun insert(uri: android.net.Uri, values: android.content.ContentValues?) = null
    override fun delete(uri: android.net.Uri, s: String?, a: Array<String>?) = 0
    override fun update(u: android.net.Uri, v: android.content.ContentValues?, s: String?, a: Array<String>?) = 0
}
