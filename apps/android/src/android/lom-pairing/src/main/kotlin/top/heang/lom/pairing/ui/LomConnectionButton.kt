package top.heang.lom.pairing.ui

import android.content.Intent
import android.widget.Toast
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Computer
import androidx.compose.material.icons.outlined.Dialpad
import androidx.compose.material.icons.outlined.LinkOff
import androidx.compose.material.icons.outlined.QrCodeScanner
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import top.heang.lom.pairing.PairingFailure
import top.heang.lom.pairing.R
import top.heang.lom.pairing.cloud.LomPairing
import top.heang.lom.pairing.cloud.RelayStatus

/** Home-screen entry left of the clock: 扫一扫 / 配对码; once paired, the computer and 解除配对. */
@Composable
fun LomConnectionButton() {
    if (!LomPairing.CLOUD_ENABLED) return
    val context = LocalContext.current
    val pairing = remember { LomPairing.get(context) }
    val deviceName by top.heang.lom.pairing.cloud.LomDeviceName.state.collectAsState()
    LaunchedEffect(Unit) { top.heang.lom.pairing.cloud.LomDeviceName.read(context) }
    val paired by pairing.paired.collectAsState()
    val relay by pairing.relayStatus.collectAsState()
    val problem by pairing.connectionProblem.collectAsState()
    var background by remember { mutableStateOf(pairing.backgroundEnabled()) }
    var expanded by remember { mutableStateOf(false) }
    var asking by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(Unit) { pairing.start() }
    fun open(mode: String) {
        expanded = false
        context.startActivity(Intent(context, PairingActivity::class.java)
            .putExtra(PairingActivity.MODE, mode))
    }
    Box {
        IconButton(onClick = { background = pairing.backgroundEnabled(); expanded = !expanded }) {
            Icon(if (paired != null) Icons.Outlined.Computer else Icons.Outlined.QrCodeScanner,
                stringResource(R.string.lom_connect),
                tint = if (paired != null && relay == RelayStatus.ONLINE) MaterialTheme.colorScheme.primary
                    else MaterialTheme.colorScheme.onSurface)
        }
        DropdownMenu(expanded, onDismissRequest = { expanded = false },
            modifier = Modifier.widthIn(min = 176.dp), shape = RoundedCornerShape(20.dp),
            containerColor = MaterialTheme.colorScheme.surfaceContainerLowest, tonalElevation = 0.dp) {
            val state = paired
            if (state == null) {
                DropdownMenuItem(text = { Text(stringResource(R.string.lom_scan)) },
                    leadingIcon = { Icon(Icons.Outlined.QrCodeScanner, null) },
                    onClick = { open("scan") })
                HorizontalDivider()
                DropdownMenuItem(text = { Text(stringResource(R.string.lom_code)) },
                    leadingIcon = { Icon(Icons.Outlined.Dialpad, null) },
                    onClick = { open("code") })
            } else {
                DropdownMenuItem(enabled = false, onClick = {}, text = { Text("本机：$deviceName") })
                val desktop = state.desktops.firstOrNull()?.name.orEmpty()
                DropdownMenuItem(enabled = false, onClick = {},
                    text = { Text(stringResource(R.string.lom_paired_to, desktop)) },
                    leadingIcon = { Icon(Icons.Outlined.Computer, null) },
                    trailingIcon = { Text(stringResource(when (relay) {
                        RelayStatus.ONLINE -> R.string.lom_relay_online
                        RelayStatus.CONNECTING -> R.string.lom_relay_connecting
                        RelayStatus.OFFLINE -> R.string.lom_relay_offline
                    }), style = MaterialTheme.typography.labelSmall) })
                HorizontalDivider()
                DropdownMenuItem(text = { Text(if (background) "暂停后台连接" else "恢复后台连接") },
                    onClick = { background = !background; pairing.setBackgroundEnabled(background) })
                if (problem.isNotBlank()) DropdownMenuItem(text = { Text(problem) }, onClick = { pairing.start() })
                DropdownMenuItem(text = { Text("定时任务准时运行设置") }, onClick = {
                    expanded = false
                    if (android.os.Build.VERSION.SDK_INT >= 31) context.startActivity(Intent(android.provider.Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM,
                        android.net.Uri.parse("package:${context.packageName}")))
                })
                if (!LomKeepAlive.ignoringBattery(context)) DropdownMenuItem(text = { Text("允许后台保持连接（推荐）") },
                    onClick = { expanded = false; LomKeepAlive.requestBattery(context) })
                if (LomKeepAlive.hasAutostart) DropdownMenuItem(text = { Text("开启自启动") },
                    onClick = { expanded = false; LomKeepAlive.openAutostart(context) })
                DropdownMenuItem(text = { Text("后台与电池设置") }, onClick = { expanded = false; LomKeepAlive.appDetails(context) })
                DropdownMenuItem(text = { Text(stringResource(if (busy) R.string.lom_unpairing else R.string.lom_unpair)) },
                    leadingIcon = { Icon(Icons.Outlined.LinkOff, null) }, enabled = !busy,
                    onClick = { expanded = false; asking = true })
            }
        }
    }
    if (asking) {
        AlertDialog(onDismissRequest = { asking = false },
            title = { Text(stringResource(R.string.lom_unpair_title)) },
            text = { Text(stringResource(R.string.lom_unpair_body)) },
            confirmButton = {
                TextButton(onClick = {
                    asking = false
                    busy = true
                    scope.launch {
                        try { pairing.unpair() } catch (e: CancellationException) { throw e
                        } catch (e: PairingFailure) {
                            Toast.makeText(context, errorResource(e.code), Toast.LENGTH_LONG).show()
                        } finally { busy = false }
                    }
                }) { Text(stringResource(R.string.lom_unpair)) }
            },
            dismissButton = { TextButton(onClick = { asking = false }) { Text(stringResource(R.string.lom_dismiss)) } })
    }
}
