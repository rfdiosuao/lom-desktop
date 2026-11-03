package top.heang.lom.pairing

import java.net.URI
import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction
import java.util.Base64
import java.util.Locale

object PairingParser {
    // R01 has not fixed the 32-character alphabet. Reject explicitly excluded
    // ambiguous characters here; the service must enforce its final alphabet.
    fun manual(raw: String): PairingInput.Manual {
        val code = raw.trim().replace("-", "").replace(" ", "").uppercase(Locale.ROOT)
        if (!code.matches(Regex("[A-HJ-KM-NP-Z2-9]{8}"))) fail("pairing.code_invalid")
        return PairingInput.Manual(code.chunked(4).joinToString("-"))
    }

    fun qr(raw: String, allowedHosts: Set<String>, allowLan: Boolean = false): PairingInput.Qr {
        if (raw.length > 2048) fail()
        val uri = try { URI(raw) } catch (_: Exception) { fail() }
        if (uri.scheme != "lom" || uri.rawAuthority != "pair" ||
            !uri.rawPath.isNullOrEmpty() || uri.rawFragment != null) fail()
        val parts = uri.rawQuery?.split('&') ?: fail()
        val fields = mutableMapOf<String, String>()
        for (part in parts) {
            val pair = part.split('=', limit = 2)
            if (pair.size != 2 || fields.put(pair[0], pair[1]) != null) fail()
        }
        if (fields.keys != setOf("v", "h", "p", "t", "k", "f") || fields["v"] != "1") fail()
        val hostBytes = decode(fields.getValue("h"))
        val host = try {
            Charsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
                .decode(ByteBuffer.wrap(hostBytes)).toString()
        } catch (_: Exception) { fail() }
        val lan = allowLan && isLanHost(host)
        if (!lan && (!host.matches(Regex("[a-z0-9]+(?:[.-][a-z0-9]+)*")) || host !in allowedHosts)) fail()
        for ((key, length) in mapOf("p" to 16, "t" to 32, "k" to 32, "f" to 16)) {
            if (decode(fields.getValue(key)).size != length) fail()
        }
        return PairingInput.Qr(host, fields.getValue("p"), fields.getValue("t"),
            fields.getValue("k"), fields.getValue("f"))
    }

    private fun isLanHost(host: String): Boolean {
        val parts = host.split(":")
        if (parts.size != 2) return false
        val port = parts[1].toIntOrNull() ?: return false
        if (port !in 1024..65535) return false
        val o = parts[0].split(".").mapNotNull { it.toIntOrNull() }
        if (o.size != 4 || o.any { it !in 0..255 }) return false
        return o[0] == 10 || (o[0] == 192 && o[1] == 168) || (o[0] == 172 && o[1] in 16..31)
    }

    private fun decode(raw: String): ByteArray {
        if (!raw.matches(Regex("[A-Za-z0-9_-]+"))) fail()
        val bytes = try { Base64.getUrlDecoder().decode(raw) } catch (_: Exception) { fail() }
        if (Base64.getUrlEncoder().withoutPadding().encodeToString(bytes) != raw) fail()
        return bytes
    }

    private fun fail(code: String = "pairing.qr_invalid"): Nothing = throw PairingFailure(code)
}
