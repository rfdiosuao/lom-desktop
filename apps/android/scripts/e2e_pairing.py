#!/usr/bin/env python3
"""R01 end-to-end against the real Lom cloud: this script plays the desktop (same protocol and
math as the desktop app), the preview APK on a disposable emulator plays the phone.
Covers: QR path (deep link, key_proof), relay presence, removal push, pairing-code path with SAS
compared across both implementations, and unpairing from the phone.

  python3 scripts/e2e_pairing.py --adb .../adb --serial emulator-5580 --session-file <file> --output <dir>

The session file holds a Lom account session token for a TEST account; it is never printed.
"""
import argparse, base64, hashlib, hmac, json, os, re, secrets, subprocess, time, urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

p = argparse.ArgumentParser()
p.add_argument('--adb', default='adb'); p.add_argument('--serial', required=True)
p.add_argument('--session-file', required=True); p.add_argument('--output', required=True)
p.add_argument('--host', default='example.invalid')
a = p.parse_args()
if not a.serial.startswith('emulator-'):
    p.error('Use a disposable emulator, not a personal phone')
SESSION = Path(a.session_file).read_text().strip()
OUT = Path(a.output); OUT.mkdir(parents=True, exist_ok=True)
PKG = 'top.heang.lom.pairing.preview'
passed = []
b64 = lambda b: base64.urlsafe_b64encode(b).rstrip(b'=').decode()


def api(method, path, body=None):
    req = urllib.request.Request(f'https://{a.host}{path}', method=method,
        data=None if body is None else json.dumps(body).encode(),
        headers={'authorization': f'Bearer {SESSION}', 'content-type': 'application/json',
                 'user-agent': 'lom-e2e/1'})  # Cloudflare rejects the default Python UA (1010)
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        return json.loads(e.read())


def adb(*args, timeout=30):
    return subprocess.check_output([a.adb, '-s', a.serial, *args], stderr=subprocess.STDOUT, timeout=timeout)


def tree():
    adb('shell', 'uiautomator', 'dump', '/sdcard/lom-e2e.xml')
    return ET.fromstring(adb('shell', 'cat', '/sdcard/lom-e2e.xml'))


def find(root, text=None, cls=None, contains=False):
    for n in root.iter('node'):
        vals = (n.get('text') or '', n.get('content-desc') or '', n.get('resource-id') or '')
        ok = text is None or (any(text in v for v in vals) if contains else text in vals)
        if ok and (cls is None or n.get('class') == cls):
            return n
    return None


def wait(text=None, cls=None, contains=False, secs=20):
    end = time.time() + secs
    while time.time() < end:
        n = find(tree(), text, cls, contains)
        if n is not None:
            return n
        time.sleep(0.7)
    shot('missing')
    raise AssertionError(f'UI element missing: {text or cls}')


