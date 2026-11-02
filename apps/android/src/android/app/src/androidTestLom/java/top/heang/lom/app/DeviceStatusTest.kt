package top.heang.lom.app
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class DeviceStatusTest {
    @Test fun D11_real_android_battery_and_network() {
        val ins = InstrumentationRegistry.getInstrumentation()
        fun shell(cmd: String) { ins.uiAutomation.executeShellCommand(cmd).use { android.os.ParcelFileDescriptor.AutoCloseInputStream(it).readBytes() } }
        try {
            shell("dumpsys battery set level 37")
            val value = deviceStatus(ins.targetContext)
            assertEquals("37", value.getString("battery"))
            assertTrue(value.getString("network") in listOf("wifi", "cellular", "ethernet", "offline", "unknown"))
            assertTrue(value.getString("sampled_at").toLong() > 0)
            shell("dumpsys battery set level 0")
            assertEquals("0", deviceStatus(ins.targetContext).getString("battery"))
        } finally { shell("dumpsys battery reset") }
    }
}
