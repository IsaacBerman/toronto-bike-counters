// Writes the annotated canvas out as an MP4, in the browser, via WebCodecs.
//
// MediaRecorder would be the obvious choice, but it timestamps frames off the
// wall clock: a clip that takes 90 s to analyse comes back as a 90 s video in
// slow motion. VideoEncoder lets us stamp every frame at i/fps, so the export
// runs at true speed no matter how long the analysis took.

// Main@4.0 first (handles 1080p), then Baseline for older decoders, then High.
const CODECS = ['avc1.4d0028', 'avc1.42001f', 'avc1.640028'];

export function exportSupported() {
  return typeof window !== 'undefined' && typeof window.VideoEncoder === 'function';
}

async function pickCodec(config) {
  for (const codec of CODECS) {
    try {
      const support = await window.VideoEncoder.isConfigSupported({ ...config, codec });
      if (support.supported) return codec;
    } catch {
      // Unknown codec string on this browser — try the next one.
    }
  }
  return null;
}

/**
 * `fps` is the *playback* rate of the exported file, which is the analysis rate
 * times the chosen speed-up — same frames, packed into a shorter video.
 *
 * @returns {Promise<{addFrame: (canvas: HTMLCanvasElement, index: number) => Promise<void>,
 *                    finish: () => Promise<Blob>, cancel: () => void}>}
 */
export async function createMp4Recorder({ width, height, fps }) {
  if (!exportSupported()) throw new Error('This browser has no VideoEncoder support.');

  const { Muxer, ArrayBufferTarget } = await import('mp4-muxer');

  const base = {
    width,
    height,
    framerate: fps,
    // ~0.14 bits per pixel per frame keeps street scenes clean without
    // producing a file too big to hand back through a blob URL.
    bitrate: Math.min(Math.max(Math.round(width * height * fps * 0.14), 1_500_000), 16_000_000),
  };

  const codec = await pickCodec(base);
  if (!codec) throw new Error('This browser cannot encode H.264 video.');

  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    // frameRate only tells the muxer how to round timestamps, and a sped-up
    // export can land on a fractional rate — leave it off in that case and let
    // the explicit per-frame timestamps stand on their own.
    video: {
      codec: 'avc',
      width,
      height,
      ...(Number.isInteger(fps) ? { frameRate: fps } : {}),
    },
    fastStart: 'in-memory',
  });

  let failure = null;
  const encoder = new window.VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (err) => { failure = err; },
  });
  encoder.configure({ ...base, codec, latencyMode: 'quality' });

  const frameDuration = 1_000_000 / fps;
  const keyEvery = Math.max(1, Math.round(fps * 2));

  async function addFrame(canvas, index) {
    if (failure) throw failure;

    // Don't let the encoder queue outrun memory if it falls behind.
    while (encoder.encodeQueueSize > 8) {
      await new Promise((resolve) => setTimeout(resolve, 4));
      if (failure) throw failure;
    }

    const frame = new window.VideoFrame(canvas, {
      timestamp: Math.round(index * frameDuration),
      duration: Math.round(frameDuration),
    });
    try {
      encoder.encode(frame, { keyFrame: index % keyEvery === 0 });
    } finally {
      frame.close();
    }
  }

  async function finish() {
    await encoder.flush();
    if (failure) throw failure;
    muxer.finalize();
    encoder.close();
    return new Blob([target.buffer], { type: 'video/mp4' });
  }

  function cancel() {
    try {
      if (encoder.state !== 'closed') encoder.close();
    } catch {
      // Already torn down.
    }
  }

  return { addFrame, finish, cancel };
}
