package top.heang.lom.app

import android.content.ContentValues
import android.content.Context
import android.graphics.BitmapFactory
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import android.util.AtomicFile
import java.io.File

/** Export a verified, desktop-owned transfer into scoped system media storage. */
internal fun saveGallery(context: Context, dir: File, name: String): Uri {
    check(Build.VERSION.SDK_INT >= 29) { "gallery.requires_android_10" }
    val source = File(dir, "data")
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeFile(source.path, bounds)
    val mime = if (bounds.outWidth > 0 && bounds.outHeight > 0) bounds.outMimeType
        else MediaMetadataRetriever().use { reader ->
            reader.setDataSource(source.path)
            check(reader.extractMetadata(MediaMetadataRetriever.METADATA_KEY_HAS_VIDEO) == "yes") { "gallery.not_image_or_video" }
            reader.extractMetadata(MediaMetadataRetriever.METADATA_KEY_MIMETYPE)
        }
    check(mime != null && (mime.startsWith("image/") || mime.startsWith("video/"))) { "gallery.not_image_or_video" }
    val resolver = context.contentResolver
    val receipt = AtomicFile(File(dir, "gallery-uri"))
    val prior = if (receipt.baseFile.exists()) Uri.parse(String(receipt.readFully())) else null
    if (prior != null) {
        resolver.query(prior, arrayOf(MediaStore.MediaColumns.IS_PENDING), null, null, null)?.use { row ->
            if (row.moveToFirst()) {
                if (row.getInt(0) == 0) return prior
                check(resolver.delete(prior, null, null) == 1) { "gallery.pending_cleanup_failed" }
            }
        }
        receipt.delete()
    }
    val video = mime.startsWith("video/")
    val collection = if (video) MediaStore.Video.Media.EXTERNAL_CONTENT_URI else MediaStore.Images.Media.EXTERNAL_CONTENT_URI
    val uri = resolver.insert(collection, ContentValues().apply {
        put(MediaStore.MediaColumns.DISPLAY_NAME, name)
        put(MediaStore.MediaColumns.MIME_TYPE, mime)
        put(MediaStore.MediaColumns.RELATIVE_PATH, if (video) "Movies/Lom" else "Pictures/Lom")
        put(MediaStore.MediaColumns.IS_PENDING, 1)
    }) ?: error("gallery.insert_failed")
    try {
        val out = receipt.startWrite()
        try { out.write(uri.toString().toByteArray()); receipt.finishWrite(out) }
        catch (e: Exception) { receipt.failWrite(out); throw e }
        checkNotNull(resolver.openOutputStream(uri, "w")) { "gallery.open_failed" }.use { output ->
            source.inputStream().use { input -> check(input.copyTo(output) == source.length()) { "gallery.copy_failed" } }
        }
        check(resolver.update(uri, ContentValues().apply { put(MediaStore.MediaColumns.IS_PENDING, 0) }, null, null) == 1) { "gallery.publish_failed" }
        return uri
    } catch (e: Exception) {
        try { resolver.delete(uri, null, null); receipt.delete() }
        catch (cleanup: Exception) { e.addSuppressed(cleanup) }
        throw e
    }
}
