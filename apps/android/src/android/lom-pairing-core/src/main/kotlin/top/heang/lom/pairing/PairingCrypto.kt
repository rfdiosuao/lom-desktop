package top.heang.lom.pairing

import java.security.MessageDigest
import java.util.Base64
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

/** R01 §2.8 pairing math. Verified against bundled test vectors: pairing-v1.json. */
object PairingCrypto {
    fun b64(bytes: ByteArray): String = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)
    fun unb64(s: String): ByteArray = Base64.getUrlDecoder().decode(s)

    /** Public key string K = b64url(x25519 public key || ed25519 public key). */
    fun keys(x25519: ByteArray, ed25519: ByteArray): String {
        require(x25519.size == 32 && ed25519.size == 32)
        return b64(x25519 + ed25519)
    }

    fun validKeys(k: String): Boolean =
        k.length == 86 && runCatching { unb64(k).size == 64 && b64(unb64(k)) == k }.getOrDefault(false)

    fun fingerprint(keys: String): ByteArray =
        sha256("LOM-KEY-FP-V1\n$keys").copyOf(16)

    fun keyProof(psk: ByteArray, pairingId: String, desktopKeys: String, phoneKeys: String): String {
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(psk, "HmacSHA256"))
        return b64(mac.doFinal("LOM-PAIR-PROOF-V1\n$pairingId\n$desktopKeys\n$phoneKeys".toByteArray()))
    }

    fun sas(pairingId: String, desktopKeys: String, phoneKeys: String): String {
        val d = sha256("LOM-PAIR-SAS-V1\n$pairingId\n$desktopKeys\n$phoneKeys")
        val n = ((d[0].toLong() and 0xff) shl 24) or ((d[1].toLong() and 0xff) shl 16) or
            ((d[2].toLong() and 0xff) shl 8) or (d[3].toLong() and 0xff)
        return (n % 1_000_000).toString().padStart(6, '0')
    }

    /** Constant-time comparison for fingerprints. */
    fun same(a: ByteArray, b: ByteArray): Boolean = MessageDigest.isEqual(a, b)

    private fun sha256(s: String) = MessageDigest.getInstance("SHA-256").digest(s.toByteArray())
}
