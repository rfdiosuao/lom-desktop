package top.heang.lom.app

import com.openminis.app.MinisApp
import com.openminis.app.agent.SoulStore
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/** File content hashes are revisions; a stale editor never overwrites a newer phone edit. */
internal class LomRemoteDocuments(private val app: MinisApp) {
    private val root get() = File(app.filesDir, "minis-global/memory")
    private fun file(name: String): File {
        require(name == "SOUL.md" || name == "GLOBAL.md" || Regex("[0-9]{4}-[0-9]{2}-[0-9]{2}\\.md").matches(name)) { "sync.invalid_name" }
        return if (name == "SOUL.md") SoulStore.fileLocation(app) else File(root, name)
    }
    private fun content(f: File): String {
        require(f.length() <= 150000) { "sync.document_too_large" }
        return if (f.exists()) f.readText() else ""
    }
    private fun snapshot(name: String): JSONObject {
        val f = file(name); val text = content(f)
        return JSONObject().put("name", name).put("text", text).put("revision", digest(text)).put("modified", f.lastModified())
    }
    fun list(): JSONObject {
        val names = listOf("SOUL.md", "GLOBAL.md") + (root.listFiles()?.map { it.name } ?: emptyList())
            .filter { Regex("[0-9]{4}-[0-9]{2}-[0-9]{2}\\.md").matches(it) }.sortedDescending()
        return JSONObject().put("items", JSONArray(names.distinct().map { n ->
            val f = file(n); JSONObject().put("name",n).put("revision", digest(content(f))).put("modified",f.lastModified())
        }))
    }
    fun read(p: JSONObject): JSONObject = snapshot(p.getString("name"))
    fun write(p: JSONObject): JSONObject {
        val name=p.getString("name"); val text=p.getString("text"); val expected=p.getString("revision")
        require(text.toByteArray().size <= 150000) { "sync.document_too_large" }
        val lock = if(name=="SOUL.md") SoulStore else app.memoryRepository
        return synchronized(lock) {
            val f=file(name); val before=content(f)
            check(digest(before)==expected) { "sync.conflict" }
            f.parentFile?.mkdirs()
            // Keep the pre-edit revision for recovery, including writes made outside repository APIs.
            val backups=File(app.noBackupFilesDir,"lom-document-revisions").also { it.mkdirs() }
            File(backups,"$name.${digest(before)}").writeText(before)
            val tmp=File(f.parentFile,".$name.lom-tmp")
            tmp.writeText(text)
            check(digest(content(f))==expected) { "sync.conflict" }
            check(tmp.renameTo(f)) { "sync.write_failed" }
            if(name=="SOUL.md") SoulStore.refreshCache(app)
            snapshot(name)
        }
    }
}
