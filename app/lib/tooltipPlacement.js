// tooltipPlacement.js
//
// Where a chart tooltip's box sits vertically. Recharts offers the box to the
// hovered point and then clamps only its *top* to the plot area, so a box with
// more rows than there is room below the point keeps growing down past the
// bottom axis and out of the chart. These rules place it instead; see
// chartTooltipFrame.js for how a chart hands the placement over.

// Matches the Recharts `offset` default, so the gap the box keeps from the
// point (and from the plot area) is the one the charts already had.
export const TOOLTIP_GAP = 10;

/**
 * The top of the tooltip box, in the chart container's coordinates.
 *
 * `point` follows the hovered point, flipping above it when the room below runs
 * out and — the case Recharts gets wrong — resting on the bottom axis and
 * starting higher when the box is taller than the plot area. `above` parks the
 * box over the plot area entirely, clear of the bars it describes.
 *
 * `ceiling` is how far above the chart the box may reach before an ancestor
 * clips it; a box that would start higher than that stops there instead.
 */
export function tooltipTop({ placement, pointY, plotTop, plotBottom, height, ceiling = -Infinity }) {
  if (placement === 'above') {
    return Math.max(plotTop - TOOLTIP_GAP - height, ceiling);
  }

  // Below the point unless that overflows, then above it.
  let y = pointY + TOOLTIP_GAP;
  if (y + height > plotBottom) y = pointY - height - TOOLTIP_GAP;
  // Flipping above the point can overshoot the plot; start at the top instead.
  if (y < plotTop) y = plotTop;
  // Taller than the plot even so: sit it on the bottom axis and let it start
  // higher rather than run off the bottom of the chart.
  if (y + height > plotBottom) y = plotBottom - height;

  return Math.max(y, ceiling);
}
