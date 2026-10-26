package top.heang.lom.pairing

/* In-process types between the pairing gateway and its HTTP adapter (R01 §2.8).
 * The JSON wire format lives only in the adapter; nothing here is serialized as-is. */

data class DeviceInfo(val name: String, val model: String, val os: String, val appVersion: String)

class DesktopView(
    val pairingId: String, val desktopName: String, val desktopKeys: String,
    val maskedAccount: String, val expiresAtSeconds: Long,
) {
    override fun toString() = "DesktopView($desktopName)"
}

class CodeClaim(val desktop: DesktopView, val claimSecret: String) {
    override fun toString() = "CodeClaim([REDACTED])"
}

class Credential(val deviceId: String, val deviceToken: String, val tokenExpiresAtSeconds: Long,
    val desktopName: String) {
    override fun toString() = "Credential($deviceId, [REDACTED])"
}

/** Cloud calls. Implementations throw [PairingFailure] with the server's error code,
 * or `net.unreachable` when the request did not get a response. */
interface PairingApi {
    suspend fun inspect(host: String, pairingId: String, claimToken: String): DesktopView
    suspend fun claim(host: String, pairingId: String, claimToken: String, deviceKeys: String,
        info: DeviceInfo, keyProof: String): String
    suspend fun claimByCode(host: String, code: String, deviceKeys: String, info: DeviceInfo): CodeClaim
    suspend fun confirm(host: String, pairingId: String, claimSecret: String): Credential
    suspend fun cancel(host: String, pairingId: String, claimSecret: String)
}

/** This phone's long-term identity (R01 §2.1). Private keys never leave the implementation. */
interface DeviceIdentity {
    val keys: String
    val info: DeviceInfo
}

data class AuthorizedDesktop(val name: String, val keys: String, val pairedAtMillis: Long)

/** Persisted pairing. Secrets are redacted from diagnostic strings. */
class PairedState(
    val host: String, val deviceId: String, val deviceToken: String,
    val tokenExpiresAtSeconds: Long, val desktops: List<AuthorizedDesktop>,
) {
    val authorization get() = "Device $deviceId.$deviceToken"
    override fun toString() = "PairedState($deviceId, desktops=${desktops.size}, [REDACTED])"
}

interface PairingStore {
    /** Must durably persist before returning; throw if it cannot. */
    suspend fun save(state: PairedState)
    fun load(): PairedState?
    suspend fun clear()
}
