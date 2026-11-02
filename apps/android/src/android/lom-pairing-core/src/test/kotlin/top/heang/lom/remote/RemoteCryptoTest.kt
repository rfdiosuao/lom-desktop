package top.heang.lom.remote
import org.junit.Test
import org.junit.Assert.*
import org.json.JSONObject
import java.io.File
import com.google.crypto.tink.subtle.X25519
import com.google.crypto.tink.subtle.Ed25519Sign
import top.heang.lom.pairing.PairingCrypto
class RemoteCryptoTest {
    @Test fun r02_rust_to_kotlin_and_kotlin_to_rust() {
        val raw=javaClass.getResource("/remote-envelope-v1.json")!!.readText()
        val vector=JSONObject(raw);val v=vector.getJSONObject("envelope")
        val e=Envelope(v.getString("id"),v.getString("sender"),v.getString("recipient"),v.getString("ephemeral"),v.getString("ciphertext"),v.getString("signature"))
        val phone=RemoteCrypto(ByteArray(32){9},ByteArray(32){10},vector.getString("recipient"))
        assertEquals("模型同步：test-key",phone.open(e,setOf(vector.getString("sender"))))
        assertThrows(Exception::class.java){phone.open(e.copy(id="b".repeat(32)),setOf(e.sender))}
        assertThrows(Exception::class.java){phone.open(e,emptySet())}
        val reply=phone.seal(e.sender,e.id,"手机回复：ok")
        val desktop=RemoteCrypto(ByteArray(32){7},ByteArray(32){8},e.sender)
        assertEquals("手机回复：ok",desktop.open(reply,setOf(phone.keys)))
        System.getenv("LOM_VECTOR_REVERSE")?.let { path ->
            File(path).writeText(JSONObject().put("id",reply.id).put("sender",reply.sender).put("recipient",reply.recipient)
                .put("ephemeral",reply.ephemeral).put("ciphertext",reply.ciphertext).put("signature",reply.signature).toString())
        }
    }
}
