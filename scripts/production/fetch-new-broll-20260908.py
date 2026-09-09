"""Fetch fresh transcript-matching B-roll from Pexels into the reusable local library.

Bounded: 8 plan-linked queries x up to 2 new clips each (max 16 files).
Skips provider IDs already present in the manifest. Updates the manifest
atomically (tmp + rename) and writes a per-run additions log.
"""
import json
import os
import subprocess
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

LIB_ROOT = Path(r"D:\Mental Empire Studio\broll-library")
MANIFEST = LIB_ROOT / "niche-niche-82fcc549.json"
RUN_ROOT = Path(r"D:\MentalEmpire-Production\2026-09-08")
FFPROBE = Path(r"d:\Work\mental-empire-studio\resources\bin\ffprobe.exe")

# (pexels query, existing manifest keyword row to extend)
QUERIES = [
    ("woman sitting alone by window", "woman sitting alone in bedroom"),
    ("man sitting alone in dark room", "man sitting alone in darkness"),
    ("person walking alone night street", "person walking alone at night"),
    ("rain on window close up", "rainy window emotional scene"),
    ("candle flame in darkness", "candlelight mystery footage"),
    ("dark city street at night", "dark city street at night"),
    ("smoke on black background", "smoke in dark room cinematic"),
    ("person looking through window blinds", "person looking through blinds"),
]

PER_QUERY = 5  # search depth; keep first 2 not already in library
WANT_PER_QUERY = 2


def pexels_get(path, params):
    key = os.environ.get("PEXELS_API_KEY", "")
    if not key:
        raise RuntimeError("PEXELS_API_KEY is unavailable")
    url = f"https://api.pexels.com{path}?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(
        url, headers={"Authorization": key,
                      "User-Agent": "MentalEmpireStudio/1.0"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.load(resp)


def slug(keyword):
    return keyword.lower().replace("-", " ").replace("/", " ").replace(
        "  ", " ").strip().replace(" ", "_")


def probe(path):
    r = subprocess.run(
        [str(FFPROBE), "-v", "error", "-show_entries",
         "format=duration:stream=width,height",
         "-of", "json", str(path)],
        capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(f"ffprobe failed for {path}: {r.stderr[:200]}")
    doc = json.loads(r.stdout)
    streams = [s for s in doc.get("streams", [])
               if s.get("width") and s.get("height")]
    if not streams:
        raise RuntimeError(f"no video stream in {path}")
    return (float(doc["format"]["duration"]),
            int(streams[0]["width"]), int(streams[0]["height"]))


def pick_file(video):
    files = [f for f in video.get("video_files", [])
             if f.get("file_type") == "video/mp4" and f.get("link")]
    if not files:
        return None
    files.sort(key=lambda f: abs((f.get("width") or 0) - 1920))
    return files[0]


def main():
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    known_ids = {str(c.get("id"))
                 for row in manifest.get("keywords", [])
                 for c in row.get("clips", [])}
    rows = {row["keyword"]: row for row in manifest.get("keywords", [])}
    added = []
    for query, keyword in QUERIES:
        row = rows.get(keyword)
        if row is None:
            print(f"[skip] no manifest row for keyword: {keyword}")
            continue
        try:
            result = pexels_get("/videos/search",
                                {"query": query, "per_page": PER_QUERY})
        except Exception as exc:
            print(f"[{keyword}] search failed: {exc}")
            continue
        kept = 0
        for video in result.get("videos", []):
            if kept >= WANT_PER_QUERY:
                break
            vid = str(video.get("id"))
            if vid in known_ids:
                continue
            choice = pick_file(video)
            if choice is None:
                continue
            folder = LIB_ROOT / "niche-niche-82fcc549" / slug(keyword)
            folder.mkdir(parents=True, exist_ok=True)
            dest = folder / f"pexels-{vid}.mp4"
            if not dest.exists():
                r = subprocess.run(
                    ["curl.exe", "-sS", "-L", "--fail", "--retry", "2",
                     "--max-time", "300",
                     "-A", "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
                     "-o", str(dest), choice["link"]],
                    capture_output=True, text=True)
                if r.returncode != 0 or not dest.exists():
                    print(f"[{keyword}] download {vid} failed: "
                          f"{(r.stderr or '').strip()[-160:]}")
                    dest.unlink(missing_ok=True)
                    continue
            try:
                duration, width, height = probe(dest)
            except Exception as exc:
                print(f"[{keyword}] probe {vid} failed: {exc}")
                dest.unlink(missing_ok=True)
                continue
            entry = {
                "provider": "pexels",
                "id": vid,
                "path": str(dest),
                "durationSec": round(duration, 3),
                "width": width,
                "height": height,
                "tags": query.split() + [keyword],
                "addedAt": datetime.now(timezone.utc).isoformat(),
                "pageUrl": video.get("url"),
                "creator": (video.get("user") or {}).get("name"),
            }
            row.setdefault("clips", []).append(entry)
            known_ids.add(vid)
            added.append({"keyword": keyword, "query": query, **entry})
            kept += 1
            print(f"[{keyword}] + pexels-{vid} "
                  f"({duration:.1f}s {width}x{height})")
        if kept == 0:
            print(f"[{keyword}] no new clips (all known or search empty)")
    manifest["updatedAt"] = datetime.now(timezone.utc).isoformat()
    tmp = MANIFEST.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    os.replace(tmp, MANIFEST)
    log_path = RUN_ROOT / "MindCipher" / "intermediate" / "library-additions.json"
    log_path.write_text(json.dumps(
        {"generatedAt": datetime.now(timezone.utc).isoformat(),
         "added": added}, indent=2), encoding="utf-8")
    print(f"Added {len(added)} clips; manifest updated; log: {log_path}")


if __name__ == "__main__":
    sys.exit(main())
