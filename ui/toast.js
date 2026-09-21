// Traverse — toast notifications + the submission status card.
//
// Visual language: the "chroma sweep" — an exact reproduction of the sidepanel
// footer wordmark animation ([data-chroma-id="footer-traverse"]). The footer
// paints its glyphs from a 300%-sized gradient whose middle third is the chroma
// band (baby pink -> crimson -> amber gold -> ice white -> cobalt) flanked by
// the resting grey; sliding the background across carries the band through the
// glyphs while a subtle blur(1px) -> blur(0) resolves to sharp.
//
// The toast version reproduces that construction on one SVG glyph filling the
// card edge to edge — no text. The glyph is the resting grey plus a masked
// gradient rect (same stops, same proportions: the band is one full glyph tall
// inside a 3x-tall rect, so the grey flanks keep the glyph visible between
// passes). Each pass is a slow 2.6s ease-in-out travel with the same 1px blur,
// then a 2.2s rest, forever. The band travels top -> bottom while the judge
// runs and bottom -> top once the verdict is in.
//
// Morphs are REAL shape morphs, not crossfades. Every glyph is a single closed
// contour with the same point count, the same winding and the same start point,
// so the outline itself interpolates from one shape into the next — and since
// the chroma band is masked by that same path (the mask path is driven by an
// identical animation), the sweep keeps running through the shape as it
// changes. A short blur peak rides along to smooth the in-between frames.
//
// Submission flow:
//   judging   down arrow,     sweep down  (submit clicked, waiting for verdict)
//   accepted  tick,           sweep up    (verdict accepted — always plays)
//   syncing   up arrow,       sweep up    (pushing to the backend)
//   synced    Traverse mark,  one diagonal pass (bottom-left -> top-right);
//                             as soon as the chroma has crossed the mark the
//                             whole popup fades away fast
//   failed    small red cross + truncated error + copy-error button
//
// Checkpoints (verdict / sync result) may interrupt a resting sweep at any
// time, but morphs are atomic: a morph in flight always runs to completion
// before the next one starts, so an instantly successful sync still plays
// arrow -> tick -> arrow -> Traverse mark in full, each morph uncut.
//
// The card also owns the corner the timer pill lives in. A submission does not
// stack a popup next to the pill — the pill hands its box over and the card
// grows out of it (see the hand-off section below). A failed submission runs
// that in reverse: the cross rests, then the whole card scales back down into
// the pill it came from.
//
// Exposed as `window.LeetFeedbackToast` and `T.LeetFeedbackToast` (the adapters
// and the submission pipeline look the global up by that name).

