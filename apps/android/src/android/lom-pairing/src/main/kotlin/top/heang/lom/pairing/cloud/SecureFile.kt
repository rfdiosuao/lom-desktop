package top.heang.lom.pairing.cloud

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.io.File
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Small file encrypted with an AES-GCM key that never leaves Android Keystore (R01 §5.4).
 * Lives in noBackupFilesDir, so it is excluded from cloud backup and device transfer. */
internal class SecureFile(private val file: File) {
    private companion object {
        const val ALIAS = "top.heang.lom.pairing.v1"
        const val TRANSFORM = "AES/GCM/NoPadding"
    }

    private fun key(): SecretKey {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (ks.getKey(ALIAS, null) as? SecretKey)?.let { return it }
        val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        gen.init(KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256).build())
        return gen.generateKey()
    }

    fun read(): ByteArray? {
        if (!file.exists()) return null
        val data = file.readBytes()
        val cipher = Cipher.getInstance(TRANSFORM)
        cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, data, 0, 12))
        return cipher.doFinal(data, 12, data.size - 12)
    }

    /** Atomic replace: write a temp file, then rename over the old one. */
    fun write(plain: ByteArray) {
        val cipher = Cipher.getInstance(TRANSFORM)
        cipher.init(Cipher.ENCRYPT_MODE, key())
        val tmp = File(file.parentFile, "${file.name}.tmp")
        tmp.writeBytes(cipher.iv + cipher.doFinal(plain))
        if (!tmp.renameTo(file)) {
            tmp.delete()
            error("cannot replace ${file.name}")
        }
    }

    fun delete() {
        if (file.exists() && !file.delete()) error("cannot delete ${file.name}")
    }
}
