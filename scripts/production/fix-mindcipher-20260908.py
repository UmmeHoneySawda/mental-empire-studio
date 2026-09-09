"""Surgical MindCipher timeline fix (FIX-NOTES 2026-09-08).

Replaces pure-black/defective B-roll windows with verified-bright footage.
Keeps every slot boundary, duration, scene and keyword identical; only
sourcePath/sourceStartSec change. New smoke clips come from today's
library fetch (library-additions.json).
"""
import json
import os
import shutil
import subprocess
from pathlib import Path

CH = Path(r"D:\MentalEmpire-Production\2026-09-08\MindCipher")
TIMELINE = CH / "intermediate" / "broll-timeline.json"
PROVENANCE = CH / "intermediate" / "broll-provenance.json"
FFPROBE = r"D:\Work\mental-empire-studio\resources\bin\ffprobe.exe"

LIB = Path(r"D:\Mental Empire Studio\broll-library\niche-niche-82fcc549")
SMOKE = LIB / "smoke_in_dark_room_cinematic"
ALLEY = LIB / "dark_alley_mystery_b-roll"
HALL = LIB / "psychological_thriller_hallway"
SILH = LIB / "mysterious_stranger_silhouette"

# slot_index -> (source_path, source_start)
FIXES = {
    65: (SMOKE / "pexels-4320605.mp4", 2.0),
    66: (SMOKE / "pexels-9694808.mp4", 2.0),
    67: (SMOKE / "pexels-4320605.mp4", 10.0),
    68: (SMOKE / "pexels-9694808.mp4", 12.0),
    69: (SMOKE / "pexels-4320605.mp4", 18.0),
    70: (SMOKE / "pexels-9694808.mp4", 22.0),
    71: (SMOKE / "pexels-4320605.mp4", 23.0),
    72: (SMOKE / "pexels-9694808.mp4", 32.0),
    156: (SILH / "pexels-18359612.mp4", 0.0),
    162: (ALLEY / "pexels-18972999.mp4", 0.0),
    166: (ALLEY / "pexels-18972999.mp4", 3.0),
    169: (HALL / "pexels-35140392.mp4", 0.0),
    173: (HALL / "pexels-35140392.mp4", 4.9),
}


def duration(path):
    r = subprocess.run(
        [FFPROBE, "-v", "error", "-show_entries", "format=duration",
         "-of", "default=noprint_wrappers=1:nokey=1", str(path)],
        capture_output=True, text=True)
    return float(r.stdout.strip())


def main():
    shutil.copy2(TIMELINE, TIMELINE.with_suffix(".json.v1-blackgap"))
    doc = json.loads(TIMELINE.read_text(encoding="utf-8"))
    slots = {s["index"]: s for s in doc["slots"]}
    for index, (path, start) in FIXES.items():
        slot = slots[index]
        dur = duration(path)
        need = start + slot["durationSec"]
        assert need <= dur + 0.05, f"slot {index}: {need} > {dur}"
        slot["sourcePath"] = str(path)
        slot["sourceStartSec"] = round(start, 3)
        print(f"slot {index}: {path.name} @{start} "
              f"(slot {slot['durationSec']}s, src {dur:.1f}s)")
    tmp = TIMELINE.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(doc, indent=2), encoding="utf-8")
    os.replace(tmp, TIMELINE)

    prov = json.loads(PROVENANCE.read_text(encoding="utf-8"))
    have = {(a["provider"], a["providerId"]) for a in prov["assets"]}
    for index in sorted(FIXES):
        slot = slots[index]
        key = (slot["provider"], slot["providerId"])
        if key not in have:
            prov["assets"].append({
                "provider": slot["provider"],
                "providerId": slot["providerId"],
                "sourcePath": slot["sourcePath"],
                "licensePath": None,
                "keyword": slot["keyword"],
            })
            have.add(key)
    ptmp = PROVENANCE.with_suffix(".json.tmp")
    ptmp.write_text(json.dumps(prov, indent=2), encoding="utf-8")
    os.replace(ptmp, PROVENANCE)
    print("timeline + provenance updated")


if __name__ == "__main__":
    main()
