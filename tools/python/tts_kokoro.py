"""
Local text-to-speech with Kokoro-82M (Apache-2.0) via kokoro-onnx. CPU only.
Used by `mvs voice` to create a voiceover (or a placeholder read) from script.md.

Input:  --script JSON [{"text": "...", "pause": 0.3}, ...]  (one entry per sentence)
Output: --out WAV (24 kHz mono, 16-bit) and --report JSON with the start/end of every sentence.

Run by the CLI as:
  uv run --no-project --with kokoro-onnx python tools/python/tts_kokoro.py ...
Voices: af_heart, af_bella, af_nicole, am_michael, am_fenrir, am_puck, bf_emma, bm_george, ...
(full list printed with --list-voices). Languages: en-us, en-gb, es, fr-fr, it, pt-br, hi, ja, zh.
"""

import argparse
import json
import os
import sys
import wave

import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
from common import download, log, write_json  # noqa: E402

RELEASE = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0"
MODEL_SHA = "6e742170d309016e5891a994e1ce1559c702a2ccd0075e67ef7157974f6406cb"
VOICES_SHA = "bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d"


def trim(samples: np.ndarray, sr: int, threshold: float = 0.004) -> np.ndarray:
    """Cut leading/trailing silence so pauses are controlled by the script, not the model."""
    idx = np.where(np.abs(samples) > threshold)[0]
    if len(idx) == 0:
        return samples[:0]
    pad = int(0.02 * sr)
    return samples[max(0, idx[0] - pad) : min(len(samples), idx[-1] + pad)]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--script")
    ap.add_argument("--out")
    ap.add_argument("--report")
    ap.add_argument("--models", required=True)
    ap.add_argument("--voice", default="am_michael")
    ap.add_argument("--speed", type=float, default=1.0)
    ap.add_argument("--lang", default="en-us")
    ap.add_argument("--lead", type=float, default=0.15, help="silence before the first sentence (s)")
    ap.add_argument("--tail", type=float, default=0.4, help="silence after the last sentence (s)")
    ap.add_argument("--list-voices", action="store_true")
    args = ap.parse_args()

    from kokoro_onnx import Kokoro

    model = download(f"{RELEASE}/kokoro-v1.0.int8.onnx", os.path.join(args.models, "kokoro-v1.0.int8.onnx"), MODEL_SHA)
    voices = download(f"{RELEASE}/voices-v1.0.bin", os.path.join(args.models, "voices-v1.0.bin"), VOICES_SHA)
    k = Kokoro(model, voices)
    if args.list_voices:
        print("\n".join(sorted(k.get_voices())))
        return

    with open(args.script, encoding="utf-8") as f:
        sentences = json.load(f)
    sr = 24000
    chunks = [np.zeros(int(args.lead * sr), dtype=np.float32)]
    t = args.lead
    report = []
    for i, s in enumerate(sentences):
        log(f"[{i + 1}/{len(sentences)}] {s['text'][:70]}")
        samples, sr = k.create(s["text"], voice=args.voice, speed=args.speed, lang=args.lang)
        samples = trim(np.asarray(samples, dtype=np.float32), sr)
        start = t
        chunks.append(samples)
        t += len(samples) / sr
        report.append({"start": round(start, 3), "end": round(t, 3)})
        pause = float(s.get("pause", 0.3))
        if i < len(sentences) - 1 and pause > 0:
            chunks.append(np.zeros(int(pause * sr), dtype=np.float32))
            t += pause
    chunks.append(np.zeros(int(args.tail * sr), dtype=np.float32))
    audio = np.concatenate(chunks)
    peak = float(np.max(np.abs(audio))) or 1.0
    audio = audio / peak * 0.89  # -1 dBFS
    pcm = (np.clip(audio, -1, 1) * 32767).astype("<i2")
    with wave.open(args.out, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(pcm.tobytes())
    write_json(args.report, {"sentences": report, "duration": round(len(audio) / sr, 3), "voice": args.voice, "speed": args.speed})
    log(f"wrote {args.out} ({len(audio) / sr:.1f}s)")


if __name__ == "__main__":
    main()
