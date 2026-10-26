package top.heang.lom.app

import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.nio.file.Files

class LomReplyImagesTest {
    @Test fun d08GeneratedPhoneImageIsScopedAndTyped() {
        val root = Files.createTempDirectory("lom-image").toFile()
        try {
            val image = File(root, "minis-sessions/session-a/workspace/图 1.png")
            image.parentFile.mkdirs(); image.writeBytes(byteArrayOf(0x89.toByte(),80,78,71,13,10,26,10))
            assertEquals(image.canonicalFile, replyImageSource(root, "session-a", "minis://workspace/图%201.png"))
            assertEquals("image/png", replyImageMime(image))
            assertTrue(runCatching { replyImageSource(root, "session-b", "minis://workspace/图%201.png") }.isFailure)
            assertTrue(runCatching { replyImageSource(root, "session-a", "minis://workspace/%2e%2e/图.png") }.isFailure)
            assertTrue(runCatching { replyImageSource(root, "session-a", "/data/private.png") }.isFailure)
            val linked = File(image.parentFile, "outside.png")
            Files.createSymbolicLink(linked.toPath(), File(root, "private.png").apply { writeBytes(image.readBytes()) }.toPath())
            assertTrue(runCatching { replyImageSource(root, "session-a", "minis://workspace/outside.png") }.isFailure)
        } finally { root.deleteRecursively() }
    }
}
