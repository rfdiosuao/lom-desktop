package top.heang.lom.app

import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.openminis.app.MinisApp
import com.openminis.app.data.model.*
import kotlinx.coroutines.*
import org.json.JSONObject
import org.junit.Test
import org.junit.Assert.*
import org.junit.runner.RunWith
import java.net.ServerSocket
import java.util.concurrent.atomic.AtomicInteger

/** Disposable emulator only. Loopback provider is a deterministic protocol fixture, not a live AI claim. */
@RunWith(AndroidJUnit4::class)
class RemoteBridgeTest {
    @Test fun model_documents_native_chat_retry_and_stop() = runBlocking {
        val app=ApplicationProvider.getApplicationContext<MinisApp>()
        withTimeout(60000) { while(!app.subsystemsReady()) delay(100) }
        val bridge=LomAgentBridge(app)
        val peer="emulator-fixture-desktop"
        val model=JSONObject().put("base_url","https://model.invalid/v1").put("api_key","fixture-key-only")
            .put("model","fixture-model").put("platform","openai").put("revision",System.currentTimeMillis().toString())
        assertEquals("saved",bridge.handle("model.sync",model,peer).getString("status"))
        val instanceId="lom-"+digest(peer).take(24)
        assertEquals("fixture-key-only",app.providerRepository.loadApiKey(instanceId))
        assertEquals(instanceId,app.providerRepository.config.value.defaultPrimaryGroupId)
        val soul=bridge.handle("document.read",JSONObject().put("name","SOUL.md"),peer)
        val saved=bridge.handle("document.write",JSONObject().put("name","SOUL.md").put("text","测试人格：简短中文回答")
            .put("revision",soul.getString("revision")),peer)
        try {
            bridge.handle("document.write",JSONObject().put("name","SOUL.md").put("text","不应覆盖").put("revision",soul.getString("revision")),peer)
            fail("stale revision must fail")
        } catch(e:IllegalStateException) { assertEquals("sync.conflict",e.message) }
        assertEquals("测试人格：简短中文回答",bridge.handle("document.read",JSONObject().put("name","SOUL.md"),peer).getString("text"))
        bridge.handle("document.write",JSONObject().put("name","SOUL.md").put("text",soul.getString("text")).put("revision",saved.getString("revision")),peer)
        try { bridge.handle("document.read",JSONObject().put("name","../secret"),peer); fail("path traversal") }
        catch(e:IllegalArgumentException) { assertEquals("sync.invalid_name",e.message) }
        FixtureServer().use { server ->
            val instance=ProviderInstance(instanceId,"Fixture",ProviderType.openAI,ProviderCredential.apiKey,
                customBaseURL="http://127.0.0.1:${server.port}/v1",appendV1Suffix=false)
            val entry=ModelEntry(instanceId,LLMModel("fixture-model","Fixture",ProviderType.openAI.name),isCustom=true,uuid="$instanceId/fixture-model")
            app.providerRepository.importLomModel(instance,entry,ModelGroup(id=instanceId,name="Fixture",memberEntryIds=mutableListOf(entry.id)),"fixture-key-only")
            val request=JSONObject().put("client_id",java.util.UUID.randomUUID().toString()).put("session_id","").put("text","仅回复你好")
            val receipt=bridge.handle("chat.send",request,peer)
            val session=receipt.getString("session_id")
            assertEquals(session,bridge.handle("chat.send",request,peer).getString("session_id"))
            suspend fun completed():JSONObject = withTimeout(90000) {
                var snap:JSONObject
                do { delay(200); snap=bridge.handle("chat.read",JSONObject().put("session_id",session),peer) } while(snap.getBoolean("running"))
                snap
            }
            val first=completed()
            assertEquals(first.toString(),"completed",first.getString("status"))
            assertTrue(first.toString(),first.toString().contains("你好，手机本体回复"))
            val second=JSONObject().put("client_id",java.util.UUID.randomUUID().toString()).put("session_id",session).put("text","再回复一次")
            bridge.handle("chat.send",second,peer)
            val again=completed()
            assertEquals("completed",again.getString("status"))
            assertEquals(2,(0 until again.getJSONArray("items").length()).count { again.getJSONArray("items").getJSONObject(it).getString("role")=="user" })
            assertTrue(server.calls.get()>=2)
            server.slow=true
            bridge.handle("chat.send",JSONObject().put("client_id",java.util.UUID.randomUUID().toString()).put("session_id",session).put("text","停止测试"),peer)
            delay(600)
            assertEquals("cancelled",bridge.handle("chat.cancel",JSONObject().put("session_id",session),peer).getString("status"))
            assertFalse(bridge.handle("chat.read",JSONObject().put("session_id",session),peer).getBoolean("running"))
            assertTrue(bridge.handle("chat.list",JSONObject(),peer).toString().contains(session))
            bridge.handle("chat.rename",JSONObject().put("session_id",session).put("title","Remote renamed"),peer)
            bridge.handle("chat.pin",JSONObject().put("session_id",session).put("pinned",true),peer)
            assertEquals("Remote renamed",app.chatRepository.dao.getSession(session)!!.title)
            assertNotNull(app.chatRepository.dao.getSession(session)!!.pinnedAt)
            bridge.handle("chat.delete",JSONObject().put("session_id",session),peer)
            assertNull(app.chatRepository.dao.getSession(session))
        }
    }
}
internal class FixtureServer:java.io.Closeable {
    private val socket=ServerSocket(0)
    val port get()=socket.localPort
    val calls=AtomicInteger()
    @Volatile var slow=false
    private val scope=CoroutineScope(SupervisorJob()+Dispatchers.IO)
    init { scope.launch { while(isActive) {
        val client=try { socket.accept() } catch(e:Exception) { break }
        launch { client.use { c ->
            val input=c.getInputStream().buffered()
            fun line():String? {
                val out=java.io.ByteArrayOutputStream()
                while(true) { val byte=input.read(); if(byte<0) return null; if(byte==10) break; if(byte!=13) out.write(byte) }
                return out.toString("UTF-8")
            }
            val first=line() ?: return@use
            var size=0; var chunked=false
            while(true) { val line=line() ?: return@use; if(line.isEmpty()) break
                if(line.startsWith("Transfer-Encoding:",true) && line.contains("chunked",true)) chunked=true
                if(line.startsWith("Content-Length:",true)) size=line.substringAfter(':').trim().toInt()
            }
            var left=size; val buf=ByteArray(4096)
            while(left>0) { val n=input.read(buf,0,minOf(left,buf.size)); if(n<0) break; left-=n }
            if(chunked) {
                while(true) {
                    val count=(line() ?: return@use).substringBefore(';').trim().toInt(16)
                    if(count==0) { while(!line().isNullOrEmpty()) {} ; break }
                    var remain=count
                    while(remain>0) { val n=input.read(buf,0,minOf(remain,buf.size)); if(n<0) return@use; remain-=n }
                    line()
                }
            }
            val body=if(first.contains("chat/completions")) {
                calls.incrementAndGet(); if(slow) delay(30000)
                "data: {\"id\":\"fixture\",\"object\":\"chat.completion.chunk\",\"choices\":[{\"index\":0,\"delta\":{\"role\":\"assistant\",\"content\":\"你好，手机本体回复\"},\"finish_reason\":null}]}\n\n"+
                "data: {\"id\":\"fixture\",\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n"
            } else "{\"data\":[]}"
            val bytes=body.toByteArray()
            val header="HTTP/1.1 200 OK\r\nContent-Type: ${if(first.contains("chat/completions")) "text/event-stream" else "application/json"}\r\nContent-Length: ${bytes.size}\r\nConnection: close\r\n\r\n"
            runCatching { c.getOutputStream().write(header.toByteArray()+bytes); c.getOutputStream().flush() }
        } }
    } } }
    override fun close() { socket.close(); scope.cancel() }
}
