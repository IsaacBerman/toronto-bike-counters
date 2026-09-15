// chartTooltipFrame.js
'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import { usePlotArea } from 'recharts';
import { tooltipTop } from '../lib/tooltipPlacement';

// Vertical placement for a chart tooltip. A chart opting in pins the Recharts
// wrapper at y=0 (`position={{ y: 0 }}` on Tooltip — x is left to Recharts,
// which still flips the box to whichever side of the point has room) and wraps
// its tooltip content in this, which offsets the box to where
// lib/tooltipPlacement.js wants it. Recharts measures the wrapper, and a
// transform on a child does not move its parent's box, so the width Recharts
// flips on stays the real one.

export default function ChartTooltipFrame({ coordinate, placement = 'point', children }) {
  const plotArea = usePlotArea();
  const nodeRef = useRef(null);
  const [height, setHeight] = useState(0);
  // How far above the chart the box may reach before something clips it.
  // -Infinity until measured, which is the same as "nothing known to clip it".
  const [ceiling, setCeiling] = useState(-Infinity);

  // No dependency array: the box changes height whenever its rows change, and
  // every such change comes with a render. Recharts keeps the wrapper hidden
  // until it has measured it too, so the unmeasured first frame never paints.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const node = nodeRef.current;
    if (!node) return;
    const measured = node.getBoundingClientRect().height;
    setHeight(prev => (Math.abs(prev - measured) > 1 ? measured : prev));
  });

  useLayoutEffect(() => {
    const node = nodeRef.current;
    const root = node && node.closest('.recharts-wrapper');
    if (!root) return;
    let clip = root.parentElement;
    while (clip && clip !== document.body && getComputedStyle(clip).overflowY === 'visible') {
      clip = clip.parentElement;
    }
    const clipTop = clip && clip !== document.body ? clip.getBoundingClientRect().top : 0;
    setCeiling(clipTop - root.getBoundingClientRect().top + 4);
  }, []);

  const y = plotArea && coordinate
    ? tooltipTop({
        placement,
        pointY: coordinate.y,
        plotTop: plotArea.y,
        plotBottom: plotArea.y + plotArea.height,
        height,
        ceiling,
      })
    : 0;

  return (
    <div
      ref={nodeRef}
      className="chart-tooltip-frame"
      style={{ transform: `translateY(${Math.round(y)}px)` }}
    >
      {children}
    </div>
  );
}
