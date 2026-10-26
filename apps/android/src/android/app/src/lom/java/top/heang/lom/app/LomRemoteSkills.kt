package top.heang.lom.app

import com.openminis.app.MinisApp
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.zip.ZipInputStream

/** Read bounded ZIP entries first; never extract caller paths directly into app storage. */
private fun rejectZipLinks(bytes:ByteArray) {
    val b=ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN)
    val end=(bytes.size-22 downTo maxOf(0,bytes.size-65557)).firstOrNull {
        it>=0 && b.getInt(it)==0x06054b50 && it+22+(b.getShort(it+20).toInt() and 65535)==bytes.size
    } ?: error("skill.invalid_zip")
    val count=b.getShort(end+10).toInt() and 65535
    require(count<=600 && b.getShort(end+4).toInt()==0 && b.getShort(end+6).toInt()==0) { "skill.invalid_zip" }
    var offset=b.getInt(end+16)
    repeat(count) {
        require(offset>=0 && offset<=end-46 && b.getInt(offset)==0x02014b50) { "skill.invalid_zip" }
        val mode=b.getInt(offset+38) ushr 16
        require(mode and 0xf000 != 0xa000) { "skill.unsafe_path" }
        offset+=46+(b.getShort(offset+28).toInt() and 65535)+(b.getShort(offset+30).toInt() and 65535)+(b.getShort(offset+32).toInt() and 65535)
    }
    require(offset==end) { "skill.invalid_zip" }
}
internal fun skillEntries(bytes: ByteArray): List<Pair<String, ByteArray>> {
    require(bytes.size <= 10*1024*1024) { "skill.package_too_large" }; rejectZipLinks(bytes)
    val out = mutableListOf<Pair<String,ByteArray>>(); val names = mutableSetOf<String>(); var total=0; var count=0
    ZipInputStream(bytes.inputStream()).use { zip ->
        while (true) {
            val entry=zip.nextEntry ?: break; count++
            require(count<=600) { "skill.too_many_files" }
            val name=entry.name
            require(!name.startsWith('/') && !name.contains('\\') && !name.contains(':') && !name.contains('\u0000') && name.split('/').none { it==".." || it=="." }) { "skill.unsafe_path" }
            if(entry.isDirectory) continue
            require(name.split('/').none { it.isEmpty() }) { "skill.unsafe_path" }
            require(names.add(name)) { "skill.duplicate_path" }
            val buf=ByteArrayOutputStream(); val block=ByteArray(8192)
            while(true) { val n=zip.read(block); if(n<0)break; total+=n; require(total<=30*1024*1024) { "skill.expanded_too_large" }; buf.write(block,0,n) }
            if(name.startsWith("__MACOSX/") || name.endsWith(".DS_Store"))continue
            require(out.size<300) { "skill.too_many_files" }; out.add(name to buf.toByteArray())
        }
    }
    val prefix=out.firstOrNull()?.first?.substringBefore('/', "")?.takeIf { it.isNotEmpty() }?.plus('/')
    val files=if(prefix!=null && out.all { it.first.startsWith(prefix) }) out.map { it.first.removePrefix(prefix) to it.second } else out
    require(files.any { it.first=="SKILL.md" }) { "skill.missing_manifest" }
    return files
}
internal class LomRemoteSkills(private val app: MinisApp, private val files: LomRemoteFiles) {
    companion object { private val gate=Mutex() }
    private val repo get()=app.skillRepository
    private fun row(id:String):JSONObject {
        val s=repo.skills.value.firstOrNull { it.id==id } ?: error("skill.not_found")
        return JSONObject().put("id",s.id).put("name",s.name).put("description",s.description).put("version",s.version)
            .put("enabled",s.isEnabled.toString()).put("body",s.body)
    }
    suspend fun handle(method:String,p:JSONObject,desktop:String):JSONObject=gate.withLock {
        when(method) {
            "skills.list" -> JSONObject().put("items",JSONArray(repo.skills.value.map { row(it.id).put("body", "") }).toString())
            "skills.read" -> row(p.getString("id"))
            "skills.toggle" -> {
                val id=p.getString("id"); row(id)
                require(p.getString("enabled") in listOf("true","false")) { "skill.invalid_toggle" }
                repo.setEnabled(id,p.getString("enabled")=="true"); row(id)
            }
            "skills.delete" -> {
                val id=p.getString("id"); row(id); repo.delete(id)
                check(repo.skills.value.none { it.id==id } && !File(app.filesDir,"minis-global/skills/$id").exists()) { "skill.delete_failed" }
                JSONObject().put("status","deleted")
            }
            "skills.install" -> install(files.skillArchive(desktop,p.getString("id")))
            else -> error("skill.unknown_method")
        }
    }
    private fun install(bytes:ByteArray):JSONObject {
        val entries=skillEntries(bytes)
        val parsed=repo.parseSkillMdPublic(entries.first { it.first=="SKILL.md" }.second.toString(Charsets.UTF_8)) ?: error("skill.invalid_manifest")
        val skill=repo.add(parsed.name,parsed.description,parsed.body,parsed.version) ?: error("skill.already_exists_or_invalid_name")
        try {
            val root=File(app.filesDir,"minis-global/skills/${skill.id}").canonicalFile
            check(root.toPath().startsWith(File(app.filesDir,"minis-global/skills").canonicalFile.toPath())) { "skill.unsafe_path" }
            for((name,data) in entries) {
                if(name=="SKILL.md")continue
                val dest=File(root,name).canonicalFile
                require(dest.toPath().startsWith(root.toPath())) { "skill.unsafe_path" }
                check(dest.parentFile?.let { it.isDirectory || it.mkdirs() }==true) { "skill.storage_failed" }
                dest.writeBytes(data); check(dest.readBytes().contentEquals(data)) { "skill.storage_failed" }
            }
            check(File(root,"SKILL.md").isFile) { "skill.storage_failed" }
            return row(skill.id)
        } catch(e:Exception) { repo.delete(skill.id); throw e }
    }
}
