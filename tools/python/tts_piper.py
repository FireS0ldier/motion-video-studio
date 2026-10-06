"""
Local text-to-speech with Piper (piper-tts, GPL-3.0, downloaded on demand by uv; not bundled).
CPU only. Used by `mvs voice` for languages Kokoro does not speak, German by default.

Input:  --script JSON [{"text": "...", "pause": 0.3, "words": ["...", ...]}, ...]
        one entry per sentence; `words` = what the TTS says for each script word
Output: --out WAV (mono 16-bit, the voice's sample rate) and --report JSON:
        {"sentences": [{"start", "end", "words": [[s, e], ...], "scriptWords": [[s, e] | null, ...],
        "match": 0..1}], "duration", ...}. Times are seconds of the output file, from the model's
        phoneme durations: `words` per spoken (espeak) word, `scriptWords` per script word, found by
        aligning each script word's phonemes with the spoken ones (exact, no alignment model needed).

Voices: --voice de_DE-thorsten-high (default for German) or any id from rhasspy/piper-voices.
Curated voices (piper-voices.json) are checksum-verified; others are fetched from the same
pinned revision without a checksum.

Run by the CLI as:
  uv run --no-project --with "piper-tts[alignment]==1.8.0" python tools/python/tts_piper.py ...
"""

import argparse
import difflib
import json
import os
import re
import sys
import unicodedata
import wave

import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
from common import download, log, write_json  # noqa: E402

CATALOG = os.path.join(os.path.dirname(__file__), "piper-voices.json")
VOICE_ID = re.compile(r"^([a-z]{2,3})_([A-Z]{2})-([A-Za-z0-9_]+)-(x_low|low|medium|high)$")
# phonemes that end a word without being part of it
BREAKS = set(" ,.;:!?¡¿—…\"«»()")
SPECIAL = {"^", "$", "_"}
# stress marks: part of a word, but ignored when comparing phoneme sequences
STRESS = {"ˈ", "ˌ"}


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
    """Speaker by name (as listed by --speakers); a number only for voices without speaker names."""
    if speaker in (None, ""):
        return None
    ids = config.get("speaker_id_map") or {}
    if ids:
        if speaker in ids:
            return int(ids[speaker])
        names = ", ".join(list(ids.keys())[:12]) + (", ..." if len(ids) > 12 else "")
        raise SystemExit(f'unknown speaker "{speaker}"; available: {names} (mvs voice --list --voice <id> lists all)')
    if str(speaker).isdigit() and int(speaker) < int(config.get("num_speakers", 1)):
        return int(speaker)
    raise SystemExit(f'unknown speaker "{speaker}": this voice has a single speaker')


def fix_phonemizer(voice) -> None:
    """
    Some voices only know precomposed phonemes (kerstin: 'ç' but not 'c' + U+0327). Piper
    splits espeak's output into code points, so the combining mark would be dropped (wrong
    sound, lost alignment). Recompose such pairs when the voice knows the composed form.
    """
    idmap = voice.config.phoneme_id_map
    original = voice.phonemize

    def phonemize(text):
        out = []
        for sentence in original(text):
            fixed: list[str] = []
            for p in sentence:
                if fixed and unicodedata.combining(p) and p not in idmap:
                    composed = unicodedata.normalize("NFC", fixed[-1] + p)
                    if len(composed) == 1 and composed in idmap:
                        fixed[-1] = composed
                        continue
                fixed.append(p)
            out.append(fixed)
        return out

    voice.phonemize = phonemize


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


def sentence_phonemes(chunks) -> tuple[np.ndarray, list[tuple[str, int, int]], bool]:
    """Concatenate the chunks of one sentence; return audio, (phoneme, start, end) in samples, and
    whether every chunk came with alignments."""
    audio = []
    phones: list[tuple[str, int, int]] = []
    offset = 0
    complete = True
    for c in chunks:
        a = np.asarray(c.audio_float_array, dtype=np.float32)
        if c.phoneme_alignments:
            cursor = offset
            for al in c.phoneme_alignments:
                n = int(al.num_samples)
                phones.append((al.phoneme, cursor, cursor + n))
                cursor += n
        else:
            complete = False
        audio.append(a)
        offset += len(a)
    return (np.concatenate(audio) if audio else np.zeros(0, dtype=np.float32)), phones, complete


