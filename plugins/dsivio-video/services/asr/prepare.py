"""Explicit online preparation; inference never downloads resources."""
import argparse
import json
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", default="small")
    parser.add_argument("--languages", nargs="+", default=["en", "zh"])
    parser.add_argument("--cache", required=True)
    args = parser.parse_args()
    cache = Path(args.cache).resolve()
    cache.mkdir(parents=True, exist_ok=True)
    import nltk
    import whisperx
    from faster_whisper.utils import download_model
    from whisperx.alignment import DEFAULT_ALIGN_MODELS_HF, DEFAULT_ALIGN_MODELS_TORCH

    for language in args.languages:
        if language not in DEFAULT_ALIGN_MODELS_HF and language not in DEFAULT_ALIGN_MODELS_TORCH:
            raise ValueError(f"No default alignment model for language {language}")
        if args.model.endswith(".en") and language != "en":
            raise ValueError("English-only ASR models cannot prepare non-English languages")
    print(f"Preparing ASR model {args.model}", flush=True)
    model_path = download_model(args.model, cache_dir=str(cache / "huggingface"))
    for name in ("model.bin", "config.json", "tokenizer.json"):
        if not (Path(model_path) / name).is_file():
            raise RuntimeError(f"ASR model is missing {name}")
    for language in args.languages:
        print(f"Preparing alignment model for {language}", flush=True)
        model_dir = cache / ("torch" if language in DEFAULT_ALIGN_MODELS_TORCH else "huggingface")
        model_dir.mkdir(parents=True, exist_ok=True)
        model, _ = whisperx.load_align_model(language, "cpu", model_dir=str(model_dir))
        del model
    for resource in ("punkt", "punkt_tab"):
        if not nltk.download(resource, download_dir=str(cache / "nltk"), raise_on_error=True):
            raise RuntimeError(f"Could not prepare NLTK {resource}")
    print(json.dumps({"modelPath": model_path, "languages": args.languages}), flush=True)


if __name__ == "__main__":
    main()
