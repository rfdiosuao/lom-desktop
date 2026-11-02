package top.heang.lom.pairing.cloud

import android.app.*
import android.content.*
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow

/** User-visible lifetime for the paired remote Agent, independent of any Activity. */
class LomConnectionService : Service() {
    companion object {
        internal val running = MutableStateFlow(false)
        internal val problem = MutableStateFlow("")
        private const val CHANNEL = "lom_remote_connection"
        private const val ID = 4091
        fun enabled(context: Context) = context.getSharedPreferences(CHANNEL, 0).getBoolean("enabled", true)
        fun setEnabled(context: Context, enabled: Boolean) {
            context.getSharedPreferences(CHANNEL, 0).edit().putBoolean("enabled", enabled).commit()
            if (enabled) start(context) else context.stopService(Intent(context, LomConnectionService::class.java))
        }
        fun start(context: Context) {
            if (!LomPairing.CLOUD_ENABLED) return
            if (!enabled(context)) return
            try { context.startForegroundService(Intent(context, LomConnectionService::class.java)) }
            catch (e: Exception) {
                problem.value = "后台连接未启动，请回到手机应用重试（${e.javaClass.simpleName}）"
                android.util.Log.w("LomConnection", "start failed: ${e.javaClass.simpleName}")
            }
        }
    }
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    override fun onBind(intent: Intent?): IBinder? = null
    override fun onCreate() {
        super.onCreate()
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(NotificationChannel(CHANNEL, "电脑远程连接", NotificationManager.IMPORTANCE_LOW))
        val pause = PendingIntent.getService(this, ID, Intent(this, LomConnectionService::class.java).setAction("pause"), PendingIntent.FLAG_IMMUTABLE)
        val launch = packageManager.getLaunchIntentForPackage(packageName)
        val builder = Notification.Builder(this, CHANNEL).setSmallIcon(android.R.drawable.stat_notify_sync)
            .setContentTitle("Lom 手机 Agent · 远程待命")
            .setContentText("保持电脑连接；切换应用后仍可接收任务")
            .setOngoing(true).addAction(Notification.Action.Builder(null, "暂停连接", pause).build())
        if (launch != null) builder.setContentIntent(PendingIntent.getActivity(this, ID, launch, PendingIntent.FLAG_IMMUTABLE))
        try {
            if (Build.VERSION.SDK_INT >= 34) startForeground(ID, builder.build(), ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
            else startForeground(ID, builder.build())
            running.value = true; problem.value = ""
        } catch (e: Exception) {
            problem.value = "系统未允许后台连接（${e.javaClass.simpleName}）"
            android.util.Log.w("LomConnection", "foreground failed: ${e.javaClass.simpleName}")
            stopSelf(); return
        }
        scope.launch { LomPairing.get(this@LomConnectionService).paired.collect { if (it == null) stopSelf() } }
    }
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == "pause") setEnabled(this, false)
        if (!enabled(this)) { stopSelf(); return START_NOT_STICKY }
        return START_STICKY
    }
    override fun onDestroy() {
        running.value = false
        scope.cancel()
        stopForeground(STOP_FOREGROUND_REMOVE)
        super.onDestroy()
    }
}

/** BOOT_COMPLETED may start this declared special-use service; never bypass force-stop. */
class LomConnectionBootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == Intent.ACTION_BOOT_COMPLETED) LomPairing.get(context).start()
    }
}
