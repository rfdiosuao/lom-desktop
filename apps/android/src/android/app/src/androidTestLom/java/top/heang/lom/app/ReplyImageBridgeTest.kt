package top.heang.lom.app

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.Base64
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.openminis.app.MinisApp
import kotlinx.coroutines.*
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.security.MessageDigest

/** Local emulator fixture: no model call, account token or external service. */
@RunWith(AndroidJUnit4::class)
class ReplyImageBridgeTest {
    @Test fun D08_generated_image_export_chunks_restart_and_peer_isolation() = runBlocking<Unit> {
        val app = ApplicationProvider.getApplicationContext<MinisApp>()
        withTimeout(60000) { while (!app.subsystemsReady()) delay(100) }
        val session = app.chatRepository.createSession("fixture", "D08 image fixture")
        val peer = "d08-image-fixture"
        val source = File(app.filesDir, "minis-sessions/${session.id}/workspace/设计稿.png")
        source.parentFile!!.mkdirs()
        val bitmap = Bitmap.createBitmap(320, 200, Bitmap.Config.ARGB_8888)
        bitmap.eraseColor(0xff249957.toInt())
        source.outputStream().use { assertTrue(bitmap.compress(Bitmap.CompressFormat.PNG, 100, it)) }
        bitmap.recycle()
        val bytes = source.readBytes()
        val bridge = LomAgentBridge(app)
        var transfer: String? = null
        try {
            val request = JSONObject().put("session_id", session.id).put("source", "minis://workspace/设计稿.png")
            val image = bridge.handle("chat.image", request, peer)
            transfer = image.getString("id")
            assertEquals("image/png", image.getString("mime"))
            assertEquals("complete", image.getString("status"))
            assertEquals(MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }, image.getString("sha256"))
            assertEquals(transfer, LomAgentBridge(app).handle("chat.image", request, peer).getString("id"))
            assertTrue(source.delete())
            val read = JSONObject().put("id", transfer).put("offset", "0")
            val received = Base64.decode(LomAgentBridge(app).handle("file.read", read, peer).getString("data"), Base64.NO_WRAP)
            assertArrayEquals(bytes, received)
            val restored = BitmapFactory.decodeByteArray(received, 0, received.size)
            assertEquals(320, restored.width); assertEquals(200, restored.height); restored.recycle()
            try { bridge.handle("file.read", read, "other-peer"); fail("Other peer must not read this export") }
            catch (e: IllegalStateException) { assertEquals("file.incomplete", e.message) }
        } finally {
            transfer?.let { bridge.handle("file.delete", JSONObject().put("id", it), peer) }
            bridge.handle("chat.delete", JSONObject().put("session_id", session.id), peer)
            source.delete()
        }
    }
}
