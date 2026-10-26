package top.heang.lom.pairing.ui

import android.content.ActivityNotFoundException
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings

/** Settings that decide whether the paired connection survives in the background. The app only opens the
 *  system pages; the user makes the choice there. */
internal object LomKeepAlive {
    fun ignoringBattery(context: Context): Boolean =
        context.getSystemService(PowerManager::class.java)?.isIgnoringBatteryOptimizations(context.packageName) == true

    /** System dialog "allow to run in background without battery restrictions", falling back to the list page. */
    fun requestBattery(context: Context) {
        val direct = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:${context.packageName}"))
        if (!open(context, direct)) open(context, Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
    }

    /** Xiaomi / Redmi / POCO keep a separate autostart switch; without it the system may stop the connection service. */
    val hasAutostart: Boolean get() = Build.MANUFACTURER.lowercase() in setOf("xiaomi", "redmi", "poco")

    fun openAutostart(context: Context) {
        val pages = listOf(
            ComponentName("com.miui.securitycenter", "com.miui.permcenter.autostart.AutoStartManagementActivity"),
            ComponentName("com.miui.securitycenter", "com.miui.powercenter.PowerSettings"),
        )
        if (pages.none { open(context, Intent().setComponent(it)) }) appDetails(context)
    }

    fun appDetails(context: Context) {
        open(context, Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${context.packageName}")))
    }

    private fun open(context: Context, intent: Intent): Boolean = try {
        context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); true
    } catch (e: ActivityNotFoundException) { false
    } catch (e: SecurityException) {
        android.util.Log.w("LomKeepAlive", "settings page refused: ${e.javaClass.simpleName}"); false
    }
}
