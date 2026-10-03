"""Local perception only. Private stdio protocol v1; no HTTP, cloud or raw-audio files.

Models must be provisioned locally before launch. Inference stderr is never relayed
to product logs. PortAudio callback never waits for ASR or Kernel operations.
"""
import os
import sys
import json
import time
import threading
import queue
from collections import deque
from typing import Protocol
import socket

def deny_network(*args, **kwargs):
    raise RuntimeError("Voice inference network is disabled")

socket.socket.connect = deny_network
socket.socket.connect_ex = deny_network
socket.create_connection = deny_network

WIRE = sys.stdout
# Third-party diagnostics must not corrupt or expose text through protocol stdout.
sys.stdout = sys.stderr
WRITE_LOCK = threading.Lock()

def emit(value):
    with WRITE_LOCK:
        WIRE.write(json.dumps(value, separators=(",", ":")) + "\n")
        WIRE.flush()

def reply(request, ok=True, value=None):
    emit({"id": request["id"], "ok": ok, "value": value})

class Vad(Protocol):
    def speech(self, audio) -> float: ...

class Asr(Protocol):
    def transcribe(self, audio) -> str: ...

class Tts(Protocol):
    def synthesize(self, text): ...

class Wake(Protocol):
    def detect(self, audio) -> bool: ...

class SileroVad:
    def __init__(self):
        import torch
        from silero_vad import load_silero_vad
        self.torch = torch
        torch.set_num_threads(1)
        self.model = load_silero_vad()

    def speech(self, audio):
        return float(self.model(self.torch.from_numpy(audio), 16000).item())

class WhisperAsr:
    def __init__(self):
        from faster_whisper import WhisperModel
        model = os.environ.get("JARVIS_ASR_MODEL_PATH", "")
        if not os.path.isdir(model):
            raise ValueError("Local ASR model directory required")
        self.model = WhisperModel(model, device="cpu", compute_type="int8", local_files_only=True)

    def transcribe(self, audio):
        segments, _ = self.model.transcribe(audio, language="en", beam_size=1,
                                          vad_filter=False, condition_on_previous_text=False)
        return " ".join(s.text.strip() for s in segments).strip()[:8192]

class KokoroTts:
    def __init__(self):
        from kokoro import KPipeline
        # HF offline enforced by the parent. Missing cached assets fail explicitly.
        self.pipeline = KPipeline(lang_code="b")
        self.voice = os.environ.get("JARVIS_TTS_VOICE", "bf_emma")

    def synthesize(self, text):
        for _, _, audio in self.pipeline(text, voice=self.voice):
            yield audio.numpy() if hasattr(audio, "numpy") else audio

class PorcupineWake:
    def __init__(self):
        import pvporcupine
        self.engine = pvporcupine.create(access_key=os.environ["PICOVOICE_ACCESS_KEY"], keywords=["jarvis"])
        if self.engine.sample_rate != 16000 or self.engine.frame_length != 512:
            raise ValueError("Unsupported wake frame format")

    def detect(self, audio):
        return self.engine.process((audio * 32767).astype("int16")) >= 0

