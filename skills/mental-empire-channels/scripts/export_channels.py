#!/usr/bin/env python3
"""Export Mental Empire Studio channel mappings without modifying the database."""

import argparse
import json
import os
import shutil
import sqlite3
import subprocess
from datetime import datetime, timezone
from pathlib import Path


def default_db() -> Path:
    appdata = os.environ.get("APPDATA")
    if not appdata:
        raise SystemExit("APPDATA is unset; pass --db explicitly.")
    return Path(appdata) / "mental-empire-studio" / "mental-empire.db"


def default_ytdlp() -> Path | None:
    candidates = []
    repo = os.environ.get("MENTAL_EMPIRE_REPO")
    if repo:
        candidates.append(Path(repo) / "resources" / "bin" / "yt-dlp.exe")
    candidates.extend(
        [
            Path.cwd() / "resources" / "bin" / "yt-dlp.exe",
            Path(__file__).resolve().parents[3] / "resources" / "bin" / "yt-dlp.exe",
        ]
    )
    for candidate in candidates:
        if candidate.exists():
            return candidate
    found = shutil.which("yt-dlp")
    return Path(found) if found else None


def rows(con: sqlite3.Connection, sql: str) -> list[dict]:
    return [dict(row) for row in con.execute(sql)]


def youtube_metadata(ytdlp: Path, url: str) -> dict:
    command = [
        str(ytdlp),
        "--dump-single-json",
        "--flat-playlist",
        "--playlist-end",
        "1",
        "--skip-download",
        "--no-warnings",
        url.rstrip("/") + "/videos",
    ]
    result = subprocess.run(command, check=True, capture_output=True, text=True, encoding="utf-8")
    raw = json.loads(result.stdout)
    return {
        "youtubeChannelId": raw.get("channel_id") or raw.get("id"),
        "name": raw.get("channel") or raw.get("uploader"),
        "handle": raw.get("uploader_id"),
        "canonicalUrl": raw.get("channel_url") or raw.get("uploader_url"),
        "subscriberCount": raw.get("channel_follower_count"),
        "availability": raw.get("availability"),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--db", type=Path, default=default_db())
    parser.add_argument("--ytdlp", type=Path, default=default_ytdlp())
    parser.add_argument("--refresh-youtube", action="store_true")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()

    if not args.db.exists():
        raise SystemExit(f"Database not found: {args.db}")

    con = sqlite3.connect(f"file:{args.db}?mode=ro", uri=True)
    con.row_factory = sqlite3.Row
    try:
        owned = rows(con, "SELECT * FROM my_channels ORDER BY name, handle")
        sources = rows(con, "SELECT * FROM source_channels ORDER BY name, handle")
    finally:
        con.close()

    owned_by_id = {item["id"]: item for item in owned}
    grouped = {item["id"]: [] for item in owned}
    unassigned = []
    conflicts = []

    for source in sources:
        reverse_id = source.get("linkedMyChannelId")
        forward_ids = [
            item["id"] for item in owned if item.get("linkedSourceId") == source["id"]
        ]
        candidates = set(forward_ids)
        if reverse_id:
            candidates.add(reverse_id)
        valid = [item for item in candidates if item in owned_by_id]
        if len(valid) == 1:
            grouped[valid[0]].append(source["id"])
        elif not valid:
            unassigned.append(source["id"])
        else:
            conflicts.append({"sourceId": source["id"], "ownedChannelIds": sorted(valid)})

    if args.refresh_youtube:
        if not args.ytdlp or not args.ytdlp.exists():
            raise SystemExit("yt-dlp not found; pass --ytdlp explicitly.")
        for item in owned:
            if item.get("handle"):
                item["youtube"] = youtube_metadata(
                    args.ytdlp, f"https://www.youtube.com/{item['handle']}"
                )
        for item in sources:
            if item.get("url"):
                item["youtube"] = youtube_metadata(args.ytdlp, item["url"])

    output = {
        "exportedAt": datetime.now(timezone.utc).isoformat(),
        "database": str(args.db),
        "ownedChannels": owned,
        "sourceChannels": sources,
        "groups": [
            {
                "ownedChannelId": owned_id,
                "ownedChannelName": owned_by_id[owned_id].get("name"),
                "sourceIds": source_ids,
            }
            for owned_id, source_ids in grouped.items()
        ],
        "unassignedSourceIds": unassigned,
        "conflicts": conflicts,
    }

    text = json.dumps(output, indent=2, ensure_ascii=False)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(text + "\n", encoding="utf-8")
    else:
        print(text)


if __name__ == "__main__":
    main()
