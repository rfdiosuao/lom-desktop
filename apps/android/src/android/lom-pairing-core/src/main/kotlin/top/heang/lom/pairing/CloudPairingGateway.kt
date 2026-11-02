package top.heang.lom.pairing

import java.util.UUID
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay

/**
 * R01 pairing against the Lom cloud.
 * - QR path: fetch the desktop keys, check them against the QR fingerprint, then claim with key_proof.
 * - Code path: claim by code; the 6-digit SAS is computed locally from both public keys, so a
 *   service that swaps keys shows a different code on each screen.
 * Success is returned only after the server confirmed and the credential was stored.
 */
class CloudPairingGateway(
    private val api: PairingApi,
    private val identity: DeviceIdentity,
    private val store: PairingStore,
    private val codeHost: String,
    private val now: () -> Long = System::currentTimeMillis,
    private val pause: suspend (Long) -> Unit = { delay(it) },
) : PairingGateway {
    private class Pending(val host: String, val pairingId: String, val secret: String,
        val desktopName: String, val desktopKeys: String)

    private val pending = mutableMapOf<String, Pending>()

    override suspend fun claim(input: PairingInput): PairingChallenge {
        if (store.load() != null) throw PairingFailure("pairing.already_paired")
        return when (input) {
            is PairingInput.Qr -> claimQr(input)
            is PairingInput.Manual -> claimCode(input)
        }
    }

    private suspend fun claimQr(qr: PairingInput.Qr): PairingChallenge {
        val desktop = api.inspect(qr.host, qr.pairingId, qr.claimToken)
        if (desktop.pairingId != qr.pairingId || !PairingCrypto.validKeys(desktop.desktopKeys) ||
            !PairingCrypto.same(PairingCrypto.fingerprint(desktop.desktopKeys), PairingCrypto.unb64(qr.fingerprint)))
            throw PairingFailure("pairing.key_mismatch")
        val proof = PairingCrypto.keyProof(PairingCrypto.unb64(qr.psk), qr.pairingId,
            desktop.desktopKeys, identity.keys)
        val secret = api.claim(qr.host, qr.pairingId, qr.claimToken, identity.keys, identity.info, proof)
        return remember(Pending(qr.host, qr.pairingId, secret, desktop.desktopName, desktop.desktopKeys),
            desktop, sas = null)
    }

    private suspend fun claimCode(code: PairingInput.Manual): PairingChallenge {
        val claim = api.claimByCode(codeHost, code.code, identity.keys, identity.info)
        val desktop = claim.desktop
        if (!PairingCrypto.validKeys(desktop.desktopKeys)) throw PairingFailure("pairing.response_invalid")
        val sas = PairingCrypto.sas(desktop.pairingId, desktop.desktopKeys, identity.keys)
        return remember(Pending(codeHost, desktop.pairingId, claim.claimSecret, desktop.desktopName,
            desktop.desktopKeys), desktop, sas)
    }

    private fun remember(p: Pending, desktop: DesktopView, sas: String?): PairingChallenge {
        val handle = UUID.randomUUID().toString()
        pending[handle] = p
        return PairingChallenge(handle, desktop.desktopName, desktop.maskedAccount,
            desktop.expiresAtSeconds * 1000, sas)
    }

    override suspend fun confirm(handle: String): PairedDevice {
        val p = pending[handle] ?: throw PairingFailure("pairing.expired")
        val credential = confirmWithRetry(p)
        try {
            store.save(PairedState(p.host, credential.deviceId, credential.deviceToken,
                credential.tokenExpiresAtSeconds, listOf(AuthorizedDesktop(p.desktopName, p.desktopKeys, now()))))
        } catch (e: CancellationException) { throw e
        } catch (e: Exception) {
            // The server bound the device; confirming again re-issues the credential.
            throw PairingFailure("pairing.store_failed")
        }
        pending.remove(handle)
        return PairedDevice(identity.info.name, credential.desktopName)
    }

    /** Waits for the desktop's key_proof check (≤15 s) and resolves lost responses by re-confirming:
     * the server answers a repeated confirm with a fresh credential instead of a second device. */
    private suspend fun confirmWithRetry(p: Pending): Credential {
        var waits = 0
        var networkRetries = 0
        while (true) {
            try {
                return api.confirm(p.host, p.pairingId, p.secret)
            } catch (e: PairingFailure) {
                when {
                    e.code == "pairing.awaiting_desktop" && waits < 15 -> waits++
                    e.code == "net.unreachable" && networkRetries < 3 -> networkRetries++
                    e.code == "pairing.awaiting_desktop" -> throw PairingFailure("pairing.desktop_timeout")
                    else -> throw e
                }
                pause(1000)
            }
        }
    }

    override suspend fun cancel(handle: String) {
        val p = pending[handle] ?: return
        api.cancel(p.host, p.pairingId, p.secret)
        pending.remove(handle)
    }
}
