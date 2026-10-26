package top.heang.lom.pairing.cloud

import android.content.Context
import android.os.Build
import android.provider.Settings
import com.google.crypto.tink.subtle.Ed25519Sign
import com.google.crypto.tink.subtle.X25519
import java.io.File
import org.json.JSONObject
import top.heang.lom.pairing.DeviceIdentity
import top.heang.lom.pairing.DeviceInfo
import top.heang.lom.pairing.PairingCrypto

/** This phone's long-term identity (R01 §2.1): X25519 for key agreement, Ed25519 for signatures.
 * Generated once; the private keys are stored only inside [SecureFile]. Survives unpairing. */
internal class LomIdentity private constructor(override val keys: String, private val context: Context, val crypto: top.heang.lom.remote.RemoteCrypto) :
    DeviceIdentity {
    override val info: DeviceInfo get() = deviceInfo(context)
    companion object {
        fun loadOrCreate(context: Context): LomIdentity {
            val file = SecureFile(File(context.noBackupFilesDir, "lom-identity.bin"))
            val json = file.read()?.let { JSONObject(String(it)) } ?: create().also { file.write(it.toString().toByteArray()) }
            val keys = PairingCrypto.keys(PairingCrypto.unb64(json.getString("x25519_pub")),
                PairingCrypto.unb64(json.getString("ed25519_pub")))
            return LomIdentity(keys, context.applicationContext, top.heang.lom.remote.RemoteCrypto(
                PairingCrypto.unb64(json.getString("x25519_priv")), PairingCrypto.unb64(json.getString("ed25519_priv")), keys))
        }

        private fun create(): JSONObject {
            val xPriv = X25519.generatePrivateKey()
            val ed = Ed25519Sign.KeyPair.newKeyPair()
            return JSONObject()
                .put("x25519_priv", PairingCrypto.b64(xPriv))
                .put("x25519_pub", PairingCrypto.b64(X25519.publicFromPrivate(xPriv)))
                .put("ed25519_priv", PairingCrypto.b64(ed.privateKey))
                .put("ed25519_pub", PairingCrypto.b64(ed.publicKey))
        }

        private fun deviceInfo(context: Context): DeviceInfo {
            val name = LomDeviceName.read(context)
            val version = runCatching {
                context.packageManager.getPackageInfo(context.packageName, 0).versionName
            }.getOrNull().orEmpty()
            return DeviceInfo(name, "${Build.MANUFACTURER} ${Build.MODEL}".trim(),
                "Android ${Build.VERSION.RELEASE}", version)
        }
    }
}
