import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from contextlib import redirect_stderr
from io import StringIO

source = Path(__file__).resolve().parents[1] / 'core/scripts/just/test-workspace-low-disk.py'
spec = importlib.util.spec_from_file_location('low_disk', source)
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


class LowDiskTests(unittest.TestCase):
    def test_keeps_all_workspace_library_binary_and_integration_targets(self):
        targets = [
            {'name': 'lib', 'kind': ['lib'], 'test': True},
            {'name': 'cli', 'kind': ['bin'], 'test': True},
            {'name': 'integration', 'kind': ['test'], 'test': True},
            {'name': 'build-script', 'kind': ['custom-build']},
            {'name': 'disabled', 'kind': ['bin'], 'test': False},
        ]
        metadata = {'workspace_members': ['member'], 'packages': [
            {'id': 'dependency', 'name': 'external', 'targets': targets},
            {'id': 'member', 'name': 'member', 'targets': targets},
        ]}
        self.assertEqual(runner.test_targets(metadata), [
            (('--lib',), {('member', 'lib')}),
            (('--bin', 'cli'), {('member', 'cli')}),
            (('--test', 'integration'), {('member', 'integration')}),
        ])

    def test_same_named_tests_in_two_members_both_have_to_run(self):
        metadata = {'workspace_members': ['one', 'two'], 'packages': [
            {'id': name, 'name': name, 'targets': [{'name': 'shared', 'kind': ['test'], 'test': True}]}
            for name in ['one', 'two']
        ]}
        self.assertEqual(runner.test_targets(metadata), [
            (('--test', 'shared'), {('one', 'shared'), ('two', 'shared')}),
        ])

    def test_reclaims_only_real_build_outputs_and_preserves_outside_files(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            target = root / 'target'
            target.mkdir()
            executable = target / 'test-program'
            executable.write_text('compiled')
            user_file = root / 'user-file'
            user_file.write_text('preserve')
            link = target / 'linked-output'
            link.symlink_to(user_file)
            runner.reclaim([str(executable), str(user_file), str(link)], target)
            self.assertFalse(executable.exists())
            self.assertEqual(user_file.read_text(), 'preserve')
            self.assertTrue(link.is_symlink())

    def test_missing_test_targets_cannot_be_reported_as_success(self):
        class Process:
            stdout = []

            def wait(self):
                return 0

        with tempfile.TemporaryDirectory() as temp:
            with patch.object(runner.subprocess, 'Popen', return_value=Process()), redirect_stderr(StringIO()):
                self.assertEqual(runner.run_target(('--test', 'shared'), {('one', 'shared')}, temp), 1)

    def test_failed_test_exit_is_preserved(self):
        class Process:
            stdout = []

            def wait(self):
                return 7

        with tempfile.TemporaryDirectory() as temp:
            with patch.object(runner.subprocess, 'Popen', return_value=Process()):
                self.assertEqual(runner.run_target(('--lib',), {('one', 'lib')}, temp), 7)


if __name__ == '__main__':
    unittest.main()
