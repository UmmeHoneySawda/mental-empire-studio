# Mental Empire Studio — Render Capability Matrix

## Encoder Selection

| Machine capability | Settings option | Render behavior |
|---|---|---|
| Any machine with FFmpeg/libx264 | CPU | Uses `libx264 -preset medium -crf` and works everywhere. |
| NVIDIA GPU with working NVENC | NVENC | Uses `h264_nvenc -preset p5 -tune hq -rc vbr -cq ... -b:v 0`. |
| Intel Quick Sync listed by FFmpeg | QSV | Uses `h264_qsv` with global quality. |
| AMD AMF listed by FFmpeg | AMF | Uses `h264_amf` CQP quality mode. |
| Hardware option selected but unavailable/fails | NVENC/QSV/AMF | Falls back to CPU/libx264 so the render completes instead of hard-failing. |

## Filters

| Feature | Requirement | Fallback |
|---|---|---|
| Burned ASS captions | FFmpeg built with `libass` | The bundled FFmpeg is expected to include `libass`; capability probe exposes this to the UI. |
| Cinematic grade | Standard FFmpeg filters: `curves`, `colorbalance`, `eq`, `noise`, `vignette` | Clean style omits grade filters. |
| Audio mastering | FFmpeg `loudnorm` filter | Render fails loudly if the bundled FFmpeg lacks core audio filters. |
| B-roll assembly | Standard `scale`, `crop`, `fps`, `concat`/`xfade` filters | Falls back to still-image track when B-roll fetch/assembly fails. |

## Manual GPU Verification

CI and fixture smoke tests assert hardware encoder arguments and fallback behavior, but they cannot prove actual GPU utilization without a GPU. On a user machine:

1. Open Settings and select an available hardware encoder.
2. Render a short B-roll project.
3. Confirm Render Queue shows `GPU-*` in the device chip during encoding.
4. Confirm Task Manager or the GPU vendor tool shows video encode activity.
5. If FFmpeg hardware encode fails, confirm the render retries and completes as CPU/libx264.

