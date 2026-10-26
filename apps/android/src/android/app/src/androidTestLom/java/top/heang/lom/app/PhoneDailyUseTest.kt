package top.heang.lom.app

import android.util.Base64
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.openminis.app.MinisApp
import com.openminis.app.data.model.*
import com.openminis.app.scheduled.ScheduledTaskManager
import kotlinx.coroutines.*
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.util.UUID

@RunWith(AndroidJUnit4::class)
class PhoneDailyUseTest {
    private val peer="daily-use-fixture"
    private suspend fun app(): MinisApp = ApplicationProvider.getApplicationContext<MinisApp>().also {
        withTimeout(60000) { while(!it.subsystemsReady()) delay(100) }
    }
    private suspend fun rejects(code: String, action: suspend () -> Unit) {
        try { action(); fail("Expected $code") } catch(e: IllegalArgumentException) { assertEquals(code,e.message) }
        catch(e: IllegalStateException) { assertEquals(code,e.message) }
    }
    @Test fun R02_02_files_multichunk_retry_integrity_isolation_and_native_attachment() = runBlocking<Unit> {
        val app=app(); val bridge=LomAgentBridge(app); val id=UUID.randomUUID().toString()
        val data=ByteArray(300001) { (it%127).toByte() }
        val hash=java.security.MessageDigest.getInstance("SHA-256").digest(data).joinToString("") { "%02x".format(it) }
        val begin=JSONObject().put("id",id).put("name","daily-test.txt").put("mime","text/plain").put("size",data.size.toString()).put("sha256",hash)
        bridge.handle("file.begin",begin,peer)
        rejects("file.invalid_id") { bridge.handle("file.status",JSONObject().put("id","../../secret"),peer) }
        rejects("file.missing") { bridge.handle("file.status",JSONObject().put("id",id),"other-peer") }
        rejects("file.integrity_failed") { bridge.handle("file.finish",JSONObject().put("id",id),peer) }
        var offset=0
        while(offset<data.size) {
            val bytes=data.copyOfRange(offset,minOf(offset+128*1024,data.size))
            val chunk=JSONObject().put("id",id).put("offset",offset.toString()).put("data",Base64.encodeToString(bytes,Base64.NO_WRAP))
            val first=bridge.handle("file.chunk",chunk,peer)
            assertEquals(first.getString("offset"),bridge.handle("file.chunk",chunk,peer).getString("offset"))
            offset+=bytes.size
        }
        assertEquals("complete",bridge.handle("file.finish",JSONObject().put("id",id),peer).getString("status"))
        val copy=java.io.ByteArrayOutputStream(); offset=0
        while(offset<data.size) {
            val part=bridge.handle("file.read",JSONObject().put("id",id).put("offset",offset.toString()),peer)
            copy.write(Base64.decode(part.getString("data"),Base64.NO_WRAP)); offset=part.getString("next").toInt()
        }
        assertArrayEquals(data,copy.toByteArray())
        FixtureServer().use { server ->
            installModel(app,server.port)
            val send=JSONObject().put("client_id",UUID.randomUUID().toString()).put("session_id","").put("text","查看附件").put("files",JSONArray(listOf(id)).toString())
            val session=bridge.handle("chat.send",send,peer).getString("session_id")
            val snapshot=withTimeout(90000) {
                var result:JSONObject
                do { delay(200); result=bridge.handle("chat.read",JSONObject().put("session_id",session),peer) } while(result.getBoolean("running"))
                result
            }
            assertTrue(snapshot.toString().contains("daily-test.txt"))
            val rows=snapshot.getJSONArray("items")
            val user=(0 until rows.length()).map { rows.getJSONObject(it) }.first { it.getString("role")=="user" }
            val exported=bridge.handle("chat.file",JSONObject().put("session_id",session).put("message_id",user.getString("id")).put("index","0"),peer)
            assertEquals(hash,exported.getString("sha256"))
            bridge.handle("file.delete",JSONObject().put("id",exported.getString("id")),peer)

            val persisted=app.chatRepository.dao.loadMessages(session)
            assertTrue(persisted.any { it.role=="assistant" && remoteStoredText(JSONArray(it.partsJson)).contains("你好") })
            val uploaded=java.io.File(app.filesDir,"minis-sessions/$session/attachments/uploads/daily-test.txt")
            assertTrue("Native agent sandbox attachment must exist",uploaded.exists())
            assertArrayEquals(data,uploaded.readBytes())
            bridge.handle("chat.delete",JSONObject().put("session_id",session),peer)
        }
        bridge.handle("file.delete",JSONObject().put("id",id),peer)
    }
    @Test fun R02_02_schedule_crud_conflicts_and_real_alarm_execution() = runBlocking<Unit> {
        val app=app(); val bridge=LomAgentBridge(app)
        FixtureServer().use { server ->
            installModel(app,server.port)
            val id=UUID.randomUUID().toString()
            val next=java.time.LocalDateTime.now().plusMinutes(1).withSecond(0).withNano(0)
            val p=JSONObject().put("id",id).put("revision","").put("name","Daily smoke")
                .put("prompt","仅回复你好").put("freq","once").put("time",next.toString()).put("days","[]")
                .put("every","60").put("enabled","false").put("session_id","")
            val saved=bridge.handle("schedule.save",p,peer)
            assertEquals(id,bridge.handle("schedule.save",p,peer).getString("id"))
            assertEquals(1,ScheduledTaskManager(app).list().count { it.id==id })
            p.put("revision","stale")
            rejects("sync.conflict") { bridge.handle("schedule.save",p,peer) }
            val savedModel=ScheduledTaskManager(app).get(id)!!.modelBinding
            assertTrue(savedModel!!.contains("lom-schedule-"))
            bridge.handle("model.sync",JSONObject().put("base_url","https://model.invalid/v1").put("api_key","changed-fixture")
                .put("model","different-model").put("platform","openai").put("revision",System.currentTimeMillis().toString()),peer)
            assertEquals(savedModel,ScheduledTaskManager(app).get(id)!!.modelBinding)
            val enabled=bridge.handle("schedule.toggle",JSONObject().put("id",id).put("revision",saved.getString("revision")).put("enabled","true"),peer)
            try {
                val task=withTimeout(100000) {
                    while(ScheduledTaskManager(app).get(id)!!.runHistory.isEmpty()) delay(500)
                    ScheduledTaskManager(app).get(id)!!
                }
                assertFalse(task.enabled)
                assertTrue("Pinned fixture must receive request; calls=${server.calls.get()}",server.calls.get()>0)
                assertTrue("Scheduled result: ${task.runHistory.first().preview}",task.runHistory.first().ok)
                assertTrue(task.runHistory.first().preview!!.contains("你好"))
                assertNotNull(task.runHistory.first().sessionId)
                assertEquals(1,task.runHistory.size)
                val existing=app.chatRepository.createSession("different-model", "Append fixture")
                val wrong="lom-"+digest(peer).take(24)+"/different-model"
                app.chatRepository.updateSessionBinding(existing.id,JSONObject().put("type","entry").put("entryId",wrong).toString(),"different-model")
                val append=task.copy(id=UUID.randomUUID().toString(),targetMode=com.openminis.app.scheduled.ScheduledTargetMode.AppendToSession(existing.id),runHistory=emptyList())
                ScheduledTaskManager(app).create(append)
                try {
                    com.openminis.app.scheduled.ScheduledAgentRunner.run(app,append,waitForCompletion=true)
                    val result=ScheduledTaskManager(app).get(append.id)!!.runHistory.first()
                    assertTrue("Append pinned model: ${result.preview}",result.ok)
                    assertTrue(result.preview!!.contains("你好"))
                } finally { ScheduledTaskManager(app).delete(append.id) }

                val listing=bridge.handle("schedule.list",JSONObject(),peer)
                assertTrue(listing.has("exact")); assertTrue(listing.getString("items").contains(id))
            } finally {
                val list=JSONArray(bridge.handle("schedule.list",JSONObject(),peer).getString("items"))
                val latest=(0 until list.length()).map { list.getJSONObject(it) }.first { it.getString("id")==id }
                bridge.handle("schedule.delete",JSONObject().put("id",id).put("revision",latest.getString("revision")),peer)
            }
            assertNull(ScheduledTaskManager(app).get(id))
        }
    }
    private suspend fun installModel(app:MinisApp,port:Int) {
        val id="lom-"+digest(peer).take(24)
        val instance=ProviderInstance(id,"Fixture",ProviderType.openAI,ProviderCredential.apiKey,customBaseURL="http://127.0.0.1:$port/v1",appendV1Suffix=false)
        val entry=ModelEntry(id,LLMModel("fixture-model","Fixture",ProviderType.openAI.name),isCustom=true,uuid="$id/fixture-model")
        app.providerRepository.importLomModel(instance,entry,ModelGroup(id=id,name="Fixture",memberEntryIds=mutableListOf(entry.id)),"fixture-only")
    }
}
