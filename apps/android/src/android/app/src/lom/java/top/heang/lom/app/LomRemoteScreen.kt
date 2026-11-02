package top.heang.lom.app

import android.accessibilityservice.AccessibilityService
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Path
import android.os.Build
import android.util.Base64
import android.view.accessibility.AccessibilityNodeInfo
import com.openminis.app.accessibility.MinisAccessibilityService
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream

/** Invoked only after the paired envelope has been authenticated. No shell execution. */
internal class LomRemoteScreen(private val context: Context, private val isMetered: () -> Boolean = {
    context.getSystemService(android.net.ConnectivityManager::class.java)?.isActiveNetworkMetered == true
}) {
    private val gate = Mutex()
    private var lastCaptureAt = 0L
    private val receipts = context.getSharedPreferences("lom_control_receipts", Context.MODE_PRIVATE)
    private fun service() = MinisAccessibilityService.getInstance() ?: error("screen.permission_required")
    suspend fun handle(method: String, p: JSONObject, desktop: String): JSONObject = gate.withLock {
        when (method) {
            "screen.capture" -> capture(p)
            "screen.tree" -> tree()
            "screen.control" -> control(p, desktop)
            else -> error("screen.unknown_method")
        }
    }
    private suspend fun capture(p: JSONObject): JSONObject {
        check(Build.VERSION.SDK_INT >= 30) { "screen.unsupported" }
        val svc = service()
        val metered = isMetered()
        val saver = p.optString("cellular_cap", "false") == "true" && metered
        val wait = (if (saver) 2000L else 400L) - (android.os.SystemClock.elapsedRealtime() - lastCaptureAt)
        if(wait>0) kotlinx.coroutines.delay(wait)
        lastCaptureAt = android.os.SystemClock.elapsedRealtime()
        val raw = svc.captureScreenshot().bitmap ?: error("screen.capture_failed")
        val quality = if (saver) "low" else p.optString("quality", "balanced")
        val limit = if (saver) 45000 else 260000
        val edge = when(quality) { "low" -> 480; "high" -> 1080; else -> 720 }
        val ratio = minOf(1f, edge.toFloat()/maxOf(raw.width,raw.height))
        val scaled = Bitmap.createScaledBitmap(raw,(raw.width*ratio).toInt().coerceAtLeast(1),(raw.height*ratio).toInt().coerceAtLeast(1),true)
        try {
            val bytes = ByteArrayOutputStream()
            var compression = if(quality=="high") 82 else 65
            do {
                bytes.reset()
                check(scaled.compress(Bitmap.CompressFormat.JPEG,compression,bytes)) { "screen.capture_failed" }
                compression -= 20
            } while(bytes.size()>limit && compression>=20)
            // The relay caps the doubly-base64-wrapped encrypted response at 512 KiB.
            check(bytes.size() <= limit) { "screen.frame_too_large" }
            return JSONObject().put("image",Base64.encodeToString(bytes.toByteArray(),Base64.NO_WRAP)).put("mime","image/jpeg")
                .put("width",raw.width.toString()).put("height",raw.height.toString()).put("captured_at",System.currentTimeMillis().toString())
        } finally { if(scaled!==raw) scaled.recycle(); raw.recycle() }
    }
    private fun tree(): JSONObject {
        val svc=service(); val rows=JSONArray()
        fun walk(n: AccessibilityNodeInfo, depth: Int) {
            if(rows.length()>=300 || depth>20) return
            val b=android.graphics.Rect(); n.getBoundsInScreen(b)
            rows.put(JSONObject().put("text",if(n.isPassword) "[password]" else n.text?.toString()?.take(160).orEmpty())
                .put("description",if(n.isPassword) "" else n.contentDescription?.toString()?.take(160).orEmpty())
                .put("resource",n.viewIdResourceName.orEmpty()).put("bounds",JSONArray(listOf(b.left,b.top,b.right,b.bottom)))
                .put("clickable",n.isClickable).put("editable",n.isEditable).put("focused",n.isFocused))
            for(i in 0 until n.childCount) { val child=n.getChild(i) ?: continue; try { walk(child,depth+1) } finally { child.recycle() } }
        }
        for(root in svc.rootNodes()) try { walk(root,0) } finally { root.recycle() }
        return JSONObject().put("package",svc.foregroundPackage().first.orEmpty()).put("nodes",rows).put("truncated",rows.length()>=300)
    }
    private fun control(p: JSONObject, desktop: String): JSONObject {
        val id=p.getString("request_id")
        require(Regex("[a-zA-Z0-9-]{16,64}").matches(id)) { "screen.invalid_request" }
        val key=digest(desktop+id); val fingerprint=digest(p.toString())
        receipts.getString(key,null)?.let {
            val saved=JSONObject(it); check(saved.getString("fingerprint")==fingerprint) { "screen.id_reused" }
            check(saved.getString("status")=="completed") { "screen.previous_result_unknown" }
            return saved
        }
        val svc=service(); val action=p.getString("action")
        require(action in listOf("tap","swipe","type","back","home","open_app")) { "screen.invalid_action" }
        val bounds = if(Build.VERSION.SDK_INT >= 30) context.getSystemService(android.view.WindowManager::class.java).currentWindowMetrics.bounds else android.graphics.Rect(0,0,context.resources.displayMetrics.widthPixels,context.resources.displayMetrics.heightPixels)
        fun coord(name: String, max: Int) = p.getString(name).toFloat().also { require(it.isFinite() && it>=0 && it<max) { "screen.invalid_coordinate" } }
        val path=if(action=="tap" || action=="swipe") Path().apply {
            moveTo(coord("x",bounds.width()),coord("y",bounds.height()))
            if(action=="swipe") lineTo(coord("x2",bounds.width()),coord("y2",bounds.height()))
        } else null
        val text=p.optString("text"); require(text.length<=8000) { "screen.text_too_long" }
        val intent=if(action=="open_app") {
            val pkg=p.getString("package_name"); require(Regex("[a-zA-Z0-9_.]+\\.[a-zA-Z0-9_.]+").matches(pkg)) { "screen.invalid_package" }
            context.packageManager.getLaunchIntentForPackage(pkg) ?: error("screen.app_missing")
        } else null
        val result=JSONObject().put("fingerprint",fingerprint).put("status","unknown").put("action",action).put("at",System.currentTimeMillis())
        check(receipts.edit().putString(key,result.toString()).commit()) { "screen.receipt_failed" }
        val ok=when(action) {
            "tap","swipe" -> svc.dispatchSimpleGesture(path!!,0,if(action=="tap") 80 else 400)
            "back" -> svc.performGlobalAction(AccessibilityService.GLOBAL_ACTION_BACK)
            "home" -> svc.performGlobalAction(AccessibilityService.GLOBAL_ACTION_HOME)
            "open_app" -> { context.startActivity(intent!!.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); true }
            "type" -> {
                val root=svc.rootInActiveWindow ?: error("screen.no_window")
                try { val focus=root.findFocus(AccessibilityNodeInfo.FOCUS_INPUT) ?: error("screen.no_focused_input")
                    try { svc.setNodeText(focus,text) } finally { focus.recycle() }
                } finally { root.recycle() }
            }
            else -> false
        }
        check(ok) { "screen.action_unconfirmed" }
        result.put("status","completed").put("confirmation","Android accepted the action. Read the screen or UI tree to verify the intended result.")
        check(receipts.edit().putString(key,result.toString()).commit()) { "screen.receipt_failed" }
        // Audit metadata only. Full text, coordinates, image and credentials stay out of logs.
        android.util.Log.i("LomControl", "action=$action status=completed")
        return result
    }
}
