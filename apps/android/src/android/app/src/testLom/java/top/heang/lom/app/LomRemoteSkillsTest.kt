package top.heang.lom.app
import org.junit.Assert.*
import org.junit.Test
import java.io.ByteArrayOutputStream
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream
class LomRemoteSkillsTest {
    private fun archive(vararg names:String):ByteArray {
        val out=ByteArrayOutputStream();ZipOutputStream(out).use { zip -> names.forEach { zip.putNextEntry(ZipEntry(it));zip.write("test".toByteArray());zip.closeEntry() } };return out.toByteArray()
    }
    @Test fun D09_archive_paths_limits_and_wrapper() {
        val linked=archive("SKILL.md");val b=java.nio.ByteBuffer.wrap(linked).order(java.nio.ByteOrder.LITTLE_ENDIAN)
        val central=(0..linked.size-46).first { b.getInt(it)==0x02014b50 };b.putInt(central+38,0xa1ff shl 16)
        try { skillEntries(linked);fail("Symbolic link") } catch(e:IllegalArgumentException) { assertEquals("skill.unsafe_path",e.message) }
        assertEquals(listOf("SKILL.md","scripts/a.py"),skillEntries(archive("bundle/SKILL.md","bundle/scripts/a.py")).map { it.first })
        for(path in listOf("../escape","/absolute","a/../escape","C:/escape","a\\escape")) {
            try { skillEntries(archive("SKILL.md",path));fail(path) } catch(e:IllegalArgumentException) { assertEquals("skill.unsafe_path",e.message) }
        }
        try { skillEntries(archive("other.txt"));fail("Missing manifest") } catch(e:IllegalArgumentException) { assertEquals("skill.missing_manifest",e.message) }
        try { skillEntries(ByteArray(10*1024*1024+1));fail("Oversized package") } catch(e:IllegalArgumentException) { assertEquals("skill.package_too_large",e.message) }
    }
}
