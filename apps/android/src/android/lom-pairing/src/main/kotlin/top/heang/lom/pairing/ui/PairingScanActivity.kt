package top.heang.lom.pairing.ui

import com.journeyapps.barcodescanner.CaptureActivity
import com.journeyapps.barcodescanner.DecoratedBarcodeView
import com.journeyapps.barcodescanner.Size

/** Dedicated portrait QR scanner; keep the decoding region and visible frame square. */
class PairingScanActivity : CaptureActivity() {
    override fun initializeContent(): DecoratedBarcodeView {
        val scanner = super.initializeContent()
        val metrics = resources.displayMetrics
        val side = (minOf(metrics.widthPixels, metrics.heightPixels) * 0.72f).toInt()
        scanner.barcodeView.framingRectSize = Size(side, side)
        return scanner
    }
}
