package top.heang.lom.app

import android.util.Base64
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.openminis.app.MinisApp
import kotlinx.coroutines.*
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.io.ByteArrayOutputStream
import java.io.File
import java.security.MessageDigest
import java.util.UUID
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

@RunWith(AndroidJUnit4::class)
class SkillBridgeTest {
    @Test fun D09_upload_install_read_toggle_delete_and_peer_isolation() = runBlocking<Unit> {
        val app = ApplicationProvider.getApplicationContext<MinisApp>()
        withTimeout(60000) { while (!app.subsystemsReady()) delay(100) }
        val name="d09-"+UUID.randomUUID().toString().take(8)
        val output=ByteArrayOutputStream()
        ZipOutputStream(output).use { zip ->
            for((path,body) in listOf("bundle/SKILL.md" to "---\nname: $name\ndescription: fixture skill\nversion: 1.0\n---\nRead the fixture file.", "bundle/references/note.txt" to "real-file-content")) {
                zip.putNextEntry(ZipEntry(path));zip.write(body.toByteArray());zip.closeEntry()
            }
        }
        val bytes=output.toByteArray();val transfer=UUID.randomUUID().toString();val peer="d09-fixture"
        val bridge=LomAgentBridge(app);var skill:String?=null
        try {
            val hash=MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
            bridge.handle("file.begin",JSONObject().put("id",transfer).put("name","skill.zip").put("mime","application/zip").put("size",bytes.size.toString()).put("sha256",hash),peer)
            bridge.handle("file.chunk",JSONObject().put("id",transfer).put("offset","0").put("data",Base64.encodeToString(bytes,Base64.NO_WRAP)),peer)
            bridge.handle("file.finish",JSONObject().put("id",transfer),peer)
            try { bridge.handle("skills.install",JSONObject().put("id",transfer),"other-peer");fail("Wrong peer imported archive") }
            catch(e:IllegalStateException) { assertEquals("file.missing",e.message) }
            val installed=bridge.handle("skills.install",JSONObject().put("id",transfer),peer);skill=installed.getString("id")
            assertEquals(name,installed.getString("name"))
            val path=File(app.filesDir,"minis-global/skills/$skill/references/note.txt")
            assertEquals("real-file-content",path.readText())
            assertTrue(bridge.handle("skills.list",JSONObject(),peer).getString("items").contains(name))
            assertTrue(bridge.handle("skills.read",JSONObject().put("id",skill),peer).getString("body").contains("fixture file"))
            assertEquals("false",bridge.handle("skills.toggle",JSONObject().put("id",skill).put("enabled","false"),peer).getString("enabled"))
            assertEquals("true",bridge.handle("skills.toggle",JSONObject().put("id",skill).put("enabled","true"),peer).getString("enabled"))
            try { bridge.handle("skills.install",JSONObject().put("id",transfer),peer);fail("Existing skill silently replaced") }
            catch(e:IllegalStateException) { assertEquals("skill.already_exists_or_invalid_name",e.message) }
            bridge.handle("skills.delete",JSONObject().put("id",skill),peer);skill=null
            assertFalse(path.exists());assertFalse(bridge.handle("skills.list",JSONObject(),peer).getString("items").contains(name))
        } finally {
            skill?.let { bridge.handle("skills.delete",JSONObject().put("id",it),peer) }
            bridge.handle("file.delete",JSONObject().put("id",transfer),peer)
        }
    }
}
