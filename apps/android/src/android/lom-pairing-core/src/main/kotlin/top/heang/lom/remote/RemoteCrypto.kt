package top.heang.lom.remote

import com.google.crypto.tink.subtle.ChaCha20Poly1305
import com.google.crypto.tink.subtle.Ed25519Sign
import com.google.crypto.tink.subtle.Ed25519Verify
import com.google.crypto.tink.subtle.Hkdf
import com.google.crypto.tink.subtle.X25519
import top.heang.lom.pairing.PairingCrypto

/** R02-01. Signature authenticates both routing metadata and ciphertext. */
class RemoteCrypto(private val x: ByteArray, private val ed: ByteArray, val keys: String) {
    private fun aad(e: Envelope) = "LOM-REMOTE-V1\n${e.id}\n${e.sender}\n${e.recipient}\n${e.ephemeral}".toByteArray()
    private fun cipher(shared: ByteArray, aad: ByteArray): ChaCha20Poly1305 {
        require(shared.any { it != 0.toByte() }) { "remote.invalid_key" }
        return ChaCha20Poly1305(Hkdf.computeHkdf("HmacSha256", shared, ByteArray(32), aad, 32))
    }
    fun seal(recipient: String, id: String, text: String): Envelope {
        require(text.toByteArray().size <= 350000 && id.length == 32) { "remote.payload_invalid" }
        val peer = PairingCrypto.unb64(recipient)
        require(peer.size == 64) { "remote.invalid_key" }
        val ephemeral = X25519.generatePrivateKey()
        val e = Envelope(id, keys, recipient, PairingCrypto.b64(X25519.publicFromPrivate(ephemeral)), "", "")
        val a = aad(e)
        val body = cipher(X25519.computeSharedSecret(ephemeral, peer.copyOfRange(0,32)), a).encrypt(text.toByteArray(), a)
        return e.copy(ciphertext = PairingCrypto.b64(body), signature = PairingCrypto.b64(Ed25519Sign(ed).sign(a + body)))
    }
    fun open(e: Envelope, trusted: Set<String>): String {
        require(e.recipient == keys && e.sender in trusted) { "remote.untrusted_peer" }
        val peer = PairingCrypto.unb64(e.sender)
        require(peer.size == 64 && e.id.length == 32) { "remote.invalid_key" }
        val a = aad(e); val body = PairingCrypto.unb64(e.ciphertext)
        require(body.size in 28..400000) { "remote.payload_invalid" }
        Ed25519Verify(peer.copyOfRange(32,64)).verify(PairingCrypto.unb64(e.signature), a + body)
        val eph = PairingCrypto.unb64(e.ephemeral)
        require(eph.size == 32) { "remote.invalid_key" }
        return cipher(X25519.computeSharedSecret(x, eph), a).decrypt(body, a).toString(Charsets.UTF_8)
    }
}