class Runtime:
    def __init__(self, vad=None, asr=None, tts=None, wake=None):
        import numpy as np
        import sounddevice as sd
        self.np, self.sd = np, sd
        self.frames = queue.Queue(maxsize=128)  # <=4.1 seconds, in RAM only
        self.asr_jobs = queue.Queue(maxsize=4)
        self.utterance = 0
        self.last_final = 0
        self.inference_failed = False
        self.alive = True
        self.engaged = False
        self.input_id = None
        self.output_id = None
        self.stream = None
        self.output = None
        self.cancel = threading.Event()
        self.play_lock = threading.Lock()
        self.playing = False
        self.generation = 0
        self.vad = vad or SileroVad()
        self.asr = asr or WhisperAsr()
        self.tts = tts or KokoroTts()
        self.wake = wake or (PorcupineWake() if os.environ.get("PICOVOICE_ACCESS_KEY") else None)
        self.device_lock = threading.RLock()
        threading.Thread(target=self.listen, daemon=True).start()
        threading.Thread(target=self.infer, daemon=True).start()

    def event(self, kind, **values):
        emit({"kind": "recognition", "event": {"type": kind, "deviceId": str(self.input_id or "default"),
                                              "observedAt": time.monotonic() * 1000, **values}})

    def devices(self):
        default_in, default_out = self.sd.default.device
        return [{"id": str(i), "name": d["name"], "input": d["max_input_channels"] > 0,
                 "output": d["max_output_channels"] > 0, "defaultInput": i == default_in,
                 "defaultOutput": i == default_out} for i, d in enumerate(self.sd.query_devices())]

    def callback(self, data, frames, timing, status):
        if status or self.frames.full():
            self.generation += 1  # Never splice dropped audio into another utterance.
            self.event("observation-dropped")
            self.event("audio-state", vad="silence", amplitude=0)
        try:
            self.frames.put_nowait((data[:, 0].copy(), self.generation))
        except queue.Full:
            pass

    def capture(self):
        with self.device_lock:
            if self.stream:
                self.stream.close()
            self.stream = self.sd.InputStream(device=self.input_id, channels=1, samplerate=16000,
                                             blocksize=512, dtype="float32", callback=self.callback)
            self.stream.start()
            self.generation += 1
            self.event("device-ready")

    def listen(self):
        pieces, speech, silent, last_partial = [], False, 0, 0.0
        preroll = deque(maxlen=6)
        generation = self.generation
        while self.alive:
            try:
                audio, frame_generation = self.frames.get(timeout=1)
            except queue.Empty:
                try:
                    if self.stream is not None and not self.stream.active:
                        self.event("device-lost")
                        self.capture()
                except Exception:
                    self.event("device-lost")
                    time.sleep(1)
                continue
            if generation != frame_generation:
                pieces, speech, silent = [], False, 0
                preroll.clear()
                generation = frame_generation
            try:
                confidence = self.vad.speech(audio)
                amplitude = min(1.0, float(self.np.sqrt(self.np.mean(audio ** 2))) * 4)
                now = time.monotonic()
                if now - getattr(self, "last_envelope", 0) >= .1:
                    self.last_envelope = now
                    self.event("audio-state", amplitude=amplitude, vad="speech" if confidence >= .5 else "silence")
                if not self.engaged and self.wake:
                    if self.wake.detect(audio) and not self.playing:
                        self.engaged = True
                        self.event("wake")  # Binary detector; no invented probability.
                    continue
                if confidence >= .5:
                    if not speech:
                        speech, silent = True, 0
                        self.utterance += 1
                        pieces = list(preroll)
                        preroll.clear()
                        self.event("speech-start", utteranceId=self.utterance)  # No AEC claim.
                    silent = 0
                elif speech:
                    silent += 512
                if not speech:
                    preroll.append(audio)
                    continue
                pieces.append(audio)
                # Hard utterance limit prevents unbounded buffers/latency.
                final = silent >= 8000 or len(pieces) >= 625
                if final or (self.engaged and now - last_partial >= .65 and len(pieces) >= 16):
                    job = (self.np.concatenate(pieces), final, self.utterance, generation)
                    # Keep newest work only; never block capture behind inference.
                    if self.asr_jobs.full():
                        try:
                            self.asr_jobs.get_nowait()
                            self.event("observation-dropped")
                        except queue.Empty:
                            pass
                    self.asr_jobs.put_nowait(job)
                    last_partial = now
                    if final:
                        self.event("silence", durationMs=silent / 16)
                        pieces, speech, silent = [], False, 0
            except Exception:
                pieces, speech, silent = [], False, 0
                self.event("device-lost")

    def infer(self):
        previous = (0, "")
        while self.alive:
            try:
                audio, final, utterance, generation = self.asr_jobs.get(timeout=1)
            except queue.Empty:
                continue
            try:
                if not final and utterance <= self.last_final:
                    continue
                text = self.asr.transcribe(audio)
                if self.inference_failed:
                    self.inference_failed = False
                    self.event("device-ready")
                if generation != self.generation:
                    continue
                if final:
                    self.last_final = utterance
                    if not self.engaged:
                        import re
                        match = re.match(r"^jarvis\b[\s.,?!]*", text, flags=re.I)
                        if match and not self.playing:
                            self.engaged = True
                            self.event("wake")
                            rest = text[match.end():]
                            if rest:
                                self.event("final", text=rest, utteranceId=utterance)
                    elif text:
                        self.event("final", text=text, utteranceId=utterance)
                elif self.engaged and text and previous != (utterance, text):
                    previous = (utterance, text)
                    self.event("partial", text=text, utteranceId=utterance)
            except Exception:
                self.inference_failed = True
                self.event("device-lost")

    def stop_playback(self):
        self.cancel.set()
        # Abort PortAudio immediately; don't wait for model synthesis to finish.
        with self.device_lock:
            if self.output:
                self.output.abort()
        emit({"kind": "playback", "amplitude": 0})

    def speak(self, request):
        try:
            if self.cancel.is_set():
                reply(request)
                return
            self.playing = True
            with self.device_lock:
                self.output = self.sd.OutputStream(device=self.output_id, samplerate=24000, channels=1, dtype="float32", blocksize=480)
                self.output.start()
            for audio in self.tts.synthesize(request["text"]):
                for start in range(0, len(audio), 480):
                    if self.cancel.is_set():
                        break
                    chunk = self.np.asarray(audio[start:start + 480], dtype="float32")
                    self.output.write(chunk)
                    emit({"kind": "playback", "amplitude": min(1.0, float(self.np.sqrt(self.np.mean(chunk ** 2))) * 4)})
                if self.cancel.is_set():
                    break
            reply(request)
        except Exception:
            reply(request, self.cancel.is_set())
        finally:
            with self.device_lock:
                if self.output:
                    self.output.close()
                    self.output = None
            self.playing = False
            emit({"kind": "playback", "amplitude": 0})
            self.play_lock.release()

