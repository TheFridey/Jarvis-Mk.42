"""Dependency-free control-plane tests. These do not qualify audio hardware."""
import importlib.util
import io
import json
from pathlib import Path
import threading
import unittest
from unittest.mock import Mock

spec = importlib.util.spec_from_file_location("voice_sidecar", Path(__file__).with_name("main.py"))
voice = importlib.util.module_from_spec(spec)
spec.loader.exec_module(voice)

class RuntimeControls(unittest.TestCase):
    def setUp(self):
        self.wire = io.StringIO()
        voice.WIRE = self.wire

    def test_cancel_aborts_playback_while_synthesis_lock_is_held(self):
        runtime = voice.Runtime.__new__(voice.Runtime)
        runtime.cancel = threading.Event()
        runtime.device_lock = threading.RLock()
        runtime.play_lock = threading.Lock()
        runtime.play_lock.acquire()
        runtime.output = Mock()
        runtime.stop_playback()
        self.assertTrue(runtime.cancel.is_set())
        runtime.output.abort.assert_called_once()
        self.assertEqual(json.loads(self.wire.getvalue()), {"kind": "playback", "amplitude": 0})

    def test_early_cancel_never_starts_output_or_synthesis(self):
        runtime = voice.Runtime.__new__(voice.Runtime)
        runtime.cancel = threading.Event()
        runtime.cancel.set()
        runtime.device_lock = threading.RLock()
        runtime.play_lock = threading.Lock()
        runtime.play_lock.acquire()
        runtime.output = None
        runtime.tts = Mock()
        runtime.speak({"id": 9, "text": "test"})
        runtime.tts.synthesize.assert_not_called()
        self.assertFalse(runtime.play_lock.locked())
        replies = [json.loads(line) for line in self.wire.getvalue().splitlines()]
        self.assertTrue(replies[0]["ok"])

    def test_offline_runtime_blocks_outgoing_network(self):
        with self.assertRaisesRegex(RuntimeError, "network is disabled"):
            voice.socket.create_connection(("example.com", 443))

    def test_command_version_is_checked_before_initializing_models(self):
        previous = voice.sys.stdin
        voice.sys.stdin = io.StringIO('{"v":2,"id":1,"op":"start"}\n{"v":1,"id":2,"op":"shutdown"}\n')
        try:
            voice.main()
        finally:
            voice.sys.stdin = previous
        self.assertEqual([json.loads(line)["ok"] for line in self.wire.getvalue().splitlines()], [False, True])

if __name__ == "__main__":
    unittest.main()
