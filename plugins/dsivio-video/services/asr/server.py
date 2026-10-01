"""Loopback-only, single-inference WhisperX service (no runtime downloads)."""
import argparse
import importlib.metadata
import json
import logging
import os
from pathlib import Path
import re
import socket
import tempfile
import threading
import time
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PROTOCOL = "dsivio-video.asr/1"
SERVICE_VERSION = "0.1.0"
MAX_REQUEST = 64 * 1024
MAX_AUDIO = 512 * 1024 * 1024


class ServiceError(Exception):
    def __init__(self, code, message, status=400):
        super().__init__(message)
        self.code, self.status = code, status


def deny_download(*args, **kwargs):
    raise ServiceError("RESOURCE_NOT_PREPARED", "Resource is not cached; run dsivio-video setup asr", 503)


class Engine:
    def __init__(self, args):
        os.environ.update(HF_HUB_OFFLINE="1", TRANSFORMERS_OFFLINE="1", HF_HUB_DISABLE_TELEMETRY="1")
        import nltk
        import numpy as np
        import torch
        import whisperx
        import torchaudio
        from whisperx.alignment import DEFAULT_ALIGN_MODELS_HF, DEFAULT_ALIGN_MODELS_TORCH
        self.args, self.np, self.whisperx = args, np, whisperx
        self.torch_models, self.hf_models = DEFAULT_ALIGN_MODELS_TORCH, DEFAULT_ALIGN_MODELS_HF
        self.cache = Path(args.cache).resolve()
        nltk.data.path.insert(0, str(self.cache / "nltk"))
        nltk.download = deny_download
        torch.hub.download_url_to_file = deny_download
        # torchaudio's imported download alias also needs to be blocked.
        import torchaudio._internal
        torchaudio._internal.download_url_to_file = deny_download
        self.aligners = {}
        # The pinned wheel's trusted legacy VAD checkpoint includes configuration
        # classes. Keep PyTorch's weights-only loading, with an explicit allow-list.
        from collections import defaultdict
        from typing import Any
        from omegaconf import ListConfig
        from omegaconf.base import ContainerMetadata, Metadata
        from omegaconf.nodes import AnyNode
        from pyannote.audio.core.model import Introspection
        from pyannote.audio.core.task import Problem, Resolution, Specifications
        from torch.torch_version import TorchVersion
        with torch.serialization.safe_globals([defaultdict, ListConfig, ContainerMetadata,
                                               Metadata, AnyNode, Introspection, Problem,
                                               Resolution, Specifications, TorchVersion,
                                               Any, list, dict, int]):
            self.model = whisperx.load_model(args.model, args.device, compute_type=args.compute,
                                            download_root=str(self.cache / "huggingface"), local_files_only=True)
        logging.info("ASR loaded: model=%s device=%s compute=%s", args.model, args.device, args.compute)

    def aligner(self, language):
        if language in self.aligners:
            return self.aligners[language]
        if language not in self.torch_models and language not in self.hf_models:
            raise ServiceError("INVALID_INPUT", f"No default alignment model for language {language}")
        directory = self.cache / ("torch" if language in self.torch_models else "huggingface")
        if language in self.torch_models:
            import torchaudio
            bundle = getattr(torchaudio.pipelines, self.torch_models[language])
            checkpoint = directory / Path(bundle._path).name
            if not checkpoint.is_file():
                raise ServiceError("RESOURCE_NOT_PREPARED", f"Alignment resources for {language} are not cached; run dsivio-video setup asr", 503)
        try:
            value = self.whisperx.load_align_model(language, self.args.device, model_dir=str(directory), model_cache_only=True)
        except (ValueError, OSError, LookupError) as error:
            raise ServiceError("RESOURCE_NOT_PREPARED", f"Alignment resources for {language} are not cached; run dsivio-video setup asr", 503) from error
        self.aligners[language] = value
        logging.info("Alignment model loaded: language=%s", language)
        return value

    def transcribe(self, pcm, language):
        if self.args.model.endswith(".en") and language not in (None, "en"):
            raise ServiceError("INVALID_INPUT", "English-only ASR model cannot transcribe this language")
        if language is not None:
            self.aligner(language)
        audio = self.np.frombuffer(pcm, dtype="<i2").astype(self.np.float32) / 32768.0
        started = time.monotonic()
        result = self.model.transcribe(audio, batch_size=self.args.batch_size, language=language)
        language = result["language"]
        if not result["segments"]:
            return {"language": language, "segments": []}
        model, metadata = self.aligner(language)
        aligned = self.whisperx.align(result["segments"], model, metadata, audio, self.args.device, return_char_alignments=False)
        segments = []
        for segment in aligned["segments"]:
            words = []
            for word in segment.get("words", []):
                words.append({"text": word.get("word", ""), **{key: word[key] for key in ("start", "end", "score") if key in word}})
            segments.append({"text": segment["text"], "words": words, **{key: segment[key] for key in ("start", "end") if key in segment}})
        logging.info("Transcription and alignment complete: language=%s seconds=%.3f", language, time.monotonic() - started)
        return {"language": language, "segments": segments}


