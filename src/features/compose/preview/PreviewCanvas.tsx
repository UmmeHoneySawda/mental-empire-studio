import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../../../store/useStore";
import { useData } from "../../../store/useData";
import { usePreviewCompositor } from "../hooks/usePreviewCompositor";
import { mediaSrc } from "../../../lib/media";
import { previewImagesKey } from "./previewKeys";

function fmt(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

function TransportButton({
  icon,
  title,
  disabled,
  onClick,
  active,
}: {
  icon: React.ReactNode;
  title: string;
  disabled?: boolean;
  onClick: () => void;
  active?: boolean;
}): JSX.Element {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className="me-btn"
      style={{
        width: 32,
        height: 28,
        border: active ? "1px solid var(--accent)" : "1px solid #262b34",
        borderRadius: 7,
        background: active ? "var(--accent-soft)" : "#15181f",
        color: disabled ? "#4f5662" : active ? "var(--accent)" : "#cdd2da",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      {icon}
    </button>
  );
}

interface PreviewCanvasProps {
  playheadSec?: number;
  onPlayheadChange?: (sec: number) => void;
  selectedLabel?: string;
}

export function PreviewCanvas({
  playheadSec: controlledPlayheadSec,
  onPlayheadChange,
  selectedLabel,
}: PreviewCanvasProps = {}): JSX.Element | null {
  const videoEditorV2 = useStore((s) => s.settings.features.videoEditorV2);
  const project = useData((s) => s.activeProject);
  const images = useData((s) => s.projectImages);
  const transcript = useData((s) => s.transcript);
  const spec = useData((s) => s.previewSpec);
  const previewLoading = useData((s) => s.previewLoading);
  const previewError = useData((s) => s.previewError);
  const loadPreviewSpec = useData((s) => s.loadPreviewSpec);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [localPlayheadSec, setLocalPlayheadSec] = useState(0);
  const [playing, setPlaying] = useState(false);
  const lastPlayheadEmitMs = useRef(0);

  const projectKey = useMemo(() => {
    if (!project) return "";
    return [
      project.id,
      project.durationSec,
      project.captionPreset,
      project.captionFont,
      project.captionAnim,
      project.captionAspect,
      project.captionLines,
      project.captionPosition,
      project.captionPace,
      project.captionHighlightColor,
      project.captionBoxColor,
      project.captionWordsPerPage,
      project.kenBurns,
      project.motionPreset,
      project.punchZoom,
      project.keywords,
      project.lookLut,
      project.lookStrength,
      JSON.stringify(project.lookAdjust ?? {}),
      JSON.stringify(project.betaOpts ?? {}),
    ].join("|");
  }, [project]);
  const imagesKey = useMemo(() => previewImagesKey(images), [images]);
  const transcriptKey = useMemo(
    () =>
      transcript
        .map(
          (w) => `${w.id}:${w.word}:${w.start}:${w.end}:${w.emphasis ? 1 : 0}`,
        )
        .join("|"),
    [transcript],
  );
  const durationSec = Math.max(
    0.05,
    spec?.durationSec ?? project?.durationSec ?? 0.05,
  );
  const externalPlayheadSec = controlledPlayheadSec ?? localPlayheadSec;
  const playheadSec = playing ? localPlayheadSec : externalPlayheadSec;
  const { status, error, drawAt } = usePreviewCompositor(canvasRef, spec, playheadSec);
  const activeBroll = spec?.broll?.find(
    (seg) => playheadSec >= seg.startSec && playheadSec < seg.endSec,
  );
  const canDraw = !!project && !!spec && status !== "error";
  const setPreviewPlayhead = (
    next: number | ((current: number) => number),
    opts?: { throttle?: boolean },
  ): void => {
    const value = typeof next === "function" ? next(playheadSec) : next;
    const clamped = Math.max(0, Math.min(durationSec, value));
    setLocalPlayheadSec(clamped);
    if (!opts?.throttle) {
      lastPlayheadEmitMs.current = performance.now();
      onPlayheadChange?.(clamped);
      return;
    }
    const now = performance.now();
    if (now - lastPlayheadEmitMs.current >= 100 || clamped >= durationSec) {
      lastPlayheadEmitMs.current = now;
      onPlayheadChange?.(clamped);
    }
  };

  useEffect(() => {
    setPlaying(false);
    setLocalPlayheadSec(0);
  }, [project?.id]);

  useEffect(() => {
    if (!playing && controlledPlayheadSec != null)
      setLocalPlayheadSec(controlledPlayheadSec);
  }, [controlledPlayheadSec, playing]);

  useEffect(() => {
    if (!playing && audioRef.current) {
      audioRef.current.currentTime = playheadSec;
    }
  }, [playheadSec, playing]);

  useEffect(() => {
    if (!videoEditorV2 || !project) return;
    void loadPreviewSpec(project.id);
  }, [
    videoEditorV2,
    project?.id,
    projectKey,
    imagesKey,
    transcriptKey,
    loadPreviewSpec,
  ]);

  useEffect(() => {
    if (playheadSec > durationSec) setPreviewPlayhead(durationSec);
  }, [durationSec]);

  useEffect(() => {
    if (!playing || !canDraw) return;
    let raf = 0;
    let last = performance.now();
    let t = playheadSec;
    const audio = audioRef.current;

    if (audio) {
      audio.currentTime = t;
      audio.play().catch((e) => console.error("Audio play failed:", e));
    }

    const tick = (now: number): void => {
      const dt = Math.min(0.25, (now - last) / 1000);
      last = now;
      let next = t + dt;
      if (audio && !audio.paused) {
        next = audio.currentTime;
      }
      if (next >= durationSec) {
        t = durationSec;
        drawAt(t);
        setPreviewPlayhead(t);
        setPlaying(false);
        if (audio) audio.pause();
        return;
      }
      t = next;
      // Draw every frame directly (no React state) so playback stays smooth; only
      // push the throttled state update needed for the scrubber/time label + parent.
      drawAt(t);
      setPreviewPlayhead(t, { throttle: true });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      if (audio) audio.pause();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, canDraw, durationSec, drawAt]);

  if (!videoEditorV2) return null;

  // This IS the real render (same compositor/spec builder as the final GPU export) —
  // there is no ffmpeg fallback to render a separate clip when WebGL errors.
  const statusText =
    previewLoading || status === "loading"
      ? "Building preview"
      : previewError || error
        ? "Preview unavailable"
        : spec?.broll?.length
          ? "Live still preview · B-roll poster"
          : "Live still preview";

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(360px, 680px) minmax(220px, 1fr)",
        gap: 16,
        alignItems: "stretch",
        marginBottom: 20,
      }}
    >
      <div
        style={{
          border: "1px solid #1d2129",
          borderRadius: 14,
          background: "#0c0d11",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            position: "relative",
            aspectRatio: spec ? `${spec.width}/${spec.height}` : "16/9",
            background: "#080a0e",
            display: "grid",
            placeItems: "center",
          }}
        >
          <canvas
            ref={canvasRef}
            style={{
              width: "100%",
              height: "100%",
              display: "block",
            }}
          />
          {!project && (
            <div
              style={{
                position: "absolute",
                inset: 0,
                display: "grid",
                placeItems: "center",
                fontSize: 12,
                color: "#5b616f",
              }}
            >
              Choose a downloaded clip to preview.
            </div>
          )}
          {activeBroll && (
            <div
              title={activeBroll.path}
              style={{
                position: "absolute",
                left: 12,
                top: 12,
                border: "1px solid rgba(64,169,255,.45)",
                borderRadius: 999,
                padding: "4px 9px",
                fontSize: 10,
                fontWeight: 800,
                color: "#9bd4ff",
                background: "rgba(8,10,14,.78)",
                letterSpacing: 0,
              }}
            >
              ▶ video poster
            </div>
          )}
          {(previewLoading || status === "loading") && (
            <div
              style={{
                position: "absolute",
                right: 12,
                top: 12,
                border: "1px solid rgba(245,179,35,.35)",
                borderRadius: 999,
                padding: "3px 8px",
                fontSize: 10,
                color: "#f5b323",
                background: "rgba(8,10,14,.78)",
              }}
            >
              Loading
            </div>
          )}
          {(previewError || error) && (
            <div
              title={previewError || error}
              style={{
                position: "absolute",
                left: 12,
                right: 12,
                bottom: 12,
                border: "1px solid #5a2530",
                borderRadius: 9,
                padding: "8px 10px",
                fontSize: 11,
                color: "#ff8a96",
                background: "rgba(20,10,14,.86)",
              }}
            >
              {previewError || error}
            </div>
          )}
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "10px 12px",
            borderTop: "1px solid #1d2129",
          }}
        >
          <TransportButton
            icon={
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <path d="M6 19h2V5H6v14zm3.5-7L18 5v14l-8.5-7z" />
              </svg>
            }
            title="Start"
            disabled={!canDraw}
            onClick={() => setPreviewPlayhead(0)}
          />
          <TransportButton
            icon={
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z" />
              </svg>
            }
            title="Back 1 second"
            disabled={!canDraw}
            onClick={() => setPreviewPlayhead((t) => Math.max(0, t - 1))}
          />
          <TransportButton
            icon={
              playing ? (
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                >
                  <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
                </svg>
              ) : (
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                >
                  <path d="M8 5v14l11-7z" />
                </svg>
              )
            }
            title={playing ? "Pause" : "Play timing preview"}
            disabled={!canDraw}
            onClick={() => setPlaying((p) => !p)}
            active={playing}
          />
          <TransportButton
            icon={
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z" />
              </svg>
            }
            title="Forward 1 second"
            disabled={!canDraw}
            onClick={() =>
              setPreviewPlayhead((t) => Math.min(durationSec, t + 1))
            }
          />
          <TransportButton
            icon={
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <path d="M16 5v14h2V5h-2zm-8.5 7L16 19V5L7.5 12z" />
              </svg>
            }
            title="End"
            disabled={!canDraw}
            onClick={() => setPreviewPlayhead(durationSec)}
          />
          <input
            type="range"
            min={0}
            max={Math.max(1, durationSec)}
            step={1 / Math.max(1, spec?.fps ?? 24)}
            value={Math.min(playheadSec, durationSec)}
            disabled={!canDraw}
            onChange={(e) => setPreviewPlayhead(Number(e.target.value))}
            style={{
              flex: 1,
              accentColor: "var(--accent)",
              cursor: canDraw ? "pointer" : "not-allowed",
            }}
          />
          <span
            style={{
              width: 86,
              textAlign: "right",
              fontFamily: "var(--font-mono)",
              fontSize: 10.5,
              color: "#8a909c",
            }}
          >
            {fmt(playheadSec)} / {fmt(durationSec)}
          </span>
        </div>
      </div>
      {project?.mp3Path && (
        <audio ref={audioRef} src={mediaSrc(project.mp3Path)} preload="auto" />
      )}
      <div
        style={{
          border: "1px solid #1d2129",
          borderRadius: 14,
          background: "#12151b",
          padding: 14,
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        <div>
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 9.5,
              letterSpacing: ".6px",
              color: "var(--accent)",
              marginBottom: 6,
            }}
          >
            LIVE PREVIEW
          </div>
          <div
            style={{
              fontFamily: "var(--font-display)",
              fontWeight: 600,
              fontSize: 18,
              color: "#eef0f3",
              lineHeight: 1.15,
            }}
          >
            Frame preview
          </div>
        </div>
        <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
          <span
            style={{
              border: "1px solid #262b34",
              borderRadius: 999,
              padding: "3px 8px",
              fontSize: 10,
              color: "#aab0bb",
              fontFamily: "var(--font-mono)",
            }}
          >
            {spec ? `${spec.width}x${spec.height}` : "no spec"}
          </span>
          <span
            style={{
              border: "1px solid #262b34",
              borderRadius: 999,
              padding: "3px 8px",
              fontSize: 10,
              color: status === "ready" ? "#36c98e" : "#8a909c",
              fontFamily: "var(--font-mono)",
            }}
          >
            {statusText}
          </span>
          {spec?.grade.style && (
            <span
              style={{
                border: "1px solid #262b34",
                borderRadius: 999,
                padding: "3px 8px",
                fontSize: 10,
                color: "#aab0bb",
                fontFamily: "var(--font-mono)",
              }}
            >
              {spec.grade.style}
            </span>
          )}
          {selectedLabel && (
            <span
              title={selectedLabel}
              style={{
                border: "1px solid #262b34",
                borderRadius: 999,
                padding: "3px 8px",
                fontSize: 10,
                color: "var(--accent)",
                fontFamily: "var(--font-mono)",
                maxWidth: 180,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {selectedLabel}
            </span>
          )}
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 8,
            fontSize: 11.5,
            color: "#8a909c",
          }}
        >
          <div
            style={{
              border: "1px solid #1d2129",
              borderRadius: 9,
              padding: 9,
              background: "#0e1116",
            }}
          >
            <b style={{ color: "#cdd2da" }}>{spec?.images.length ?? 0}</b>
            <br />
            image windows
          </div>
          <div
            style={{
              border: "1px solid #1d2129",
              borderRadius: 9,
              padding: 9,
              background: "#0e1116",
            }}
          >
            <b style={{ color: "#cdd2da" }}>
              {spec?.captions.groups.length ?? 0}
            </b>
            <br />
            caption groups
          </div>
          <div
            style={{
              border: "1px solid #1d2129",
              borderRadius: 9,
              padding: 9,
              background: "#0e1116",
            }}
          >
            <b style={{ color: "#cdd2da" }}>
              {spec?.motion.kenBurns ? "On" : "Off"}
            </b>
            <br />
            motion
          </div>
          <div
            style={{
              border: "1px solid #1d2129",
              borderRadius: 9,
              padding: 9,
              background: "#0e1116",
            }}
          >
            <b style={{ color: "#cdd2da" }}>{spec?.overlay ? "On" : "Off"}</b>
            <br />
            overlay
          </div>
        </div>
      </div>
    </div>
  );
}
