package top.heang.lom.app

import java.io.File
import java.net.URLDecoder

/** Session-scoped image exports. Never search other sessions or expose arbitrary host files. */
internal fun replyImageSource(filesDir: File, session: String, source: String): File {
    require(Regex("[a-zA-Z0-9_-]{1,128}").matches(session)) { "image.invalid_session" }
    val raw = when {
        source.startsWith("minis://") -> source.removePrefix("minis://")
        source.startsWith("/var/minis/") -> source.removePrefix("/var/minis/")
        !source.startsWith("/") && !source.contains(":") -> "workspace/$source"
        else -> error("image.invalid_path")
    }
    val path = URLDecoder.decode(raw.substringBefore('?').replace("+", "%2B"), "UTF-8")
    require(path.split('/').none { it == ".." } && !path.contains('\\') && !path.contains('\u0000')) { "image.invalid_path" }
    val sub = path.substringBefore('/')
    val root = if (sub == "shared") File(filesDir, "minis-global/shared")
        else { require(sub in listOf("attachments", "workspace", "offloads", "browser")) { "image.invalid_path" }
            File(filesDir, "minis-sessions/$session/$sub") }
    val canonicalRoot = root.canonicalFile
    val boundary = if (sub == "shared") File(filesDir.canonicalFile, "minis-global/shared") else File(filesDir.canonicalFile, "minis-sessions/$session")
    require(canonicalRoot.toPath().startsWith(boundary.toPath())) { "image.invalid_path" }
    val file = File(canonicalRoot, path.substringAfter('/', "")).canonicalFile
    require(file.toPath().startsWith(canonicalRoot.toPath()) && file.isFile && file.length() in 1..15L*1024*1024) { "image.file_unavailable" }
    return file
}
internal fun replyImageMime(file: File): String {
    val bytes = ByteArray(12); val count = file.inputStream().use { it.read(bytes) }
    val ascii = String(bytes, Charsets.ISO_8859_1)
    return when {
        count >= 8 && ascii.startsWith("\u0089PNG\r\n\u001a\n") -> "image/png"
        count >= 3 && bytes[0] == 0xff.toByte() && bytes[1] == 0xd8.toByte() && bytes[2] == 0xff.toByte() -> "image/jpeg"
        ascii.startsWith("GIF87a") || ascii.startsWith("GIF89a") -> "image/gif"
        count == 12 && ascii.startsWith("RIFF") && ascii.substring(8,12) == "WEBP" -> "image/webp"
        else -> error("image.unsupported")
    }
}
