package top.heang.lom.app

import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.BatteryManager
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import org.json.JSONObject

/** Read-only telemetry, reachable only through an authenticated paired RPC. */
internal fun deviceStatus(context: Context): JSONObject {
    val battery = context.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
    val level = battery?.getIntExtra(BatteryManager.EXTRA_LEVEL, -1) ?: -1
    val scale = battery?.getIntExtra(BatteryManager.EXTRA_SCALE, -1) ?: -1
    val percent = if (level >= 0 && scale > 0 && level <= scale) (level * 100L / scale).toString() else ""
    val cm = context.getSystemService(ConnectivityManager::class.java)
    val caps = cm?.getNetworkCapabilities(cm.activeNetwork)
    val network = when {
        cm == null -> "unknown"
        cm.activeNetwork == null -> "offline"
        caps?.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) == true -> "wifi"
        caps?.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) == true -> "cellular"
        caps?.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) == true -> "ethernet"
        else -> "unknown"
    }
    return JSONObject().put("battery", percent).put("network", network).put("sampled_at", System.currentTimeMillis().toString())
}
