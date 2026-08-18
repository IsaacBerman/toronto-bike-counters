'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Upload, Play, Square, Download, RotateCcw, Loader2, Info } from 'lucide-react';
import {
  createTracker, emptyCounts, groupsForMode, modeConfig, MODES, totalOf,
} from '../../lib/video-counter/tracker';
import { detectFrame, loadDetector, MODELS } from '../../lib/video-counter/detector';
import { drawAnnotations, drawCountingLine, drawWatermark } from '../../lib/video-counter/draw';
import { createMp4Recorder, exportSupported } from '../../lib/video-counter/encoder';

// 720p-ish output keeps encoding quick and the download a sane size; detection
// runs on a smaller copy still, since SSD only ever sees 300x300 internally.
const MAX_OUT_WIDTH = 1280;
const DETECT_WIDTH = 640;
const SAMPLE_RATES = [4, 6, 8, 10, 15];
const SPEEDS = [1, 2, 3, 5];
// Detections below the user's threshold are still fetched: the tracker leans on
// them to bridge frames where an object is blurred or half-hidden.
const WEAK_SCORE = 0.15;
// Above this, some players stop honouring the frame rate, so a fast export
// drops frames instead of pushing the rate higher.
const MAX_EXPORT_FPS = 60;

// Same analysed frames, packed into a shorter file. Playing them back at
// sampleRate x speed shortens the video by exactly that factor; if that rate
// would be absurd, keep the duration and drop every other frame instead.
function exportPlan(sampleRate, speed) {
  const targetFps = sampleRate * speed;
  const every = Math.max(1, Math.ceil(targetFps / MAX_EXPORT_FPS));
  return { every, fps: targetFps / every };
}

function evenDims(width, height, maxWidth) {
  const scale = Math.min(1, maxWidth / width);
  return {
    w: Math.max(2, Math.round((width * scale) / 2) * 2),
    h: Math.max(2, Math.round((height * scale) / 2) * 2),
  };
}

// The line is always vertical: one x position, with a top and bottom handle
// that bound how much of the frame it watches.
function toPixels(line, width, height) {
  return {
    x: line.x * width,
    y1: line.y1 * height,
    y2: line.y2 * height,
  };
}

function cloneCounts(counts) {
  const copy = {};
  for (const key of Object.keys(counts)) copy[key] = { ...counts[key] };
  return copy;
}