def tap(n):
    x1, y1, x2, y2 = map(int, re.findall(r'\d+', n.get('bounds')))
    adb('shell', 'input', 'tap', str((x1 + x2) // 2), str((y1 + y2) // 2))


def shot(name):
    (OUT / f'{name}.png').write_bytes(adb('exec-out', 'screencap', '-p'))


def until(fn, secs=20, what='condition'):
    end = time.time() + secs
    while time.time() < end:
        v = fn()
        if v:
            return v
        time.sleep(1)
    raise AssertionError(f'timed out waiting for {what}')


class Desktop:
    """Desktop side: random install keys, psk only in this process (R01 §2.2)."""
    def __init__(self):
        self.keys = b64(secrets.token_bytes(64))
        r = api('POST', '/v1/pairing/sessions', {'install_id': 'inst_e2e', 'desktop_name': 'E2E 测试电脑', 'desktop_keys': self.keys})
        assert r['success'], r
        self.s = r['data']; self.pid = self.s['pairing_id']; self.psk = secrets.token_bytes(32)
        fp = hashlib.sha256(f'LOM-KEY-FP-V1\n{self.keys}'.encode()).digest()[:16]
        self.qr = (f"lom://pair?v=1&h={b64(self.s['host'].encode())}&p={self.pid}&t={self.s['claim_token']}"
                   f"&k={b64(self.psk)}&f={b64(fp)}")

    def status(self):
        return api('GET', f'/v1/pairing/sessions/{self.pid}')['data']

    def sas(self, phone_keys):
        d = hashlib.sha256(f'LOM-PAIR-SAS-V1\n{self.pid}\n{self.keys}\n{phone_keys}'.encode()).digest()
        return f'{int.from_bytes(d[:4], "big") % 1_000_000:06d}'

    def verify(self, st):
        mac = hmac.new(self.psk, f'LOM-PAIR-PROOF-V1\n{self.pid}\n{self.keys}\n{st["device_keys"]}'.encode(), hashlib.sha256).digest()
        ok = hmac.compare_digest(b64(mac), st['key_proof'])
        api('POST', f'/v1/pairing/sessions/{self.pid}/verify', {'ok': ok})
        return ok


def devices():
    return api('GET', '/v1/devices')['data']


# Fresh phone: clean app data gives a new identity and no credential.
adb('shell', 'pm', 'clear', PKG)
adb('shell', 'cmd', 'locale', 'set-app-locales', PKG, '--locales', 'zh-CN')
adb('shell', 'am', 'start', '-n', PKG + '/.PreviewActivity'); wait('连接电脑')

# 1. QR path through the lom:// deep link (same parser and adapter as the in-app scanner).
d = Desktop()
adb('shell', f"am start -a android.intent.action.VIEW -d '{d.qr}' {PKG}")
wait('确认连接'); wait('E2E 测试电脑', contains=True)
st = until(lambda: (lambda s: s if s['state'] == 'claimed' else None)(d.status()), what='claimed')
assert st['method'] == 'qr' and d.verify(st), 'key_proof must verify with the desktop psk'
passed.append('R01 QR: phone checked the desktop fingerprint, desktop verified key_proof')
shot('qr-confirm')
tap(wait('确认连接')); wait('手机已配对', secs=30)
assert d.status()['state'] == 'confirmed'
passed.append('R01 AC-2: phone confirmed, session confirmed in cloud')
shot('qr-paired')
dev = until(lambda: next((x for x in devices() if x['online']), None), secs=20, what='relay online')
passed.append(f"R02 presence: device online via relay ({dev['info']['model']})")
tap(wait('完成')); tap(wait('连接电脑')); wait('E2E 测试电脑', contains=True); shot('menu-paired')
passed.append('R01: phone menu shows the connected computer')
adb('shell', 'input', 'keyevent', '4')

# 2. Removal from the desktop reaches the phone over the relay.
assert api('DELETE', f"/v1/devices/{dev['id']}")['success']
t0 = time.time()
# Measure the credential file itself (UI automation adds ~2 s per round), then check the menu.
def cred_gone():
    return b'lom-pairing.bin' not in adb('shell', 'run-as', PKG, 'ls', 'no_backup')
end = time.time() + 10
while time.time() < end and not cred_gone():
    time.sleep(0.2)
latency = time.time() - t0
assert cred_gone(), 'credential still present 10 s after removal'
tap(wait('连接电脑')); wait('扫一扫'); adb('shell', 'input', 'keyevent', '4')
passed.append(f'R01 AC-10: removed on desktop, phone dropped its credential in {latency:.1f}s and shows 扫一扫 again')

# 3. Pairing-code path: SAS must match between this script and the Kotlin implementation.
d = Desktop()
tap(wait('连接电脑')); tap(wait('配对码')); tap(wait(cls='android.widget.EditText'))
adb('shell', 'input', 'text', d.s['manual_code'].replace('-', '').lower())
tap(wait('下一步')); wait('两端确认码一致')
st = until(lambda: (lambda s: s if s['state'] == 'claimed' else None)(d.status()), what='claimed by code')
want = d.sas(st['device_keys'])
shown = re.sub(r'\D', '', ''.join(n.get('text') or '' for n in tree().iter('node') if re.fullmatch(r'\d{3} \d{3}', n.get('text') or '')))
assert shown == want, f'SAS mismatch phone={shown} desktop={want}'
passed.append('R01 AC-7: phone and desktop show the same 6-digit code')
shot('code-sas')
tap(wait('两端确认码一致')); tap(wait('确认连接')); wait('手机已配对', secs=30)
until(lambda: d.status()['state'] == 'confirmed', what='confirmed by code')
until(lambda: any(x['online'] for x in devices()), secs=20, what='relay online after code pairing')
passed.append('R01: pairing-code path confirmed and online')
tap(wait('完成'))

# 4. Unpair from the phone.
tap(wait('连接电脑')); tap(wait('解除配对')); dlg = wait('解除与电脑的连接？')
tap([n for n in tree().iter('node') if n.get('text') == '解除配对'][-1])
until(lambda: devices() == [], secs=15, what='device removed after phone unpair')
passed.append('R01 §2.7: unpair on phone removes the device in the cloud')
shot('after-unpair')

(OUT / 'e2e-results.json').write_text(json.dumps({'passed': passed}, ensure_ascii=False, indent=2))
print(json.dumps({'passed': len(passed), 'checks': passed}, ensure_ascii=False, indent=1))
