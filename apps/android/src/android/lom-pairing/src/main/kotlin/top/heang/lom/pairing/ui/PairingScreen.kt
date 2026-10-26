package top.heang.lom.pairing.ui

import androidx.compose.foundation.selection.toggleable
import androidx.compose.ui.semantics.Role
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.Computer
import androidx.compose.material.icons.outlined.QrCodeScanner
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import top.heang.lom.pairing.*
import top.heang.lom.pairing.R

@Composable
internal fun PairingTheme(content: @Composable () -> Unit) {
    val palette = if (isSystemInDarkTheme()) darkColorScheme(primary = Color(0xFF9BD6AD))
        else lightColorScheme(primary = Color(0xFF287742), background = Color(0xFFF5F5F8),
            surface = Color(0xFFF5F5F8))
    MaterialTheme(colorScheme = palette, content = content)
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun PairingScreen(state: PairingUiState, mode: String, onMode: (String) -> Unit,
    onScan: () -> Unit, onCode: (String) -> Unit, onSas: (Boolean) -> Unit,
    onConfirm: () -> Unit, onBack: () -> Unit) {
    val busy = state.stage in setOf(PairingStage.CLAIMING, PairingStage.CONFIRMING, PairingStage.CANCELLING)
    Scaffold(topBar = {
        TopAppBar(title = { Text(stringResource(R.string.lom_connect)) }, navigationIcon = {
            IconButton(onClick = onBack, enabled = !busy) {
                Icon(Icons.AutoMirrored.Outlined.ArrowBack, stringResource(R.string.lom_back))
            }
        })
    }) { padding ->
        Column(Modifier.fillMaxSize().padding(padding).imePadding()
            .verticalScroll(rememberScrollState()).padding(24.dp),
            verticalArrangement = Arrangement.spacedBy(20.dp)) {
            when (state.stage) {
                PairingStage.INPUT -> InputPanel(mode, onMode, onScan, onCode)
                PairingStage.CONFIRM -> ConfirmPanel(state, onSas, onConfirm, onBack)
                PairingStage.PAIRED -> {
                    Icon(Icons.Outlined.CheckCircle, null, Modifier.size(52.dp), MaterialTheme.colorScheme.primary)
                    Text(stringResource(R.string.lom_paired), style = MaterialTheme.typography.headlineSmall)
                    Text("${state.deviceName} · ${state.desktopName}")
                    Text(stringResource(R.string.lom_paired_body))
                    Button(onClick = onBack, modifier = Modifier.fillMaxWidth()) {
                        Text(stringResource(R.string.lom_done))
                    }
                }
                else -> {
                    CircularProgressIndicator()
                    Text(stringResource(when (state.stage) {
                        PairingStage.CONFIRMING -> R.string.lom_confirming
                        PairingStage.CANCELLING -> R.string.lom_cancelling
                        else -> R.string.lom_checking
                    }))
                }
            }
            state.error?.let { code ->
                Surface(color = MaterialTheme.colorScheme.errorContainer,
                    shape = MaterialTheme.shapes.medium, modifier = Modifier.fillMaxWidth()) {
                    Text(stringResource(errorResource(code)), Modifier.padding(16.dp),
                        color = MaterialTheme.colorScheme.onErrorContainer)
                }
            }
        }
    }
}

@Composable
private fun InputPanel(mode: String, onMode: (String) -> Unit, onScan: () -> Unit,
    onCode: (String) -> Unit) {
    // Never use rememberSaveable: pairing codes are temporary credentials.
    var code by remember { mutableStateOf("") }
    TabRow(selectedTabIndex = if (mode == "scan") 0 else 1) {
        Tab(selected = mode == "scan", onClick = { onMode("scan") },
            text = { Text(stringResource(R.string.lom_scan)) })
        Tab(selected = mode == "code", onClick = { onMode("code") },
            text = { Text(stringResource(R.string.lom_code)) })
    }
    if (mode == "scan") {
        Icon(Icons.Outlined.QrCodeScanner, null, Modifier.size(72.dp), MaterialTheme.colorScheme.primary)
        Text(stringResource(R.string.lom_scan_title), style = MaterialTheme.typography.headlineSmall)
        Text(stringResource(R.string.lom_scan_body))
        Button(onClick = onScan, modifier = Modifier.fillMaxWidth()) {
            Text(stringResource(R.string.lom_scan_action))
        }
    } else {
        Text(stringResource(R.string.lom_code_title), style = MaterialTheme.typography.headlineSmall)
        Text(stringResource(R.string.lom_code_body))
        OutlinedTextField(value = code, onValueChange = { if (it.length <= 32) code = it },
            label = { Text(stringResource(R.string.lom_code_label)) },
            placeholder = { Text("XXXX-XXXX") }, singleLine = true,
            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Characters,
                autoCorrectEnabled = false, keyboardType = KeyboardType.Ascii),
            modifier = Modifier.fillMaxWidth())
        Button(onClick = { val submitted = code; code = ""; onCode(submitted) },
            enabled = code.isNotBlank(), modifier = Modifier.fillMaxWidth()) {
            Text(stringResource(R.string.lom_next))
        }
    }
}

