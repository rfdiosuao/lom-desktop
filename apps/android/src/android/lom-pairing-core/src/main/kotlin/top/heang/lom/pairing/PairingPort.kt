package top.heang.lom.pairing

/** In-process UI boundary, NOT a network DTO or replacement for lom-protocol.
 * Implementations must use generated contracts, verify keys, persist credentials
 * in Keystore, and return success only after the server confirms the binding.
 */
interface PairingGateway {
    suspend fun claim(input: PairingInput): PairingChallenge
    suspend fun confirm(handle: String): PairedDevice
    suspend fun cancel(handle: String)
}

sealed interface PairingInput {
    class Manual internal constructor(val code: String) : PairingInput {
        override fun toString() = "Manual([REDACTED])"
    }
    class Qr internal constructor(
        val host: String, val pairingId: String, val claimToken: String,
        val psk: String, val fingerprint: String,
    ) : PairingInput {
        override fun toString() = "Qr([REDACTED])"
    }
}

/** handle is opaque and memory-only. No key material is exposed in UI state. */
class PairingChallenge(
    val handle: String, val desktopName: String, val maskedAccount: String,
    val expiresAtMillis: Long, val confirmationCode: String? = null,
) {
    override fun toString() = "PairingChallenge([REDACTED])"
}

data class PairedDevice(val deviceName: String, val desktopName: String)
class PairingFailure(val code: String) : Exception(code)

object UnavailablePairingGateway : PairingGateway {
    override suspend fun claim(input: PairingInput): PairingChallenge = unavailable()
    override suspend fun confirm(handle: String): PairedDevice = unavailable()
    override suspend fun cancel(handle: String): Unit = unavailable()
    private fun unavailable(): Nothing = throw PairingFailure("pairing.service_unconfigured")
}
