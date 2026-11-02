package top.heang.lom.pairing

import java.util.Base64
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.ExperimentalCoroutinesApi
import org.junit.Assert.*
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class PairingTest {
    private fun b64(bytes: ByteArray) = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)
    private fun qr(host: String = "pair.example.test") = "lom://pair?v=1&h=${b64(host.toByteArray())}" +
        "&p=${b64(ByteArray(16) { 1 })}&t=${b64(ByteArray(32) { 2 })}" +
        "&k=${b64(ByteArray(32) { 3 })}&f=${b64(ByteArray(16) { 4 })}"
    private val hosts = setOf("pair.example.test")
    private fun assertFailure(code: String, action: () -> Unit) {
        try { action(); fail("Expected $code") } catch (e: PairingFailure) { assertEquals(code, e.code) }
    }

    @Test fun R01_manual_normalizes_case_and_separator() {
        assertEquals("ABCD-2345", PairingParser.manual(" abcd 2345 ").code)
        for (bad in listOf("ABCD-234", "ABCD-23456", "ABCD-23O5", "ABCD-2315", "ABCD-23I5", "ABCD-23L5"))
            assertFailure("pairing.code_invalid") { PairingParser.manual(bad) }
    }

    @Test fun R01_AC5_qr_is_strict_and_host_is_allowlisted() {
        assertEquals("pair.example.test", PairingParser.qr(qr(), hosts).host)
        for (bad in listOf(qr("evil.test"), qr() + "&v=1", qr() + "#extra", qr().replace("v=1", "v=2"),
            qr().replace("lom://pair", "https://pair"), qr().replace("&p=", "&unknown="),
            qr().replace("&t=", "&t=="), qr().replace("&f=", "&f=X"), qr().replace("lom://pair?", "lom://pair/path?")))
            assertFailure("pairing.qr_invalid") { PairingParser.qr(bad, hosts) }
    }

    @Test fun R01_credentials_are_not_in_diagnostic_strings() {
        assertEquals("Qr([REDACTED])", PairingParser.qr(qr(), hosts).toString())
        assertEquals("Manual([REDACTED])", PairingParser.manual("ABCD2345").toString())
    }

    @Test fun R01_scan_retry_clears_old_permission_error() = runTest {
        val c = PairingController(UnavailablePairingGateway, emptySet(), this)
        c.report("pairing.camera_denied")
        c.clearInputError()
        assertNull(c.state.value.error)
        assertEquals(PairingStage.INPUT, c.state.value.stage)
    }

    private class Gateway : PairingGateway {
        var claims = 0; var confirms = 0; var cancels = 0
        var sas: String? = "482913"
        var confirmFailure: String? = null
        var cancelFailure: String? = null
        var claimFailure: String? = null
        var latch: CompletableDeferred<Unit>? = null
        override suspend fun claim(input: PairingInput): PairingChallenge {
            claims++
            latch?.await()
            claimFailure?.let { throw PairingFailure(it) }
            return PairingChallenge("opaque-handle", "My Mac", "a***@example.test", 100_000, sas)
        }
        override suspend fun confirm(handle: String): PairedDevice {
            confirms++
            confirmFailure?.let { throw PairingFailure(it) }
            return PairedDevice("Phone", "My Mac")
        }
        override suspend fun cancel(handle: String) {
            cancels++
            cancelFailure?.let { throw PairingFailure(it) }
        }
    }

    @Test fun R01_AC5_invalid_host_never_reaches_gateway() = runTest {
        val gateway = Gateway()
        val c = PairingController(gateway, hosts, this) { 0 }
        c.submitQr(qr("evil.test")); runCurrent()
        assertEquals(0, gateway.claims)
        assertEquals("pairing.qr_invalid", c.state.value.error)
    }

    @Test fun R01_AC7_requires_explicit_SAS_match_before_confirm() = runTest {
        val gateway = Gateway(); val c = PairingController(gateway, hosts, this) { 0 }
        c.submitCode("ABCD2345"); runCurrent()
        assertEquals(PairingStage.CONFIRM, c.state.value.stage)
        c.confirm(); runCurrent(); assertEquals(0, gateway.confirms)
        c.setSasChecked(true); c.confirm(); c.confirm(); runCurrent()
        assertEquals(1, gateway.confirms)
        assertEquals(PairingStage.PAIRED, c.state.value.stage)
    }

    @Test fun R01_AC9_expired_confirmation_cannot_bind() = runTest {
        var now = 0L
        val gateway = Gateway(); val c = PairingController(gateway, hosts, this) { now }
        c.submitCode("ABCD2345"); runCurrent(); c.setSasChecked(true)
        now = 100_000; c.confirm(); runCurrent()
        assertEquals(0, gateway.confirms)
        assertEquals("pairing.expired", c.state.value.error)
    }

    @Test fun R01_cancel_failure_does_not_erase_pending_claim_or_enable_invalid_SAS() = runTest {
        val gateway = Gateway().apply { sas = null; cancelFailure = "net.unreachable" }
        val c = PairingController(gateway, hosts, this) { 0 }
        c.submitCode("ABCD2345"); runCurrent()
        assertEquals("pairing.response_invalid", c.state.value.error)
        c.cancel(); runCurrent(); c.confirm(); runCurrent()
        assertEquals(0, gateway.confirms)
        assertEquals(PairingStage.CONFIRM, c.state.value.stage)
        gateway.cancelFailure = null; c.cancel(); runCurrent()
        assertEquals(PairingStage.INPUT, c.state.value.stage)
        assertEquals(2, gateway.cancels)
    }

    @Test fun R01_no_fake_success_after_network_error() = runTest {
        val gateway = Gateway().apply { confirmFailure = "net.unreachable" }
        val c = PairingController(gateway, hosts, this) { 0 }
        c.submitCode("ABCD2345"); runCurrent(); c.setSasChecked(true)
        c.confirm(); runCurrent()
        assertEquals(PairingStage.CONFIRM, c.state.value.stage)
        assertEquals("net.unreachable", c.state.value.error)
    }

    @Test fun R01_AC8_double_submit_starts_only_one_claim() = runTest {
        val gate = CompletableDeferred<Unit>()
        val gateway = Gateway().apply { latch = gate }
        val c = PairingController(gateway, hosts, this) { 0 }
        c.submitCode("ABCD2345"); c.submitCode("EFGH2345"); runCurrent()
        assertEquals(1, gateway.claims)
        c.cancel(); runCurrent(); assertEquals(0, gateway.cancels)
        gate.complete(Unit); runCurrent()
        assertEquals(PairingStage.CONFIRM, c.state.value.stage)
    }

    @Test fun R01_unconfigured_adapter_reports_real_status() = runTest {
        val c = PairingController(UnavailablePairingGateway, emptySet(), this) { 0 }
        c.submitCode("ABCD2345"); runCurrent()
        assertEquals(PairingStage.INPUT, c.state.value.stage)
        assertEquals("pairing.service_unconfigured", c.state.value.error)
        c.submitQr(qr()); assertEquals("pairing.service_unconfigured", c.state.value.error)
    }

    @Test fun R01_AC6_key_mismatch_from_verified_adapter_never_enables_confirmation() = runTest {
        val gateway = Gateway().apply { claimFailure = "pairing.key_mismatch" }
        val c = PairingController(gateway, hosts, this) { 0 }
        c.submitQr(qr()); runCurrent(); c.confirm(); runCurrent()
        assertEquals("pairing.key_mismatch", c.state.value.error)
        assertEquals(0, gateway.confirms)
    }
}
