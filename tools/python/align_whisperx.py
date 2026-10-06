"""
Transcription + word alignment with WhisperX (optional, heavier, multilingual).
Use it when the voiceover is not English, or when there is no script yet.

Output JSON: {"words": [{"word": str, "start": s|null, "end": s|null, "score": float|null}], "language": str}
The CLI maps these ASR words onto the script words (sequence alignment).

Run by `mvs align --engine whisperx` roughly as:
  uv run --no-project --python 3.12 --with whisperx python tools/python/align_whisperx.py --audio vo.wav --out words.json
GPU is used automatically when CUDA is available, otherwise CPU (int8).
"""

import argparse
import json
import os
import sys
import zipfile

sys.path.insert(0, os.path.dirname(__file__))
from common import download, log  # noqa: E402

PUNKT_URL = "https://raw.githubusercontent.com/nltk/nltk_data/gh-pages/packages/tokenizers/punkt_tab.zip"
PUNKT_SHA = "e57f64187974277726a3417ca6f181ec5403676c717672eef6a748a7b20e0106"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--audio", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--language", default=None)
    ap.add_argument("--model", default="small")
    ap.add_argument("--batch", type=int, default=8)
    ap.add_argument("--models", default=os.path.join(os.path.dirname(__file__), "..", "..", ".cache", "models"))
    args = ap.parse_args()

    import nltk
    import torch
    import whisperx

    # whisperx splits sentences with NLTK's punkt tokenizer. Fetch it ourselves from a
    # pinned URL with a checksum (works behind proxies, keeps NLTK's SSRF guard intact).
    nltk_dir = os.path.join(args.models, "nltk_data")
    if not os.path.isdir(os.path.join(nltk_dir, "tokenizers", "punkt_tab")):
        z = download(PUNKT_URL, os.path.join(nltk_dir, "punkt_tab.zip"), PUNKT_SHA)
        with zipfile.ZipFile(z) as zf:
            zf.extractall(os.path.join(nltk_dir, "tokenizers"))
    nltk.data.path.insert(0, nltk_dir)

    device = "cuda" if torch.cuda.is_available() else "cpu"
    compute = "float16" if device == "cuda" else "int8"
    log(f"whisperx on {device} ({compute}), model {args.model}")
    audio = whisperx.load_audio(args.audio)
    model = whisperx.load_model(args.model, device, compute_type=compute, language=args.language)
    result = model.transcribe(audio, batch_size=args.batch, language=args.language)
    language = result.get("language", args.language or "en")
    align_model, meta = whisperx.load_align_model(language_code=language, device=device)
    aligned = whisperx.align(result["segments"], align_model, meta, audio, device, return_char_alignments=False)
    words = []
    for seg in aligned["segments"]:
        for w in seg.get("words", []):
            words.append({"word": w.get("word", ""), "start": w.get("start"), "end": w.get("end"), "score": w.get("score")})
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump({"words": words, "language": language}, f)
    log(f"{len(words)} words")


if __name__ == "__main__":
    main()