(function () {
  'use strict';

  const T = (globalThis.Traverse = globalThis.Traverse || {});
  const logger = T.createLogger ? T.createLogger('toast') : { log() {} };

  /* ── chroma sweep ──────────────────────────────────────────────────────── */

  // Resting glyph shade — the flanks of the footer gradient, where the
  // wordmark settles after its sweep.
  const RESTING_GREY = '#8C8C8C';

  // The chroma band, exact stops from the sidepanel footer wordmark gradient
  // ([data-chroma-id="footer-traverse"]), hex for rgb(). The band occupies
  // 40%–60% of the 300% background, flanked by the resting grey (footer uses
  // rgba(255,255,255,0.1) text-fill + transparent; here the flanks are the
  // resting grey so the glyph stays visible as the band passes through).
  const CHROMA_BAND = [
    [40, '#FFB6C1'], // baby pink   (footer: rgb(255, 182, 193))
    [45, '#F02832'], // crimson     (footer: rgb(240, 40, 50))
    [50, '#FFBE14'], // amber gold  (footer: rgb(255, 190, 20))
    [55, '#EBEBFF'], // ice white   (footer: rgb(235, 235, 255))
    [60, '#145AE6'], // cobalt blue (footer: rgb(20, 90, 230))
  ];

  /** Gradient stop list for one travel direction (pink always leads the band). */
  function chromaStops(pinkLeadsDown) {
    const band = pinkLeadsDown
      ? CHROMA_BAND
      : CHROMA_BAND.slice().reverse().map((s) => [100 - s[0], s[1]]);
    const stops = [[0, RESTING_GREY], [33.33, RESTING_GREY]].concat(band, [
      [66.67, RESTING_GREY],
      [100, RESTING_GREY],
    ]);
    return stops.map((s) => '<stop offset="' + s[0] + '%" stop-color="' + s[1] + '"/>').join('');
  }

  // Sweep timing: the footer sweep, slowed for the toast — the band drifts
  // through the glyph, then rests before the next pass. SWEEP_PCT is the
  // keyframe share of the travel inside the cycle.
  const SWEEP_TRAVEL_S = 2.6;
  const SWEEP_REST_S = 2.2;
  const SWEEP_CYCLE_S = SWEEP_TRAVEL_S + SWEEP_REST_S;
  const SWEEP_PCT = Math.round((SWEEP_TRAVEL_S / SWEEP_CYCLE_S) * 1000) / 10;
  // The closing diagonal pass travels 250 units instead of 200 (a 45-degree
  // band has to clear the glyph corner to corner), so it runs 1.25x longer to
  // keep the band speed identical to the vertical sweeps.
  const SWEEP_DIAG_TRAVEL_S = SWEEP_TRAVEL_S * 1.25;
  // The CSS animation starts after this delay; the chroma has crossed the mark
  // once the diagonal band's leading edge clears the far corner, ~58% of its
  // travel. From that moment the card just fades away, fast.
  const SWEEP_START_DELAY_MS = 200;
  const DIAG_CROSS_MS = SWEEP_START_DELAY_MS + SWEEP_DIAG_TRAVEL_S * 1000 * 0.58;
  const FAST_FADE_MS = 160;

  /* ── glyph geometry ────────────────────────────────────────────────────── */

  // Every glyph is one closed contour — clockwise in screen coords, starting at
  // its topmost point, resampled to 120 points and lightly smoothed so the
  // edges read as rounded (the arrows and tick most of all). That identical
  // structure is what makes the outlines interpolable, so a morph is a genuine
  // shape transformation. Generated offline from the intended silhouettes:
  // thick block arrows, a thick tick, the Traverse mark (from icons/logo.svg)
  // and a small X. Only `info` carries two contours; it is never a morph source
  // or target (standalone toasts only condense it out of its collapsed self).
  const GLYPH_POINTS = {
    down: '39.67,11.67 40.85,10.85 42.37,10.37 44.13,10.13 46.04,10.04 48.01,10.01 50.00,10.00 51.99,10.01 53.96,10.04 55.87,10.13 57.63,10.37 59.15,10.85 60.33,11.67 61.15,12.85 61.63,14.37 61.87,16.13 61.96,18.04 61.99,20.01 62.00,22.00 62.00,24.00 62.00,26.00 62.00,28.00 62.00,30.00 62.00,32.00 62.00,34.00 62.00,36.00 62.00,38.00 62.01,39.99 62.03,41.96 62.12,43.87 62.33,45.63 62.77,47.15 63.50,48.33 64.57,49.15 65.93,49.63 67.52,49.87 69.23,49.96 71.00,50.00 72.74,50.03 74.40,50.11 75.83,50.29 76.90,50.68 77.46,51.32 77.45,52.26 76.93,53.46 76.05,54.86 74.94,56.36 73.74,57.92 72.50,59.50 71.25,61.08 70.00,62.67 68.75,64.25 67.50,65.83 66.25,67.42 65.00,69.00 63.75,70.58 62.50,72.17 61.25,73.75 60.00,75.33 58.75,76.92 57.50,78.50 56.25,80.07 55.00,81.61 53.75,83.04 52.51,84.26 51.27,85.09 50.04,85.41 48.82,85.16 47.61,84.38 46.40,83.23 45.20,81.86 44.00,80.39 42.80,78.88 41.60,77.36 40.40,75.84 39.20,74.32 38.00,72.80 36.80,71.28 35.60,69.76 34.40,68.24 33.20,66.72 32.00,65.20 30.80,63.68 29.60,62.16 28.40,60.64 27.20,59.12 26.01,57.61 24.86,56.11 23.81,54.66 22.99,53.32 22.57,52.17 22.67,51.27 23.37,50.65 24.59,50.28 26.21,50.10 28.05,50.02 29.97,49.97 31.87,49.87 33.63,49.63 35.15,49.15 36.33,48.33 37.15,47.15 37.63,45.63 37.87,43.87 37.96,41.96 37.99,39.99 38.00,38.00 38.00,36.00 38.00,34.00 38.00,32.00 38.00,30.00 38.00,28.00 38.00,26.00 38.00,24.00 38.00,22.00 38.01,20.01 38.04,18.04 38.13,16.13 38.37,14.37 38.85,12.85',
    up: '50.00,14.54 51.20,14.82 52.40,15.61 53.60,16.76 54.80,18.14 56.00,19.61 57.20,21.12 58.40,22.64 59.60,24.16 60.80,25.68 62.00,27.20 63.20,28.72 64.40,30.24 65.60,31.76 66.80,33.28 68.00,34.80 69.20,36.32 70.40,37.84 71.60,39.36 72.80,40.88 73.99,42.39 75.14,43.89 76.19,45.34 77.01,46.68 77.43,47.83 77.33,48.73 76.63,49.35 75.41,49.72 73.79,49.90 71.95,49.98 70.03,50.03 68.13,50.13 66.37,50.37 64.85,50.85 63.67,51.67 62.85,52.85 62.37,54.37 62.13,56.13 62.04,58.04 62.01,60.01 62.00,62.00 62.00,64.00 62.00,66.00 62.00,68.00 62.00,70.00 62.00,72.00 62.00,74.00 62.00,76.00 62.00,78.00 61.99,79.99 61.96,81.96 61.87,83.87 61.63,85.63 61.15,87.15 60.33,88.33 59.15,89.15 57.63,89.63 55.87,89.87 53.96,89.96 51.99,89.99 50.00,90.00 48.01,89.99 46.04,89.96 44.13,89.87 42.37,89.63 40.85,89.15 39.67,88.33 38.85,87.15 38.37,85.63 38.13,83.87 38.04,81.96 38.01,79.99 38.00,78.00 38.00,76.00 38.00,74.00 38.00,72.00 38.00,70.00 38.00,68.00 38.00,66.00 38.00,64.00 38.00,62.00 37.99,60.01 37.96,58.04 37.87,56.13 37.63,54.37 37.15,52.85 36.33,51.67 35.15,50.85 33.63,50.37 31.87,50.13 29.97,50.03 28.05,49.98 26.21,49.90 24.59,49.72 23.37,49.35 22.67,48.73 22.57,47.83 22.99,46.68 23.81,45.34 24.86,43.89 26.01,42.39 27.20,40.88 28.40,39.36 29.60,37.84 30.80,36.32 32.00,34.80 33.20,33.28 34.40,31.76 35.60,30.24 36.80,28.72 38.00,27.20 39.20,25.68 40.40,24.16 41.60,22.64 42.80,21.12 44.00,19.61 45.20,18.14 46.40,16.76 47.60,15.61 48.80,14.82',
    tick: '72.56,22.34 73.85,22.41 75.18,22.83 76.54,23.54 77.91,24.45 79.28,25.49 80.63,26.61 81.91,27.76 83.07,28.94 84.02,30.14 84.68,31.36 84.99,32.62 84.93,33.92 84.51,35.25 83.81,36.60 82.90,37.97 81.87,39.36 80.76,40.75 79.63,42.15 78.48,43.54 77.32,44.94 76.17,46.34 75.02,47.73 73.86,49.13 72.71,50.53 71.55,51.93 70.40,53.32 69.25,54.72 68.09,56.12 66.94,57.51 65.78,58.91 64.63,60.31 63.48,61.70 62.32,63.10 61.17,64.50 60.01,65.89 58.86,67.29 57.71,68.69 56.55,70.08 55.40,71.48 54.24,72.88 53.09,74.28 51.94,75.67 50.78,77.06 49.63,78.44 48.47,79.79 47.31,81.06 46.15,82.20 44.98,83.13 43.79,83.76 42.59,84.02 41.37,83.89 40.14,83.40 38.90,82.61 37.65,81.60 36.39,80.46 35.13,79.25 33.87,78.00 32.60,76.75 31.34,75.48 30.08,74.22 28.82,72.96 27.55,71.70 26.29,70.43 25.03,69.17 23.77,67.91 22.53,66.65 21.31,65.38 20.17,64.12 19.15,62.85 18.34,61.59 17.81,60.32 17.64,59.05 17.84,57.77 18.38,56.49 19.22,55.21 20.26,53.93 21.43,52.67 22.66,51.43 23.93,50.26 25.20,49.21 26.48,48.37 27.75,47.81 29.00,47.60 30.25,47.75 31.49,48.24 32.73,49.02 33.96,49.98 35.18,51.04 36.40,52.09 37.61,53.05 38.82,53.80 40.02,54.27 41.22,54.38 42.40,54.10 43.56,53.47 44.73,52.54 45.88,51.40 47.03,50.13 48.18,48.79 49.33,47.42 50.48,46.03 51.63,44.65 52.77,43.26 53.92,41.87 55.07,40.48 56.22,39.09 57.37,37.70 58.51,36.31 59.66,34.92 60.81,33.53 61.96,32.14 63.11,30.75 64.26,29.37 65.40,27.99 66.56,26.65 67.72,25.38 68.89,24.23 70.08,23.29 71.30,22.64',
    cross: '44.02,35.67 44.75,35.88 45.49,36.39 46.24,37.07 46.99,37.80 47.75,38.54 48.49,39.22 49.23,39.73 49.95,39.95 50.65,39.82 51.33,39.39 52.00,38.79 52.67,38.14 53.34,37.47 54.01,36.81 54.68,36.22 55.35,35.78 56.03,35.62 56.73,35.82 57.43,36.30 58.13,36.93 58.84,37.63 59.55,38.33 60.25,39.04 60.96,39.75 61.67,40.45 62.37,41.16 63.07,41.87 63.70,42.57 64.18,43.27 64.38,43.97 64.22,44.65 63.78,45.32 63.19,45.99 62.53,46.66 61.86,47.33 61.21,48.00 60.61,48.67 60.18,49.35 60.05,50.05 60.27,50.77 60.78,51.51 61.46,52.25 62.20,53.01 62.93,53.76 63.61,54.51 64.12,55.25 64.33,55.98 64.16,56.71 63.70,57.42 63.07,58.13 62.37,58.84 61.67,59.55 60.96,60.25 60.25,60.96 59.55,61.67 58.84,62.37 58.13,63.07 57.43,63.70 56.73,64.18 56.03,64.38 55.35,64.22 54.68,63.78 54.01,63.19 53.34,62.53 52.67,61.86 52.00,61.21 51.33,60.61 50.65,60.18 49.95,60.05 49.23,60.27 48.49,60.78 47.75,61.46 46.99,62.20 46.24,62.93 45.49,63.61 44.75,64.12 44.02,64.33 43.29,64.16 42.58,63.70 41.87,63.07 41.16,62.37 40.45,61.67 39.75,60.96 39.04,60.25 38.33,59.55 37.63,58.84 36.93,58.13 36.30,57.43 35.82,56.73 35.62,56.03 35.78,55.35 36.22,54.68 36.81,54.01 37.47,53.34 38.14,52.67 38.79,52.00 39.39,51.33 39.82,50.65 39.95,49.95 39.73,49.23 39.22,48.49 38.54,47.75 37.80,46.99 37.07,46.24 36.39,45.49 35.88,44.75 35.67,44.02 35.84,43.29 36.30,42.58 36.93,41.87 37.63,41.16 38.33,40.45 39.04,39.75 39.75,39.04 40.45,38.33 41.16,37.63 41.87,36.93 42.58,36.30 43.29,35.84',
    info: '49.91,15.53 50.34,15.54 50.76,15.57 51.20,15.62 51.65,15.70 52.10,15.80 52.52,15.92 52.92,16.05 53.33,16.22 53.77,16.43 54.23,16.67 54.67,16.95 55.08,17.22 55.42,17.50 55.74,17.77 56.05,18.08 56.36,18.42 56.66,18.77 56.92,19.12 57.16,19.47 57.38,19.85 57.59,20.26 57.79,20.68 57.95,21.07 58.08,21.45 58.18,21.81 58.27,22.17 58.35,22.56 58.41,22.99 58.45,23.45 58.47,23.91 58.46,24.34 58.43,24.76 58.38,25.20 58.30,25.65 58.20,26.10 58.08,26.52 57.95,26.92 57.79,27.32 57.59,27.74 57.38,28.15 57.16,28.53 56.92,28.88 56.66,29.23 56.36,29.58 56.05,29.92 55.74,30.23 55.42,30.50 55.08,30.78 54.67,31.05 54.23,31.33 53.77,31.57 53.33,31.78 52.93,31.95 52.55,32.08 52.19,32.18 51.83,32.27 51.44,32.35 51.01,32.41 50.55,32.45 50.09,32.47 49.66,32.46 49.24,32.43 48.80,32.38 48.35,32.30 47.90,32.20 47.48,32.08 47.08,31.95 46.68,31.79 46.26,31.59 45.85,31.38 45.47,31.16 45.12,30.92 44.77,30.66 44.42,30.36 44.08,30.05 43.77,29.74 43.50,29.42 43.23,29.08 42.96,28.70 42.71,28.31 42.50,27.93 42.31,27.56 42.14,27.16 41.98,26.72 41.85,26.28 41.74,25.86 41.66,25.45 41.59,25.01 41.55,24.55 41.53,24.09 41.54,23.66 41.57,23.24 41.62,22.80 41.70,22.35 41.80,21.90 41.92,21.48 42.05,21.08 42.22,20.67 42.43,20.23 42.67,19.77 42.95,19.33 43.22,18.92 43.50,18.58 43.77,18.26 44.08,17.95 44.42,17.64 44.77,17.34 45.12,17.08 45.47,16.84 45.85,16.62 46.26,16.41 46.68,16.21 47.07,16.05 47.45,15.92 47.81,15.82 48.17,15.73 48.56,15.65 48.99,15.59 49.45,15.55;44.49,40.50 45.08,40.16 45.88,40.03 46.77,40.00 47.69,40.00 48.62,40.00 49.54,40.00 50.46,40.00 51.38,40.00 52.31,40.00 53.23,40.00 54.12,40.03 54.92,40.16 55.51,40.50 55.84,41.10 55.97,41.91 56.00,42.81 56.00,43.74 56.00,44.68 56.00,45.62 56.00,46.55 56.00,47.49 56.00,48.43 56.00,49.36 56.00,50.30 56.00,51.23 56.00,52.17 56.00,53.11 56.00,54.04 56.00,54.98 56.00,55.91 56.00,56.85 56.00,57.79 56.00,58.72 56.00,59.66 56.00,60.60 56.00,61.53 56.00,62.47 56.00,63.40 56.00,64.34 56.00,65.28 56.00,66.21 56.00,67.15 56.00,68.09 56.00,69.02 56.00,69.96 56.00,70.89 56.00,71.83 56.00,72.77 56.00,73.70 56.00,74.64 56.00,75.57 56.00,76.51 56.00,77.45 56.00,78.38 56.00,79.32 56.00,80.26 56.00,81.19 55.97,82.09 55.84,82.90 55.51,83.50 54.92,83.84 54.12,83.97 53.23,84.00 52.31,84.00 51.38,84.00 50.46,84.00 49.54,84.00 48.62,84.00 47.69,84.00 46.77,84.00 45.88,83.97 45.08,83.84 44.49,83.50 44.16,82.90 44.03,82.09 44.00,81.19 44.00,80.26 44.00,79.32 44.00,78.38 44.00,77.45 44.00,76.51 44.00,75.57 44.00,74.64 44.00,73.70 44.00,72.77 44.00,71.83 44.00,70.89 44.00,69.96 44.00,69.02 44.00,68.09 44.00,67.15 44.00,66.21 44.00,65.28 44.00,64.34 44.00,63.40 44.00,62.47 44.00,61.53 44.00,60.60 44.00,59.66 44.00,58.72 44.00,57.79 44.00,56.85 44.00,55.91 44.00,54.98 44.00,54.04 44.00,53.11 44.00,52.17 44.00,51.23 44.00,50.30 44.00,49.36 44.00,48.43 44.00,47.49 44.00,46.55 44.00,45.62 44.00,44.68 44.00,43.74 44.00,42.81 44.03,41.91 44.16,41.10',
    logo: '52.29,13.46 53.82,15.20 54.58,17.78 54.84,20.84 54.89,24.06 54.90,27.31 54.98,30.42 55.32,33.00 56.18,34.43 57.69,34.36 59.71,33.01 61.95,30.96 64.26,28.70 66.58,26.42 68.91,24.31 71.28,22.73 73.63,22.19 75.78,22.93 77.32,24.67 77.77,26.90 76.96,29.24 75.21,31.57 73.02,33.89 70.72,36.19 68.47,38.48 66.47,40.67 65.23,42.56 65.29,43.92 66.83,44.65 69.47,44.93 72.59,44.99 75.84,45.00 79.07,45.05 82.13,45.29 84.73,46.03 86.50,47.53 87.21,49.69 86.78,51.95 85.27,53.68 82.86,54.61 79.89,54.95 76.69,55.02 73.43,55.02 70.16,55.02 66.90,55.02 63.67,55.07 60.62,55.32 58.05,56.08 56.26,57.64 55.32,60.04 54.98,63.00 54.90,66.20 54.90,69.46 54.90,72.73 54.89,75.99 54.84,79.22 54.58,82.26 53.82,84.83 52.30,86.56 50.14,87.21 47.90,86.73 46.23,85.16 45.35,82.71 45.03,79.72 44.96,76.51 44.95,73.26 44.89,70.12 44.60,67.44 43.83,65.78 42.43,65.59 40.51,66.73 38.30,68.68 36.01,70.92 33.71,73.21 31.40,75.39 29.06,77.09 26.72,77.82 24.51,77.27 22.82,75.65 22.15,73.47 22.76,71.12 24.40,68.77 26.54,66.44 28.82,64.13 31.08,61.83 33.06,59.61 34.29,57.65 34.20,56.21 32.63,55.41 29.98,55.10 26.86,55.03 23.61,55.02 20.39,54.95 17.39,54.65 14.91,53.80 13.30,52.18 12.76,49.96 13.34,47.76 14.99,46.17 17.50,45.35 20.52,45.07 23.73,45.01 26.99,45.00 30.26,45.00 33.52,44.99 36.73,44.92 39.72,44.61 42.17,43.72 43.80,41.99 44.62,39.47 44.89,36.45 44.95,33.23 44.96,29.97 44.96,26.70 44.97,23.44 45.03,20.23 45.35,17.25 46.23,14.81 47.90,13.26 50.12,12.79',
  };

  function parseGlyph(name) {
    return GLYPH_POINTS[name].split(';').map((contour) =>
      contour
        .trim()
        .split(' ')
        .map((pair) => {
          const parts = pair.split(',');
          return [Number(parts[0]), Number(parts[1])];
        })
    );
  }

  function contoursToPath(contours) {
    let d = '';
    for (let c = 0; c < contours.length; c++) {
      const pts = contours[c];
      for (let i = 0; i < pts.length; i++) {
        d += (i === 0 ? 'M' : 'L') + pts[i][0] + ' ' + pts[i][1] + ' ';
      }
      d += 'Z';
    }
    return d;
  }

  const pathCache = {};
  function glyphPath(name) {
    if (!pathCache[name]) pathCache[name] = contoursToPath(parseGlyph(name));
    return pathCache[name];
  }

  // Collapsed copy of a glyph: every point pulled toward the centre. The
  // entrance morphs out of this, so the icon condenses into existence.
  function collapsedPath(name) {
    return contoursToPath(
      parseGlyph(name).map((contour) =>
        contour.map((p) => [50 + (p[0] - 50) * 0.15, 50 + (p[1] - 50) * 0.15])
      )
    );
  }

  /* ── morphing ──────────────────────────────────────────────────────────── */

  const MORPH_MS = 520;
  const REVEAL_MS = 700;
  const MORPH_EASING = 'cubic-bezier(0.4, 0, 0.2, 1)';

  /* ── hand-off timing ───────────────────────────────────────────────────── */

  // The pill and the card swap places with a FLIP: the card keeps its final
  // geometry and a transform stretches it back over the box the pill left, so
  // the two interpolate as one shape. That stays on the compositor — no layout
  // and no paint per frame, which is the only way this reads as smooth.
  const HANDOFF_IN_MS = 460;
  const HANDOFF_OUT_MS = 460;
  const HANDOFF_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)';

  // The content swap — pill out, glyph in, cross out — happens in the opening
  // (or closing) frames only, while the two boxes still coincide. Everything
  // after that is a plain shape morph on opaque surfaces.
  const HANDOFF_CROSSFADE_MS = 150;

  // How long the failure cross rests before it scales back into the pill.
  // Long enough to read three lines of error and hit Copy, short enough that
  // the corner is not occupied for the rest of the session.
  const FAIL_HOLD_MS = 3600;

  // The card's resting border and shadow. Both are drawn in the card's own
  // (unscaled) space, so a 2.9x vertical stretch would render a fat border and
  // a 118px halo; they are faded in over the morph and stay invisible while
  // the box is still the wrong shape.
  const CARD_BORDER = 'rgba(255, 255, 255, 0.12)';
  const CARD_SHADOW = '0 12px 40px rgba(0, 0, 0, 0.85), 0 0 0 1px rgba(39, 110, 241, 0.15)';
  const CARD_BORDER_HIDDEN = 'rgba(255, 255, 255, 0)';
  const CARD_SHADOW_HIDDEN = '0 0 0 rgba(0, 0, 0, 0), 0 0 0 rgba(39, 110, 241, 0)';

  let uid = 0;

  /**
   * Interpolate a path's geometry. Falls back to a hard swap where Web
   * Animations is unavailable (e.g. the Node smoke harness).
   */
  function animateGeometry(el, from, to, duration, easing) {
    if (!el) return;
    if (typeof el.animate !== 'function') {
      el.setAttribute('d', to);
      return;
    }
    let anim;
    try {
      anim = el.animate([{ d: 'path("' + from + '")' }, { d: 'path("' + to + '")' }], {
        duration: duration,
        easing: easing,
        fill: 'forwards',
      });
    } catch (e) {
      el.setAttribute('d', to);
      return;
    }
    // Commit on completion so the next morph starts from a settled attribute.
    anim.onfinish = () => {
      el.setAttribute('d', to);
      anim.cancel();
    };
  }

  function runGeometryMorph(card, from, to, duration, blurPeak) {
    animateGeometry(card.querySelector('.lfb-glyph'), from, to, duration, MORPH_EASING);
    animateGeometry(card.querySelector('.lfb-mask-path'), from, to, duration, MORPH_EASING);

    const group = card.querySelector('.lfb-glyph-morph');
    if (group && typeof group.animate === 'function') {
      try {
        group.animate(
          [
            { filter: 'blur(0px)' },
            { filter: 'blur(' + blurPeak + 'px)', offset: 0.45 },
            { filter: 'blur(0px)' },
          ],
          { duration: duration, easing: 'ease-in-out' }
        );
      } catch (e) {
        /* the blur pulse is cosmetic */
      }
    }
  }

  /** Morph the card's glyph into `name` (no-op if it is already showing). */
  function morphGlyph(card, name) {
    if (!card) return;
    const path = card.querySelector('.lfb-glyph');
    if (!path || path.getAttribute('data-glyph') === name) return;
    const from = path.getAttribute('d');
    path.setAttribute('data-glyph', name);
    runGeometryMorph(card, from, glyphPath(name), MORPH_MS, 2.5);
  }

  /** Entrance: the glyph condenses out of its collapsed self. */
  function revealGlyph(card) {
    if (!card) return;
    const path = card.querySelector('.lfb-glyph');
    if (!path) return;
    const name = path.getAttribute('data-glyph');
    if (!name || !GLYPH_POINTS[name]) return;
    runGeometryMorph(card, path.getAttribute('d'), glyphPath(name), REVEAL_MS, 4);
  }

  /** Point the chroma band up, down or diagonally (or freeze it). */
  function setSweep(card, dir) {
    if (!card) return;
    card.classList.remove('lfb-sweep-down', 'lfb-sweep-up', 'lfb-sweep-diag', 'lfb-sweep-off');
    card.classList.add('lfb-sweep-' + dir);
  }

  /* ── svg markup ────────────────────────────────────────────────────────── */

  /**
   * One glyph, three sweeper bands, one mask. The visible path and the mask
   * path carry the same geometry and are always animated together, so the
   * chroma band stays locked to the shape through every morph.
   */
  function buildGlyphSvg(initialGlyph) {
    const id = ++uid;
    const gradDown = 'lfb-grad-' + id + '-down';
    const gradUp = 'lfb-grad-' + id + '-up';
    const maskId = 'lfb-mask-' + id;
    const collapsed = collapsedPath(initialGlyph);

    return (
      '<svg class="lfb-glyph-svg" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet" aria-hidden="true">' +
      '<defs>' +
      '<linearGradient id="' + gradDown + '" x1="0" y1="0" x2="0" y2="1">' + chromaStops(true) + '</linearGradient>' +
      '<linearGradient id="' + gradUp + '" x1="0" y1="0" x2="0" y2="1">' + chromaStops(false) + '</linearGradient>' +
      '<mask id="' + maskId + '" maskUnits="userSpaceOnUse" x="-50" y="-50" width="200" height="200">' +
      '<path class="lfb-mask-path" d="' + collapsed + '" fill="#FFFFFF"/>' +
      '</mask>' +
      '</defs>' +
      '<g class="lfb-glyph-morph"><g class="lfb-glyph-blur">' +
      '<path class="lfb-glyph" data-glyph="' + initialGlyph + '" d="' + collapsed + '" fill="' + RESTING_GREY + '"/>' +
      '<g mask="url(#' + maskId + ')">' +
      '<rect class="lfb-sweeper lfb-sweeper-down" x="0" y="-100" width="100" height="300" fill="url(#' + gradDown + ')"/>' +
      '<rect class="lfb-sweeper lfb-sweeper-up" x="0" y="-100" width="100" height="300" fill="url(#' + gradUp + ')"/>' +
      // Diagonal closing pass: the same band rotated 45deg, so its travel axis
      // runs bottom-left -> top-right. Pink leads here too, hence the
      // down-direction gradient.
      '<g transform="rotate(45 50 50)">' +
      '<rect class="lfb-sweeper lfb-sweeper-diag" x="0" y="-100" width="100" height="300" fill="url(#' + gradDown + ')"/>' +
      '</g>' +
      '</g>' +
      '</g></g>' +
      '</svg>'
    );
  }

  /**
   * Build one card. `initialGlyph` is the shape it starts (and condenses) from.
   * `sweep` is the initial band direction: 'down' | 'up' | 'diag' | 'off'.
   * `failPanel`: null | 'hidden' | 'visible' — the error-message + copy button
   * column, revealed by adding .lfb-fail to the card.
   */
  function createCard(options) {
    const card = document.createElement('div');
    card.className = 'lfb-card lfb-sweep-' + (options.sweep || 'down');

    const close = document.createElement('button');
    close.className = 'lfb-close';
    close.textContent = '\u00D7';
    close.setAttribute('aria-label', 'Dismiss');

    const stage = document.createElement('div');
    stage.className = 'lfb-stage';
    stage.innerHTML = buildGlyphSvg(options.initialGlyph || 'info');

    card.appendChild(close);
    card.appendChild(stage);

    let copyBtn = null;
    let msgEl = null;
    if (options.failPanel) {
      const panel = document.createElement('div');
      panel.className = 'lfb-fail-panel';

      msgEl = document.createElement('div');
      msgEl.className = 'lfb-fail-msg';
      msgEl.textContent = options.message || 'Something went wrong';
      msgEl.setAttribute('title', options.message || 'Something went wrong');

      copyBtn = document.createElement('button');
      copyBtn.className = 'lfb-copy-btn';
      copyBtn.textContent = 'Copy error';

      panel.appendChild(msgEl);
      panel.appendChild(copyBtn);
      card.appendChild(panel);

      if (options.failPanel === 'visible') card.classList.add('lfb-fail');
    }

    return { card, close, copyBtn, msgEl };
  }

  /* ── copy-to-clipboard ─────────────────────────────────────────────────── */

  function fallbackCopy(text, done) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;left:-9999px;top:-9999px;opacity:0;';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    } catch (e) {
      /* clipboard unavailable — still flash the button so the click registers */
    }
    done();
  }

  function wireCopy(btn, getMessage) {
    btn.onclick = () => {
      const msg = getMessage();
      const done = () => {
        btn.textContent = 'Copied';
        btn.classList.add('lfb-copied');
        setTimeout(() => {
          btn.textContent = 'Copy error';
          btn.classList.remove('lfb-copied');
        }, 1400);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(msg).then(done, () => fallbackCopy(msg, done));
      } else {
        fallbackCopy(msg, done);
      }
    };
  }

  /* ── styles ────────────────────────────────────────────────────────────── */

  function injectStyles() {
    if (document.getElementById('leetfeedback-chroma-styles')) return;

    const style = document.createElement('style');
    style.id = 'leetfeedback-chroma-styles';
    style.textContent = `
            .lfb-card {
                position: relative;
                width: 112px;
                height: 112px;
                background: rgba(10, 10, 10, 0.88);
                backdrop-filter: blur(16px);
                -webkit-backdrop-filter: blur(16px);
                border: 1px solid rgba(255, 255, 255, 0.12);
                border-radius: 16px;
                box-shadow: 0 12px 40px rgba(0, 0, 0, 0.85), 0 0 0 1px rgba(39, 110, 241, 0.15);
                box-sizing: border-box;
                overflow: hidden;
                pointer-events: auto;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
                transition: width 0.45s cubic-bezier(0.4, 0, 0.2, 1),
                    opacity 0.3s cubic-bezier(0.2, 0.8, 0.2, 1),
                    transform 0.3s cubic-bezier(0.2, 0.8, 0.2, 1);
            }
            .lfb-card.lfb-fixed {
                position: fixed;
                bottom: 24px;
                right: 24px;
                z-index: 9999999;
            }
            .lfb-card.lfb-fail {
                width: 256px;
            }
            .lfb-card.lfb-hidden {
                opacity: 0;
                transform: translateY(14px) scale(0.94);
            }
            /* Closing fade: the whole popup goes away quickly, no hold. */
            .lfb-card.lfb-gone {
                opacity: 0;
                transition: opacity ${FAST_FADE_MS}ms ease-out, transform ${FAST_FADE_MS}ms ease-out;
            }

            /* Glyph stage — the icon spans the card edge to edge. */
            .lfb-stage {
                position: absolute;
                left: 0;
                top: 0;
                width: 112px;
                height: 112px;
            }
            .lfb-stage svg {
                width: 100%;
                height: 100%;
                display: block;
            }

            /* One morphing path: the outline itself travels between shapes.
               The failure cross is the one coloured glyph. */
            .lfb-glyph {
                fill: ${RESTING_GREY};
                transition: fill 0.45s ease;
            }
            .lfb-glyph[data-glyph="cross"] {
                fill: #E11900;
            }
            .lfb-mask-path {
                fill: #FFFFFF;
            }

            /* The chroma band. The rect rests with its flanks over the glyph
               (resting grey); each cycle slides the band fully through —
               SWEEP_TRAVEL_S ease-in-out travel, then SWEEP_REST_S before the
               next pass, 0.2s initial delay, mirroring the footer sweep. */
            .lfb-sweeper {
                visibility: hidden;
                will-change: transform;
            }
            .lfb-sweep-down .lfb-sweeper-down,
            .lfb-sweep-up .lfb-sweeper-up,
            .lfb-sweep-diag .lfb-sweeper-diag {
                visibility: visible;
            }
            .lfb-sweep-down .lfb-sweeper-down {
                animation: lfb-kf-sweep-down ${SWEEP_CYCLE_S}s linear 0.2s infinite;
            }
            .lfb-sweep-up .lfb-sweeper-up {
                animation: lfb-kf-sweep-up ${SWEEP_CYCLE_S}s linear 0.2s infinite;
            }
            /* Closing pass: one shot, bottom-left -> top-right, then it holds
               its final frame (band parked off the glyph). */
            .lfb-sweep-diag .lfb-sweeper-diag {
                animation: lfb-kf-sweep-diag ${SWEEP_DIAG_TRAVEL_S}s linear 0.2s 1 forwards;
            }
            @keyframes lfb-kf-sweep-down {
                0% {
                    transform: translateY(-100px);
                    animation-timing-function: cubic-bezier(0.42, 0, 0.58, 1);
                }
                ${SWEEP_PCT}% { transform: translateY(100px); }
                100% { transform: translateY(100px); }
            }
            @keyframes lfb-kf-sweep-up {
                0% {
                    transform: translateY(100px);
                    animation-timing-function: cubic-bezier(0.42, 0, 0.58, 1);
                }
                ${SWEEP_PCT}% { transform: translateY(-100px); }
                100% { transform: translateY(-100px); }
            }
            @keyframes lfb-kf-sweep-diag {
                0% {
                    transform: translateY(75px);
                    animation-timing-function: cubic-bezier(0.42, 0, 0.58, 1);
                }
                100% { transform: translateY(-175px); }
            }

            /* The footer sweep carries a subtle 1px blur that resolves to
               sharp as the pass completes; same here, on a wrapper group so
               it composes with (never fights) the morph blur. */
            .lfb-sweep-down .lfb-glyph-blur,
            .lfb-sweep-up .lfb-glyph-blur {
                animation: lfb-kf-sweep-blur ${SWEEP_CYCLE_S}s linear 0.2s infinite;
            }
            .lfb-sweep-diag .lfb-glyph-blur {
                animation: lfb-kf-diag-blur ${SWEEP_DIAG_TRAVEL_S}s linear 0.2s 1 forwards;
            }
            @keyframes lfb-kf-sweep-blur {
                0% { filter: blur(0px); }
                4% {
                    filter: blur(1px);
                    animation-timing-function: cubic-bezier(0.42, 0, 0.58, 1);
                }
                ${SWEEP_PCT}% { filter: blur(0px); }
                100% { filter: blur(0px); }
            }
            @keyframes lfb-kf-diag-blur {
                0% { filter: blur(0px); }
                3% {
                    filter: blur(1px);
                    animation-timing-function: cubic-bezier(0.42, 0, 0.58, 1);
                }
                100% { filter: blur(0px); }
            }

            /* Close button — hover-reveal so the resting card is just the icon. */
            .lfb-close {
                position: absolute;
                top: 6px;
                right: 6px;
                z-index: 10;
                background: transparent;
                border: none;
                color: #6E6E6E;
                font-size: 15px;
                line-height: 1;
                cursor: pointer;
                padding: 2px 4px;
                opacity: 0;
                transition: opacity 0.18s ease, color 0.15s ease;
            }
            .lfb-card:hover .lfb-close { opacity: 1; }
            .lfb-close:hover { color: #FFFFFF; }

            /* Failure column: truncated message + copy-error button. */
            .lfb-fail-panel {
                position: absolute;
                left: 112px;
                top: 0;
                right: 0;
                bottom: 0;
                display: flex;
                flex-direction: column;
                justify-content: center;
                gap: 10px;
                padding: 12px 14px 12px 6px;
                opacity: 0;
                pointer-events: none;
                transition: opacity 0.35s ease 0.12s;
            }
            .lfb-card.lfb-fail .lfb-fail-panel {
                opacity: 1;
                pointer-events: auto;
            }
            .lfb-fail-msg {
                font-size: 11px;
                font-weight: 500;
                line-height: 1.45;
                color: #C9C9C9;
                display: -webkit-box;
                -webkit-line-clamp: 3;
                -webkit-box-orient: vertical;
                overflow: hidden;
                word-break: break-word;
            }
            .lfb-copy-btn {
                align-self: flex-start;
                background: transparent;
                border: 1px solid rgba(255, 255, 255, 0.18);
                border-radius: 6px;
                color: #9A9A9A;
                font-family: inherit;
                font-size: 10.5px;
                font-weight: 600;
                letter-spacing: 0.02em;
                padding: 4px 10px;
                cursor: pointer;
                transition: color 0.15s ease, border-color 0.15s ease;
            }
            .lfb-copy-btn:hover {
                color: #FFFFFF;
                border-color: rgba(255, 255, 255, 0.4);
            }
            .lfb-copy-btn.lfb-copied {
                color: #34D399;
                border-color: rgba(14, 131, 69, 0.55);
            }

            @media (prefers-reduced-motion: reduce) {
                /* Park the band below the glyph so the resting grey flanks
                   cover it, and drop all motion. */
                .lfb-sweeper {
                    animation: none !important;
                    transform: translateY(100px) !important;
                }
                .lfb-glyph-blur { animation: none !important; }
            }
        `;
    document.head.appendChild(style);
  }

  /* ── toast notifications (icon-only, chroma sweep) ─────────────────────── */

  class ToastNotification {
    constructor() {
      this.container = null;
      this.toasts = [];
      this.submission = null;
      this.init();
    }

    init() {
      if (this.container) return;
      this.container = document.createElement('div');
      this.container.id = 'leetfeedback-toast-container';
      this.container.style.cssText = `
                position: fixed;
                bottom: 24px;
                right: 24px;
                z-index: 999999;
                display: flex;
                flex-direction: column-reverse;
                gap: 10px;
                pointer-events: none;
            `;
      document.body.appendChild(this.container);
    }

    show(message, type = 'info', duration) {
      this.init();
      injectStyles();

      const isError = type === 'error';
      const glyph = type === 'success' ? 'tick' : isError ? 'cross' : 'info';
      const sweep = isError ? 'off' : type === 'success' ? 'up' : 'down';
      const ttl = typeof duration === 'number' ? duration : isError ? 8000 : 2600;

      const built = createCard({
        initialGlyph: glyph,
        sweep: sweep,
        failPanel: isError ? 'visible' : null,
        message: message,
      });

      const card = built.card;
      card.classList.add('leetfeedback-toast', 'leetfeedback-toast-' + type);
      card.setAttribute('title', message);
      built.close.onclick = () => this.dismiss(card);
      if (built.copyBtn) wireCopy(built.copyBtn, () => message);

      card.style.transform = 'translateX(120%)';
      card.style.opacity = '0';
      this.container.appendChild(card);
      this.toasts.push(card);

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          card.style.transform = 'translateX(0)';
          card.style.opacity = '1';
          revealGlyph(card);
        });
      });

      if (ttl > 0) {
        card._autoDismissTimeout = setTimeout(() => this.dismiss(card), ttl);
      }
      return card;
    }

    dismiss(card) {
      if (!card || !card.parentNode) return;
      if (card._autoDismissTimeout) clearTimeout(card._autoDismissTimeout);
      card.style.transform = 'translateX(120%)';
      card.style.opacity = '0';
      setTimeout(() => {
        if (card.parentNode) card.parentNode.removeChild(card);
        const index = this.toasts.indexOf(card);
        if (index > -1) this.toasts.splice(index, 1);
      }, 360);
    }

    success(message, duration) {
      return this.show(message, 'success', duration);
    }

    error(message, duration) {
      return this.show(message, 'error', duration);
    }

    info(message, duration) {
      return this.show(message, 'info', duration);
    }

    /** Replace any existing submission card and return a fresh tracker. */
    createSubmission() {
      // A previous card may still be holding the corner. Hand its claim on the
      // parked timer to the new card instead of letting the pill flicker back
      // in between the two, then take the card down.
      const previous = this.submission;
      let morphFrom = null;
      if (previous && !previous.isDismissed) {
        morphFrom = previous.takeMorphOrigin();
        previous.dismiss(true);
      }

      // Belt and braces: an SPA navigation can drop the tracker while its card
      // is still on screen, and nothing would own that node any more.
      const orphan = document.querySelector('.leetfeedback-submission-card');
      if (orphan) orphan.remove();

      const timer = window.ProblemTimer ? window.ProblemTimer.getInstance() : null;
      if (!morphFrom && timer) morphFrom = timer.parkOverlay();

      this.submission = new SubmissionTracker({ morphFrom });
      return this.submission;
    }
  }

  /* ── submission tracker ────────────────────────────────────────────────── */

  // Visual phases. `beat` is how long the glyph sweeps after its morph
  // completes before the queue auto-advances. A checkpoint (verdict / sync
  // result) may interrupt that sweep at any moment, but never a morph in
  // flight — morphs are atomic, the next one only starts once the current
  // one has finished.
  const PHASES = {
    judging: { glyph: 'down', sweep: 'down', beat: 0 }, // yields to checkpoints only
    accepted: { glyph: 'tick', sweep: 'up', beat: 400 }, // a legible beat in the morph chain
    syncing: { glyph: 'up', sweep: 'up', beat: 0 }, // yields to checkpoints only
    // The Traverse mark closes the flow: one diagonal pass (bottom-left ->
    // top-right). There is no hold after it — as soon as the chroma has
    // crossed the mark the whole card fades away fast (see renderPhase).
    synced: { glyph: 'logo', sweep: 'diag', beat: 0 },
    failed: { glyph: 'cross', sweep: 'off', beat: 0 },
  };

  class SubmissionTracker {
    constructor(options = {}) {
      this.card = null;
      this.copyBtn = null;
      this.msgEl = null;
      this.isDismissed = false;

      this.phase = null;
      this.queue = [];
      this.morphDoneAt = 0; // when the current morph completes
      this.autoAt = 0; // earliest auto-advance (morph done + beat)
      this.interruptArmed = false; // a checkpoint is waiting to cut the sweep
      this.pumpTimer = null;
      this.terminal = null; // set once 'synced' or 'failed' has rendered
      this.errorMessage = '';

      // The box the timer pill left behind, if it handed one over. Non-null
      // means this card owns the corner: it grew out of the pill and is the
      // only thing that may give it back.
      this.morphFrom = options.morphFrom || null;
      this.handoffAnims = null;
      this.handoffSettled = false;

      this.init();
    }

    init() {
      injectStyles();

      const built = createCard({
        initialGlyph: 'down',
        sweep: 'down',
        failPanel: 'hidden',
      });
      this.card = built.card;
      this.copyBtn = built.copyBtn;
      this.msgEl = built.msgEl;
      this.card.classList.add('leetfeedback-submission-card', 'lfb-fixed');

      built.close.onclick = () => this.dismiss();
      if (this.copyBtn) wireCopy(this.copyBtn, () => this.errorMessage);

      document.body.appendChild(this.card);

      this.renderPhase('judging');

      if (this.morphFrom && typeof this.card.animate === 'function') {
        this.handoffIn(this.morphFrom);
        return;
      }

      // No pill to grow out of (timer off or hidden), or no Web Animations at
      // all (the Node smoke harness): give the corner straight back and keep
      // the card's own slide-in entrance.
      this.releaseTimer();
      this.card.classList.add('lfb-hidden');
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (!this.card) return;
          this.card.classList.remove('lfb-hidden');
          revealGlyph(this.card);
        });
      });
    }

    /* ── hand-off ────────────────────────────────────────────────────────────
     *
     * The timer pill and this card occupy the same corner, so a submission
     * morphs one into the other rather than stacking a second popup beside the
     * first. The card keeps its final geometry throughout and a FLIP transform
     * maps it onto the pill's box — a genuinely non-uniform stretch, which is
     * what makes the pill *become* the card instead of the card fading in on
     * top of it.
     *
     * Two consequences drive the shape of this code:
     *
     *   1. Content cannot ride a non-uniform scale — the glyph would visibly
     *      squash. So the stage is held back (forward) or dropped early
     *      (reverse), and only ever swapped while the two boxes coincide.
     *   2. Border and shadow are drawn in the card's own space, so a 2.9x
     *      vertical stretch renders a fat border and a huge halo. Both are
     *      faded in over the morph, so the stretched frames never show them.
     */

    /** Grow the card out of the box the pill vacated. */
    handoffIn(origin) {
      const card = this.card;
      if (!card) return;

      if (typeof card.animate !== 'function') {
        this.settleHandoff();
        return;
      }

      const stage = card.querySelector('.lfb-stage');
      const to = T.util.rectOf(card.getBoundingClientRect());

      // The card renders invisible from its first frame; the pill is already
      // fading under it, so the swap happens while the boxes still overlap.
      card.style.opacity = '0';
      card.style.transformOrigin = '0 0';
      card.style.borderColor = CARD_BORDER_HIDDEN;
      card.style.boxShadow = CARD_SHADOW_HIDDEN;
      if (stage) stage.style.opacity = '0';

      let shape;
      let swap;
      try {
        shape = card.animate(
          [
            {
              transform: T.util.morphTransform(origin, to),
              borderColor: CARD_BORDER_HIDDEN,
              boxShadow: CARD_SHADOW_HIDDEN,
            },
            { transform: 'none', borderColor: CARD_BORDER, boxShadow: CARD_SHADOW },
          ],
          { duration: HANDOFF_IN_MS, easing: HANDOFF_EASING, fill: 'forwards' }
        );
        swap = card.animate([{ opacity: 0 }, { opacity: 1 }], {
          duration: HANDOFF_CROSSFADE_MS,
          easing: 'ease-out',
          fill: 'forwards',
        });
      } catch (error) {
        this.settleHandoff();
        return;
      }

      this.handoffAnims = [shape, swap];

      const done = () => this.settleHandoff();
      if (shape.finished && typeof shape.finished.then === 'function') shape.finished.then(done, done);
      else setTimeout(done, HANDOFF_IN_MS + 40);
      // Safety net: `finished` never resolving would leave the glyph hidden.
      setTimeout(done, HANDOFF_IN_MS + 200);
    }

    /**
     * Land the entrance: drop every inline override the morph wrote, fade the
     * stage in, and condense the glyph into existence as it always has. Safe to
     * call more than once.
     */
    settleHandoff() {
      if (this.handoffSettled) return;
      this.handoffSettled = true;

      const card = this.card;
      this.cancelHandoff();
      if (!card) return;

      this.clearHandoffStyles(card);

      const stage = card.querySelector('.lfb-stage');
      if (stage) {
        stage.style.transition = `opacity ${HANDOFF_CROSSFADE_MS}ms ease`;
        stage.style.opacity = '1';
      }

      if (!this.isDismissed) revealGlyph(card);
    }

    /**
     * Reverse of `handoffIn`: shrink the card back into the pill. Returns false
     * when there is no pill to morph back into, so the caller can fall back to
     * a plain dismissal.
     */
    handoffOut() {
      const card = this.card;
      const timer = window.ProblemTimer ? window.ProblemTimer.getInstance() : null;
      if (!card || !this.morphFrom || !timer) return false;
      if (typeof card.animate !== 'function') return false;

      const restore = timer.beginRestore();
      if (!restore) return false;

      this.morphFrom = null;

      // `_cancelHandoff` has already run, so the card is back at its natural
      // box — which is what the FLIP maths needs as the "from" side.
      card.style.transform = 'none';
      card.style.opacity = '';
      card.style.borderColor = '';
      card.style.boxShadow = '';
      card.style.transformOrigin = '0 0';

      const from = T.util.rectOf(card.getBoundingClientRect());
      const to = restore.rect;
      const stage = card.querySelector('.lfb-stage');
      const panel = card.querySelector('.lfb-fail-panel');

      let shape;
      let fade;
      try {
        // The cross belongs to the card, not the pill: drop it in the opening
        // frames so the shrinking box is just a box.
        if (stage) {
          stage.style.opacity = '';
          stage.animate([{ opacity: 1 }, { opacity: 0 }], {
            duration: HANDOFF_CROSSFADE_MS,
            easing: 'ease-in',
            fill: 'forwards',
          });
        }
        if (panel) panel.style.opacity = '0';

        shape = card.animate(
          [{ transform: 'none' }, { transform: T.util.morphTransform(to, from) }],
          { duration: HANDOFF_OUT_MS, easing: HANDOFF_EASING, fill: 'forwards' }
        );
        // Hold the card opaque until it has landed on the pill, then hand the
        // corner over: both boxes coincide by then, so the swap is invisible.
        fade = card.animate(
          [
            { opacity: 1, offset: 0 },
            { opacity: 1, offset: 0.72 },
            { opacity: 0, offset: 1 },
          ],
          { duration: HANDOFF_OUT_MS, easing: 'linear', fill: 'forwards' }
        );
      } catch (error) {
        // The pill is already rebuilt but still invisible — never strand it.
        timer.completeRestore();
        return false;
      }

      this.handoffAnims = [shape, fade];

      // The pill fades in under the card's last frames.
      timer.completeRestore({ delayMs: Math.round(HANDOFF_OUT_MS * 0.7) });
      return true;
    }

    /** Hand the parked pill to whoever comes next (see createSubmission). */
    takeMorphOrigin() {
      const origin = this.morphFrom;
      this.morphFrom = null;
      return origin;
    }

    cancelHandoff() {
      if (!this.handoffAnims) return;
      this.handoffAnims.forEach((anim) => {
        try {
          anim.cancel();
        } catch (error) {
          /* already finished and collected */
        }
      });
      this.handoffAnims = null;
    }

    /** Drop the inline overrides a hand-off wrote, so the card's CSS applies. */
    clearHandoffStyles(card = this.card) {
      if (!card) return;
      card.style.opacity = '';
      card.style.transform = '';
      card.style.transformOrigin = '';
      card.style.borderColor = '';
      card.style.boxShadow = '';
    }

    /** Give the corner back to the pill, if this card was the one that took it. */
    releaseTimer() {
      if (!this.morphFrom) return;
      this.morphFrom = null;
      const timer = window.ProblemTimer ? window.ProblemTimer.getInstance() : null;
      if (timer) timer.restoreOverlay();
    }

    /** Put a phase on screen: morph the glyph, aim the sweep, arm the beat. */
    renderPhase(id) {
      const phase = PHASES[id];
      this.phase = id;
      this.interruptArmed = false;
      morphGlyph(this.card, phase.glyph);
      setSweep(this.card, phase.sweep);
      this.morphDoneAt = Date.now() + MORPH_MS;
      this.autoAt = this.morphDoneAt + phase.beat;

      if (id === 'synced') {
        this.terminal = 'synced';
        // Once the chroma has swept across the mark, fade the whole popup away
        // fast — no lingering hold, no waiting for the band to leave the icon.
        setTimeout(() => this.dismiss(true, true), DIAG_CROSS_MS);
      } else if (id === 'failed') {
        this.terminal = 'failed';
        if (this.msgEl) {
          this.msgEl.textContent = this.errorMessage || 'Sync failed';
          this.msgEl.setAttribute('title', this.errorMessage || 'Sync failed');
        }
        if (this.card) this.card.classList.add('lfb-fail');
        // The cross rests long enough to be read and copied, then the whole
        // card scales back down into the pill it grew out of.
        setTimeout(() => this.dismissToTimer(), FAIL_HOLD_MS);
      }
    }

    /**
     * Advance the queue. `interrupt` marks a checkpoint (verdict / sync
     * result): the resting sweep may be cut short, but a morph in flight is
     * atomic — the next morph is never armed earlier than morphDoneAt, and a
     * morph -> sweep / morph -> morph handover is never interrupted. Without
     * an interrupt, the queue waits for the phase's beat. Safe to call
     * repeatedly.
     */
    requestAdvance(interrupt) {
      if (this.isDismissed) return;
      if (interrupt) {
        this.interruptArmed = true;
        if (this.pumpTimer) {
          clearTimeout(this.pumpTimer);
          this.pumpTimer = null;
        }
      }
      if (this.pumpTimer) return;

      const tick = () => {
        this.pumpTimer = null;
        if (this.isDismissed) return;
        const gate = this.interruptArmed ? this.morphDoneAt : this.autoAt;
        const wait = gate - Date.now();
        if (wait > 0) {
          this.pumpTimer = setTimeout(tick, wait + 20);
          return;
        }
        this.interruptArmed = false;
        const next = this.queue.shift();
        if (next) {
          this.renderPhase(next);
          if (this.queue.length) this.requestAdvance(false);
        }
      };
      this.pumpTimer = setTimeout(tick, 0);
    }

    enqueue(id) {
      if (this.isDismissed || this.terminal) return;
      if (this.phase === id) return;
      if (this.queue.length && this.queue[this.queue.length - 1] === id) return;
      this.queue.push(id);
      this.requestAdvance(true);
    }

    // AI analysis runs server-side, so there is no separate "analyzing" phase
    // to show; the verdict is in, so play tick -> up arrow.
    setAIStarted() {
      this.setAISkipped();
    }

    setAIComplete() {
      this.setAISkipped();
    }

    setAISkipped() {
      this.enqueue('accepted');
      this.enqueue('syncing');
    }

    setBackendStarted() {
      if (this.phase === 'syncing' || this.queue.indexOf('syncing') > -1) return;
      if (this.phase === 'accepted' || this.queue.indexOf('accepted') > -1) {
        this.enqueue('syncing');
      } else {
        this.setAISkipped();
      }
    }

    succeed(message = 'Synced') {
      if (this.terminal === 'failed' || this.phase === 'failed' || this.queue.indexOf('failed') > -1) return;
      if (this.card) this.card.setAttribute('title', message);
      this.enqueue('synced');
    }

    fail(errorMessage = 'Failed') {
      // Never overwrite a successful sync.
      if (this.terminal === 'synced' || this.phase === 'synced' || this.queue.indexOf('synced') > -1) return;
      this.errorMessage = errorMessage;
      if (this.phase === 'failed') return;
      // A queued 'accepted' still plays (the verdict really was accepted);
      // any queued syncing/synced phases are superseded by the failure.
      this.queue = this.queue.filter((id) => id === 'accepted');
      this.queue.push('failed');
      this.requestAdvance(true);
    }

    dismiss(force = false, fast = false) {
      if (this.isDismissed && !force) return;
      this.isDismissed = true;

      if (this.pumpTimer) {
        clearTimeout(this.pumpTimer);
        this.pumpTimer = null;
      }
      this.cancelHandoff();

      if (!this.card) {
        this.releaseTimer();
        return;
      }

      this.clearHandoffStyles();
      const card = this.card;
      this.card = null;
      card.classList.add(fast ? 'lfb-gone' : 'lfb-hidden');
      setTimeout(
        () => {
          if (card && card.parentNode) card.parentNode.removeChild(card);
          this.releaseTimer();
        },
        fast ? FAST_FADE_MS + 40 : 360
      );
    }

    /**
     * Failure exit. The cross has had its hold; now the card scales back down
     * into the timer pill and the pill fades in as the card lands on it — the
     * exact reverse of the entrance, so a failed submission leaves the page
     * exactly as it found it.
     */
    dismissToTimer() {
      if (this.isDismissed) return;
      this.isDismissed = true;

      if (this.pumpTimer) {
        clearTimeout(this.pumpTimer);
        this.pumpTimer = null;
      }
      this.cancelHandoff();

      const card = this.card;
      if (!card) {
        this.releaseTimer();
        return;
      }

      const morphed = this.handoffOut();
      this.card = null;

      if (morphed) {
        setTimeout(() => {
          if (card.parentNode) card.parentNode.removeChild(card);
        }, HANDOFF_OUT_MS + 80);
        return;
      }

      this.clearHandoffStyles(card);
      card.classList.add('lfb-hidden');
      setTimeout(() => {
        if (card.parentNode) card.parentNode.removeChild(card);
        this.releaseTimer();
      }, 360);
    }
  }

  const toast = new ToastNotification();
  T.ToastNotification = ToastNotification;
  T.SubmissionTracker = SubmissionTracker;
  T.LeetFeedbackToast = toast;
  window.LeetFeedbackToast = toast;

  logger.log('toast utility loaded');
})();
