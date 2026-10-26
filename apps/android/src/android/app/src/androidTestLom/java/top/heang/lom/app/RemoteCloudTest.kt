@file:Suppress("INVISIBLE_MEMBER", "INVISIBLE_REFERENCE")
package top.heang.lom.app

import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.openminis.app.MinisApp
import com.openminis.app.data.model.*
import kotlinx.coroutines.*
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import org.junit.Test
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.runner.RunWith
import top.heang.lom.pairing.*
import top.heang.lom.pairing.cloud.*
import top.heang.lom.remote.*

/** Opt-in online smoke, disposable account supplied OUTSIDE the APK/repository. */
@RunWith(AndroidJUnit4::class)
class RemoteCloudTest {
 @Test fun real_cloud_pair_encrypted_rpc_native_agent_and_revoke() = runBlocking {
    val app=ApplicationProvider.getApplicationContext<MinisApp>()
    val config=java.io.File(app.filesDir,"lom-r02-test.json")
    assumeTrue("Requires operator-created disposable cloud account",config.exists())
    val settings=JSONObject(config.readText()); val host=settings.getString("host"); val token=settings.getString("token")
    withTimeout(60000) { while(!app.subsystemsReady()) delay(100) }
    val client=HttpPairingApi.client().newBuilder().protocols(listOf(okhttp3.Protocol.HTTP_1_1)).readTimeout(30,java.util.concurrent.TimeUnit.SECONDS).callTimeout(40,java.util.concurrent.TimeUnit.SECONDS).build()
    suspend fun call(method:String,path:String,body:JSONObject?=null):JSONObject=withContext(Dispatchers.IO) {
        val request=Request.Builder().url("https://$host$path").header("Authorization","Bearer $token")
            .method(method,body?.toString()?.toRequestBody("application/json".toMediaType())).build()
        client.newCall(request).execute().use { response ->
            val json=JSONObject(response.body!!.string())
            check(response.isSuccessful && json.optBoolean("success")) { "cloud.test_failed:${response.code}:${json.optString("code")}" }
            json.optJSONObject("data") ?: JSONObject()
        }
    }
    val x=ByteArray(32) { 7 }; val ed=ByteArray(32) { 8 }
    val desktopKeys="E75P6uryBMf9M1j8nAByGIHRdCeBKCJ-xnTzf3_pe20TmPYsbRpFfFG6aktfPb0vafypMhYhjciZfkFr0X2Tyg"
    val desktop=RemoteCrypto(x,ed,desktopKeys)
    val phone=LomIdentity.loadOrCreate(app)
    val api=HttpPairingApi(client); val store=KeystorePairingStore(app)
    check(store.load()==null) { "Test requires disposable unpaired emulator" }
    val created=call("POST","/v1/pairing/sessions",JSONObject().put("install_id","inst-smoke-"+java.util.UUID.randomUUID()).put("desktop_name","R02 isolated smoke").put("desktop_keys",desktopKeys))
    val pairing=LomPairing.get(app)
    check(pairing.paired.value==null) { "Test requires disposable unpaired emulator" }
    val launch=app.packageManager.getLaunchIntentForPackage(app.packageName)!!
    app.startActivity(launch.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK))
    delay(1500)
    val gateway=pairing.createPairingGateway()
    val challenge=gateway.claim(PairingInput.Manual(created.getString("manual_code")))
    gateway.confirm(challenge.handle)
    pairing.setBackgroundEnabled(true)
    val paired=pairing.paired.value!!
    val deviceId=paired.deviceId
    suspend fun rpc(method:String,payload:JSONObject):JSONObject {
        val id=java.util.UUID.randomUUID().toString().replace("-","")
        val e=desktop.seal(phone.keys,id,JSONObject().put("method",method).put("payload",payload.toString()).put("issued_at",System.currentTimeMillis().toString()).toString())
        val wire=JSONObject().put("id",e.id).put("sender",e.sender).put("recipient",e.recipient).put("ephemeral",e.ephemeral).put("ciphertext",e.ciphertext).put("signature",e.signature)
        val r=call("POST","/v1/devices/${deviceId}/rpc",wire)
        val reply=Envelope(r.getString("id"),r.getString("sender"),r.getString("recipient"),r.getString("ephemeral"),r.getString("ciphertext"),r.getString("signature"))
        assertEquals(id,reply.id)
        val decoded=JSONObject(desktop.open(reply,setOf(phone.keys)))
        assertEquals(decoded.toString(),"ok",decoded.getString("status"))
        return JSONObject(decoded.getString("payload"))
    }
    try {
        withTimeout(30000) { while(pairing.relayStatus.value!=RelayStatus.ONLINE) delay(100) }
        val ui=androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().getUiAutomation(android.app.UiAutomation.FLAG_DONT_SUPPRESS_ACCESSIBILITY_SERVICES)
        ui.executeShellCommand("input keyevent KEYCODE_HOME").close()
        delay(1500)
        assertTrue(top.heang.lom.pairing.cloud.LomConnectionService.running.value)
        assertTrue(rpc("chat.list",JSONObject()).has("items"))
        ui.executeShellCommand("settings put secure enabled_accessibility_services top.heang.lom.agent/com.openminis.app.accessibility.MinisAccessibilityService").close()
        ui.executeShellCommand("settings put secure accessibility_enabled 1").close()
        withTimeout(10000) { while(com.openminis.app.accessibility.MinisAccessibilityService.getInstance()==null) delay(100) }
        val frame=rpc("screen.capture",JSONObject().put("quality","high"))
        assertEquals("image/jpeg",frame.getString("mime")); assertTrue(frame.getString("image").length>100)
        assertTrue(rpc("screen.tree",JSONObject()).getJSONArray("nodes").length()>0)
        val control=JSONObject().put("request_id",java.util.UUID.randomUUID().toString()).put("action","home")
        assertEquals("completed",rpc("screen.control",control).getString("status"))
        assertEquals("completed",rpc("screen.control",control).getString("status"))
        android.util.Log.i("DailyTest", "R02-03 encrypted real screenshot, UI tree and control passed")

        pairing.setBackgroundEnabled(false)
        withTimeout(10000) { while(pairing.relayStatus.value!=RelayStatus.OFFLINE) delay(100) }
        app.startActivity(launch.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK))
        delay(1000); pairing.setBackgroundEnabled(true)
        withTimeout(30000) { while(pairing.relayStatus.value!=RelayStatus.ONLINE) delay(100) }
        ui.executeShellCommand("input keyevent KEYCODE_HOME").close()
        ui.executeShellCommand("svc wifi disable").close()
        ui.executeShellCommand("svc data disable").close()
        try { withTimeout(40000) { while(pairing.relayStatus.value!=RelayStatus.OFFLINE) delay(100) } }
        finally { ui.executeShellCommand("svc wifi enable").close(); ui.executeShellCommand("svc data enable").close() }
        withTimeout(40000) { while(pairing.relayStatus.value!=RelayStatus.ONLINE) delay(100) }
        delay(5000)
        client.connectionPool.evictAll() // Test desktop shares emulator network; real desktop has its own connection.
        assertTrue(rpc("chat.list",JSONObject()).has("items"))
        android.util.Log.i("DailyTest", "network restored and encrypted RPC passed")
        val fileId=java.util.UUID.randomUUID().toString()
        val bytes=ByteArray(128*1024) { (it%127).toByte() }
        val hash=java.security.MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
        rpc("file.begin",JSONObject().put("id",fileId).put("name","cloud-file.txt").put("mime","text/plain").put("size",bytes.size.toString()).put("sha256",hash))
        rpc("file.chunk",JSONObject().put("id",fileId).put("offset","0").put("data",android.util.Base64.encodeToString(bytes,android.util.Base64.NO_WRAP)))
        assertEquals("complete",rpc("file.finish",JSONObject().put("id",fileId)).getString("status"))
        assertArrayEquals(bytes,android.util.Base64.decode(rpc("file.read",JSONObject().put("id",fileId).put("offset","0")).getString("data"),android.util.Base64.NO_WRAP))
        rpc("file.delete",JSONObject().put("id",fileId))
        assertTrue(rpc("schedule.list",JSONObject()).has("exact"))
        android.util.Log.i("DailyTest", "encrypted file roundtrip passed")
        val model=JSONObject().put("base_url","https://model.invalid/v1").put("api_key","FIXTURE_ONLY_NOT_A_REAL_KEY").put("model","fixture-model").put("platform","openai").put("revision",System.currentTimeMillis().toString())
        assertEquals("saved",rpc("model.sync",model).getString("status"))
        val id="lom-"+digest(desktopKeys).take(24)
        assertEquals("FIXTURE_ONLY_NOT_A_REAL_KEY",app.providerRepository.loadApiKey(id))
        val soul=rpc("document.read",JSONObject().put("name","SOUL.md"))
        val changed=rpc("document.write",JSONObject().put("name","SOUL.md").put("text",soul.getString("text")+"\nR02 cloud smoke").put("revision",soul.getString("revision")))
        assertTrue(rpc("document.read",JSONObject().put("name","SOUL.md")).getString("text").endsWith("R02 cloud smoke"))
        rpc("document.write",JSONObject().put("name","SOUL.md").put("text",soul.getString("text")).put("revision",changed.getString("revision")))
        FixtureServer().use { server ->
            val instance=ProviderInstance(id,"Cloud fixture",ProviderType.openAI,ProviderCredential.apiKey,customBaseURL="http://127.0.0.1:${server.port}/v1",appendV1Suffix=false)
            val entry=ModelEntry(id,LLMModel("fixture-model","Fixture",ProviderType.openAI.name),isCustom=true,uuid="$id/fixture-model")
            app.providerRepository.importLomModel(instance,entry,ModelGroup(id=id,name="Cloud fixture",memberEntryIds=mutableListOf(entry.id)),"FIXTURE_ONLY_NOT_A_REAL_KEY")
            val send=JSONObject().put("client_id",java.util.UUID.randomUUID().toString()).put("session_id","").put("text","云端通道测试，只回复你好")
            val receipt=rpc("chat.send",send); val session=receipt.getString("session_id")
            assertEquals(session,rpc("chat.send",send).getString("session_id"))
            val result=withTimeout(60000) {
                var snap:JSONObject
                do { delay(300); snap=rpc("chat.read",JSONObject().put("session_id",session)) } while(snap.getBoolean("running"))
                snap
            }
            assertEquals(result.toString(),"completed",result.getString("status"))
            assertTrue(result.toString().contains("你好，手机本体回复"))
            assertTrue(rpc("chat.list",JSONObject()).toString().contains(session))
        }
        call("DELETE","/v1/devices/${deviceId}")
        withTimeout(10000) { while(pairing.paired.value!=null) delay(100) }
    } finally {
        runCatching { call("DELETE","/v1/devices/${deviceId}") }
        pairing.setBackgroundEnabled(false)
        store.clear()
    }
 }
}
