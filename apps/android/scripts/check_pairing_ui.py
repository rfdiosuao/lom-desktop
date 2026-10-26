#!/usr/bin/env python3
"""R01 native UI smoke test. Only operates the isolated preview package.
Requires an explicitly selected disposable emulator with the preview APK installed.
"""
import argparse
import json
from pathlib import Path
import re
import subprocess
import xml.etree.ElementTree as ET

parser = argparse.ArgumentParser()
parser.add_argument('--adb', default='adb')
parser.add_argument('--serial', required=True)
parser.add_argument('--output', required=True)
a = parser.parse_args()
if not a.serial.startswith('emulator-'):
    parser.error('Use a disposable emulator, not a personal phone')
base = [a.adb, '-s', a.serial]
out = Path(a.output)
out.mkdir(parents=True, exist_ok=True)
package = 'top.heang.lom.pairing.preview'
checks = []


def adb(*args):
    return subprocess.check_output(base + list(args), stderr=subprocess.STDOUT, timeout=30)


def tree():
    adb('shell', 'uiautomator', 'dump', '/sdcard/lom-pairing-check.xml')
    return ET.fromstring(adb('shell', 'cat', '/sdcard/lom-pairing-check.xml'))


def find(root, value=None, cls=None):
    return next((n for n in root.iter('node') if
        (value is None or value in (n.get('text'), n.get('content-desc'), n.get('resource-id'))) and
        (cls is None or cls == n.get('class'))), None)


def wait(value=None, cls=None):
    for _ in range(4):
        root = tree()
        node = find(root, value, cls)
        if node is not None:
            return node
    raise AssertionError(f'UI element missing: {value or cls}')


def tap(node):
    x1, y1, x2, y2 = map(int, re.findall(r'\d+', node.get('bounds')))
    adb('shell', 'input', 'tap', str((x1 + x2) // 2), str((y1 + y2) // 2))


def click(label):
    tap(wait(label))


adb('shell', 'cmd', 'locale', 'set-app-locales', package, '--locales', 'zh-CN')
adb('shell', 'am', 'force-stop', package)
adb('shell', 'pm', 'revoke', package, 'android.permission.CAMERA')
adb('shell', 'pm', 'clear-permission-flags', package, 'android.permission.CAMERA', 'user-set', 'user-fixed')
adb('shell', 'am', 'start', '-n', package + '/.PreviewActivity')
click('连接电脑')
wait('扫一扫'); wait('配对码')
checks.append('R01: toolbar dropdown has Scan and Pairing code')
(out / 'connection-menu.png').write_bytes(adb('exec-out', 'screencap', '-p'))
adb('shell', 'input', 'keyevent', '4')
assert find(tree(), '配对码') is None
checks.append('R01: back dismisses dropdown')
click('连接电脑'); click('配对码'); wait('输入配对码')
tap(wait(cls='android.widget.EditText'))
adb('shell', 'input', 'text', 'AB12')
click('下一步')
wait('配对码不正确。请输入电脑上显示的 8 位码（不包含 0、O、1、I、L）。')
checks.append('R01: invalid code is rejected in native UI')
tap(wait(cls='android.widget.EditText'))
adb('shell', 'input', 'text', 'ABCD2345')
click('下一步')
# Well-formed but unknown code: the real cloud rejects it (needs network).
wait('配对码不正确。请输入电脑上显示的 8 位码（不包含 0、O、1、I、L）。')
assert find(tree(), '手机已配对') is None
checks.append('R01: unknown code is rejected by the cloud, no fake success')
# Hide keyboard if present, then use the explicit app back button.
click('返回'); wait('连接电脑')
checks.append('R01: leaving pairing returns to the host screen')
click('连接电脑'); click('扫一扫')
click('com.android.permissioncontroller:id/permission_deny_button')
wait('未获得相机权限。可在系统设置中允许，或改用配对码。')
checks.append('R01: denied camera permission shows pairing-code fallback')
click('扫描二维码')
click('com.android.permissioncontroller:id/permission_allow_foreground_only_button')
wait('Lom · 扫描电脑上的配对二维码')
checks.append('R01: camera permission opens the in-app QR scanner')
adb('shell', 'input', 'keyevent', '4')
wait('扫描二维码')
assert find(tree(), '手机已配对') is None
assert find(tree(), '未获得相机权限。可在系统设置中允许，或改用配对码。') is None
checks.append('R01: cancelling scanner does not create a paired device')
(out / 'ui-smoke-results.json').write_text(json.dumps({'passed': checks}, ensure_ascii=False, indent=2))
print(json.dumps({'passed': len(checks), 'checks': checks}, ensure_ascii=False))
