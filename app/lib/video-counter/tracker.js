// Multi-object tracking + tripwire counting.
//
// The tracker is ByteTrack: a Kalman filter predicts where each track should be
// next, the Hungarian algorithm assigns detections to tracks optimally, and
// association runs in stages — confident detections first, then the weak ones
// that a plain threshold would have thrown away. Those weak detections are the
// whole point of ByteTrack: a car that dips to 0.3 confidence behind a pole
// keeps its track instead of dying and being reborn with a new identity.
//
// (Ultralytics' `model.track()` runs this same algorithm behind YOLO. The
// detector in front of it here is RT-DETR.)
//
// Counting sits on top: a track is counted the instant its centre crosses the
// user's vertical line, once, in the direction it crossed. A parked car never
// crosses, so it never counts.

import { solveAssignment, FORBIDDEN } from './assignment';
import { boxToMeasurement, initiate, measurementToBox, predict, update } from './kalman';
import { centreOf, containment, intersectionArea, iou } from './geometry';

export const GROUPS = [
  { key: 'vehicles', label: 'Vehicles', color: '#2f6f9f' },
  { key: 'bikes', label: 'Bikes', color: '#e8590c' },
  { key: 'pedestrians', label: 'Pedestrians', color: '#2e7d5b' },
];

// One run counts one pair of road users. Bikes and pedestrians are never
// counted together, because a cyclist is a `person` box sitting on a `bicycle`
// box and no amount of reconciliation makes that reliably one or the other.
// Split the passes and the ambiguity is gone: in bike mode people are not a
// category at all, so a rider can only ever be a bike.
export const MODES = [
  {
    value: 'bikes',
    label: 'Bikes & vehicles',
    groups: ['vehicles', 'bikes'],
    note: 'People on foot are ignored, so a rider always counts as a bike.',
  },
  {
    value: 'pedestrians',
    label: 'Pedestrians & vehicles',
    groups: ['vehicles', 'pedestrians'],
    note: 'Bicycles are not counted. Riders can be excluded from the pedestrian tally below.',
  },
];

const GROUP_BY_CLASS = {
  car: 'vehicles',
  truck: 'vehicles',
  bus: 'vehicles',
  motorcycle: 'vehicles',
  bicycle: 'bikes',
  person: 'pedestrians',
};

const RIDDEN_CLASSES = new Set(['bicycle', 'motorcycle']);

export function groupFor(className) {
  return GROUP_BY_CLASS[className] || null;
}

export function modeConfig(mode) {
  return MODES.find((m) => m.value === mode) || MODES[0];
}

export function groupsForMode(mode) {
  const keys = modeConfig(mode).groups;
  return GROUPS.filter((g) => keys.includes(g.key));
}

export function emptyCounts(mode) {
  const counts = {};
  for (const g of groupsForMode(mode)) counts[g.key] = { right: 0, left: 0 };
  return counts;
}

export function totalOf(count) {
  return count.right + count.left;
}

function looksLikeRider(personBox, bikeBox) {
  if (!intersectionArea(personBox, bikeBox)) return false;
  const cover = containment(personBox, bikeBox);
  if (cover > 0.3) return true;
  const [bx, by] = centreOf(bikeBox);
  const inside =
    bx > personBox[0] && bx < personBox[0] + personBox[2] &&
    by > personBox[1] && by < personBox[1] + personBox[3];
  return inside && cover > 0.15;
}


function topVote(votes) {
  let best = null;
  let bestCount = -1;
  for (const [key, count] of Object.entries(votes)) {
    if (count > bestCount) {
      best = key;
      bestCount = count;
    }
  }
  return best;
}

