"""
Local text-to-speech with Piper (piper-tts, GPL-3.0, downloaded on demand by uv; not bundled).
CPU only. Used by `mvs voice` for languages Kokoro does not speak, German by default.

Input:  --script JSON [{"text": "...", "pause": 0.3}, ...]  (one entry per sentence)
Output: --out WAV (mono 16-bit, the voice's sample rate) and --report JSON:
        {"sentences": [{"start": s, "end": s, "words": [[start, end], ...]}], "duration": s, ...}
        `words` are the spoken words of each sentence in seconds of the output file, taken from
        the model's phoneme durations (exact, no alignment model needed).

Voices: --voice de_DE-thorsten-high (default for German) or any id from rhasspy/piper-voices.
Curated voices (piper-voices.json) are checksum-verified; others are fetched from the same
pinned revision without a checksum.

Run by the CLI as:
  uv run --no-project --with "piper-tts[alignment]==1.8.0" python tools/python/tts_piper.py ...
"""

import argparse
import json
import os
import re
import sys
import wave

import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
from common import download, log, write_json  # noqa: E402

CATALOG = os.path.join(os.path.dirname(__file__), "piper-voices.json")
VOICE_ID = re.compile(r"^([a-z]{2,3})_([A-Z]{2})-([A-Za-z0-9_]+)-(x_low|low|medium|high)$")
# phonemes that end a word without being part of it
BREAKS = set(" ,.;:!?¡¿—…\"«»()")
SPECIAL = {"^", "$", "_"}


def voice_files(voice_id: str, models: str, catalog: dict) -> tuple[str, str]:
    """Download the .onnx model and .onnx.json config of a voice (cached)."""
    base = f"https://huggingface.co/{catalog['repo']}/resolve/{catalog['revision']}"
    entry = catalog["voices"].get(voice_id)
    if entry:
        path, onnx_sha, cfg_sha = entry["path"], entry["onnx"]["sha256"], entry["config"]["sha256"]
    else:
        m = VOICE_ID.match(voice_id)
        if not m:
            raise SystemExit(f'"{voice_id}" is not a Piper voice id (expected e.g. de_DE-thorsten-high)')
        lang, region, name, quality = m.groups()
        path = f"{lang}/{lang}_{region}/{name}/{quality}"
        onnx_sha = cfg_sha = None
        log(f"{voice_id} is not in the curated list: downloading from the pinned revision without a checksum.")
        log("Check its license: https://huggingface.co/rhasspy/piper-voices/blob/main/" + path + "/MODEL_CARD")
    dest = os.path.join(models, voice_id)
    onnx = download(f"{base}/{path}/{voice_id}.onnx", os.path.join(dest, f"{voice_id}.onnx"), onnx_sha)
    cfg = download(f"{base}/{path}/{voice_id}.onnx.json", os.path.join(dest, f"{voice_id}.onnx.json"), cfg_sha)
    return onnx, cfg


def speaker_id(speaker: str | None, config: dict) -> int | None:
    if speaker in (None, ""):
        return None
    ids = config.get("speaker_id_map") or {}
    if speaker in ids:
        return int(ids[speaker])
    if str(speaker).isdigit() and int(speaker) < int(config.get("num_speakers", 1)):
        return int(speaker)
    names = ", ".join(list(ids.keys())[:12]) or "none (single-speaker voice)"
    raise SystemExit(f'unknown speaker "{speaker}"; available: {names}')


def load_voice(onnx_path: str, config: dict, seed: int):
    """
    Load a voice patched in memory to (1) report phoneme durations (word timings) and
    (2) draw its sampling noise from a fixed seed, so the same script gives the same read.
    Raises ImportError when the `onnx` package is missing.
    """
    import onnx
    import onnxruntime
    from pathlib import Path
    from piper import PiperConfig, PiperVoice
    from piper.patch_voice_with_alignment import add_alignment_output
    from piper.voice import ESPEAK_DATA_DIR

    model = onnx.load(onnx_path)
    try:
        add_alignment_output(model)
    except ValueError:
        pass  # already patched
    k = 0
    for node in model.graph.node:
        if node.op_type in ("RandomNormalLike", "RandomNormal", "RandomUniformLike", "RandomUniform"):
            for attr in [a for a in node.attribute if a.name == "seed"]:
                node.attribute.remove(attr)
            node.attribute.append(onnx.helper.make_attribute("seed", float(seed * 1000 + k)))
            k += 1
    session = onnxruntime.InferenceSession(model.SerializeToString(), sess_options=onnxruntime.SessionOptions(), providers=["CPUExecutionProvider"])
    return PiperVoice(session=session, config=PiperConfig.from_dict(config), espeak_data_dir=Path(ESPEAK_DATA_DIR), download_dir=Path.cwd())


