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
import { areaOf, centreOf, containment, intersectionArea, iou } from './geometry';

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

// Weight of the direction term in association. OC-SORT's default.
const MOMENTUM_WEIGHT = 0.2;

// Most a detection's area may differ from the track's and still be considered
// the same object. Four times the area is twice the width and height — far more
// than a vehicle changes between two sampled frames.
const MAX_AREA_JUMP = 4;

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
    // Frame width, used to bound how far a track may reach in absolute terms.
    frameWidth = 1280,
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
  // Nothing legitimately moves this far across the frame between two sampled
  // frames, so no amount of box size or velocity may buy a longer reach.
  const maxReach = frameWidth * 0.2;

  let nextId = 1;
  let tracks = [];
  let frame = 0;
  const counts = emptyCounts(mode);

  // ---- Diagnostics --------------------------------------------------------
  // Every track's observed path is kept, including tracks that died, so a run
  // can be asked afterwards: which objects were seen on both sides of the line
  // and still didn't count, and what stopped them.
  const journal = new Map();

  function record(track) {
    let entry = journal.get(track.id);
    if (!entry) {
      entry = {
        id: track.id,
        group: track.group,
        className: track.className,
        firstFrame: frame,
        lastFrame: frame,
        frames: [],
        xs: [],
        ys: [],
        widths: [],
        hits: 0,
        counted: false,
        direction: null,
        countedAtFrame: null,
        rejects: {},
      };
      journal.set(track.id, entry);
    }
    return entry;
  }

  function note(track, reason, extra) {
    const entry = record(track);
    entry.rejects[reason] = (entry.rejects[reason] || 0) + 1;
    if (extra) entry.last = { reason, frame, ...extra };
    if (reason === 'counted') {
      entry.counted = true;
      entry.countedTimes = track.countedTimes;
      entry.direction = track.direction;
      entry.countedAtFrame = frame;
      (entry.countedAtFrames = entry.countedAtFrames || []).push(frame);
    }
  }

  function newTrack(det) {
    const kf = initiate(boxToMeasurement(det.box));
    const [cx, cy] = centreOf(det.box);
    return {
      id: nextId++,
      kf,
      obsX: cx,
      obsY: cy,
      prevObsX: null,
      prevObsY: null,
      lastObsBox: det.box,
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
      countedTimes: 0,
      // Cleared on counting, restored once the track has travelled a clear
      // margin away from the line. A tripwire counts every genuine crossing;
      // the margin is what stops something loitering on the line from counting
      // over and over.
      armed: true,
      direction: null,
      countedAtFrame: -1,
      suppressed: false,
    };
  }

  // A crossing is the box's centre passing the line, full stop.
  //
  // This briefly took an adjustable reference point that slid toward the box's
  // leading edge. It was withdrawn because the offset was recomputed from the
  // current box width each frame, so when a detector box doubled in size the
  // reference lurched clear over the line between two checks and the crossing
  // vanished. Anything reintroducing an offset here has to carry it forward
  // between checks so the reference path stays continuous.
  function checkCrossing(track, prevX, prevY, line) {
    const from = prevX;
    const to = track.cx;

    if (!line) return note(track, 'no-line');
    if (track.hits < minHits) return note(track, 'too-few-hits');
    const { x, y1, y2 } = line;

    // A track that has just counted must clear the line by a real margin before
    // it may count again. Without this an object idling on the line would tick
    // on every jitter; with it, a vehicle that genuinely comes back through is
    // counted again, as a tripwire should.
    if (!track.armed) {
      const margin = Math.max(track.displayBox[2] * 0.75, frameWidth * 0.04);
      if (Math.abs(track.cx - x) <= margin) return note(track, 'awaiting-rearm');
      track.armed = true;
    }

    const wasLeft = from < x;
    // The ordinary case on almost every frame: the track simply didn't change
    // sides between these two observations.
    if (wasLeft === (to < x)) return note(track, 'no-side-change');

    // Where along the line it crossed: outside the trimmed segment (the far
    // sidewalk, a parking lot) it doesn't count.
    const span = to - from;
    const ratio = span === 0 ? 0 : (x - from) / span;
    const yAt = prevY + (track.cy - prevY) * ratio;
    if (yAt < Math.min(y1, y2) || yAt > Math.max(y1, y2)) {
      return note(track, 'outside-segment', { yAt: Math.round(yAt) });
    }

    if (!counts[track.group]) return note(track, 'group-not-counted');

    track.counted = true;
    track.countedTimes += 1;
    track.armed = false;
    track.direction = wasLeft ? 'right' : 'left';
    track.countedAtFrame = frame;
    counts[track.group][track.direction] += 1;
    note(track, 'counted');
  }

  function absorb(track, det, line) {
    const prevX = track.cx;
    const prevY = track.cy;

    // NB: OC-SORT's observation-centric re-update belongs here, rebuilding the
    // gap as virtual observations. Doing it correctly means replaying the
    // filter *from* a snapshot taken at the last real observation — feeding
    // virtual observations into a state that has already been predicted forward
    // across the gap drags it backwards and measurably wrecks both position and
    // velocity. Left out until it can be done from a snapshot.
    update(track.kf, boxToMeasurement(det.box));

    // Observation history drives the direction term in association; it is kept
    // separate from the filter's estimate, which is the whole point of an
    // observation-centric tracker.
    const [obsX, obsY] = centreOf(det.box);
    track.prevObsX = track.obsX;
    track.prevObsY = track.obsY;
    track.obsX = obsX;
    track.obsY = obsY;
    track.lastObsBox = det.box;
    track.box = measurementToBox(track.kf.mean);
    // Light smoothing only. The Kalman posterior is already smooth, so a heavy
    // blend here buys little and costs lag — and since crossings are judged on
    // this box, that lag ate into the sensitivity setting, leaving "halfway
    // over" firing later than it claims.
    track.displayBox = track.displayBox
      ? track.displayBox.map((v, i) => v + (track.box[i] - v) * 0.85)
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

    const entry = record(track);
    entry.lastFrame = frame;
    entry.hits = track.hits;
    entry.className = track.className;
    entry.frames.push(frame);
    entry.xs.push(Math.round(track.cx));
    entry.ys.push(Math.round(track.cy));
    entry.widths.push(Math.round(track.displayBox[2]));

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

      // Objects grow and shrink gradually as they approach or recede. A
      // detection several times the track's area is a different object, and
      // matching it is exactly how one identity ends up straddling a distant
      // bicycle and a close-up truck in consecutive frames — box widths walking
      // 34 -> 441 -> 16 while the track drifts across the road. Coasting tracks
      // get some slack, since the object really may have grown while unseen.
      const areaRatio = areaOf(det.box) / Math.max(areaOf(track.predictedBox), 1);
      const sizeLimit = MAX_AREA_JUMP * (1 + Math.min(track.misses, 3) * 0.5);
      if (areaRatio > sizeLimit || areaRatio < 1 / sizeLimit) return FORBIDDEN;

      const overlap = iou(track.predictedBox, det.box);
      const [tcx, tcy] = centreOf(track.predictedBox);
      const [dcx, dcy] = centreOf(det.box);
      const size = Math.max(track.predictedBox[2], track.predictedBox[3], det.box[2], det.box[3]) || 1;
      // How far the object is expected to have travelled. A car at city speed
      // sampled at 10 fps moves most of its own length between frames, so a
      // gate based on size alone loses it, restarts the track, and leaves the
      // old one free to latch onto something across the road.
      // Capped, and deliberately so: a track that has jumped to the wrong
      // object carries a wild velocity, which would widen its own search radius
      // and let it jump further still. Left uncapped that feedback loop lets one
      // identity wander the entire frame, absorbing vehicle after vehicle.
      const speed = Math.min(Math.hypot(track.kf.mean[4], track.kf.mean[5]), size * 1.5);
      // A one-hit track has no velocity estimate yet, so it gets room to make
      // that first jump on size alone.
      const spread = track.hits < 2 ? 2.2 : 1.4;
      // Widen while coasting — the longer unseen, the less certain the
      // prediction — but cap it, or a stale track reaches clear across the frame.
      // The absolute ceiling matters as much as the relative one: an oversized
      // detection would otherwise buy a track a reach of several hundred pixels
      // and let it hop between unrelated vehicles.
      const reach = Math.min(
        (size * spread + speed * 1.3) * (1 + Math.min(track.misses, 3) * 0.5),
        maxReach * (1 + Math.min(track.misses, 3) * 0.3),
      );
      const proximity = Math.max(0, 1 - Math.hypot(dcx - tcx, dcy - tcy) / reach);
      return 1 - Math.max(overlap, proximity * 0.85);
    }));
  }

  // Observation-centric momentum (OC-SORT): prefer the detection that continues
  // the direction the track has actually been observed travelling. This is what
  // keeps two vehicles passing each other from swapping identities — geometry
  // alone can't tell them apart at the moment they overlap, but their headings
  // can. Applied only as a tie-breaker, never as a gate, so it can never reject
  // a track's only candidate.
  function momentumPenalty(track, det) {
    if (track.prevObsX == null) return 0;
    const trackDx = track.obsX - track.prevObsX;
    const trackDy = track.obsY - track.prevObsY;
    const speed = Math.hypot(trackDx, trackDy);
    const size = Math.max(track.box[2], track.box[3]) || 1;
    // Direction is noise for something barely moving.
    if (speed < size * 0.08) return 0;

    const [detX, detY] = centreOf(det.box);
    const candDx = detX - track.obsX;
    const candDy = detY - track.obsY;
    const candDist = Math.hypot(candDx, candDy);
    if (candDist < 1e-6) return 0;

    const cosine = (trackDx * candDx + trackDy * candDy) / (speed * candDist);
    return MOMENTUM_WEIGHT * (1 - cosine) / 2;
  }

  function matchStage(candidates, dets, maxCost, line, claimedTracks, claimedDets) {
    const pendingTracks = candidates.filter((t) => !claimedTracks.has(t));
    const pendingDets = dets.filter((d) => !claimedDets.has(d));
    if (!pendingTracks.length || !pendingDets.length) return;

    // Assignment runs on the momentum-biased cost; the accept/reject threshold
    // is applied to the plain geometric cost, so direction decides *which*
    // pairing wins without changing what counts as reachable at all.
    const base = costMatrix(pendingTracks, pendingDets);
    const biased = base.map((row, r) => row.map((cost, c) => (
      cost >= FORBIDDEN ? cost : cost + momentumPenalty(pendingTracks[r], pendingDets[c])
    )));

    const pairs = solveAssignment(biased, Infinity);
    for (const [row, col] of pairs) {
      if (base[row][col] > maxCost || base[row][col] >= FORBIDDEN) continue;
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
      if (claimedDets.has(det)) continue;
      const born = newTrack(det);
      tracks.push(born);
      // Logged at birth, not at first match: a track that spawns and dies
      // without ever being matched again is exactly the churn worth seeing, and
      // it would otherwise leave no trace at all.
      const entry = record(born);
      entry.frames.push(frame);
      entry.xs.push(Math.round(born.cx));
      entry.ys.push(Math.round(born.cy));
      entry.widths.push(Math.round(born.box[2]));
      entry.hits = 1;
    }

    for (const t of active) {
      if (claimedTracks.has(t)) continue;
      t.misses += 1;
      // An unconfirmed track that misses even once was probably noise.
      t.state = t.state === 'tentative' ? 'dead' : 'lost';
    }

    const survivors = [];
    for (const t of tracks) {
      if (t.suppressed || t.state === 'dead' || t.misses > maxAge) {
        note(t, t.state === 'dead' ? 'died-unconfirmed' : 'died-after-gap');
        continue;
      }
      survivors.push(t);
    }
    tracks = survivors;
    return tracks;
  }

  // Splits every track into counted, missed (seen both sides of the line but
  // never counted — the interesting ones), and the rest that never went near it.
  function report(line) {
    const entries = [...journal.values()];
    const spansLine = (e) => line && e.xs.length > 1
      && Math.min(...e.xs) < line.x && Math.max(...e.xs) > line.x;

    const missed = entries.filter((e) => spansLine(e) && !e.counted);
    const counted = entries.filter((e) => e.counted);

    return {
      line,
      totals: {
        frames: frame,
        tracks: entries.length,
        counted: counted.length,
        seenBothSidesButNotCounted: missed.length,
        neverNearLine: entries.length - missed.length - counted.length,
        // High churn shows up here: lots of tracks that never got a second
        // observation, or that died unconfirmed, means identities are being
        // rebuilt constantly and crossings fall through the gap.
        singleObservationTracks: entries.filter((e) => e.xs.length === 1).length,
        diedUnconfirmed: entries.filter((e) => e.rejects['died-unconfirmed']).length,
        diedAfterGap: entries.filter((e) => e.rejects['died-after-gap']).length,
      },
      counts,
      missed: missed.map((e) => ({
        ...e,
        // Gaps in this sequence are frames where the track existed but was not
        // matched to a detection.
        observedOverFrames: `${e.firstFrame}-${e.lastFrame}`,
        observations: e.xs.length,
      })),
      // Everything else, in full. These are the short-lived fragments — a track
      // that covered an object up to the line, died, and left a fresh track to
      // pick the same object up beyond it. Neither half ever sees both sides, so
      // the crossing is lost while the box on screen looks unbroken.
      others: entries
        .filter((e) => !e.counted && !spansLine(e))
        .map((e) => ({
          ...e,
          observedOverFrames: `${e.firstFrame}-${e.lastFrame}`,
          observations: e.xs.length,
          endedNearLine: line ? Math.abs(e.xs[e.xs.length - 1] - line.x) : null,
          startedNearLine: line ? Math.abs(e.xs[0] - line.x) : null,
        })),
      counted: counted.map((e) => ({
        id: e.id, className: e.className, group: e.group, direction: e.direction,
        countedAtFrame: e.countedAtFrame, countedTimes: e.countedTimes || 1,
        countedAtFrames: e.countedAtFrames, observations: e.xs.length,
        observedOverFrames: `${e.firstFrame}-${e.lastFrame}`,
        // Frame numbers as well as positions: without them there is no way to
        // tell how many identities were live at any moment, which is what
        // exposes tracks being handed from object to object.
        frames: e.frames, xs: e.xs, ys: e.ys, widths: e.widths, rejects: e.rejects,
      })),
    };
  }

  return {
    update: update_,
    counts,
    report,
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
