#!/usr/bin/env python3
"""Run every workspace test target, reclaiming each executable after execution.

Opt-in alternative to nextest's compile-all-first strategy. Libraries and Cargo
fingerprints remain cached. Like the default nextest gate, this excludes doctests.
"""
import json
import os
from pathlib import Path
import subprocess
import sys


def test_targets(metadata):
    members = set(metadata['workspace_members'])
    groups = {}
    for package in metadata['packages']:
        if package['id'] not in members:
            continue
        for target in package['targets']:
            if not target.get('test', True):
                continue
            kinds = target['kind']
            if 'test' in kinds:
                selector = ('--test', target['name'])
            elif 'bin' in kinds:
                selector = ('--bin', target['name'])
            elif 'lib' in kinds or 'proc-macro' in kinds:
                selector = ('--lib',)
            else:
                continue
            groups.setdefault(selector, set()).add((package['id'], target['name']))
    return list(groups.items())


def reclaim(executables, target_dir):
    root = Path(target_dir).resolve()
    for name in executables:
        path = Path(name)
        # Cargo output is data: never let a malformed artifact delete user files.
        if not path.is_symlink() and path.resolve().is_relative_to(root) and path.is_file():
            path.unlink()


def run_target(selector, expected, target_dir):
    # Keep workspace feature unification identical for every invocation. Selecting
    # one package at a time would create many duplicate dependency variants.
    command = ['just', '_cargo', 'test', '--locked', '--workspace', *selector,
               '--message-format=json', '--', '--test-threads=' + os.environ.get('NEXTEST_TEST_THREADS', '2')]
    process = subprocess.Popen(command, stdout=subprocess.PIPE, text=True)
    executables = []
    found = set()
    for line in process.stdout:
        try:
            event = json.loads(line)
        except ValueError:
            print(line, end='', flush=True)
            continue
        if not isinstance(event, dict):
            print(line, end='', flush=True)
            continue
        if event.get('reason') == 'compiler-artifact' and event.get('profile', {}).get('test') and event.get('executable'):
            executables.append(event['executable'])
            found.add((event['package_id'], event['target']['name']))
        elif event.get('reason') == 'compiler-message':
            print(event.get('message', {}).get('rendered', ''), end='', flush=True)
    code = process.wait()
    reclaim(executables, target_dir)
    if not code and not expected.issubset(found):
        print('Cargo did not execute every selected workspace test target', file=sys.stderr)
        return 1
    return code


def main():
    metadata = json.loads(subprocess.check_output(
        ['just', '_cargo', 'metadata', '--locked', '--no-deps', '--format-version=1'], text=True))
    if 'CARGO_TARGET_DIR' not in os.environ:
        # Never reclaim executables from another task's ordinary Cargo cache.
        dedicated = str(Path(metadata['target_directory']) / 'low-disk-tests')
        os.environ['CARGO_TARGET_DIR'] = dedicated
        metadata['target_directory'] = dedicated
    targets = list(test_targets(metadata))
    if not targets:
        raise RuntimeError('No workspace test targets were discovered')
    for index, (selector, expected) in enumerate(targets, 1):
        print(f'[{index}/{len(targets)}] workspace {" ".join(selector)} ({len(expected)} targets)', flush=True)
        code = run_target(selector, expected, metadata['target_directory'])
        if code:
            return code
    print(f'Passed all {sum(len(expected) for _, expected in targets)} workspace test targets.', flush=True)
    return 0


if __name__ == '__main__':
    sys.exit(main())
