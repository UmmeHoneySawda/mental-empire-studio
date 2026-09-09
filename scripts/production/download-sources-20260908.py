import os
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(r"d:\Work\mental-empire-studio")
YTDLP = REPO_ROOT / "resources" / "bin" / "yt-dlp.exe"
FFMPEG = REPO_ROOT / "resources" / "bin" / "ffmpeg.exe"
FFPROBE = REPO_ROOT / "resources" / "bin" / "ffprobe.exe"
RUN_ROOT = Path(r"D:\MentalEmpire-Production\2026-09-08")

SOURCES = {
    "MindCipher": "https://www.youtube.com/watch?v=vMkStAjmCYE",
    "NeuralVault": "https://www.youtube.com/watch?v=R5J4dctoCD8",
    "PsycheNoir": "https://www.youtube.com/watch?v=IvFUc1jV48k",
    "DisciplineDoctrine": "https://www.youtube.com/watch?v=d5VtTHFnkXk",
}

CLIENT_LADDER = ["web_embedded", "tv_embedded"]
AUDIO_FORMAT = "bestaudio[ext=m4a]/bestaudio/best"

def probe_duration(path: Path) -> float:
    cmd = [
        str(FFPROBE), "-v", "error",
        "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1",
        str(path)
    ]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(f"ffprobe failed for {path}: {r.stderr}")
    return float(r.stdout.strip())

def download_channel(channel: str, url: str):
    target_dir = RUN_ROOT / channel / "source"
    target_dir.mkdir(parents=True, exist_ok=True)
    target_file = target_dir / "source.mp3"

    if target_file.exists():
        try:
            dur = probe_duration(target_file)
            size_mb = target_file.stat().st_size / (1024 * 1024)
            if dur > 60 and size_mb > 5:
                print(f"[{channel}] Already downloaded: {target_file} ({dur:.2f}s, {size_mb:.2f} MB)")
                return
        except Exception:
            print(f"[{channel}] Existing file corrupt, re-downloading...")
            target_file.unlink(missing_ok=True)

    temp_out = target_dir / "source.%(ext)s"
    success = False
    for client in CLIENT_LADDER:
        print(f"[{channel}] Downloading {url} with client={client}...")
        cmd = [
            str(YTDLP), "-f", AUDIO_FORMAT, "-x", "--audio-format", "mp3",
            "--audio-quality", "192K", "--js-runtimes", "node",
            "--continue", "--no-warnings", "--no-progress",
            "--socket-timeout", "30", "--retries", "3",
            "--ffmpeg-location", str(FFMPEG),
            "--extractor-args", f"youtube:player_client={client}",
            "-o", str(temp_out),
            "--no-playlist", url,
        ]
        r = subprocess.run(cmd, capture_output=True, text=True)
        if r.returncode == 0 and target_file.exists():
            dur = probe_duration(target_file)
            size_mb = target_file.stat().st_size / (1024 * 1024)
            print(f"[{channel}] Downloaded successfully: {dur:.2f}s, {size_mb:.2f} MB")
            success = True
            break
        else:
            print(f"[{channel}] Client {client} failed: {r.stderr.strip()[-200:] if r.stderr else r.returncode}")

    if not success:
        raise RuntimeError(f"Failed to download source for {channel} from {url}")

def main():
    print("=== Downloading 4 Source Audios for 2026-09-08 Batch ===")
    for ch, url in SOURCES.items():
        download_channel(ch, url)
    print("=== All 4 Source Audios Downloaded & Validated ===")

if __name__ == "__main__":
    main()
