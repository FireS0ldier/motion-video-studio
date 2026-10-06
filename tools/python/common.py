"""Shared helpers for the optional Python tools (run through `uv run`, never imported by the engine)."""

import hashlib
import json
import os
import sys
import urllib.request


def log(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)


def sha256(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def download(url: str, dest: str, expected_sha256: str | None = None) -> str:
    """Download once into a cache folder, verify the checksum, return the path."""
    if os.path.exists(dest) and (expected_sha256 is None or sha256(dest) == expected_sha256):
        return dest
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    tmp = dest + ".part"
    log(f"downloading {url}")
    with urllib.request.urlopen(url) as r, open(tmp, "wb") as f:  # honours HTTPS_PROXY
        total = int(r.headers.get("content-length") or 0)
        done = 0
        next_report = 0.25
        while True:
            chunk = r.read(1 << 20)
            if not chunk:
                break
            f.write(chunk)
            done += len(chunk)
            if total and done / total >= next_report:
                log(f"  {done / 1e6:.0f}/{total / 1e6:.0f} MB")
                next_report += 0.25
    if expected_sha256 and sha256(tmp) != expected_sha256:
        os.remove(tmp)
        raise SystemExit(f"checksum mismatch for {url}")
    os.replace(tmp, dest)
    return dest


def write_json(path: str, data) -> None:
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f)
