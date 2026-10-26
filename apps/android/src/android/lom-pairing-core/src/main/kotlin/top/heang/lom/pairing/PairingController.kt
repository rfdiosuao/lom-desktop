package top.heang.lom.pairing

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow

enum class PairingStage { INPUT, CLAIMING, CONFIRM, CONFIRMING, CANCELLING, PAIRED }
data class PairingUiState(
    val stage: PairingStage = PairingStage.INPUT,
    val desktopName: String = "", val maskedAccount: String = "",
    val sas: String? = null, val sasChecked: Boolean = false,
    val confirmationValid: Boolean = false,
    val expiresAtMillis: Long = 0, val error: String? = null,
    val deviceName: String = "",
)

/** Main-thread controller; a ViewModel owns its scope. Secrets never enter saved state. */
class PairingController(
    private val gateway: PairingGateway,
    private val allowedHosts: Set<String>,
    private val scope: CoroutineScope,
    private val now: () -> Long = System::currentTimeMillis,
) {
    private val mutable = MutableStateFlow(PairingUiState())
    val state = mutable.asStateFlow()
    private var challenge: PairingChallenge? = null
    private var invalidChallenge = false

    fun submitCode(raw: String) = claim { PairingParser.manual(raw) }
    fun clearInputError() {
        if (state.value.stage == PairingStage.INPUT) mutable.value = state.value.copy(error = null)
    }
    fun submitQr(raw: String) = claim {
        if (allowedHosts.isEmpty()) throw PairingFailure("pairing.service_unconfigured")
        PairingParser.qr(raw, allowedHosts)
    }

    private fun claim(parse: () -> PairingInput) {
        if (state.value.stage != PairingStage.INPUT) return
        val input = try { parse() } catch (e: PairingFailure) { report(e.code); return }
        mutable.value = PairingUiState(stage = PairingStage.CLAIMING)
        scope.launch {
            try {
                val result = gateway.claim(input)
                // Retain the handle even for a malformed/expired response so the
                // user can explicitly cancel instead of orphaning the server claim.
                challenge = result
                invalidChallenge = result.handle.isBlank() || result.desktopName.isBlank() ||
                    (input is PairingInput.Manual && result.confirmationCode?.matches(Regex("[0-9]{6}")) != true) ||
                    (result.confirmationCode != null && !result.confirmationCode.matches(Regex("[0-9]{6}")))
                mutable.value = PairingUiState(
                    stage = PairingStage.CONFIRM, desktopName = result.desktopName,
                    maskedAccount = result.maskedAccount, sas = result.confirmationCode,
                    expiresAtMillis = result.expiresAtMillis,
                    confirmationValid = !invalidChallenge,
                )
                if (invalidChallenge) {
                    report("pairing.response_invalid")
                } else { checkExpiry() }
            } catch (e: CancellationException) { throw e
            } catch (e: Exception) {
                mutable.value = PairingUiState(error = errorCode(e))
            }
        }
    }

    fun setSasChecked(checked: Boolean) {
        if (state.value.stage == PairingStage.CONFIRM)
            mutable.value = state.value.copy(sasChecked = checked)
    }

    fun checkExpiry() {
        if (state.value.stage == PairingStage.CONFIRM && now() >= state.value.expiresAtMillis)
            report("pairing.expired")
    }

    fun confirm() {
        if (state.value.stage != PairingStage.CONFIRM) return
        checkExpiry()
        if (invalidChallenge || now() >= state.value.expiresAtMillis) return
        if (state.value.sas != null && !state.value.sasChecked) return
        val active = challenge ?: return
        mutable.value = state.value.copy(stage = PairingStage.CONFIRMING, error = null)
        scope.launch {
            try {
                val device = gateway.confirm(active.handle)
                challenge = null
                mutable.value = PairingUiState(stage = PairingStage.PAIRED,
                    desktopName = device.desktopName, deviceName = device.deviceName)
            } catch (e: CancellationException) { throw e
            } catch (e: Exception) {
                mutable.value = state.value.copy(stage = PairingStage.CONFIRM, error = errorCode(e))
            }
        }
    }

    fun cancel() {
        // Never cancel an in-flight confirm: the server may already have bound
        // the device. Adapter must reconcile uncertain outcomes before returning.
        if (state.value.stage != PairingStage.CONFIRM) return
        val active = challenge ?: return
        mutable.value = state.value.copy(stage = PairingStage.CANCELLING, error = null)
        scope.launch {
            try {
                gateway.cancel(active.handle)
                challenge = null
                invalidChallenge = false
                mutable.value = PairingUiState()
            } catch (e: CancellationException) { throw e
            } catch (e: Exception) {
                mutable.value = state.value.copy(stage = PairingStage.CONFIRM, error = errorCode(e))
            }
        }
    }

    fun report(code: String) { mutable.value = state.value.copy(error = code) }
    private fun errorCode(e: Exception) = (e as? PairingFailure)?.code ?: "pairing.operation_failed"
}
