package top.heang.lom.app

import android.graphics.Bitmap
import android.net.Uri
import android.util.Base64
import androidx.test.core.app.ApplicationProvider
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.openminis.app.MinisApp
import kotlinx.coroutines.*
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.io.ByteArrayOutputStream
import java.util.UUID
import top.heang.lom.pairing.cloud.LomDeviceName

@RunWith(AndroidJUnit4::class)
class GalleryNameTest {
    @Test fun D13_actual_gallery_bytes_idempotency_incomplete_and_peer_isolation() = runBlocking<Unit> {
        val app = ApplicationProvider.getApplicationContext<MinisApp>()
        withTimeout(60000) { while (!app.subsystemsReady()) delay(100) }
        val bridge = LomAgentBridge(app)
        val png = ByteArrayOutputStream().also { Bitmap.createBitmap(4, 4, Bitmap.Config.ARGB_8888).compress(Bitmap.CompressFormat.PNG, 100, it) }.toByteArray()
        val video = InstrumentationRegistry.getInstrumentation().context.assets.open("d13-video.mp4").use { it.readBytes() }
        for ((name, bytes) in listOf("test.png" to png, "test.mp4" to video, "fake.png" to "not an image".toByteArray())) {
            val id = UUID.randomUUID().toString(); val peer = "d13-test"; val req = JSONObject().put("id", id)
            var uri: Uri? = null
            val sha = java.security.MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
            try {
                bridge.handle("file.begin", JSONObject().put("id",id).put("name",name).put("mime","image/png").put("size",bytes.size.toString()).put("sha256",sha), peer)
                try { bridge.handle("file.save_gallery",req,peer); fail("incomplete export") } catch (e: IllegalStateException) { assertEquals("file.incomplete_or_corrupt", e.message) }
                bridge.handle("file.chunk", JSONObject().put("id",id).put("offset","0").put("data",Base64.encodeToString(bytes,Base64.NO_WRAP)), peer)
                bridge.handle("file.finish", req, peer)
                try { bridge.handle("file.save_gallery",req,"other-peer"); fail("cross-peer export") } catch (e: IllegalStateException) { assertEquals("file.missing", e.message) }
                if (name == "fake.png") {
                    var rejected = false
                    try { bridge.handle("file.save_gallery",req,peer) } catch (e: Exception) { rejected = true }
                    assertTrue("forged image accepted", rejected)
                } else {
                    val saved = bridge.handle("file.save_gallery",req,peer)
                    assertEquals("saved", saved.getString("status")); uri = Uri.parse(saved.getString("uri"))
                    assertArrayEquals(bytes, app.contentResolver.openInputStream(uri)!!.use { it.readBytes() })
                    // Recreate handler to model a process restart; disk receipt must prevent duplicates.
                    assertEquals(uri.toString(), LomAgentBridge(app).handle("file.save_gallery",req,peer).getString("uri"))
                    app.contentResolver.query(uri, arrayOf(android.provider.MediaStore.MediaColumns.IS_PENDING),null,null,null)!!.use {
                        assertTrue(it.moveToFirst()); assertEquals(0,it.getInt(0))
                    }
                }
            } finally {
                uri?.let { app.contentResolver.delete(it,null,null) }
                bridge.handle("file.delete",req,peer)
            }
        }
    }
    @Test fun D13_name_rpc_persists_and_updates_phone_display_without_system_rename() = runBlocking<Unit> {
        val app = ApplicationProvider.getApplicationContext<MinisApp>()
        withTimeout(60000) { while (!app.subsystemsReady()) delay(100) }
        val old = LomDeviceName.read(app)
        val system = android.provider.Settings.Global.getString(app.contentResolver, android.provider.Settings.Global.DEVICE_NAME)
        try {
            val reply = LomAgentBridge(app).handle("device.rename",JSONObject().put("name","测试手机 · D13"),"d13-test")
            assertEquals("测试手机 · D13", reply.getString("name"))
            assertEquals("测试手机 · D13", LomDeviceName.read(app))
            assertEquals("测试手机 · D13", LomDeviceName.state.value)
            assertEquals(system, android.provider.Settings.Global.getString(app.contentResolver,android.provider.Settings.Global.DEVICE_NAME))
            try { LomDeviceName.save(app," "); fail("blank name accepted") } catch (e: IllegalArgumentException) { assertEquals("device.invalid_name",e.message) }
        } finally { LomDeviceName.save(app,old) }
    }
}
