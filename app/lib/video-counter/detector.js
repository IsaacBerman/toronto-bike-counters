// Object detection, in the browser. Two backends behind one interface:
//
//   RT-DETR R18 (transformers.js + ONNX Runtime) — a real-time detection
//     transformer trained on COCO + Objects365. Roughly twice the COCO mAP of
//     MobileNet-SSD and far better on the small, distant, partly-occluded
//     traffic that a street camera actually sees. Runs on WebGPU where the
//     browser has it.
//
//   COCO-SSD (TensorFlow.js) — the light option. Quick to download and quick
//     per frame, but it misses small objects badly, which shows up as broken
//     tracks and undercounting.
//
// Model weights are fetched from a public CDN; the video itself never leaves
// the machine.

import { groupFor } from './tracker';
import { containment, iou } from './geometry';

// Two boxes this close together, on the same kind of road user, are one object
// seen twice. RT-DETR is a DETR-family model with no built-in NMS, so nothing
// upstream removes these; left in, each duplicate becomes its own track and its
// own count.
const DUPLICATE_IOU = 0.6;
const DUPLICATE_CONTAINMENT = 0.8;

function isDuplicate(a, b) {
  return iou(a, b) > DUPLICATE_IOU || containment(a, b) > DUPLICATE_CONTAINMENT;
}

// Greedy non-maximum suppression, per group: walk the detections strongest
// first and drop any that mostly overlaps one already kept. Grouped rather than
// per-exact-class, because the same van is happily called `car` in one box and
// `truck` in the box on top of it.
function dedupeOverlapping(detections) {
  const kept = [];
  for (const det of [...detections].sort((a, b) => b.score - a.score)) {
    const duplicate = kept.some((k) => k.group === det.group && isDuplicate(k.box, det.box));
    if (!duplicate) kept.push(det);
  }
  return kept;
}

export const MODELS = [
  {
    value: 'rtdetr-r18',
    label: 'RT-DETR R18 — balanced',
    backend: 'rtdetr',
    repo: 'onnx-community/rtdetr_r18vd_coco_o365',
    note: '20 MB download. Much stronger on small and distant traffic than COCO-SSD. Uses WebGPU when available.',
  },
  {
    value: 'rtdetr-r50',
    label: 'RT-DETR R50 — most accurate',
    backend: 'rtdetr',
    repo: 'onnx-community/rtdetr_r50vd_coco_o365',
    note: '43 MB download and slower per frame, but the best detection here. Same family as R18 with a heavier backbone.',
  },
  {
    value: 'lite_mobilenet_v2',
    label: 'COCO-SSD lite — fastest',
    backend: 'cocossd',
    base: 'lite_mobilenet_v2',
    note: '5 MB download. Quickest per frame, but misses small or partly hidden objects.',
  },
  {
    value: 'mobilenet_v2',
    label: 'COCO-SSD MobileNet v2',
    backend: 'cocossd',
    base: 'mobilenet_v2',
    note: '25 MB download. A middle option.',
  },
];

export function modelConfig(id) {
  return MODELS.find((m) => m.value === id) || MODELS[0];
}

// Every model resizes its input to a fixed square internally — 640x640 for
// RT-DETR, 300x300 for COCO-SSD — so handing the detector a bigger frame buys
// nothing. Splitting the frame into tiles and detecting each one separately is
// what actually gives a distant cyclist more pixels to be found in.
export const TILINGS = [
  { value: 1, label: 'Whole frame', note: 'One pass per frame. Fastest.' },
  { value: 2, label: '2 × 2 tiles', note: 'Five passes per frame, so roughly 5× slower. Finds smaller, further traffic.' },
  { value: 3, label: '3 × 3 tiles', note: 'Ten passes per frame, so roughly 10× slower. For distant or high-angle footage.' },
];

// Tiles overlap so an object sitting on a seam is whole in at least one of
// them; the duplicate that creates is removed by the same NMS as everything else.
const TILE_OVERLAP = 0.15;
const WHOLE_FRAME = { x: 0, y: 0, w: 1, h: 1 };

function tileRegions(count) {
  if (count <= 1) return [WHOLE_FRAME];
  const regions = [WHOLE_FRAME]; // keeps objects too big for one tile
  const step = 1 / count;
  const pad = step * TILE_OVERLAP;
  for (let row = 0; row < count; row += 1) {
    for (let col = 0; col < count; col += 1) {
      const x = Math.max(0, col * step - pad);
      const y = Math.max(0, row * step - pad);
      const right = Math.min(1, (col + 1) * step + pad);
      const bottom = Math.min(1, (row + 1) * step + pad);
      regions.push({ x, y, w: right - x, h: bottom - y });
    }
  }
  return regions;
}

// RT-DETR's label set uses the older COCO names for a few classes.
const CLASS_ALIASES = {
  motorbike: 'motorcycle',
  aeroplane: 'airplane',
  sofa: 'couch',
  pottedplant: 'potted plant',
  diningtable: 'dining table',
  tvmonitor: 'tv',
};

