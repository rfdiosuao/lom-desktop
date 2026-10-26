package top.heang.lom.app

import android.content.Context
import android.content.Intent
import android.provider.Settings
import org.json.JSONArray
import org.json.JSONObject

/** 「开图」用：这台手机装了哪些可打开的应用、无障碍是否已开（总指挥能否看屏和操作）。
 *  只读，只经过已配对、已加密的 RPC。应用是否已登录要由手机 Agent 打开后查看，这里不读其他应用的数据。 */
internal fun phoneApps(context: Context): JSONObject {
    val pm = context.packageManager
    val launcher = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
    val apps = pm.queryIntentActivities(launcher, 0)
        .map { it.activityInfo.packageName to it.loadLabel(pm).toString() }
        .filter { it.first != context.packageName }
        .distinctBy { it.first }
        .sortedBy { it.second }
    val enabled = Settings.Secure.getString(context.contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES).orEmpty()
    return JSONObject()
        .put("items", JSONArray(apps.map { (pkg, label) -> JSONObject().put("package", pkg).put("label", label) }))
        .put("accessibility", enabled.split(':').any { it.startsWith("${context.packageName}/") }.toString())
        .put("sampled_at", System.currentTimeMillis().toString())
}
