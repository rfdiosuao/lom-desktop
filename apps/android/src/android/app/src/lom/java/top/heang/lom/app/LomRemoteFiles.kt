package top.heang.lom.app

import android.net.Uri
import android.util.Base64
import com.openminis.app.MinisApp
import com.openminis.app.ui.chat.InputAttachment
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.RandomAccessFile
import java.security.MessageDigest

/** Only files admitted through the paired encrypted channel are addressable; no arbitrary paths. */
internal class LomRemoteFiles(private val app: MinisApp) {
    private val gate = Mutex()
    private val root = File(app.filesDir, "lom_remote_files").apply { mkdirs() }
    private fun folder(desktop: String) = File(root, digest(desktop)).apply { mkdirs() }
    private fun dir(desktop: String, id: String): File {
        require(Regex("[a-zA-Z0-9-]{16,64}").matches(id)) { "file.invalid_id" }
        return File(folder(desktop), id)
    }
    private fun meta(dir: File): JSONObject {
        check(File(dir, "meta.json").isFile) { "file.missing" }
        return JSONObject(File(dir, "meta.json").readText())
    }
    private fun state(dir: File): JSONObject = meta(dir).put("offset", File(dir,"data").length().toString())
        .put("status", if (File(dir,"ready").exists()) "complete" else "uploading")
    private fun sha(file: File): String {
        val md = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { input -> val buf = ByteArray(65536); var n = input.read(buf)
            while(n >= 0) { md.update(buf,0,n); n = input.read(buf) } }
        return md.digest().joinToString("") { "%02x".format(it) }
    }
    suspend fun skillArchive(desktop: String, id: String): ByteArray = gate.withLock {
        val dir=dir(desktop,id); val m=meta(dir); val file=File(dir,"data")
        check(File(dir,"ready").exists() && file.length() in 1..10L*1024*1024 && sha(file)==m.getString("sha256")) { "skill.invalid_transfer" }
        file.readBytes()
    }
    suspend fun handle(method: String, p: JSONObject, desktop: String): JSONObject = gate.withLock {
        if (method == "file.list") {
            val items = folder(desktop).listFiles().orEmpty().filter { File(it,"meta.json").isFile }.map { state(it) }
            return@withLock JSONObject().put("items", JSONArray(items).toString())
        }
        val dir = dir(desktop, p.getString("id"))
        when (method) {
            "file.begin" -> {
                val name = p.getString("name"); val size = p.getString("size").toLong()
                require(name.isNotBlank() && name.length <= 200 && name !in listOf(".","..") && name.none { it == '/' || it == '\\' || it.code < 32 }) { "file.invalid_name" }
                require(size in 0..100L*1024*1024 && Regex("[a-f0-9]{64}").matches(p.getString("sha256"))) { "file.invalid_size_or_hash" }
                require(p.getString("mime").length <= 200) { "file.invalid_mime" }
                if (dir.exists()) {
                    val old = meta(dir)
                    for (key in listOf("name","size","sha256","mime")) check(old.getString(key) == p.getString(key)) { "file.id_reused" }
                } else {
                    val reserved = root.walkTopDown().filter { it.name == "meta.json" }.sumOf { JSONObject(it.readText()).getString("size").toLong() }
                    check(reserved + size <= 500L*1024*1024) { "file.quota_exceeded" }
                    check(dir.mkdirs()) { "file.storage_failed" }
                    File(dir,"meta.json").writeText(JSONObject().apply { for(key in listOf("id","name","mime","size","sha256")) put(key,p.getString(key)) }.toString())
                    File(dir,"data").createNewFile()
                }
            }
            "file.chunk" -> {
                val m = meta(dir); val file = File(dir,"data"); val offset = p.getString("offset").toLong()
                val data = Base64.decode(p.getString("data"), Base64.NO_WRAP)
                require(data.isNotEmpty() && data.size <= 128*1024 && offset >= 0 && offset + data.size <= m.getString("size").toLong()) { "file.invalid_chunk" }
                RandomAccessFile(file,"rw").use { out ->
                    if (offset < out.length()) {
                        require(offset + data.size <= out.length()) { "file.offset_mismatch" }
                        val old = ByteArray(data.size); out.seek(offset); out.readFully(old)
                        require(old.contentEquals(data)) { "file.chunk_conflict" }
                    } else {
                        check(!File(dir,"ready").exists() && offset == out.length()) { "file.offset_mismatch" }
                        out.seek(offset); out.write(data); out.fd.sync()
                    }
                }
            }
            "file.finish" -> {
                val m = meta(dir); val file = File(dir,"data")
                check(file.length() == m.getString("size").toLong() && sha(file) == m.getString("sha256")) { "file.integrity_failed" }
                File(dir,"ready").writeText("verified")
            }
            "file.save_gallery" -> {
                val m = meta(dir); val file = File(dir, "data")
                check(File(dir, "ready").exists() && sha(file) == m.getString("sha256")) { "file.incomplete_or_corrupt" }
                val uri = saveGallery(app, dir, m.getString("name"))
                return@withLock JSONObject().put("id", m.getString("id")).put("status", "saved").put("uri", uri.toString())
            }
            "file.status" -> Unit
            "file.read" -> {
                check(File(dir,"ready").exists()) { "file.incomplete" }
                val file = File(dir,"data"); val offset = p.getString("offset").toLong()
                require(offset in 0..file.length()) { "file.invalid_offset" }
                val data = ByteArray(minOf(128L*1024, file.length()-offset).toInt())
                RandomAccessFile(file,"r").use { it.seek(offset); it.readFully(data) }
                return@withLock JSONObject().put("data",Base64.encodeToString(data,Base64.NO_WRAP)).put("next",(offset+data.size).toString())
            }
            "file.delete" -> {
                check(dir.deleteRecursively()) { "file.delete_failed" }
                return@withLock JSONObject().put("status","deleted")
            }
            else -> error("file.unknown_method")
        }
        state(dir)
    }
    /** Export only a durable mediaRef in a real message; callers never supply a host path. */
    suspend fun prepare(p: JSONObject, desktop: String): JSONObject = gate.withLock {
        val session = p.getString("session_id")
        val message = app.chatRepository.dao.loadMessages(session).firstOrNull { it.id == p.getString("message_id") }
            ?: error("file.message_missing")
        val parts = JSONArray(message.partsJson)
        val refs = (0 until parts.length()).mapNotNull { i -> parts.optJSONObject(i)?.takeIf { it.optString("type") == "mediaRef" }?.optJSONObject("value") }
        val ref = refs.getOrNull(p.getString("index").toInt()) ?: error("file.attachment_missing")
        val media = File(app.filesDir,"media").canonicalFile
        val source = File(media,ref.getString("relativePath")).canonicalFile
        check(source.toPath().startsWith(media.toPath()) && source.isFile && source.length()<=100L*1024*1024) { "file.invalid_source" }
        val id = digest(session+message.id+ref.getString("id"))
        val dir = dir(desktop,id)
        if(!File(dir,"ready").exists()) {
            val reserved=root.walkTopDown().filter { it.name=="meta.json" }.sumOf { JSONObject(it.readText()).getString("size").toLong() }
            check(reserved+source.length()<=500L*1024*1024) { "file.quota_exceeded" }
            dir.mkdirs()
            source.copyTo(File(dir,"data"),overwrite=true)
            val file=File(dir,"data")
            File(dir,"meta.json").writeText(JSONObject().put("id",id).put("name",ref.optString("originalFileName",source.name))
                .put("size",file.length().toString()).put("sha256",sha(file)).put("mime",ref.getString("mimeType")).toString())
            File(dir,"ready").writeText("verified")
        }
        state(dir)
    }
    /** Export a generated image from this session's sandbox through existing encrypted chunks. */
    suspend fun prepareImage(p: JSONObject, desktop: String): JSONObject = gate.withLock {
        val session = p.getString("session_id")
        check(app.chatRepository.dao.getSession(session) != null) { "chat.session_missing" }
        val source = replyImageSource(app.filesDir, session, p.getString("source"))
        val mime = replyImageMime(source)
        val checksum = sha(source)
        val id = digest(session + source.path + checksum)
        val dir = dir(desktop, id)
        if (!File(dir, "ready").exists()) {
            val reserved = root.walkTopDown().filter { it.name == "meta.json" }.sumOf { JSONObject(it.readText()).getString("size").toLong() }
            check(reserved + source.length() <= 500L*1024*1024) { "file.quota_exceeded" }
            check(dir.exists() || dir.mkdirs()) { "file.storage_failed" }
            source.copyTo(File(dir, "data"), overwrite = true)
            check(sha(File(dir, "data")) == checksum) { "image.changed_during_read" }
            File(dir, "meta.json").writeText(JSONObject().put("id", id).put("name", source.name).put("mime", mime)
                .put("size", source.length().toString()).put("sha256", checksum).toString())
            File(dir, "ready").writeText("verified")
        }
        state(dir)
    }
    suspend fun attachments(ids: String, desktop: String): List<InputAttachment> = gate.withLock {
        val items = JSONArray(ids)
        require(items.length() <= 10) { "file.too_many" }
        (0 until items.length()).map { i ->
            val dir = dir(desktop, items.getString(i)); val m = meta(dir)
            check(File(dir,"ready").exists()) { "file.incomplete" }
            InputAttachment(fileName=m.getString("name"),uri=Uri.fromFile(File(dir,"data")),mimeType=m.getString("mime"),
                kind=if(m.getString("mime").startsWith("image/")) InputAttachment.Kind.IMAGE else InputAttachment.Kind.DOCUMENT)
        }
    }
}