// Resolves once the frame at `time` is painted into the video element. The
// no-op guard matters: re-setting currentTime to its current value never fires
// `seeked`, which would otherwise hang the pass.
function seekTo(video, time) {
  return new Promise((resolve) => {
    if (Math.abs(video.currentTime - time) < 0.0005) {
      resolve();
      return;
    }
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      video.removeEventListener('seeked', finish);
      video.removeEventListener('error', finish);
      resolve();
    };
    const timer = setTimeout(finish, 5000);
    video.addEventListener('seeked', finish);
    video.addEventListener('error', finish);
    video.currentTime = time;
  });
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds)) return '—';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function VideoCounterContent() {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const detectCanvasRef = useRef(null);
  const dragRef = useRef(null);
  const cancelRef = useRef(false);
  const lineRef = useRef(null);
  const objectUrlsRef = useRef([]);

  const [stage, setStage] = useState('empty'); // empty | ready | loading | running | done | error
  const [error, setError] = useState(null);
  const [fileName, setFileName] = useState('');
  const [media, setMedia] = useState(null); // { w, h, duration }
  // Full height by default: most clips want the whole frame, and the handles
  // are there to trim it down to one lane when they don't.
  const [line, setLine] = useState({ x: 0.5, y1: 0, y2: 1 });
  const [hover, setHover] = useState(null);
  const [previewTime, setPreviewTime] = useState(0);
  const [mode, setMode] = useState(MODES[0].value);
  const [counts, setCounts] = useState(() => emptyCounts(MODES[0].value));
  const [progress, setProgress] = useState(0);
  const [resultUrl, setResultUrl] = useState(null);
  const [resultSize, setResultSize] = useState(0);
  const [dropping, setDropping] = useState(false);
  const [canExport, setCanExport] = useState(true);
  const [device, setDevice] = useState(null);

  // Settings
  const [sampleRate, setSampleRate] = useState(10);
  const [speed, setSpeed] = useState(1);
  const [modelBase, setModelBase] = useState(MODELS[0].value);
  const [minScore, setMinScore] = useState(0.7);
  const [excludeRiders, setExcludeRiders] = useState(true);
  const [showBoxes, setShowBoxes] = useState(true);

  lineRef.current = line;

  useEffect(() => {
    setCanExport(exportSupported());
  }, []);

  const trackUrl = useCallback((url) => {
    objectUrlsRef.current.push(url);
    return url;
  }, []);

  useEffect(() => () => {
    for (const url of objectUrlsRef.current) URL.revokeObjectURL(url);
  }, []);

  const redrawPreview = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !media) return;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, media.w, media.h);
    drawCountingLine(ctx, toPixels(lineRef.current, media.w, media.h), media.w, {
      hovered: hover !== null,
    });
    drawWatermark(ctx, media.w, media.h);
  }, [media, hover]);

  // Redraw whenever the line moves — the video element still holds the frame,
  // so this costs nothing but a drawImage.
  useEffect(() => {
    if (stage === 'ready') redrawPreview();
  }, [line, stage, redrawPreview]);

  // Scrubbing to a representative frame makes the line easier to place.
  useEffect(() => {
    if (stage !== 'ready') return undefined;
    let stale = false;
    (async () => {
      await seekTo(videoRef.current, previewTime);
      if (!stale) redrawPreview();
    })();
    return () => { stale = true; };
  }, [previewTime, stage, redrawPreview]);

  function resetResult() {
    if (resultUrl) URL.revokeObjectURL(resultUrl);
    setResultUrl(null);
    setResultSize(0);
    setCounts(emptyCounts(mode));
    setProgress(0);
  }

  async function acceptFile(file) {
    if (!file || !file.type.startsWith('video/')) {
      setError('That file is not a video.');
      return;
    }
    setError(null);
    resetResult();

    const video = videoRef.current;
    // Object URL only: the file is read straight from disk by the browser and
    // never uploaded or written anywhere.
    const url = trackUrl(URL.createObjectURL(file));
    video.src = url;
    video.muted = true;

    try {
      // `loadeddata`, not `loadedmetadata` — metadata alone gives dimensions
      // but no decoded frame, so the first drawImage would come out blank.
      await new Promise((resolve, reject) => {
        video.onloadeddata = resolve;
        video.onerror = () => reject(new Error('This video could not be decoded by your browser. Try an MP4 (H.264).'));
      });

      const duration = Number.isFinite(video.duration)
        ? video.duration
        : (video.seekable.length ? video.seekable.end(0) : 0);
      if (!duration) {
        throw new Error('This video has no readable duration. Try re-saving it as an MP4.');
      }

      const dims = evenDims(video.videoWidth, video.videoHeight, MAX_OUT_WIDTH);
      const detectDims = evenDims(dims.w, dims.h, Math.min(DETECT_WIDTH, dims.w));

      setFileName(file.name);
      // The canvases are sized in an effect rather than here: the visible one
      // isn't mounted until this state change takes us out of the empty stage.
      setMedia({ ...dims, duration, detectW: detectDims.w, detectH: detectDims.h });
      setPreviewTime(0);
      setStage('ready');
    } catch (err) {
      setError(err?.message || 'That video could not be opened.');
      // Fall back to the drop zone rather than a half-built editor.
      setStage(media ? 'error' : 'empty');
    }
  }

  // Sizing a canvas also clears it, so this runs before the preview is drawn.
  useEffect(() => {
    if (!media) return;
    const canvas = canvasRef.current;
    const detect = detectCanvasRef.current;
    if (!canvas || !detect) return;
    canvas.width = media.w;
    canvas.height = media.h;
    detect.width = media.detectW;
    detect.height = media.detectH;
    redrawPreview();
  }, [media, redrawPreview]);

  function onDrop(event) {
    event.preventDefault();
    setDropping(false);
    const file = event.dataTransfer.files?.[0];
    if (file) acceptFile(file);
  }

  // ---- Line editing -------------------------------------------------------

  function canvasPoint(event) {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height,
    };
  }

  // What the pointer is over: an end handle, the line itself, or nothing. Only
  // these spots are interactive, which is what the cursor is promising.
  function hitTest(p) {
    if (!media) return null;
    const px = toPixels(line, media.w, media.h);
    const handleReach = Math.max(15, media.w * 0.022);
    const lineReach = Math.max(9, media.w * 0.012);
    const top = Math.min(px.y1, px.y2);
    const bottom = Math.max(px.y1, px.y2);
    // Matches the inset the handles are drawn at, so the grab zone sits on the
    // circle the user can see rather than on the line's true end.
    const inset = 7 * Math.max(1, media.w / 640);

    if (Math.hypot(p.x - px.x, p.y - (top + inset)) < handleReach) {
      return px.y1 <= px.y2 ? 'y1' : 'y2';
    }
    if (Math.hypot(p.x - px.x, p.y - (bottom - inset)) < handleReach) {
      return px.y1 <= px.y2 ? 'y2' : 'y1';
    }
    if (Math.abs(p.x - px.x) < lineReach && p.y > top - lineReach && p.y < bottom + lineReach) {
      return 'x';
    }
    return null;
  }

  function onPointerDown(event) {
    if (stage !== 'ready' || !media) return;
    const target = hitTest(canvasPoint(event));
    if (!target) return;
    dragRef.current = { mode: target };
    setHover(target);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event) {
    if (stage !== 'ready' || !media) return;
    const p = canvasPoint(event);
    const drag = dragRef.current;

    if (!drag) {
      setHover(hitTest(p));
      return;
    }

    const nx = Math.min(1, Math.max(0, p.x / media.w));
    const ny = Math.min(1, Math.max(0, p.y / media.h));
    if (drag.mode === 'y1') setLine((l) => ({ ...l, y1: ny }));
    else if (drag.mode === 'y2') setLine((l) => ({ ...l, y2: ny }));
    else setLine((l) => ({ ...l, x: nx }));
  }

  function onPointerUp(event) {
    dragRef.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  }

  // ---- The counting pass --------------------------------------------------

  async function run() {
    if (!media) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const detectCanvas = detectCanvasRef.current;
    const detectCtx = detectCanvas.getContext('2d', { willReadFrequently: false });

    cancelRef.current = false;
    resetResult();
    setError(null);
    setStage('loading');

    let recorder = null;
    try {
      const detector = await loadDetector(modelBase);
      if (cancelRef.current) { setStage('ready'); return; }
      setDevice(detector.device);
      setStage('running');

      const fps = sampleRate;
      const totalFrames = Math.max(1, Math.floor(media.duration * fps));
      const tracker = createTracker({ fps, scoreThreshold: minScore, mode, excludeRiders });
      const groups = groupsForMode(mode);
      const linePx = toPixels(lineRef.current, media.w, media.h);

      const plan = exportPlan(fps, speed);
      let exportedFrames = 0;
      if (canExport) {
        recorder = await createMp4Recorder({ width: media.w, height: media.h, fps: plan.fps });
      }

      for (let i = 0; i < totalFrames; i += 1) {
        if (cancelRef.current) break;
        const time = i / fps;
        await seekTo(video, time);

        ctx.drawImage(video, 0, 0, media.w, media.h);
        detectCtx.drawImage(video, 0, 0, media.detectW, media.detectH);

        const detections = await detectFrame(detector, detectCanvas, {
          width: media.w,
          height: media.h,
          // Weak detections are kept and handed to the tracker, which uses them
          // only to hold existing tracks together.
          minScore: Math.min(WEAK_SCORE, minScore),
        });
        const tracks = tracker.update(detections, linePx);

        drawAnnotations(ctx, {
          tracks,
          counts: tracker.counts,
          groups,
          line: linePx,
          width: media.w,
          height: media.h,
          frameIndex: tracker.frame,
          time,
          duration: media.duration,
          showBoxes,
          coastDrawFrames: tracker.coastDrawFrames,
          flashFrames: tracker.flashFrames,
        });

        // Every frame is still analysed — only the export thins out.
        if (recorder && i % plan.every === 0) {
          await recorder.addFrame(canvas, exportedFrames);
          exportedFrames += 1;
        }

        setCounts(cloneCounts(tracker.counts));
        setProgress((i + 1) / totalFrames);
      }

      if (cancelRef.current) {
        recorder?.cancel();
        setStage('ready');
        redrawPreview();
        return;
      }

      if (recorder) {
        const blob = await recorder.finish();
        setResultUrl(URL.createObjectURL(blob));
        setResultSize(blob.size);
      }
      setStage('done');
    } catch (err) {
      recorder?.cancel();
      setError(err?.message || 'Something went wrong while analysing the video.');
      setStage('error');
    }
  }

  function stop() {
    cancelRef.current = true;
  }

  function startOver() {
    cancelRef.current = true;
    resetResult();
    setFileName('');
    setMedia(null);
    setStage('empty');
    setError(null);
    if (videoRef.current) videoRef.current.removeAttribute('src');
  }

  const busy = stage === 'loading' || stage === 'running';
  const totalFrames = media ? Math.max(1, Math.floor(media.duration * sampleRate)) : 0;
  const downloadName = fileName.replace(/\.[^.]+$/, '') || 'video';

  return (
    <main className="container mx-auto px-4 max-w-6xl py-8">
      {/* Parked offscreen rather than display:none — a hidden video element is
          the frame source for every drawImage, and browsers are entitled to
          skip decoding for one that isn't rendered at all. */}
      <video
        ref={videoRef}
        playsInline
        muted
        preload="auto"
        style={{ position: 'absolute', left: -9999, top: 0, width: 1, height: 1, opacity: 0, pointerEvents: 'none' }}
      />
      <canvas ref={detectCanvasRef} className="hidden" />

      <div className="mb-6">
        <h1 className="dd-title text-3xl sm:text-4xl mb-3">Transportation Mode Counter</h1>
        <p className="max-w-2xl text-sm leading-relaxed" style={{ color: 'var(--ink-2)' }}>
          Drop in a video of a street, drag the counting line across the lane, sidewalk or bike
          path you care about, and everything that crosses it gets counted, with the running tally
          drawn into the video for you to download.
        </p>
        <p className="mt-3 max-w-2xl text-xs leading-relaxed" style={{ color: 'var(--ink-3)' }}>
          Your video never leaves this browser tab. There is no upload and nothing is stored on a
          server: the detection model runs on your own machine and the annotated copy is built
          locally.
        </p>
      </div>

      {error && (
        <div
          className="dd-panel mb-5 px-4 py-3 text-sm font-semibold"
          style={{ borderColor: '#c23a24', color: '#96201c' }}
        >
          {error}
        </div>
      )}

      {stage === 'empty' ? (
        <label
          onDragOver={(e) => { e.preventDefault(); setDropping(true); }}
          onDragLeave={() => setDropping(false)}
          onDrop={onDrop}
          className="dd-panel-ruled flex cursor-pointer flex-col items-center justify-center gap-3 px-6 py-16 text-center"
          style={{ borderColor: dropping ? 'var(--accent)' : undefined }}
        >
          <Upload size={26} style={{ color: 'var(--accent)' }} />
          <span className="dd-title text-lg">Drop a video here, or choose a file</span>
          <span className="text-xs" style={{ color: 'var(--ink-3)' }}>
            MP4, MOV or WebM. Anything your browser can play.
          </span>
          <input
            type="file"
            accept="video/*"
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0];
              // Clear the value so picking the same file twice still fires.
              e.target.value = '';
              if (file) acceptFile(file);
            }}
          />
        </label>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
          {/* self-start: as a grid item this panel would otherwise stretch to
              the height of the taller settings column, leaving a slab of empty
              panel-white under the video. */}
          <div className="dd-panel-ruled overflow-hidden self-start">
            <canvas
              ref={canvasRef}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerLeave={() => { if (!dragRef.current) setHover(null); }}
              className="block w-full"
              style={{
                background: '#16150f',
                touchAction: 'none',
                // Only the line reports as grabbable, and the arrows say which
                // way it moves: sideways for the line, up/down for its ends.
                cursor: hover === 'x' ? 'ew-resize' : hover ? 'ns-resize' : 'default',
              }}
            />

            <div className="border-t px-4 py-3" style={{ borderColor: 'var(--line)' }}>
              {stage === 'ready' && media && (
                <>
                  <div className="mb-3 flex items-center gap-2 text-xs font-semibold" style={{ color: 'var(--ink-2)' }}>
                    <Info size={14} style={{ color: 'var(--accent)' }} />
                    Drag the line to slide it across the frame, or drag its end handles to trim
                    what it watches. Crossings are tallied as → and ←.
                  </div>
                  <label className="flex items-center gap-3 text-xs font-semibold" style={{ color: 'var(--ink-3)' }}>
                    <span className="whitespace-nowrap">Preview frame</span>
                    <input
                      type="range"
                      min={0}
                      max={Math.max(0, media.duration - 0.05)}
                      step={0.1}
                      value={previewTime}
                      onChange={(e) => setPreviewTime(Number(e.target.value))}
                      className="w-full"
                      style={{ accentColor: 'var(--accent)' }}
                    />
                    <span className="tabular-nums">{formatTime(previewTime)}</span>
                  </label>
                </>
              )}

              {busy && (
                <div>
                  <div className="mb-2 flex items-center justify-between text-xs font-bold" style={{ color: 'var(--ink-2)' }}>
                    <span className="flex items-center gap-2">
                      <Loader2 size={14} className="animate-spin" />
                      {stage === 'loading' ? 'Loading detection model…' : `Analysing frame ${Math.round(progress * totalFrames)} of ${totalFrames}`}
                    </span>
                    <span className="tabular-nums">{Math.round(progress * 100)}%</span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-sm" style={{ background: 'var(--line)' }}>
                    <div
                      className="h-full transition-[width] duration-150"
                      style={{ width: `${progress * 100}%`, background: 'var(--accent)' }}
                    />
                  </div>
                </div>
              )}

              {stage === 'done' && (
                <div className="text-xs font-semibold" style={{ color: 'var(--ink-2)' }}>
                  Done. {totalFrames} frames analysed at {sampleRate} fps.
                  {resultUrl
                    ? ` Annotated MP4 ready: ${formatTime(media.duration / speed)}${speed > 1 ? ` at ${speed}× speed` : ''}, ${(resultSize / 1024 / 1024).toFixed(1)} MB.`
                    : ''}
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-4">
            <div className="dd-panel px-4 py-4">
              <p className="dd-kicker mb-3">Counted crossings</p>
              <div className="flex flex-col gap-2">
                {groupsForMode(mode).map((group) => {
                  const count = counts[group.key];
                  return (
                    <div key={group.key} className="flex items-center gap-3">
                      <span className="h-3 w-3 rounded-sm" style={{ background: group.color }} />
                      <span className="flex-1 text-sm font-semibold" style={{ color: 'var(--ink)' }}>
                        {group.label}
                      </span>
                      <span className="text-xs tabular-nums" style={{ color: 'var(--ink-3)' }}>
                        →{count.right} ←{count.left}
                      </span>
                      <span className="dd-title w-8 text-right text-xl tabular-nums">
                        {totalOf(count)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="dd-panel px-4 py-4">
              <p className="dd-kicker mb-3">Settings</p>
              <div className="flex flex-col gap-3">
                <label className="flex flex-col gap-1 text-xs font-bold" style={{ color: 'var(--ink-2)' }}>
                  What to count
                  <select
                    className="dd-select"
                    value={mode}
                    disabled={busy}
                    onChange={(e) => {
                      setMode(e.target.value);
                      setCounts(emptyCounts(e.target.value));
                      resetResult();
                    }}
                  >
                    {MODES.map((m) => (
                      <option key={m.value} value={m.value}>{m.label}</option>
                    ))}
                  </select>
                  <span className="font-semibold" style={{ color: 'var(--ink-3)' }}>
                    {modeConfig(mode).note}
                  </span>
                </label>

                <label className="flex flex-col gap-1 text-xs font-bold" style={{ color: 'var(--ink-2)' }}>
                  Model
                  <select
                    className="dd-select"
                    value={modelBase}
                    disabled={busy}
                    onChange={(e) => setModelBase(e.target.value)}
                  >
                    {MODELS.map((m) => (
                      <option key={m.value} value={m.value}>{m.label}</option>
                    ))}
                  </select>
                  <span className="font-semibold" style={{ color: 'var(--ink-3)' }}>
                    {MODELS.find((m) => m.value === modelBase)?.note}
                    {device ? ` Running on ${device === 'webgpu' ? 'WebGPU' : device === 'webgl' ? 'WebGL' : 'CPU'}.` : ''}
                  </span>
                </label>

                <label className="flex flex-col gap-1 text-xs font-bold" style={{ color: 'var(--ink-2)' }}>
                  Frames analysed per second
                  <select
                    className="dd-select"
                    value={sampleRate}
                    disabled={busy}
                    onChange={(e) => setSampleRate(Number(e.target.value))}
                  >
                    {SAMPLE_RATES.map((rate) => (
                      <option key={rate} value={rate}>{rate} fps</option>
                    ))}
                  </select>
                </label>

                <label className="flex flex-col gap-1 text-xs font-bold" style={{ color: 'var(--ink-2)' }}>
                  Download speed
                  <select
                    className="dd-select"
                    value={speed}
                    disabled={busy}
                    onChange={(e) => setSpeed(Number(e.target.value))}
                  >
                    {SPEEDS.map((value) => (
                      <option key={value} value={value}>
                        {value === 1 ? '1× (real time)' : `${value}× faster`}
                        {media ? ` (${formatTime(media.duration / value)})` : ''}
                      </option>
                    ))}
                  </select>
                  <span className="font-semibold" style={{ color: 'var(--ink-3)' }}>
                    Speeds up the downloaded video only. The counts and the on-screen clock stay
                    the same.
                  </span>
                </label>

                <label className="flex flex-col gap-1 text-xs font-bold" style={{ color: 'var(--ink-2)' }}>
                  Confidence threshold: {minScore.toFixed(2)}
                  <input
                    type="range"
                    min={0.6}
                    max={0.8}
                    step={0.05}
                    value={minScore}
                    disabled={busy}
                    onChange={(e) => setMinScore(Number(e.target.value))}
                    style={{ accentColor: 'var(--accent)' }}
                  />
                </label>

                {/* Only meaningful when pedestrians are the thing being counted;
                    in bike mode people are not a category at all. */}
                {mode === 'pedestrians' && (
                  <label className="flex items-start gap-2 text-xs font-semibold" style={{ color: 'var(--ink-2)' }}>
                    <input
                      type="checkbox"
                      checked={excludeRiders}
                      disabled={busy}
                      onChange={(e) => setExcludeRiders(e.target.checked)}
                      style={{ accentColor: 'var(--accent)', marginTop: 2 }}
                    />
                    Leave people riding bikes out of the pedestrian count
                  </label>
                )}

                <label className="flex items-start gap-2 text-xs font-semibold" style={{ color: 'var(--ink-2)' }}>
                  <input
                    type="checkbox"
                    checked={showBoxes}
                    disabled={busy}
                    onChange={(e) => setShowBoxes(e.target.checked)}
                    style={{ accentColor: 'var(--accent)', marginTop: 2 }}
                  />
                  Draw detection boxes on the video
                </label>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              {stage === 'running' || stage === 'loading' ? (
                <button type="button" className="dd-btn dd-btn-ghost" onClick={stop}>
                  <Square size={15} /> Stop
                </button>
              ) : (
                <button type="button" className="dd-btn dd-btn-accent" onClick={run} disabled={!media}>
                  <Play size={15} /> {stage === 'done' ? 'Run again' : 'Count crossings'}
                </button>
              )}

              {resultUrl && (
                <a
                  className="dd-btn dd-btn-primary"
                  href={resultUrl}
                  download={`${downloadName}-counted${speed > 1 ? `-${speed}x` : ''}.mp4`}
                >
                  <Download size={15} /> Download annotated video
                </a>
              )}

              <button type="button" className="dd-btn dd-btn-ghost" onClick={startOver}>
                <RotateCcw size={15} /> Use a different video
              </button>
            </div>

            {media && (
              <p className="text-xs leading-relaxed" style={{ color: 'var(--ink-3)' }}>
                {fileName}, {media.w}×{media.h}, {formatTime(media.duration)}. The pass will
                analyse {totalFrames} frames; expect roughly {Math.ceil(totalFrames / 12)}–
                {Math.ceil(totalFrames / 4)} seconds depending on your machine. The download will
                run {formatTime(media.duration / speed)} and has no audio track.
              </p>
            )}

            {!canExport && (
              <p className="text-xs font-semibold" style={{ color: '#96201c' }}>
                This browser can’t encode video (no WebCodecs support), so counting will run and
                display but there will be nothing to download. Chrome, Edge, Safari 16.4+ or
                Firefox 130+ can export.
              </p>
            )}
          </div>
        </div>
      )}

      <div className="dd-panel mt-8 px-5 py-5">
        <p className="dd-kicker mb-3">How the counting works</p>
        <ul className="flex list-disc flex-col gap-2 pl-5 text-sm leading-relaxed" style={{ color: 'var(--ink-2)' }}>
          <li>
            The line is vertical, so put it where traffic passes across it. Anything above or
            below the two handles is ignored, so trimming the line to one lane or one sidewalk
            counts only that lane or sidewalk.
          </li>
          <li>
            Bikes and people on foot are never counted in the same run. A cyclist is a person
            sitting on a bicycle as far as any detector is concerned, so counting both at once
            means constantly deciding which one they are. Counting bikes against vehicles removes
            the question: people aren’t a category, and a rider can only be a bike.
          </li>
          <li>
            These are estimates, not a certified count: heavy occlusion, night footage, very small
            or very fast objects and steep camera angles all cost accuracy.
          </li>
        </ul>
      </div>
    </main>
  );
}
