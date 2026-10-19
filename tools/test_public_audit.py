import importlib.util
from pathlib import Path
import subprocess
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('audit_public', Path(__file__).with_name('audit-public.py'))
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)


class PublicAuditTests(unittest.TestCase):
    def test_credentials_even_inside_image_metadata(self):
        value = b'sk-' + b'a' * 32
        self.assertIn('access-token', audit.inspect('docs/assets/image.png', b'PNG metadata ' + value))

    def test_home_paths_and_private_addresses(self):
        for value in [b'/' + b'Users/person/project', b'C:' + b'\\Users\\person', b'192.' + b'168.1.1']:
            self.assertTrue(audit.inspect('docs/example.md', value))

    def test_local_transport_is_allowed_but_remote_is_not(self):
        self.assertEqual([], audit.inspect('src/runtime/client.ts', b'fetch("http://127.0.0.1:12345")'))
        self.assertIn('unexpected-network-address', audit.inspect('src/runtime/client.ts', b'fetch("https://example.invalid")'))
        self.assertIn('network-outside-local-adapter', audit.inspect('src/App.tsx', b'fetch(url)'))

    def test_private_artifacts(self):
        for name in ['src-tauri/src/remote_wire.rs', '.env.production', 'deploy/config.toml', 'docs/data.sqlite', 'docs/key.pem']:
            self.assertTrue(audit.inspect(name, b''), name)

    def test_untracked_and_staged_secret_cannot_hide_behind_clean_worktree(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            subprocess.run(['git', 'init', '-q', folder], check=True)
            value = b'sk-' + b'a' * 32
            (root / 'draft.md').write_bytes(value)
            self.assertTrue(audit.scan(root)[1])  # untracked
            subprocess.run(['git', 'add', 'draft.md'], cwd=root, check=True)
            (root / 'draft.md').write_text('clean working copy')
            self.assertIn(('draft.md [index]', 'access-token'), audit.scan(root)[1])

    def test_symlink_is_rejected(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            subprocess.run(['git', 'init', '-q', folder], check=True)
            try:
                (root / 'link.md').symlink_to(root / 'missing')
            except OSError:
                self.skipTest('This Windows account cannot create symlinks')
            self.assertIn(('link.md', 'symlink'), audit.scan(root)[1])


if __name__ == '__main__':
    unittest.main()
