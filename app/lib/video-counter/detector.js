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

const RTDETR_REPO = 'onnx-community/rtdetr_r18vd_coco_o365';

export const MODELS = [
  {
    value: 'rtdetr',
    label: 'RT-DETR R18 — most accurate',
    note: '20 MB download. Much stronger on small and distant traffic. Uses WebGPU when available.',
  },
  {
    value: 'lite_mobilenet_v2',
    label: 'COCO-SSD lite — fastest',
    note: '5 MB download. Quickest per frame, but misses small or partly hidden objects.',
  },
  {
    value: 'mobilenet_v2',
    label: 'COCO-SSD MobileNet v2',
    note: '25 MB download. A middle option.',
  },
];

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

async function loadTransformers() {
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
    pipe = await pipeline('object-detection', RTDETR_REPO, { device, dtype });
  } catch (err) {
    if (!useWebGpu) throw err;
    // Some machines advertise WebGPU but fail to compile the graph.
    pipe = await pipeline('object-detection', RTDETR_REPO, { device: 'wasm', dtype: 'q8' });
    return { pipe, RawImage, device: 'wasm' };
  }
  return { pipe, RawImage, device };
}

async function buildRtdetr() {
  const { pipe, RawImage, device } = await loadTransformers();
  return {
    id: 'rtdetr',
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
  const detector = id === 'rtdetr' ? await buildRtdetr() : await buildCocoSsd(id);
  cached = detector;
  return detector;
}

/**
 * Runs the detector on `canvas` and returns boxes in output-pixel coordinates.
 *
 * `minScore` is deliberately low: the tracker wants the weak detections too, to
 * hold a track together through a blurred or half-occluded frame. It applies
 * the user's real threshold itself when deciding what may start a new track.
 */
export async function detectFrame(detector, canvas, { width, height, minScore = 0.15 } = {}) {
  const found = await detector.detect(canvas, minScore);

  const detections = found
    .map((d) => ({
      className: d.className,
      score: d.score,
      group: groupFor(d.className),
      box: [d.box[0] * width, d.box[1] * height, d.box[2] * width, d.box[3] * height],
    }))
    .filter((d) => d.group);

  return dedupeOverlapping(detections);
}
