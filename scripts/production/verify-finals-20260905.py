import json
import subprocess
from pathlib import Path

REPO_ROOT = Path(r"d:\Work\mental-empire-studio")
FFPROBE = REPO_ROOT / "resources" / "bin" / "ffprobe.exe"
FFMPEG = REPO_ROOT / "resources" / "bin" / "ffmpeg.exe"
ROOT = Path(r"D:\MentalEmpire-Production\2026-09-05")

channels = ["MindCipher", "NeuralVault", "PsycheNoir", "DisciplineDoctrine"]

def main():
    print("=== FINAL GATE VERIFICATION (2026-09-05 BATCH) ===")
    all_passed = True
    for ch in channels:
        final_dir = ROOT / ch / "final"
        mp4s = list(final_dir.glob("*.mp4"))
        if not mp4s:
            print(f"[{ch}] ERROR: No final mp4 found!")
            all_passed = False
            continue
        final_path = mp4s[0]
        source_path = ROOT / ch / "source" / "source.mp3"

        # probe final
        cmd = [
            str(FFPROBE), "-v", "error",
            "-show_entries", "format=duration,size",
            "-show_entries", "stream=codec_type,codec_name,width,height",
            "-of", "json", str(final_path)
        ]
        info = json.loads(subprocess.run(cmd, capture_output=True, text=True).stdout)
        v_stream = next(s for s in info["streams"] if s["codec_type"] == "video")
        a_stream = next(s for s in info["streams"] if s["codec_type"] == "audio")

        # probe source duration
        src_cmd = [
            str(FFPROBE), "-v", "error",
            "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1", str(source_path)
        ]
        src_dur = float(subprocess.run(src_cmd, capture_output=True, text=True).stdout.strip())
        final_dur = float(info["format"]["duration"])
        size_mb = float(info["format"]["size"]) / (1024 * 1024)
        delta = final_dur - src_dur

        vc = v_stream["codec_name"]
        w = v_stream["width"]
        h = v_stream["height"]
        ac = a_stream["codec_name"]

        stream_ok = (vc == "h264" and w == 1920 and h == 1080 and ac == "aac")
        duration_ok = abs(delta) < 1.0

        print(f"\nChannel: {ch}")
        print(f"  File: {final_path.name}")
        print(f"  Streams: Video={vc} ({w}x{h}), Audio={ac} -> {'PASS' if stream_ok else 'FAIL'}")
        print(f"  Duration: Final={final_dur:.3f}s, Source={src_dur:.3f}s (Delta: {delta:+.3f}s), Size={size_mb:.1f} MB -> {'PASS' if duration_ok else 'FAIL'}")

        if not (stream_ok and duration_ok):
            all_passed = False

        # extract 3 frames
        frames_dir = ROOT / ch / "intermediate" / "verify_frames"
        frames_dir.mkdir(parents=True, exist_ok=True)
        for pos, t in [("open", 5.0), ("mid", final_dur / 2.0), ("end", max(1.0, final_dur - 5.0))]:
            out_jpg = frames_dir / f"frame_{pos}.jpg"
            fcmd = [str(FFMPEG), "-y", "-ss", str(t), "-i", str(final_path), "-vframes", "1", "-q:v", "2", str(out_jpg)]
            subprocess.run(fcmd, capture_output=True)
        print(f"  Frames: Extracted opening, mid, end frames to {frames_dir}")

    print(f"\nFinal gate result: {'ALL 4 PASSED' if all_passed else 'SOME FAILED'}")

if __name__ == "__main__":
    main()
