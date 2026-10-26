package top.heang.lom.pairing.ui

import android.Manifest
import android.content.ActivityNotFoundException
import android.content.pm.PackageManager
import android.os.Bundle
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewModelScope
import com.journeyapps.barcodescanner.ScanContract
import com.journeyapps.barcodescanner.ScanOptions
import kotlinx.coroutines.delay
import top.heang.lom.pairing.*
import top.heang.lom.pairing.cloud.LomPairing

class PairingViewModel(host: PairingHost?) : ViewModel() {
    val controller = PairingController(host?.createPairingGateway() ?: UnavailablePairingGateway,
        host?.pairingAllowedHosts ?: emptySet(), viewModelScope)
    var started = false
}

class PairingActivity : ComponentActivity() {
    companion object { const val MODE = "top.heang.lom.pairing.MODE" }
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (!LomPairing.CLOUD_ENABLED) { intent.data = null; finish(); return }
        // Pairing details are transient: exclude screenshots and recents previews.
        window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        val model = ViewModelProvider(this, object : ViewModelProvider.Factory {
            @Suppress("UNCHECKED_CAST")
            override fun <T : ViewModel> create(modelClass: Class<T>): T =
                PairingViewModel(application as? PairingHost ?: LomPairing.get(application)) as T
        })[PairingViewModel::class.java]
        val initialQr = intent.dataString
        val initialMode = intent.getStringExtra(MODE) ?: "code"
        // Do not retain a credential-bearing deep link in the Activity's Intent.
        intent.data = null
        setContent {
            PairingTheme { PairingContent(model, initialQr, initialMode, ::finish) }
        }
    }
}

@Composable
private fun PairingContent(model: PairingViewModel, initialQr: String?, initialMode: String,
    close: () -> Unit) {
    val controller = model.controller
    val state by controller.state.collectAsStateWithLifecycle()
    var mode by rememberSaveable { mutableStateOf(initialMode) }
    val context = LocalContext.current
    val scanner = rememberLauncherForActivityResult(ScanContract()) { result ->
        result.contents?.let(controller::submitQr)
    }
    fun launchScanner() = scanner.launch(ScanOptions().setDesiredBarcodeFormats(ScanOptions.QR_CODE)
        .setBeepEnabled(false).setBarcodeImageEnabled(false)
        .setCaptureActivity(PairingScanActivity::class.java)
        .setOrientationLocked(true).setPrompt("Lom · 扫描电脑上的配对二维码"))
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) launchScanner() else controller.report("pairing.camera_denied")
    }
    fun startScan() {
        controller.clearInputError()
        // Already granted: scan directly and never touch the system permission UI.
        if (context.checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
            launchScanner()
            return
        }
        // Some OEM ROMs (e.g. a Flyme OTA mismatch) ship a permission controller without the grant
        // Activity, so launching the request throws instead of returning "denied". Report it as a
        // normal "camera unavailable, use the pairing code" error rather than crashing the app.
        try {
            permission.launch(Manifest.permission.CAMERA)
        } catch (_: ActivityNotFoundException) {
            controller.report("pairing.camera_denied")
        }
    }
    val leave = {
        when (state.stage) {
            PairingStage.INPUT, PairingStage.PAIRED -> close()
            PairingStage.CONFIRM -> controller.cancel()
            else -> Unit // Resolve in-flight server operations before leaving.
        }
    }
    BackHandler(onBack = leave)
    LaunchedEffect(Unit) {
        if (!model.started) {
            model.started = true
            if (initialQr != null) controller.submitQr(initialQr)
            else if (initialMode == "scan") startScan()
        }
    }
    LaunchedEffect(state.stage, state.expiresAtMillis) {
        if (state.stage == PairingStage.CONFIRM) {
            while (true) { controller.checkExpiry(); delay(1000) }
        }
    }
    PairingScreen(state, mode, onMode = { mode = it }, onScan = ::startScan,
        onCode = controller::submitCode, onSas = controller::setSasChecked,
        onConfirm = controller::confirm, onBack = leave)
}