def main():
    runtime = None
    for line in sys.stdin:
        request = None
        try:
            if len(line) > 16384:
                raise ValueError("Oversize command")
            request = json.loads(line)
            if request.get("v") != 1 or not isinstance(request.get("id"), int):
                raise ValueError("Invalid version")
            op = request["op"]
            if op == "shutdown":
                if runtime:
                    runtime.alive = False
                    runtime.stop_playback()
                    if runtime.stream:
                        runtime.stream.close()
                reply(request)
                break
            if runtime is None:
                runtime = Runtime()
            if op == "start":
                runtime.capture()
            elif op == "devices":
                reply(request, value=runtime.devices())
                continue
            elif op == "cancel":
                runtime.stop_playback()
            elif op == "speak":
                if not isinstance(request.get("text"), str) or len(request["text"]) > 8192:
                    raise ValueError("Invalid speech text")
                if not runtime.play_lock.acquire(blocking=False):
                    reply(request, False)
                    continue
                runtime.cancel.clear()  # Reset before dispatch, so early cancellation isn't lost.
                threading.Thread(target=runtime.speak, args=(request,), daemon=True).start()
                continue
            elif op == "engaged":
                if not isinstance(request.get("value"), bool):
                    raise ValueError("Invalid activation")
                runtime.engaged = request["value"]
            elif op in ("input", "output"):
                device = request["deviceId"]
                device = None if device == "default" else int(device)
                if op == "input":
                    runtime.sd.check_input_settings(device=device, channels=1, samplerate=16000)
                    runtime.input_id = device
                    runtime.capture()
                else:
                    runtime.sd.check_output_settings(device=device, channels=1, samplerate=24000)
                    runtime.stop_playback()
                    runtime.output_id = device
            elif op == "stop":
                if runtime.stream:
                    runtime.stream.close()
                    runtime.stream = None
            else:
                raise ValueError("Unknown operation")
            reply(request)
        except Exception:
            if isinstance(request, dict) and isinstance(request.get("id"), int):
                reply(request, False)

if __name__ == "__main__":
    main()
