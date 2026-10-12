"""Broker unit tests. Real cgroup/descendant/OOM checks run on Linux after install."""
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("guard", Path(__file__).with_name("agent-studio-workload-guard.py"))
guard = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guard)


class WorkloadGuardTests(unittest.TestCase):
    def test_rejects_paths_and_non_uuid_names(self):
        for token in ("../pm2-agentstudio.service", "", "ABC", "/tmp/job"):
            with self.assertRaises(ValueError):
                guard.group_path(token)

    def test_new_job_has_hard_limit_and_no_reclaim_throttle_or_swap(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "ready").touch()
            with patch.object(guard, "ROOT", root), patch.object(guard, "STATE", root):
                group = guard.prepare("a" * 32)
                self.assertEqual((group / "memory.max").read_text(), str(8 * 1024 ** 3))
                self.assertEqual((group / "memory.high").read_text(), "max")
                self.assertEqual((group / "memory.swap.max").read_text(), "0")
                self.assertEqual((group / "memory.oom.group").read_text(), "1")
                self.assertEqual((group / "cpu.max").read_text(), "200000 100000")
                with self.assertRaises(FileExistsError):
                    guard.prepare("a" * 32)

    def test_no_unlimited_fallback_when_supervisor_is_down(self):
        with tempfile.TemporaryDirectory() as temp:
            with patch.object(guard, "ROOT", Path(temp)), patch.object(guard, "STATE", Path(temp)):
                with self.assertRaisesRegex(RuntimeError, "not ready"):
                    guard.prepare("a" * 32)

    def test_recycled_pid_is_not_considered_alive(self):
        with patch.object(guard, "identity", return_value={"start": "new", "state": "S"}):
            self.assertFalse(guard.alive({"pid": 123, "start": "old"}))

    def test_attach_rejects_other_users_before_creating_group(self):
        with patch.object(guard, "identity", return_value={"uid": -1}), patch.object(guard.pwd, "getpwnam") as user:
            user.return_value.pw_uid = 997
            with self.assertRaises(PermissionError):
                guard.attach(123, "a" * 32)


if __name__ == "__main__":
    unittest.main()