def word_spans(chunks) -> tuple[np.ndarray, list[list[int]]]:
    """Concatenate the chunks of one sentence; return audio and [start, end) sample spans per word."""
    audio = []
    spans: list[list[int]] = []
    offset = 0
    for c in chunks:
        a = np.asarray(c.audio_float_array, dtype=np.float32)
        if c.phoneme_alignments:
            cursor = offset
            cur: list[int] | None = None
            for al in c.phoneme_alignments:
                n = int(al.num_samples)
                ph = al.phoneme
                if ph in SPECIAL or ph in BREAKS:
                    if cur:
                        spans.append(cur)
                        cur = None
                elif cur is None:
                    cur = [cursor, cursor + n]
                else:
                    cur[1] = cursor + n
                cursor += n
            if cur:
                spans.append(cur)
        audio.append(a)
        offset += len(a)
    return (np.concatenate(audio) if audio else np.zeros(0, dtype=np.float32)), spans


def trim_range(samples: np.ndarray, sr: int, threshold: float = 0.004) -> tuple[int, int]:
    """Range without leading/trailing silence, so pauses are controlled by the script."""
    idx = np.where(np.abs(samples) > threshold)[0]
    if len(idx) == 0:
        return 0, 0
    pad = int(0.02 * sr)
    return max(0, int(idx[0]) - pad), min(len(samples), int(idx[-1]) + pad)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--script")
    ap.add_argument("--out")
    ap.add_argument("--report")
    ap.add_argument("--models", required=True)
    ap.add_argument("--voice", default="de_DE-thorsten-high")
    ap.add_argument("--speaker", default=None)
    ap.add_argument("--speed", type=float, default=1.0)
    ap.add_argument("--seed", type=int, default=1, help="sampling seed: same seed, same read; change it for another take")
    ap.add_argument("--lead", type=float, default=0.15, help="silence before the first sentence (s)")
    ap.add_argument("--tail", type=float, default=0.4, help="silence after the last sentence (s)")
    ap.add_argument("--speakers", action="store_true", help="print the speakers of --voice and exit")
    args = ap.parse_args()

    from piper import PiperVoice, SynthesisConfig

    with open(CATALOG, encoding="utf-8") as f:
        catalog = json.load(f)
    onnx, cfg_path = voice_files(args.voice, args.models, catalog)
    with open(cfg_path, encoding="utf-8") as f:
        config = json.load(f)
    if args.speakers:
        print("\n".join(config.get("speaker_id_map") or {}) or "(single speaker)")
        return

    try:
        voice = load_voice(onnx, config, args.seed)
        aligned = True
    except ImportError as e:  # alignments and seeding need the `onnx` package; audio still works without
        log(f"word timings unavailable ({e}); synthesizing without them")
        voice = PiperVoice.load(onnx, config_path=cfg_path)
        aligned = False
    inference = config.get("inference") or {}
    syn = SynthesisConfig(
        speaker_id=speaker_id(args.speaker, config),
        length_scale=float(inference.get("length_scale", 1.0)) / max(0.25, args.speed),
        normalize_audio=False,  # one gain for the whole read, set below
    )
    sr = int(config["audio"]["sample_rate"])

    with open(args.script, encoding="utf-8") as f:
        sentences = json.load(f)
    chunks = [np.zeros(int(args.lead * sr), dtype=np.float32)]
    t = args.lead
    report = []
    for i, s in enumerate(sentences):
        log(f"[{i + 1}/{len(sentences)}] {s['text'][:70]}")
        audio, spans = word_spans(voice.synthesize(s["text"], syn, include_alignments=aligned))
        a, b = trim_range(audio, sr)
        start = t
        words = []
        for ws, we in spans:
            ws, we = max(ws, a), min(we, b)
            if we > ws:
                words.append([round(start + (ws - a) / sr, 3), round(start + (we - a) / sr, 3)])
        chunks.append(audio[a:b])
        t += (b - a) / sr
        report.append({"start": round(start, 3), "end": round(t, 3), "words": words})
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
    write_json(
        args.report,
        {
            "engine": "piper",
            "voice": args.voice,
            "speaker": args.speaker,
            "speed": args.speed,
            "seed": args.seed,
            "sampleRate": sr,
            "duration": round(len(audio) / sr, 3),
            "sentences": report,
        },
    )
    log(f"wrote {args.out} ({len(audio) / sr:.1f}s)")


if __name__ == "__main__":
    main()
