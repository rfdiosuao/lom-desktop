#!/usr/bin/env python3
"""Inspect the explicit public export, never the private source tree."""
from pathlib import Path
import re, subprocess, sys
root = Path(__file__).resolve().parents[1]
files = subprocess.check_output(['git', 'ls-files', '-z'], cwd=root).decode().split('\0')
patterns = {
    'private-key': rb'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----',
    'access-token': rb'(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|sk-[A-Za-z0-9_-]{24,}|AKIA[A-Z0-9]{16})',
    'personal-home': rb'(?:/' rb'Users/[^/\s]+/|/' rb'home/[^/\s]+/|[A-Z]:\\\\Users\\\\[^\\\\\s]+)',
    'private-address': rb'(?<![\d.])(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})(?![\d.])',
}
allowed = {'.github', 'src', 'src-tauri', 'docs', 'public', 'tools'}
errors = []
for name in filter(None, files):
    p = Path(name)
    if len(p.parts) > 1 and p.parts[0] not in allowed:
        errors.append((name, 'unexpected-directory'))
    if any(part in {'binaries','target','node_modules','.git','deploy'} for part in p.parts) or p.name.startswith('.env'):
        errors.append((name, 'private-or-generated-artifact'))
    if p.suffix.lower() in {'.dmg','.exe','.apk','.zip','.sqlite','.log'}:
        errors.append((name, 'binary-or-runtime-artifact'))
    data = (root / p).read_bytes()
    if p.suffix.lower() in {'.png','.ico','.icns'}: continue
    for rule, pattern in patterns.items():
        if re.search(pattern, data): errors.append((name, rule))
    if p.suffix in {'.ts','.tsx','.rs'} and p.name != 'audit-public.py':
        if re.search(rb'https?://(?!ipc\.localhost)[a-zA-Z0-9.-]+', data) and '.test.' not in name:
            errors.append((name, 'unexpected-network-address'))
for name, rule in errors: print(f'{name}: {rule}')
print(f'Public export: {len(list(filter(None, files)))} files, {len(errors)} findings')
sys.exit(bool(errors))