def read_audio(path, roots):
    if not isinstance(path, str) or not Path(path).is_absolute():
        raise ServiceError("INVALID_AUDIO_PATH", "audio_path must be an absolute path")
    try:
        resolved = Path(path).resolve(strict=True)
        if not any(resolved.is_relative_to(root) for root in roots) or not resolved.is_file():
            raise ServiceError("INVALID_AUDIO_PATH", "Audio must be a regular file inside an allowed root")
    except (OSError, RuntimeError) as error:
        raise ServiceError("INVALID_AUDIO_PATH", f"Cannot resolve audio_path: {error}") from error
    try:
        if resolved.stat().st_size > MAX_AUDIO:
            raise ServiceError("INVALID_INPUT", "Audio exceeds the 512 MiB limit")
        with wave.open(str(resolved), "rb") as wav:
            if (wav.getframerate(), wav.getnchannels(), wav.getsampwidth(), wav.getcomptype()) != (16000, 1, 2, "NONE"):
                raise ServiceError("INVALID_INPUT", "Audio must be 16 kHz mono 16-bit PCM WAV")
            count = wav.getnframes()
            pcm = wav.readframes(count)
            if count <= 0 or len(pcm) != count * 2 or wav._data_chunk.chunksize != count * 2:
                raise ServiceError("INVALID_INPUT", "WAV has empty or truncated PCM data")
            return pcm
    except (OSError, wave.Error, EOFError) as error:
        raise ServiceError("INVALID_INPUT", f"Cannot read WAV: {error}") from error


class Handler(BaseHTTPRequestHandler):
    def reply(self, status, value):
        body = json.dumps(value, ensure_ascii=False, allow_nan=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path != "/health":
            self.reply(404, {"error": {"code": "NOT_FOUND", "message": "Unknown endpoint"}})
            return
        args = self.server.engine.args
        self.reply(200, {"ok": True, "protocol": PROTOCOL, "serviceVersion": SERVICE_VERSION,
                         "whisperxVersion": importlib.metadata.version("whisperx"), "model": args.model,
                         "device": args.device, "compute": args.compute, "batchSize": args.batch_size})

    def do_POST(self):
        if self.path != "/transcribe":
            self.reply(404, {"error": {"code": "NOT_FOUND", "message": "Unknown endpoint"}})
            return
        acquired = False
        try:
            if self.headers.get_content_type() != "application/json":
                raise ServiceError("UNSUPPORTED_MEDIA_TYPE", "Expected application/json", 415)
            lengths = self.headers.get_all("Content-Length")
            if not lengths:
                raise ServiceError("LENGTH_REQUIRED", "Content-Length is required", 411)
            if len(lengths) != 1 or not re.fullmatch(r"[0-9]+", lengths[0]) or self.headers.get("Transfer-Encoding"):
                raise ServiceError("INVALID_LENGTH", "Invalid Content-Length")
            length = int(lengths[0])
            if length > MAX_REQUEST:
                raise ServiceError("REQUEST_TOO_LARGE", "Request exceeds 64 KiB", 413)
            self.connection.settimeout(10)
            try:
                body = self.rfile.read(length)
            except socket.timeout as error:
                raise ServiceError("TRUNCATED_REQUEST", "Request body is incomplete") from error
            if len(body) != length:
                raise ServiceError("TRUNCATED_REQUEST", "Request body is incomplete")
            try:
                request = json.loads(body, parse_constant=lambda value: (_ for _ in ()).throw(ValueError(value)))
            except (ValueError, UnicodeError) as error:
                raise ServiceError("INVALID_JSON", "Request is not valid JSON") from error
            if not isinstance(request, dict) or "audio_path" not in request:
                raise ServiceError("INVALID_REQUEST", "Request must contain audio_path")
            if set(request) - {"audio_path", "language"}:
                raise ServiceError("UNKNOWN_FIELD", "Only audio_path and language are accepted")
            language = request.get("language")
            if language is not None and (not isinstance(language, str) or not re.fullmatch(r"[a-z]{2,3}", language) or language in ("auto", "und")):
                raise ServiceError("INVALID_INPUT", "language must be a lowercase two- or three-letter code")
            acquired = self.server.inference_lock.acquire(blocking=False)
            if not acquired:
                raise ServiceError("BUSY", "An inference is already running", 503)
            pcm = read_audio(request["audio_path"], self.server.roots)
            self.reply(200, self.server.engine.transcribe(pcm, language))
        except ServiceError as error:
            self.reply(error.status, {"error": {"code": error.code, "message": str(error)}})
        except LookupError:
            logging.exception("Missing cached inference resource")
            self.reply(503, {"error": {"code": "RESOURCE_NOT_PREPARED", "message": "Resource is not cached; run dsivio-video setup asr"}})
        except Exception:
            logging.exception("Inference failed")
            self.reply(500, {"error": {"code": "INFERENCE_FAILED", "message": "Inference failed; see the ASR service log"}})
        finally:
            if acquired:
                self.server.last_activity = time.monotonic()
                self.server.inference_lock.release()

    def log_message(self, format, *args):
        logging.info(format, *args)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=0)
    parser.add_argument("--model", default="small")
    parser.add_argument("--device", default="cpu")
    parser.add_argument("--compute", default="int8")
    parser.add_argument("--batch-size", type=int, default=8)
    parser.add_argument("--cache", required=True)
    parser.add_argument("--allow-root", action="append", default=[])
    parser.add_argument("--idle-seconds", type=float, default=300)
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    engine = Engine(args)
    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    server.daemon_threads = True
    server.engine = engine
    server.roots = [Path(root).resolve() for root in args.allow_root or [tempfile.gettempdir()]]
    server.inference_lock = threading.Lock()
    server.last_activity = time.monotonic()
    server.timeout = 1
    logging.info("Listening on 127.0.0.1:%s", server.server_port)
    try:
        while server.inference_lock.locked() or time.monotonic() - server.last_activity < args.idle_seconds:
            server.handle_request()
    finally:
        server.server_close()
        logging.info("Idle shutdown")


if __name__ == "__main__":
    main()
