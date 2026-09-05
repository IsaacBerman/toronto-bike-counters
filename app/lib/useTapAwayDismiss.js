// useTapAwayDismiss.js
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Recharts only clears a tooltip when the pointer leaves the chart, and a touch
 * screen never fires that leave event: tapping somewhere else on the page leaves
 * the tooltip stuck open. This watches for taps that land away from the chart
 * and forces the tooltip closed until the finger comes back to it.
 *
 * Returns a ref for the element wrapping the chart, the value to hand to
 * <Tooltip active={...}> (undefined leaves Recharts in charge), and a handler to
 * wire into the chart's own move events so touching the chart brings it back.
 */
export default function useTapAwayDismiss() {
  const chartRef = useRef(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const handlePointerDown = (event) => {
      // Mouse users already get a mouseleave once they move off the chart.
      if (event.pointerType === 'mouse') return;

      const target = event.target;
      if (typeof target?.closest !== 'function') return;

      const wrapper = target.closest('.recharts-wrapper');
      const onChart =
        wrapper != null &&
        chartRef.current != null &&
        chartRef.current.contains(wrapper) &&
        // The mobile tooltip floats over the page, so a tap on it counts as away.
        target.closest('.recharts-tooltip-wrapper') == null;

      if (!onChart) {
        setDismissed(true);
      }
    };

    // Capture, so a handler that stops propagation can't hide the tap from us.
    document.addEventListener('pointerdown', handlePointerDown, true);
    return () => document.removeEventListener('pointerdown', handlePointerDown, true);
  }, []);

  /**
   * Recharts updates its own active point before it calls the chart's move
   * handlers, so restoring the tooltip from there shows the point that was just
   * touched rather than the stale one from before the tap away.
   */
  const restoreTooltip = useCallback(() => setDismissed(false), []);

  return { chartRef, tooltipActive: dismissed ? false : undefined, restoreTooltip };
}
