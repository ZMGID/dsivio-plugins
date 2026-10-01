"""Protocol boundaries; inference itself is exercised separately with cached WhisperX."""
import http.client
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import wave

spec = importlib.util.spec_from_file_location("asr_server", Path(__file__).with_name("server.py"))
server = importlib.util.module_from_spec(spec)
spec.loader.exec_module(server)
TOKEN = "a" * 64

HARNESS = r'''
import importlib.metadata, json, sys, threading, time
from pathlib import Path
from types import SimpleNamespace
sys.path.insert(0, sys.argv[1])
from server import Handler
from http.server import ThreadingHTTPServer
class Engine:
    args = SimpleNamespace(model="small", device="cpu", compute="int8", batch_size=8)
    def transcribe(self, pcm, language):
        time.sleep(float(sys.argv[3]))
        return {"language": language, "segments": [{"text": "今天", "words": [{"text": "今", "start": 0.0, "end": 0.005}, {"text": "天"}]}]}
original_version = importlib.metadata.version
importlib.metadata.version = lambda name: "3.8.6" if name == "whisperx" else original_version(name)
s = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
s.daemon_threads = True
s.engine = Engine()
s.token = "a" * 64
s.roots = [Path(sys.argv[2])]
s.inference_lock = threading.Lock()
s.active_task_id = None
s.last_activity = time.monotonic()
s.stop_requested = False
s.timeout = 0.1
print(json.dumps({"port": s.server_port}), flush=True)
while not s.stop_requested:
    s.handle_request()
s.server_close()
'''


class ProtocolTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.root = Path(self.directory.name).resolve()
        self.audio = self.root / "audio.wav"
        with wave.open(str(self.audio), "wb") as wav:
            wav.setparams((1, 2, 16000, 0, "NONE", "not compressed"))
            wav.writeframes(bytes(320))
        self.child = None

    def tearDown(self):
        if self.child:
            self.child.terminate()
            self.child.wait(timeout=5)
            self.child.stdout.close()
            self.child.stderr.close()
        self.directory.cleanup()

    def start(self, inference_seconds=0):
        self.child = subprocess.Popen([sys.executable, "-c", HARNESS, str(Path(__file__).parent), str(self.root), str(inference_seconds)], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        self.port = json.loads(self.child.stdout.readline())["port"]

    def request(self, path, body=None, extra_headers=None):
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        headers = {"Authorization": "Bearer " + TOKEN, "Content-Type": "application/json"}
        headers.update(extra_headers or {})
        connection.request("GET" if body is None else "POST", path, None if body is None else json.dumps(body), headers)
        response = connection.getresponse()
        value = json.loads(response.read())
        connection.close()
        return response.status, value

    def test_pcm_frames_and_allowed_root_are_exact(self):
        self.assertEqual(len(server.read_audio(str(self.audio), [self.root], 160)), 320)
        for count in (0, True, 159, 161, 160.0):
            with self.assertRaises(server.ServiceError):
                server.read_audio(str(self.audio), [self.root], count)
        with self.assertRaises(server.ServiceError):
            server.read_audio(str(self.audio), [self.root / "other"])
        with self.audio.open("r+b") as output:
            output.seek(40)
            output.write((321).to_bytes(4, "little"))
        with self.assertRaises(server.ServiceError):
            server.read_audio(str(self.audio), [self.root])

    def test_auth_browser_and_evidence_boundaries(self):
        self.start()
        self.assertEqual(self.request("/health", extra_headers={"Authorization": "Bearer wrong"})[0], 401)
        self.assertEqual(self.request("/health", extra_headers={"Origin": "http://localhost"})[0], 403)
        self.assertEqual(self.request("/health", extra_headers={"Host": "attacker.invalid"})[0], 403)
        base = {"audio_path": str(self.audio), "language": "zh", "sample_frames": 160}
        self.assertEqual(self.request("/transcribe", {**base, "sample_frames": 161})[0], 400)
        self.assertEqual(self.request("/transcribe", {**base, "sample_frames": None})[0], 400)
        self.assertEqual(self.request("/transcribe", {**base, "language": "auto"})[0], 400)
        self.assertEqual(self.request("/transcribe", {"audio_path": str(self.audio)})[0], 400)
        status, transcript = self.request("/transcribe", base)
        self.assertEqual(status, 200)
        self.assertEqual((transcript["schema"], transcript["sampleRate"], transcript["sampleFrames"]), ("dsivio.media.transcript/1", 16000, 160))
        self.assertEqual(transcript["segments"][0]["words"], [{"text": "今", "start": 0.0, "end": 0.005}, {"text": "天"}])
        self.assertEqual(self.request("/cancel", {"task_id": "absent"})[1]["outcome"], "too-late")
        status, segment = self.request("/transcribe", {**base, "timestamps": "segment"})
        self.assertNotIn("words", segment["segments"][0])
        self.assertEqual(self.request("/shutdown", {})[0], 200)
        self.assertEqual(self.child.wait(timeout=5), 0)

    def begin_inference(self):
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        connection.request("POST", "/transcribe", json.dumps({"audio_path": str(self.audio), "language": "en", "task_id": "owned"}), {"Authorization": "Bearer " + TOKEN, "Content-Type": "application/json"})
        deadline = time.monotonic() + 3
        while time.monotonic() < deadline:
            if self.request("/health")[1]["activeTaskId"] == "owned":
                return connection
            time.sleep(0.01)
        self.fail("Inference did not become active")

    def test_cancel_matches_active_owner_and_observes_exit(self):
        self.start(10)
        connection = self.begin_inference()
        self.assertEqual(self.request("/shutdown", {})[1]["error"]["code"], "ASR_BUSY")
        self.assertEqual(self.request("/cancel", {"task_id": "other"})[1]["outcome"], "too-late")
        self.assertEqual(self.request("/cancel", {"task_id": "owned"})[1]["outcome"], "requested")
        self.assertEqual(self.child.wait(timeout=5), 0)
        connection.close()

    def test_disconnect_stops_inference_child(self):
        self.start(10)
        connection = self.begin_inference()
        connection.close()
        self.assertEqual(self.child.wait(timeout=5), 0)


if __name__ == "__main__":
    unittest.main()