export function createTracker(options = {}) {
  const {
    fps = 10,
    // Detections at or above this may start a track; weaker ones only keep
    // existing tracks alive.
    scoreThreshold = 0.45,
    mode = 'bikes',
    // Pedestrian mode only: drop the person box of someone riding past.
    excludeRiders = true,
    // Confirmations needed before a track is drawn or may be counted.
    minHits = 2,
  } = options;

  const countedGroups = new Set(modeConfig(mode).groups);

  // ByteTrack's defaults assume 30 fps. We sample far slower, so a track is
  // kept for a comparable *duration* rather than a fixed frame count.
  const maxAge = Math.max(5, Math.round(fps * 1.5));
  const coastDrawFrames = Math.max(2, Math.round(fps * 0.4));
  // How long a counted box stays ticked and shaded: a fixed frame count would
  // flash by at 15 fps and linger at 4, so hold it for ~0.6s of video either way.
  const flashFrames = Math.max(3, Math.round(fps * 0.6));

  let nextId = 1;
  let tracks = [];
  let frame = 0;
  const counts = emptyCounts(mode);

  function newTrack(det) {
    const kf = initiate(boxToMeasurement(det.box));
    const [cx, cy] = centreOf(det.box);
    return {
      id: nextId++,
      kf,
      box: det.box,
      displayBox: det.box.slice(),
      predictedBox: det.box,
      cx, cy,
      group: det.group,
      className: det.className,
      classVotes: { [det.className]: 1 },
      score: det.score,
      state: 'tentative',
      hits: 1,
      misses: 0,
      // Set only by this track's own crossing, at the same moment the tally
      // moves and the tick is drawn. Nothing else may set it, and nothing may
      // block a track from reaching it.
      counted: false,
      direction: null,
      countedAtFrame: -1,
      suppressed: false,
    };
  }

  function checkCrossing(track, prevX, prevY, line) {
    if (track.counted || !line || track.hits < minHits) return;
    const { x, y1, y2 } = line;
    const wasLeft = prevX < x;
    if (wasLeft === (track.cx < x)) return;

    // Where along the line it crossed: outside the trimmed segment (the far
    // sidewalk, a parking lot) it doesn't count.
    const span = track.cx - prevX;
    const ratio = span === 0 ? 0 : (x - prevX) / span;
    const yAt = prevY + (track.cy - prevY) * ratio;
    if (yAt < Math.min(y1, y2) || yAt > Math.max(y1, y2)) return;

    if (!counts[track.group]) return;

    track.counted = true;
    track.direction = wasLeft ? 'right' : 'left';
    track.countedAtFrame = frame;
    counts[track.group][track.direction] += 1;
  }

  function absorb(track, det, line) {
    const prevX = track.cx;
    const prevY = track.cy;

    update(track.kf, boxToMeasurement(det.box));
    track.box = measurementToBox(track.kf.mean);
    track.displayBox = track.displayBox
      ? track.displayBox.map((v, i) => v + (track.box[i] - v) * 0.65)
      : track.box.slice();

    // Crossings are judged on the box that is actually drawn, not on the
    // filter's internal estimate. The two are not the same point: the posterior
    // sits between the prediction and the measurement, so on a fast vehicle it
    // runs ahead of the smoothed box on screen — and the tick would appear
    // while the box was still short of the line.
    [track.cx, track.cy] = centreOf(track.displayBox);
    track.score = det.score;
    track.hits += 1;
    track.misses = 0;
    track.state = track.hits >= minHits ? 'tracked' : 'tentative';

    // The label is a running vote, so one odd frame calling a car a truck
    // doesn't relabel the whole track. The *group* can't change: association is
    // same-group only, which is what makes a track's category final.
    track.classVotes[det.className] = (track.classVotes[det.className] || 0) + 1;
    track.className = topVote(track.classVotes);

    checkCrossing(track, prevX, prevY, line);
  }

  // Cost is 1 - similarity. Plain IoU is ByteTrack's metric, but it assumes
  // 30 fps; at 4-15 fps a correct pair can have zero overlap, so proximity
  // relative to object size backs it up.
  function costMatrix(candidates, dets) {
    return candidates.map((track) => dets.map((det) => {
      // Strictly same-group. With bikes and pedestrians never in the same run,
      // there is no longer any legitimate reason to match across categories.
      if (track.group !== det.group) return FORBIDDEN;
      const overlap = iou(track.predictedBox, det.box);
      const [tcx, tcy] = centreOf(track.predictedBox);
      const [dcx, dcy] = centreOf(det.box);
      const size = Math.max(track.predictedBox[2], track.predictedBox[3], det.box[2], det.box[3]) || 1;
      // How far the object is expected to have travelled. A car at city speed
      // sampled at 10 fps moves most of its own length between frames, so a
      // gate based on size alone loses it, restarts the track, and leaves the
      // old one free to latch onto something across the road.
      const speed = Math.hypot(track.kf.mean[4], track.kf.mean[5]);
      // A one-hit track has no velocity estimate yet, so it gets room to make
      // that first jump on size alone.
      const spread = track.hits < 2 ? 2.2 : 1.4;
      // Widen while coasting — the longer unseen, the less certain the
      // prediction — but cap it, or a stale track reaches clear across the frame.
      const reach = (size * spread + speed * 1.3) * (1 + Math.min(track.misses, 3) * 0.5);
      const proximity = Math.max(0, 1 - Math.hypot(dcx - tcx, dcy - tcy) / reach);
      return 1 - Math.max(overlap, proximity * 0.85);
    }));
  }

  function matchStage(candidates, dets, maxCost, line, claimedTracks, claimedDets) {
    const pendingTracks = candidates.filter((t) => !claimedTracks.has(t));
    const pendingDets = dets.filter((d) => !claimedDets.has(d));
    if (!pendingTracks.length || !pendingDets.length) return;

    const pairs = solveAssignment(costMatrix(pendingTracks, pendingDets), maxCost);
    for (const [row, col] of pairs) {
      const track = pendingTracks[row];
      const det = pendingDets[col];
      claimedTracks.add(track);
      claimedDets.add(det);
      absorb(track, det, line);
    }
  }

  // Reduce the frame to the two categories this run counts.
  //
  // In bike mode people simply aren't a category, so a rider is only ever a
  // bike and nothing needs reconciling. In pedestrian mode bicycles aren't
  // counted either, but they are still read off this frame — a bike box is the
  // one reliable signal that the person on top of it is riding, not walking.
  function prepare(detections) {
    if (mode === 'pedestrians' && excludeRiders) {
      const ridden = detections.filter((d) => RIDDEN_CLASSES.has(d.className)).map((d) => d.box);
      if (ridden.length) {
        detections = detections.filter((d) =>
          d.className !== 'person' || !ridden.some((bike) => looksLikeRider(d.box, bike)));
      }
    }
    return detections.filter((d) => countedGroups.has(d.group));
  }

  function update_(rawDetections, line) {
    frame += 1;
    const detections = prepare(rawDetections);

    const active = tracks.filter((t) => !t.suppressed);
    for (const t of active) {
      predict(t.kf);
      t.predictedBox = measurementToBox(t.kf.mean);
    }

    const strong = detections.filter((d) => d.score >= scoreThreshold);
    const weak = detections.filter((d) => d.score < scoreThreshold);
    const confirmed = active.filter((t) => t.state !== 'tentative');
    const tentative = active.filter((t) => t.state === 'tentative');

    const claimedTracks = new Set();
    const claimedDets = new Set();

    // 1. Confirmed tracks against confident detections.
    matchStage(confirmed, strong, 0.8, line, claimedTracks, claimedDets);
    // 2. Whatever is left of them against the weak detections — the ByteTrack
    //    step that carries a track through a bad frame.
    matchStage(confirmed, weak, 0.5, line, claimedTracks, claimedDets);
    // 3. New, unconfirmed tracks only get the confident leftovers.
    matchStage(tentative, strong, 0.7, line, claimedTracks, claimedDets);

    for (const det of strong) {
      if (!claimedDets.has(det)) tracks.push(newTrack(det));
    }

    for (const t of active) {
      if (claimedTracks.has(t)) continue;
      t.misses += 1;
      // An unconfirmed track that misses even once was probably noise.
      t.state = t.state === 'tentative' ? 'dead' : 'lost';
    }


    tracks = tracks.filter((t) => !t.suppressed && t.state !== 'dead' && t.misses <= maxAge);
    return tracks;
  }

  return {
    update: update_,
    counts,
    coastDrawFrames,
    flashFrames,
    get tracks() {
      return tracks;
    },
    get frame() {
      return frame;
    },
  };
}
