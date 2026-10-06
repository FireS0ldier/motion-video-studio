"""
Forced alignment of a known script against a voiceover with a CTC acoustic
model (wav2vec2-base-960h, quantized ONNX, ~95 MB, English). CPU only.

Input:  --audio  raw float32 mono 16 kHz PCM (written by the CLI with ffmpeg)
        --tokens JSON {"words": [["MEET"], ["FORTY", "PERCENT"], ...]}  (spoken tokens per script word)
Output: --out    JSON {"words": [{"start": s, "end": s, "conf": 0..1} | null, ...], "duration": s}

Run by `mvs align` as:
  uv run --no-project --with onnxruntime --with numpy python tools/python/align_ctc.py ...
"""

import argparse
import json
import os
import sys

import numpy as np
import onnxruntime as ort

sys.path.insert(0, os.path.dirname(__file__))
from common import download, log, write_json  # noqa: E402

REPO = "https://huggingface.co/Xenova/wav2vec2-base-960h/resolve/a19f851b3d42865797e410752b4c570c871e4825"
MODEL_SHA = "cd5040c147381580ed73258143dd8e0c28e800a09e74ee42ee2b3e8cb4d760a3"
SR = 16000
STRIDE = 320  # samples per output frame (20 ms)


def load_model(models_dir: str):
    model = download(f"{REPO}/onnx/model_quantized.onnx", os.path.join(models_dir, "model_quantized.onnx"), MODEL_SHA)
    vocab_path = download(f"{REPO}/vocab.json", os.path.join(models_dir, "vocab.json"))
    with open(vocab_path, encoding="utf-8") as f:
        vocab = json.load(f)
    opts = ort.SessionOptions()
    opts.intra_op_num_threads = max(1, (os.cpu_count() or 2))
    sess = ort.InferenceSession(model, sess_options=opts, providers=["CPUExecutionProvider"])
    return sess, vocab


def emissions(sess, audio: np.ndarray) -> np.ndarray:
    """Log-probabilities [T, V] computed in overlapping windows (bounded memory)."""
    x = (audio - audio.mean()) / np.sqrt(audio.var() + 1e-7)
    win = 20 * SR
    ctx = int(1.5 * SR)
    name = sess.get_inputs()[0].name
    parts = []
    total_frames = len(x) // STRIDE
    start = 0
    while start < len(x):
        a = max(0, start - ctx)
        b = min(len(x), start + win + ctx)
        logits = sess.run(None, {name: x[a:b][None, :].astype(np.float32)})[0][0]
        f0 = (start - a) // STRIDE
        f1 = f0 + min(win, len(x) - start) // STRIDE
        parts.append(logits[f0:f1])
        start += win
    lg = np.concatenate(parts, axis=0)[: max(1, total_frames)]
    m = lg.max(axis=1, keepdims=True)
    return lg - m - np.log(np.exp(lg - m).sum(axis=1, keepdims=True))


def align(lp: np.ndarray, tokens: list[int], blank: int = 0):
    """Viterbi CTC forced alignment. Returns the frame index each token is emitted at (first/last)."""
    T, N = lp.shape[0], len(tokens)
    if N == 0:
        return []
    if N > T:
        raise SystemExit(f"audio too short for the script ({T} frames for {N} characters)")
    trellis = np.full((T + 1, N + 1), -np.inf, dtype=np.float64)
    trellis[0, 0] = 0.0
    trellis[1:, 0] = np.cumsum(lp[:, blank])
    tok = np.asarray(tokens)
    for t in range(T):
        stay = trellis[t, 1:] + lp[t, blank]
        change = trellis[t, :-1] + lp[t, tok]
        trellis[t + 1, 1:] = np.maximum(stay, change)
    # backtrack: a "change" step means token j-1 was emitted at frame t-1
    t, j = T, N
    first = [None] * N
    last = [None] * N
    score = [0.0] * N
    while j > 0 and t > 0:
        stay = trellis[t - 1, j] + lp[t - 1, blank]
        change = trellis[t - 1, j - 1] + lp[t - 1, tokens[j - 1]]
        if change > stay:
            first[j - 1] = t - 1
            last[j - 1] = t - 1
            score[j - 1] = float(np.exp(lp[t - 1, tokens[j - 1]]))
            j -= 1
        t -= 1
    return list(zip(first, last, score))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--audio", required=True)
    ap.add_argument("--tokens", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--models", required=True)
    args = ap.parse_args()

    audio = np.fromfile(args.audio, dtype=np.float32)
    with open(args.tokens, encoding="utf-8") as f:
        words = json.load(f)["words"]
    sess, vocab = load_model(args.models)
    sep = vocab["|"]
    log(f"computing emissions for {len(audio) / SR:.1f}s of audio")
    lp = emissions(sess, audio)

    # flatten: characters of every spoken token, '|' between spoken tokens
    seq: list[int] = []
    owner: list[int] = []  # script word index per character (-1 for separators)
    for wi, spoken in enumerate(words):
        for tok in spoken:
            chars = [vocab[c] for c in tok.upper() if c in vocab and c != "|"]
            if not chars:
                continue
            if seq:
                seq.append(sep)
                owner.append(-1)
            seq.extend(chars)
            owner.extend([wi] * len(chars))
    log(f"aligning {len(words)} words ({len(seq)} tokens) to {lp.shape[0]} frames")
    path = align(lp, seq)
    spf = STRIDE / SR
    result = [None] * len(words)
    acc: dict[int, list] = {}
    for (f0, f1, sc), wi in zip(path, owner):
        if wi < 0 or f0 is None:
            continue
        a = acc.setdefault(wi, [f0, f1, [], 0])
        a[0] = min(a[0], f0)
        a[1] = max(a[1], f1)
        a[2].append(sc)
    for wi, (f0, f1, scores, _) in acc.items():
        result[wi] = {"start": round(f0 * spf, 3), "end": round((f1 + 1) * spf, 3), "conf": round(float(np.mean(scores)), 3)}
    write_json(args.out, {"words": result, "duration": round(len(audio) / SR, 3)})
    log("done")


if __name__ == "__main__":
    main()
