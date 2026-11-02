#!/usr/bin/env python3
"""Source-export regression checks; does not substitute for APK/device tests."""
import base64
import hashlib
import hmac
import json
from pathlib import Path
import unittest
import urllib.parse
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
PAIR = ROOT / 'src/android/lom-pairing/src/main'
B64 = lambda b: base64.urlsafe_b64encode(b).decode().rstrip('=')
UNB64 = lambda s: base64.urlsafe_b64decode(s + '=' * (-len(s) % 4))

class PublicBoundary(unittest.TestCase):
    def source(self, name):
        return (PAIR / 'kotlin/top/heang/lom/pairing' / name).read_text()

    def test_no_automatic_components_or_exported_pairing(self):
        manifest = ET.parse(PAIR / 'AndroidManifest.xml').getroot()
        app = manifest.find('application')
        for tag in ['provider', 'service', 'receiver']:
            self.assertEqual([], list(app.findall(tag)))
        activity = next(x for x in app.findall('activity') if x.attrib['{http://schemas.android.com/apk/res/android}name'].endswith('PairingActivity'))
        self.assertEqual('false', activity.attrib['{http://schemas.android.com/apk/res/android}enabled'])
        self.assertEqual('false', activity.attrib['{http://schemas.android.com/apk/res/android}exported'])
        self.assertEqual([], list(activity.findall('intent-filter')))

    def test_ui_and_network_paths_fail_closed_before_effects(self):
        pairing = self.source('cloud/LomPairing.kt')
        self.assertIn('const val CLOUD_ENABLED = false', pairing)
        self.assertIn('pairingAllowedHosts: Set<String> = emptySet()', pairing)
        for name, guard, effect in [
            ('cloud/LomPairing.kt', 'if (!CLOUD_ENABLED) return', 'scope.launch { relay.start() }'),
            ('cloud/LomRelay.kt', 'if (!LomPairing.CLOUD_ENABLED) return', 'if (started) return'),
            ('cloud/LomConnectionService.kt', 'if (!LomPairing.CLOUD_ENABLED) return', 'context.startForegroundService'),
            ('cloud/HttpPairingApi.kt', 'if (!LomPairing.CLOUD_ENABLED) throw', 'val request = Request.Builder()'),
            ('ui/LomConnectionButton.kt', 'if (!LomPairing.CLOUD_ENABLED) return', 'val context = LocalContext.current'),
            ('ui/PairingActivity.kt', 'if (!LomPairing.CLOUD_ENABLED)', 'val model = ViewModelProvider'),
        ]:
            text = self.source(name)
            self.assertLess(text.index(guard), text.index(effect), name)

    def test_bundled_pairing_vectors(self):
        vectors = json.loads((ROOT / 'src/android/lom-pairing-core/src/test/resources/pairing-v1.json').read_text())
        for case in vectors['cases']:
            fields = urllib.parse.parse_qs(urllib.parse.urlsplit(case['qr']).query)
            self.assertEqual(case['host'], UNB64(fields['h'][0]).decode())
            desktop, phone = case['desktop']['keys'], case['phone']['keys']
            for device in ['desktop', 'phone']:
                d = case[device]
                self.assertEqual(d['keys'], B64(UNB64(d['x25519']) + UNB64(d['ed25519'])))
                self.assertEqual(d['fingerprint'], B64(hashlib.sha256(('LOM-KEY-FP-V1\n'+d['keys']).encode()).digest()[:16]))
            proof = f"LOM-PAIR-PROOF-V1\n{case['pairing_id']}\n{desktop}\n{phone}".encode()
            self.assertEqual(case['key_proof'], B64(hmac.new(UNB64(case['psk']), proof, hashlib.sha256).digest()))
            sas = hashlib.sha256(f"LOM-PAIR-SAS-V1\n{case['pairing_id']}\n{desktop}\n{phone}".encode()).digest()
            self.assertEqual(case['sas'], str(int.from_bytes(sas[:4], 'big') % 1000000).zfill(6))

if __name__ == '__main__':
    unittest.main()
