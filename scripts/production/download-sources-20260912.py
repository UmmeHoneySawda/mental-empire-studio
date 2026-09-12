"""Download 4 source audios for the 2026-09-12 daily batch.

Same ladder/validation as download-sources-20260908.py, adapted to this
machine's tool paths (system ffmpeg + WinGet yt-dlp + Node 24 for --js-runtimes).
"""
import os
import subprocess
import sys
from pathlib import Path

YTDLP = Path(r"C:\Users\261-0\AppData\Local\Microsoft\WinGet\Packages\yt-dlp.yt-dlp_Microsoft.Winget.Source_8wekyb3d8bbwe\yt-dlp.exe")
FFMPEG = Path(r"C:\ProgramData\chocolatey\bin\ffmpeg.exe")
FFPROBE = Path(r"C:\ProgramData\chocolatey\bin\ffprobe.exe")
RUN_ROOT = Path(r"D:\MentalEmpire-Production\2026-09-12")

SOURCES = {
    "MindCipher": "https://www.youtube.com/watch?v=RSlc9IxdBw8",
    "NeuralVault": "https://www.youtube.com/watch?v=zZyvbvitP7k",
    "PsycheNoir": "https://www.youtube.com/watch?v=G9_qZvLQL9E",
    "DisciplineDoctrine": "https://www.youtube.com/watch?v=yOBLQ_KDmQc",
}

CLIENT_LADDER = ["web_embedded", "tv_embedded"]
AUDIO_FORMAT = "bestaudio[ext=m4a]/bestaudio/best"


def _tool(name: Path, fallback: str) -> str:
    if name.exists():
        return str(name)
    return fallback


def probe_duration(path: Path) -> float:
    cmd = [
        _tool(FFPROBE, "ffprobe"), "-v", "error",
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
    env = dict(os.environ)
    env["PATH"] = r"C:\Program Files\nodejs" + os.pathsep + env.get("PATH", "")
    for client in CLIENT_LADDER:
        print(f"[{channel}] Downloading {url} with client={client}...")
        cmd = [
            _tool(YTDLP, "yt-dlp"), "-f", AUDIO_FORMAT, "-x", "--audio-format", "mp3",
            "--audio-quality", "192K", "--js-runtimes", "node",
            "--continue", "--no-warnings", "--no-progress",
            "--socket-timeout", "30", "--retries", "3",
            "--extractor-args", f"youtube:player_client={client}",
            "-o", str(temp_out),
            "--no-playlist", url,
        ]
        if _tool(FFMPEG, "ffmpeg") != "ffmpeg":
            cmd += ["--ffmpeg-location", _tool(FFMPEG, "ffmpeg")]
        r = subprocess.run(cmd, capture_output=True, text=True, env=env)
        if r.returncode == 0 and target_file.exists():
            dur = probe_duration(target_file)
            size_mb = target_file.stat().st_size / (1024 * 1024)
            print(f"[{channel}] Downloaded successfully: {dur:.2f}s, {size_mb:.2f} MB")
            success = True
            break
        else:
            print(f"[{channel}] Client {client} failed: {r.stderr.strip()[-200:] if r.stderr else r.returncode}")

    if not success:
        raise RuntimeError(f"Failed to download source for {channel}")


def main():
    print("=== Downloading 4 Source Audios for 2026-09-12 Batch ===")
    for ch, url in SOURCES.items():
        download_channel(ch, url)
    print("=== All 4 Source Audios Downloaded & Validated ===")


if __name__ == "__main__":
    sys.exit(main())
