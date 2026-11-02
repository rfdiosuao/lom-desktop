#!/usr/bin/env python3
"""Audit export worktree or staged blobs. Report paths/rule IDs, never matches."""
import argparse
import re
import subprocess
import io
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FORBIDDEN = ('crates/lom-server/', 'deploy/', 'apps/site/', 'lom-admin/')
RUNTIME = {'.db', '.sqlite', '.sqlite3', '.jks', '.keystore', '.p12', '.pfx', '.mobileprovision', '.o', '.lo', '.la'}
RULES = {
    'private-key': re.compile(rb'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----\s+[A-Za-z0-9+/=\r\n]{100,}'),
    'github-token': re.compile(rb'\bgh[pousr]_[A-Za-z0-9]{30,}\b|\bgithub_pat_[A-Za-z0-9_]{60,}\b'),
    'api-secret': re.compile(rb'\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}\b'),
    'aws-key': re.compile(rb'\bAKIA[A-Z0-9]{16}\b'),
    'official-endpoint': re.compile(rb'(?i)https?://(?:[^/\s"\']*\.)?(?:heang[.]top|entermo[.]com)(?:[/:\s"\']|$)'),
    'personal-home': re.compile(rb'/Users/(?:heang|yuhang)(?:/|\\)|/home/(?:heang|yuhang)(?:/|\\)'),
    'credential-url': re.compile(rb'https?://[^/\s:@]+:[^/\s@]+@'),
}

def issues(name, data):
    path = Path(name)
    found = []
    if any(name.startswith(p) for p in FORBIDDEN): found.append('commercial-server')
    if path.suffix.lower() in RUNTIME: found.append('runtime-or-signing-file')
    if path.name in {'.env', 'local.properties', 'provider-customization.properties', 'ProviderCustomization.xcconfig'}: found.append('local-config')
    if re.search(r' 2\.(rs|ts|tsx)$', path.name): found.append('recovery-copy')
    for rule, pattern in RULES.items():
        inspected = re.sub(rb'https?://(?:user:(?:pass|password)|u:p)@example[.](?:com|invalid)', b'https://example.invalid', data) if rule == 'credential-url' else data
        if pattern.search(inspected): found.append(rule)
    if path.suffix.lower() in {'.pptx', '.docx', '.xlsx', '.zip', '.jar'}:
        try:
            with zipfile.ZipFile(io.BytesIO(data)) as archive:
                total = 0
                for item in archive.infolist():
                    total += item.file_size
                    if item.file_size > 16 * 1024 * 1024 or total > 64 * 1024 * 1024:
                        found.append('archive-review-required'); break
                    if Path(item.filename).suffix.lower() in {'.xml', '.json', '.properties', '.txt'}:
                        body = archive.read(item)
                        for rule, pattern in RULES.items():
                            if pattern.search(body): found.append('archive-' + rule)
        except zipfile.BadZipFile:
            found.append('invalid-archive')
    return list(dict.fromkeys(found))

def files(index=False):
    if not index:
        names = subprocess.check_output(['git', 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], cwd=ROOT).decode().split('\0')
        for name in sorted(set(names) - {''}):
            path = ROOT / name
            if path.is_file(): yield name, path.read_bytes()
        return
    entries = subprocess.check_output(['git', 'ls-files', '--stage', '-z'], cwd=ROOT).decode().split('\0')
    process = subprocess.Popen(['git', 'cat-file', '--batch'], cwd=ROOT, stdin=subprocess.PIPE, stdout=subprocess.PIPE)
    try:
        for entry in entries:
            if not entry: continue
            metadata, name = entry.split('\t', 1)
            mode, digest, stage = metadata.split()
            if mode == '160000': continue
            if stage != '0': raise RuntimeError('Resolve staged conflicts before auditing')
            process.stdin.write((digest + '\n').encode()); process.stdin.flush()
            header = process.stdout.readline().split()
            if len(header) != 3 or header[1] != b'blob': raise RuntimeError('Missing staged blob')
            data = process.stdout.read(int(header[2]))
            if process.stdout.read(1) != b'\n': raise RuntimeError('Invalid staged blob framing')
            yield name, data
    finally:
        process.stdin.close(); process.stdout.close()
        process.wait()

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--index', action='store_true')
    args = parser.parse_args()
    count = failed = 0
    for name, data in files(args.index):
        count += 1
        for rule in issues(name, data):
            print(f'{name}: {rule}')
            failed += 1
    print(f'Audited {count} files; {failed} findings. Values are never printed.')
    return bool(failed)

if __name__ == '__main__': raise SystemExit(main())