@Composable
private fun ConfirmPanel(state: PairingUiState, onSas: (Boolean) -> Unit,
    onConfirm: () -> Unit, onCancel: () -> Unit) {
    Icon(Icons.Outlined.Computer, null, Modifier.size(48.dp), MaterialTheme.colorScheme.primary)
    Text(stringResource(R.string.lom_confirm_title), style = MaterialTheme.typography.headlineSmall)
    Text(state.desktopName, style = MaterialTheme.typography.titleLarge)
    Text(state.maskedAccount, color = MaterialTheme.colorScheme.onSurfaceVariant)
    state.sas?.let { sas ->
        Text(stringResource(R.string.lom_sas_body))
        Text(sas.chunked(3).joinToString(" "), style = MaterialTheme.typography.headlineLarge,
            fontFamily = FontFamily.Monospace)
        // The whole row toggles, not just the small box: users tap the label.
        Row(Modifier.fillMaxWidth().toggleable(value = state.sasChecked, role = Role.Checkbox,
            onValueChange = onSas), verticalAlignment = Alignment.CenterVertically) {
            Checkbox(checked = state.sasChecked, onCheckedChange = null)
            Text(stringResource(R.string.lom_sas_check))
        }
    }
    Button(onClick = onConfirm, modifier = Modifier.fillMaxWidth(),
        enabled = state.confirmationValid && state.error !in setOf("pairing.expired", "pairing.response_invalid") &&
            (state.sas == null || state.sasChecked)) { Text(stringResource(R.string.lom_confirm)) }
    TextButton(onClick = onCancel, modifier = Modifier.fillMaxWidth()) {
        Text(stringResource(R.string.lom_cancel))
    }
}

internal fun errorResource(code: String): Int = when (code) {
    "pairing.service_unconfigured" -> R.string.lom_unconfigured
    "pairing.qr_invalid" -> R.string.lom_qr_invalid
    "pairing.code_invalid" -> R.string.lom_code_invalid
    "pairing.expired" -> R.string.lom_expired
    "pairing.camera_denied" -> R.string.lom_camera_denied
    "pairing.key_mismatch", "pairing.proof_invalid" -> R.string.lom_key_mismatch
    "pairing.already_claimed" -> R.string.lom_already_claimed
    "pairing.rate_limited" -> R.string.lom_rate_limited
    "net.unreachable" -> R.string.lom_network
    "device.owned_by_other_account" -> R.string.lom_owned
    "pairing.response_invalid" -> R.string.lom_response_invalid
    "pairing.failed" -> R.string.lom_pair_failed
    "pairing.cancelled" -> R.string.lom_pair_cancelled
    "pairing.desktop_timeout" -> R.string.lom_desktop_timeout
    "pairing.store_failed" -> R.string.lom_store_failed
    "pairing.already_paired" -> R.string.lom_already_paired
    "pairing.identity_unavailable" -> R.string.lom_identity_unavailable
    else -> R.string.lom_failed
}