def espeak_words(phones) -> list[list[int]]:
    """[start, end) sample spans of the words the TTS spoke (runs of phonemes between breaks)."""
    spans: list[list[int]] = []
    cur: list[int] | None = None
    for ph, a, b in phones:
        if ph in SPECIAL or ph in BREAKS:
            if cur:
                spans.append(cur)
                cur = None
        elif cur is None:
            cur = [a, b]
        else:
            cur[1] = b
    if cur:
        spans.append(cur)
    return spans


def script_word_spans(voice, pieces: list[str], phones) -> tuple[list[list[int] | None] | None, float]:
    """
    Sample spans per script word. Each word is phonemized on its own and the resulting phoneme
    sequence is aligned with the phonemes actually spoken, so it does not matter when espeak
    merges words ("es ist" -> one word) or splits them ("iPhone" -> "i phone").
    Returns (spans or None when the match is too weak, match ratio 0..1).
    """
    sounds = [(p, a, b) for p, a, b in phones if p not in SPECIAL and p not in BREAKS and p not in STRESS]
    ref: list[tuple[str, int]] = []
    for wi, piece in enumerate(pieces):
        for sentence in voice.phonemize(piece) if piece.strip() else []:
            ref.extend((p, wi) for p in sentence if p not in SPECIAL and p not in BREAKS and p not in STRESS)
    if not sounds or not ref:
        return None, 0.0
    sm = difflib.SequenceMatcher(None, [r[0] for r in ref], [c[0] for c in sounds], autojunk=False)
    owner: list[int | None] = [None] * len(sounds)
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag == "equal" or tag == "replace":
            for k in range(j1, j2):
                owner[k] = ref[i1 + (k - j1) * (i2 - i1) // (j2 - j1)][1]
    # spoken phonemes the reference does not have belong to a neighbouring word
    last = None
    for k in range(len(owner)):
        if owner[k] is None:
            owner[k] = last
        last = owner[k]
    nxt = None
    for k in range(len(owner) - 1, -1, -1):
        if owner[k] is None:
            owner[k] = nxt
        nxt = owner[k]
    spans: list[list[int] | None] = [None] * len(pieces)
    for (_, a, b), w in zip(sounds, owner):
        if w is None:
            continue
        cur = spans[w]
        spans[w] = [a, b] if cur is None else [min(cur[0], a), max(cur[1], b)]
    ratio = sm.ratio()
    ordered = [x for x in spans if x]
    if ratio < 0.75 or any(ordered[i][0] < ordered[i - 1][0] for i in range(1, len(ordered))):
        return None, ratio
    return spans, ratio


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
    fix_phonemizer(voice)
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
        audio, phones, complete = sentence_phonemes(voice.synthesize(s["text"], syn, include_alignments=aligned))
        a, b = trim_range(audio, sr)
        start = t

        def secs(span):
            if not span:
                return None
            ws, we = max(span[0], a), min(span[1], b)
            return [round(start + (ws - a) / sr, 3), round(start + (max(ws, we) - a) / sr, 3)]

        entry: dict = {"start": round(start, 3), "end": round(start + (b - a) / sr, 3)}
        # word timings only when every chunk was aligned: partial timings would be misleading
        if aligned and complete:
            entry["words"] = [w for w in (secs(x) for x in espeak_words(phones)) if w and w[1] > w[0]]
            per_word, ratio = script_word_spans(voice, s.get("words") or [], phones)
            entry["match"] = round(ratio, 3)
            if per_word is not None:
                entry["scriptWords"] = [secs(w) for w in per_word]
        chunks.append(audio[a:b])
        t += (b - a) / sr
        report.append(entry)
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
            "version": 2,
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
