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

    def test_checks_compressed_document_contents_and_blocks_object_files(self):
        data = io.BytesIO()
        with zipfile.ZipFile(data, 'w') as archive:
            archive.writestr('docProps/core.xml', 'ghp_' + 'x' * 36)
        self.assertIn('archive-github-token', audit.issues('template.pptx', data.getvalue()))
        self.assertIn('runtime-or-signing-file', audit.issues('vendor/native.o', b'object'))

if __name__ == '__main__': unittest.main()
