#!/usr/bin/env python3
"""Scan the public working tree AND index. Never echo matched secret values."""
from pathlib import Path
import re
import subprocess
import sys

PATTERNS = {
    'private-key': rb'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----',
    'access-token': rb'(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|sk-[A-Za-z0-9_-]{24,}|AKIA[A-Z0-9]{16})',
    'personal-home': rb'(?:/' rb'Users/[^/\s]+/|/' rb'home/[^/\s]+/|[A-Z]:\\(?:\\)?Users\\(?:\\)?[^\\\s]+)',
    'private-address': rb'(?<![\d.])(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})(?![\d.])',
}
ALLOWED_DIRS = {'.github', 'src', 'src-tauri', 'docs', 'public', 'tools'}
BANNED_PARTS = {'binaries', 'target', 'node_modules', '.git', 'deploy', 'remote_wire', 'phone_bridge', 'remote_crypto', 'pairing', 'phones', 'server', 'cloud', 'account', 'billing', 'login', 'login_callback', 'login_target', 'remoteWire'}
BANNED_EXTENSIONS = {'.dmg', '.exe', '.apk', '.zip', '.sqlite', '.db', '.log', '.key', '.pem', '.p12', '.pfx'}
# URLs in production code are limited to the desktop IPC/dev/sidecar loopback.
LOCAL_HOSTS = {b'ipc.localhost', b'127.0.0.1', b'localhost'}
CODE_EXTENSIONS = {'.ts', '.tsx', '.rs'}


def inspect(name: str, data: bytes) -> list[str]:
    p = Path(name)
    errors = []
    if p.is_absolute() or '..' in p.parts:
        errors.append('invalid-path')
    if len(p.parts) > 1 and p.parts[0] not in ALLOWED_DIRS:
        errors.append('unexpected-directory')
    if any(part in BANNED_PARTS or Path(part).stem in BANNED_PARTS for part in p.parts) or p.name.startswith('.env'):
        errors.append('private-or-generated-artifact')
    if p.suffix.lower() in BANNED_EXTENSIONS:
        errors.append('binary-or-runtime-artifact')
    # Do not skip images: readable embedded metadata can also contain secrets.
    for rule, pattern in PATTERNS.items():
        if re.search(pattern, data):
            errors.append(rule)
    if p.suffix in CODE_EXTENSIONS and '.test.' not in name:
        hosts = re.findall(rb'(?:https?|wss?)://([^/\s\x22\x27:;]+)', data)
        if any(host not in LOCAL_HOSTS for host in hosts):
            errors.append('unexpected-network-address')
        if re.search(rb'(?:fetch\s*\(|new\s+WebSocket\s*\()', data) and name not in {'src/runtime/client.ts', 'src/runtime/events.ts'}:
            errors.append('network-outside-local-adapter')
    return errors


def scan(root: Path) -> tuple[int, list[tuple[str, str]]]:
    def git(*args: str) -> bytes:
        return subprocess.check_output(['git', *args], cwd=root)
    names = set(filter(None, git('ls-files', '--cached', '--others', '--exclude-standard', '-z').decode().split('\0')))
    failures = set()
    for name in sorted(names):
        path = root / name
        if path.is_symlink():
            failures.add((name, 'symlink'))
        elif path.is_file():
            failures.update((name, rule) for rule in inspect(name, path.read_bytes()))
        # An index secret must still fail when the working copy was cleaned up.
        result = subprocess.run(['git', 'show', f':{name}'], cwd=root, capture_output=True)
        if result.returncode == 0:
            failures.update((name + ' [index]', rule) for rule in inspect(name, result.stdout))
    return len(names), sorted(failures)


if __name__ == '__main__':
    count, findings = scan(Path(__file__).resolve().parents[1])
    for name, rule in findings:
        print(f'{name}: {rule}')
    print(f'Public export: {count} files, {len(findings)} findings')
    sys.exit(bool(findings))
