package top.heang.lom.app
import android.app.Activity
import android.os.Bundle
import android.content.Intent
import android.widget.*
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.openminis.app.MinisApp
import com.openminis.app.accessibility.MinisAccessibilityService
import kotlinx.coroutines.*
import org.json.JSONObject
import org.junit.Test
import org.junit.Assert.*
import org.junit.runner.RunWith
import java.util.UUID

@RunWith(AndroidJUnit4::class)
class PhoneControlTest {
    private val ins=InstrumentationRegistry.getInstrumentation()
    private fun shell(command:String) { ins.getUiAutomation(android.app.UiAutomation.FLAG_DONT_SUPPRESS_ACCESSIBILITY_SERVICES).executeShellCommand(command).use { android.os.ParcelFileDescriptor.AutoCloseInputStream(it).readBytes() } }
    private suspend fun awaitService(on:Boolean) = withTimeout(10000) { while((MinisAccessibilityService.getInstance()!=null)!=on) delay(200) }
    @Test fun R02_03_real_screen_control_permission_and_idempotency()=runBlocking<Unit> {
        val app=ins.targetContext.applicationContext as MinisApp; val bridge=LomAgentBridge(app)
        shell("settings put secure enabled_accessibility_services ''"); awaitService(false)
        try { bridge.handle("screen.capture",JSONObject().put("quality","low"),"fixture"); fail("permission required") }
        catch(e:IllegalStateException){ assertEquals("screen.permission_required",e.message) }
        shell("settings put secure enabled_accessibility_services top.heang.lom.agent/com.openminis.app.accessibility.MinisAccessibilityService")
        shell("settings put secure accessibility_enabled 1"); awaitService(true)
        ins.context.startActivity(Intent(ins.context,ControlFixtureActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        delay(1200)
        val frame=bridge.handle("screen.capture",JSONObject().put("quality","low"),"fixture")
        val bytes=android.util.Base64.decode(frame.getString("image"),0)
        val image=android.graphics.BitmapFactory.decodeByteArray(bytes,0,bytes.size)
        assertNotNull(image);assertTrue(maxOf(image.width,image.height)<=480);image.recycle()
        assertEquals("image/jpeg",bridge.handle("screen.capture",JSONObject().put("quality","high"),"fixture").getString("mime"))
        // D10: a metered network overrides high quality and throttles real captures.
        delay(500) // Android rate-limits screenshots across service callers.
        val saver = LomRemoteScreen(app) { true }
        val request = JSONObject().put("quality", "high").put("cellular_cap", "true")
        val low = saver.handle("screen.capture", request, "fixture")
        val lowBytes = android.util.Base64.decode(low.getString("image"), 0)
        val lowImage = android.graphics.BitmapFactory.decodeByteArray(lowBytes, 0, lowBytes.size)
        assertTrue(maxOf(lowImage.width, lowImage.height) <= 480); assertTrue(lowBytes.size <= 45000); lowImage.recycle()
        val repeated = saver.handle("screen.capture", request, "fixture")
        assertTrue(repeated.getString("captured_at").toLong() - low.getString("captured_at").toLong() >= 1700L)
        val high = saver.handle("screen.capture", JSONObject().put("quality", "high").put("cellular_cap", "false"), "fixture")
        val highBytes = android.util.Base64.decode(high.getString("image"), 0)
        val highImage = android.graphics.BitmapFactory.decodeByteArray(highBytes, 0, highBytes.size)
        assertTrue(maxOf(highImage.width, highImage.height) > 480); highImage.recycle()
        suspend fun nodes()=bridge.handle("screen.tree",JSONObject(),"fixture").getJSONArray("nodes")
        suspend fun center(desc:String):Pair<Int,Int> {
            val all=nodes();val node=(0 until all.length()).map { all.getJSONObject(it) }.first { it.optString("description")==desc }
            val b=node.getJSONArray("bounds");return (b.getInt(0)+b.getInt(2))/2 to (b.getInt(1)+b.getInt(3))/2
        }
        fun command(action:String)=JSONObject().put("request_id",UUID.randomUUID().toString()).put("action",action)
        val (x,y)=center("fixture-tap");val tap=command("tap").put("x",x.toString()).put("y",y.toString())
        assertEquals("completed",bridge.handle("screen.control",tap,"fixture").getString("status"))
        bridge.handle("screen.control",tap,"fixture");delay(400)
        val afterTap=nodes().toString(); assertTrue(afterTap,afterTap.contains("Clicks: 1"));assertFalse(nodes().toString().contains("Clicks: 2"))
        val (ix,iy)=center("fixture-input")
        bridge.handle("screen.control",command("tap").put("x",ix.toString()).put("y",iy.toString()),"fixture");delay(400)
        bridge.handle("screen.control",command("type").put("text","Lom real control"),"fixture")
        withTimeout(4000) { while(!nodes().toString().contains("Lom real control")) delay(150) }
        bridge.handle("screen.control",command("home"),"fixture");delay(500)
        assertFalse(bridge.handle("screen.tree",JSONObject(),"fixture").getString("package").endsWith(".test"))
    }
}
