package top.heang.lom.pairing.cloud

import android.content.Context
import android.os.Build
import android.provider.Settings
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/** App display name only; never writes Android's system-wide device name. */
object LomDeviceName {
    private val current = MutableStateFlow("")
    val state: StateFlow<String> = current
    fun read(context: Context): String {
        val name = context.getSharedPreferences("lom_device_name", Context.MODE_PRIVATE).getString("name", null)
            ?: Settings.Global.getString(context.contentResolver, Settings.Global.DEVICE_NAME)?.takeIf { it.isNotBlank() }
            ?: Build.MODEL
        current.value = name
        return name
    }
    @Synchronized fun save(context: Context, value: String): String {
        val name = value.trim()
        require(name.isNotEmpty() && name.length <= 100 && name.none { it.code < 32 }) { "device.invalid_name" }
        if (read(context) != name) check(context.getSharedPreferences("lom_device_name", Context.MODE_PRIVATE)
            .edit().putString("name", name).commit()) { "device.name_save_failed" }
        current.value = name
        return name
    }
}
