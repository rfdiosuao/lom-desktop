package top.heang.lom.app

import android.Manifest
import android.content.Intent
import android.content.pm.ActivityInfo
import android.content.res.Configuration
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.journeyapps.barcodescanner.DecoratedBarcodeView
import com.journeyapps.barcodescanner.ScanOptions
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import top.heang.lom.pairing.ui.PairingScanActivity

@RunWith(AndroidJUnit4::class)
class PairingScannerTest {
    @Test fun pairing_scanner_is_portrait_with_square_visible_and_decoding_frame() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        instrumentation.uiAutomation.grantRuntimePermission(context.packageName, Manifest.permission.CAMERA)
        val intent = ScanOptions().setDesiredBarcodeFormats(ScanOptions.QR_CODE)
            .setCaptureActivity(PairingScanActivity::class.java).setOrientationLocked(true)
            .setPrompt("Lom · 扫描电脑上的配对二维码").createScanIntent(context)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        ActivityScenario.launch<PairingScanActivity>(intent).use { scenario ->
            var ready = false
            val deadline = System.currentTimeMillis() + 15000
            while (!ready && System.currentTimeMillis() < deadline) {
                scenario.onActivity { activity ->
                    val scanner = activity.findViewById<DecoratedBarcodeView>(com.google.zxing.client.android.R.id.zxing_barcode_scanner)
                    val frame = scanner.barcodeView.framingRect
                    if (frame != null) {
                        assertEquals(Configuration.ORIENTATION_PORTRAIT, activity.resources.configuration.orientation)
                        assertEquals(ActivityInfo.SCREEN_ORIENTATION_PORTRAIT, activity.requestedOrientation)
                        assertTrue(frame.width() > 0)
                        assertEquals(frame.width(), frame.height())
                        assertNotNull(scanner.barcodeView.previewFramingRect)
                        ready = true
                    }
                }
                if (!ready) Thread.sleep(150)
            }
            assertTrue("Camera preview must provide an actual square scan frame", ready)
        }
    }
}
