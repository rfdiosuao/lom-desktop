import importlib.util
from pathlib import Path
import unittest
import io
import zipfile

spec = importlib.util.spec_from_file_location('audit', Path(__file__).with_name('audit-source.py'))
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)

class AuditTests(unittest.TestCase):
    def test_rejects_server_runtime_and_realistic_secret(self):
        self.assertIn('commercial-server', audit.issues('crates/lom-server/src/main.rs', b''))
        self.assertIn('runtime-or-signing-file', audit.issues('apps/android/release.jks', b''))
        secret = ('ghp_' + 'x' * 36).encode()
        self.assertIn('github-token', audit.issues('core/example.rs', secret))

    def test_allows_public_local_core_and_documented_test_material(self):
        self.assertEqual([], audit.issues('core/crates/aionui-app/src/server.rs', b'http://127.0.0.1:1234'))
        self.assertEqual([], audit.issues('protocol/testvectors/remote.json', b'{"api_key":"test-key"}'))

    def test_detects_private_origin_without_returning_match(self):
        text = ('https://api.' + 'heang' + '.top/v1').encode()
        self.assertEqual(['official-endpoint'], audit.issues('apps/desktop/config.ts', text))
        self.assertNotIn(text.decode(), repr(audit.issues('sample', text)))

    def test_detects_current_official_origin_and_tts_tokens(self):
        url = ('https://lom.' + 'entermodetwo' + '.com/api').encode()
        self.assertIn('official-endpoint', audit.issues('client.ts', url))
        secret = ('cfast_' + 'x' * 48).encode()
        self.assertIn('api-secret', audit.issues('client.ts', secret))
        self.assertNotIn(secret.decode(), repr(audit.issues('client.ts', secret)))

    def test_detects_production_hosts_without_blocking_local_pairing(self):
        host = bytes([103, 185, 249, 189])
        address = '.'.join(str(x) for x in host).encode()
        self.assertIn('production-host', audit.issues('config.rs', address))
        self.assertEqual([], audit.issues('lan.ts', b'http://192.168.1.20:1421'))

    def test_rejects_shared_commercial_ssh_credentials(self):
        service = ('"top.' + 'heang.lom.ssh.password"').encode()
        self.assertIn('official-ssh-credential-service', audit.issues('identity.rs', service))
        self.assertEqual([], audit.issues('identity.rs', b'"org.lom.community.desktop.ssh.password"'))

    def test_checks_compressed_document_contents_and_blocks_object_files(self):
        data = io.BytesIO()
        with zipfile.ZipFile(data, 'w') as archive:
            archive.writestr('docProps/core.xml', 'ghp_' + 'x' * 36)
        self.assertIn('archive-github-token', audit.issues('template.pptx', data.getvalue()))
        self.assertIn('runtime-or-signing-file', audit.issues('vendor/native.o', b'object'))

if __name__ == '__main__': unittest.main()
