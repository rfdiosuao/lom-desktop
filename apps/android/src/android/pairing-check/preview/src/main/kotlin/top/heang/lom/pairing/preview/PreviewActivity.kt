package top.heang.lom.pairing.preview

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material.icons.outlined.Terminal
import androidx.compose.material3.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import top.heang.lom.pairing.ui.LomConnectionButton

/** Standalone harness for the pairing module against the real Lom cloud (no full Minis build needed). */
class PreviewActivity : ComponentActivity() {
    @OptIn(ExperimentalMaterial3Api::class)
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            MaterialTheme(colorScheme = lightColorScheme(primary = Color(0xFF287742),
                surface = Color(0xFFF5F5F8), background = Color(0xFFF5F5F8))) {
                Scaffold(topBar = {
                    TopAppBar(title = { Text("Lom") }, navigationIcon = {
                        IconButton(onClick = {}, enabled = false) { Icon(Icons.Outlined.Settings, null) }
                    }, actions = {
                        LomConnectionButton()
                        IconButton(onClick = {}, enabled = false) { Icon(Icons.Outlined.Schedule, null) }
                        IconButton(onClick = {}, enabled = false) { Icon(Icons.Outlined.Terminal, null) }
                    })
                }) { padding ->
                    Column(Modifier.padding(padding).padding(24.dp),
                        verticalArrangement = Arrangement.spacedBy(16.dp)) {
                        Text("手机连接 · UI 验证", style = MaterialTheme.typography.headlineSmall)
                        Text("点击右上角扫码图标，选择扫一扫或配对码。")
                        Text("这是独立验证包，不是完整手机客户端。配对走真实的麓鸣云端，结果以电脑端为准。",
                            color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
        }
    }
}
