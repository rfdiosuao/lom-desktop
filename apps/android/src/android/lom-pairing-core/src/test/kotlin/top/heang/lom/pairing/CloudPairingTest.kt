package top.heang.lom.pairing

import kotlinx.coroutines.test.runTest
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class CloudPairingTest {
    private val vectors = JSONObject(javaClass.getResource("/pairing-v1.json")!!.readText())
    private val case = vectors.getJSONArray("cases").getJSONObject(0)
    private val desktop = case.getJSONObject("desktop")
    private val phoneKeys = case.getJSONObject("phone").getString("keys")
    private val pid = case.getString("pairing_id")

    @Test fun R01_crypto_matches_shared_vectors() {
        for (i in 0 until vectors.getJSONArray("cases").length()) {
            val c = vectors.getJSONArray("cases").getJSONObject(i)
            val d = c.getJSONObject("desktop"); val p = c.getJSONObject("phone")
            val kd = PairingCrypto.keys(PairingCrypto.unb64(d.getString("x25519")), PairingCrypto.unb64(d.getString("ed25519")))
            val kp = PairingCrypto.keys(PairingCrypto.unb64(p.getString("x25519")), PairingCrypto.unb64(p.getString("ed25519")))
            assertEquals(d.getString("keys"), kd)
            assertEquals(d.getString("fingerprint"), PairingCrypto.b64(PairingCrypto.fingerprint(kd)))
            val psk = PairingCrypto.unb64(c.getString("psk"))
            assertEquals(c.getString("key_proof"), PairingCrypto.keyProof(psk, c.getString("pairing_id"), kd, kp))
            assertEquals(c.getString("sas"), PairingCrypto.sas(c.getString("pairing_id"), kd, kp))
            val qr = PairingParser.qr(c.getString("qr"), setOf(c.getString("host")))
            assertEquals(c.getString("pairing_id"), qr.pairingId)
            assertEquals(d.getString("fingerprint"), qr.fingerprint)
        }
        assertEquals(31, vectors.getString("manual_code_alphabet").length)
        for (ch in vectors.getString("manual_code_alphabet"))
            assertEquals("${ch}${ch}${ch}${ch}-2345", PairingParser.manual("$ch$ch$ch${ch}2345").code)
    }

    private class Api(val desktopKeys: String, val pid: String) : PairingApi {
        val calls = mutableListOf<String>()
        var proof: String? = null
        var confirmFailures = mutableListOf<String>()
        override suspend fun inspect(host: String, pairingId: String, claimToken: String): DesktopView {
            calls += "inspect"; return DesktopView(pairingId, "宇航的 MacBook", desktopKeys, "a***@example.com", 4_000_000_000)
        }
        override suspend fun claim(host: String, pairingId: String, claimToken: String, deviceKeys: String,
            info: DeviceInfo, keyProof: String): String { calls += "claim"; proof = keyProof; return "secret" }
        override suspend fun claimByCode(host: String, code: String, deviceKeys: String, info: DeviceInfo): CodeClaim {
            calls += "code:$host:$code"
            return CodeClaim(DesktopView(pid, "宇航的 MacBook", desktopKeys, "a***@example.com", 4_000_000_000), "secret")
        }
        override suspend fun confirm(host: String, pairingId: String, claimSecret: String): Credential {
            calls += "confirm"
            confirmFailures.removeFirstOrNull()?.let { throw PairingFailure(it) }
            return Credential("dev_1", "token", 1, "宇航的 MacBook")
        }
        override suspend fun cancel(host: String, pairingId: String, claimSecret: String) { calls += "cancel" }
    }

    private class Store(var failing: Boolean = false) : PairingStore {
        var state: PairedState? = null
        override suspend fun save(state: PairedState) { if (failing) throw IllegalStateException("disk"); this.state = state }
        override fun load() = state
        override suspend fun clear() { state = null }
    }

    private val identity = object : DeviceIdentity {
        override val keys = phoneKeys
        override val info = DeviceInfo("手机一号", "Redmi K80", "Android 15", "1.14.0")
    }

    private fun gateway(api: Api, store: Store = Store()) =
        CloudPairingGateway(api, identity, store, "example.invalid", now = { 42 }, pause = {})

    private fun qrInput(raw: String = case.getString("qr")) = PairingParser.qr(raw, setOf(case.getString("host")))

    @Test fun R01_qr_claim_sends_vector_key_proof_and_stores_credential_only_after_confirm() = runTest {
        val api = Api(desktop.getString("keys"), pid)
        val store = Store()
        val g = gateway(api, store)
        val challenge = g.claim(qrInput())
        assertNull(challenge.confirmationCode)
        assertEquals(case.getString("key_proof"), api.proof)
        assertNull(store.state)
        api.confirmFailures += listOf("pairing.awaiting_desktop", "net.unreachable")
        val device = g.confirm(challenge.handle)
        assertEquals("宇航的 MacBook", device.desktopName)
        assertEquals("Device dev_1.token", store.state!!.authorization)
        assertEquals(desktop.getString("keys"), store.state!!.desktops.single().keys)
        assertFalse(store.state.toString().contains("token"))
    }

    @Test fun R01_AC6_tampered_desktop_key_is_rejected_before_claim() = runTest {
        val api = Api(case.getJSONObject("phone").getString("keys"), pid)
        try { gateway(api).claim(qrInput()); fail() } catch (e: PairingFailure) {
            assertEquals("pairing.key_mismatch", e.code)
        }
        assertEquals(listOf("inspect"), api.calls)
    }

    @Test fun R01_AC7_code_path_shows_locally_computed_sas() = runTest {
        val api = Api(desktop.getString("keys"), pid)
        val challenge = gateway(api).claim(PairingParser.manual("abcd2345"))
        assertEquals(case.getString("sas"), challenge.confirmationCode)
        assertEquals("code:example.invalid:ABCD-2345", api.calls.single())
    }

    @Test fun R01_confirm_failures_are_reported_not_faked() = runTest {
        val api = Api(desktop.getString("keys"), pid)
        val store = Store(failing = true)
        val g = gateway(api, store)
        val c = g.claim(qrInput())
        try { g.confirm(c.handle); fail() } catch (e: PairingFailure) { assertEquals("pairing.store_failed", e.code) }
        store.failing = false
        g.confirm(c.handle) // retry re-confirms with the same claim secret
        assertNotNull(store.state)

        val g2 = gateway(Api(desktop.getString("keys"), pid).also { it.confirmFailures += List(16) { "pairing.awaiting_desktop" } })
        val c2 = g2.claim(qrInput())
        try { g2.confirm(c2.handle); fail() } catch (e: PairingFailure) { assertEquals("pairing.desktop_timeout", e.code) }
    }

    @Test fun R01_already_paired_phone_must_unpair_first() = runTest {
        val store = Store().apply { state = PairedState("h", "dev_0", "t", 1, emptyList()) }
        val api = Api(desktop.getString("keys"), pid)
        try { gateway(api, store).claim(qrInput()); fail() } catch (e: PairingFailure) {
            assertEquals("pairing.already_paired", e.code)
        }
        assertTrue(api.calls.isEmpty())
    }

    @Test fun R02_backoff_schedule_with_jitter() {
        assertEquals(listOf(1000L, 2000L, 5000L, 10000L, 30000L, 30000L), (0..5).map { RelayBackoff.delayMillis(it, 0.0) })
        assertEquals(1200L, RelayBackoff.delayMillis(0, 1.0))
        assertEquals(24000L, RelayBackoff.delayMillis(9, -1.0))
    }
}