function canonicalClass(label) {
  const name = String(label).toLowerCase();
  return CLASS_ALIASES[name] || name;
}

let cached = null;

async function loadTransformers(repo) {
  const { pipeline, env, RawImage } = await import('@huggingface/transformers');
  // Never look for weights on our own origin — they live on the Hub CDN.
  env.allowLocalModels = false;

  const useWebGpu = typeof navigator !== 'undefined' && 'gpu' in navigator;
  const device = useWebGpu ? 'webgpu' : 'wasm';
  // fp16 keeps WebGPU accurate and fast; on CPU the 8-bit weights are the only
  // way to keep per-frame time tolerable.
  const dtype = useWebGpu ? 'fp16' : 'q8';

  let pipe;
  try {
    pipe = await pipeline('object-detection', repo, { device, dtype });
  } catch (err) {
    if (!useWebGpu) throw err;
    // Some machines advertise WebGPU but fail to compile the graph.
    pipe = await pipeline('object-detection', repo, { device: 'wasm', dtype: 'q8' });
    return { pipe, RawImage, device: 'wasm' };
  }
  return { pipe, RawImage, device };
}

async function buildRtdetr(model) {
  const { pipe, RawImage, device } = await loadTransformers(model.repo);
  return {
    id: model.value,
    device,
    async detect(canvas, minScore) {
      const image = RawImage.fromCanvas(canvas);
      const found = await pipe(image, { threshold: minScore, percentage: true });
      // `percentage: true` gives boxes as fractions of the frame, which is
      // exactly what the caller wants to scale to output resolution.
      return found.map((d) => ({
        className: canonicalClass(d.label),
        score: d.score,
        box: [d.box.xmin, d.box.ymin, d.box.xmax - d.box.xmin, d.box.ymax - d.box.ymin],
      }));
    },
  };
}

async function buildCocoSsd(base) {
  const [tf, cocoSsd] = await Promise.all([
    import('@tensorflow/tfjs'),
    import('@tensorflow-models/coco-ssd'),
  ]);

  let device = 'webgl';
  try {
    await tf.setBackend('webgl');
  } catch {
    await tf.setBackend('cpu');
    device = 'cpu';
  }
  await tf.ready();

  const model = await cocoSsd.load({ base });
  return {
    id: base,
    device,
    async detect(canvas, minScore) {
      const found = await model.detect(canvas, 50, minScore);
      return found.map((d) => ({
        className: canonicalClass(d.class),
        score: d.score,
        box: [
          d.bbox[0] / canvas.width,
          d.bbox[1] / canvas.height,
          d.bbox[2] / canvas.width,
          d.bbox[3] / canvas.height,
        ],
      }));
    },
  };
}

export async function loadDetector(id) {
  if (cached && cached.id === id) return cached;
  const model = modelConfig(id);
  const detector = model.backend === 'rtdetr'
    ? await buildRtdetr(model)
    : await buildCocoSsd(model.base);
  cached = detector;
  return detector;
}

// Draws one region of the source frame into the scratch canvas at that canvas's
// full size, detects, and maps the boxes back to fractions of the whole frame.
// Cropping from `source` — the video element at its native resolution — is the
// point: a quarter of a 4K frame redrawn at 640px keeps detail that downscaling
// the whole frame throws away.
async function detectRegion(detector, source, scratch, region, minScore) {
  const sourceW = source.videoWidth || source.width;
  const sourceH = source.videoHeight || source.height;
  const ctx = scratch.getContext('2d');
  ctx.drawImage(
    source,
    region.x * sourceW, region.y * sourceH, region.w * sourceW, region.h * sourceH,
    0, 0, scratch.width, scratch.height,
  );

  const found = await detector.detect(scratch, minScore);
  return found.map((d) => ({
    className: d.className,
    score: d.score,
    box: [
      region.x + d.box[0] * region.w,
      region.y + d.box[1] * region.h,
      d.box[2] * region.w,
      d.box[3] * region.h,
    ],
  }));
}

/**
 * Detects in `source` (the video element) using `scratch` as the working canvas,
 * returning boxes in output-pixel coordinates.
 *
 * `minScore` is deliberately low: the tracker wants the weak detections too, to
 * hold a track together through a blurred or half-occluded frame. It applies
 * the user's real threshold itself when deciding what may start a new track.
 */
export async function detectFrame(detector, source, scratch, {
  width, height, minScore = 0.15, tiles = 1,
} = {}) {
  const regions = tileRegions(tiles);
  const found = [];
  for (const region of regions) {
    // Sequential on purpose: these all contend for the same GPU, and running
    // them at once only deepens the queue.
    found.push(...await detectRegion(detector, source, scratch, region, minScore));
  }

  const detections = found
    .map((d) => ({
      className: d.className,
      score: d.score,
      group: groupFor(d.className),
      box: [d.box[0] * width, d.box[1] * height, d.box[2] * width, d.box[3] * height],
    }))
    .filter((d) => d.group);

  // Also collapses the same object found in two overlapping tiles.
  return dedupeOverlapping(detections);
}
