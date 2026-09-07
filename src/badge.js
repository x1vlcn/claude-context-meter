/**
 * Badge UI — shadow DOM so claude.ai styles can't interfere.
 *
 * Two display modes:
 *   floating — position:fixed draggable widget (bottom-right fallback)
 *   nav      — inline element injected into claude.ai's top nav bar
 *
 * Click the compact badge to open/close the drill-down panel.
 * Panel sections are individually collapsible.
 */

import CONFIG from './config.js';
import { modelLabel, effortLabel } from './estimator.js';

// ── VulcanAX AX mark ────────────────────────────────────────────────────────────
// The brand identity glyph, inlined into the shadow DOM (no remote asset). Source:
// VulcanAX brand assets website/images/ax-mark.svg, normalized to a 0 0 240 240
// square via the lockup-square transform. Per brand canon the "A" body is
// currentColor (cream on this dark surface) and the "X" is red #E8232A — the one
// sanctioned identity use of red. One crisp A↔X seam, no outline, no gradient.
const AX_X_PATHS =
  '<path fill="var(--ccm-ax-red,#E8232A)" d="m 926.949,751.968 123.691,0.027 c 19.34,-0.017 61.14,-1.313 77.9,2.583 29.93,7.222 57.24,22.652 78.88,44.554 37.66,38.11 52.98,92.386 87.45,133.043 45.81,54.043 111.15,81.245 180.23,90.075 l -1.98,2.76 -154.77,0.74 c -38.06,0.13 -87.91,2.95 -123.73,-5.02 -58.46,-13 -99.15,-64.908 -125.23,-115.161 -14.19,-27.321 -33.26,-55.145 -50.19,-80.628 -23.621,-35.542 -53.316,-57.573 -94.048,-70.424 z"/>' +
  '<path fill="var(--ccm-ax-red,#E8232A)" d="m 1305.61,1055.03 110.45,-0.32 c 23.99,-0.05 52.98,-1.31 76.24,2.74 16.9,2.93 35.33,11.6 50.02,20.24 66.57,39.18 81.34,113.16 131.59,166.12 23.1,24.34 46.93,37.98 78.48,49.35 3.12,0.17 4.81,0.97 7.87,1.93 l 2.6,0.28 -0.36,1 c -33.8,1.74 -68.37,0.26 -102.25,0.8 -7.04,0.11 -14.24,0.03 -21.28,-0.33 -20.68,0.12 -56.35,1.35 -75.78,-0.73 -47.68,-5.11 -90.57,-40.88 -114.1,-81.35 -12.65,-21.75 -25.55,-49.79 -40.64,-69.29 -27.15,-35.08 -67.87,-62.92 -102.84,-90.44 z"/>' +
  '<path fill="var(--ccm-ax-red,#E8232A)" d="m 1346.71,953.445 c 81.73,-41.783 73.52,-95.96 132.06,-155.985 18.96,-18.91 46.08,-36.354 72.61,-42.12 24.76,-5.382 56.98,-3.461 82.78,-3.454 l 111.78,0.069 c 4.34,0 8.5,0.059 12.85,-0.209 l 0.21,1.637 c -2.01,0.401 -4.81,1.049 -6.79,1.192 -74.76,23.679 -99.46,76.115 -135.91,139.384 -65.08,112.951 -161.28,125.761 -269.59,59.486 z"/>' +
  '<path fill="var(--ccm-ax-red,#E8232A)" d="m 1202.63,1054.49 c 14,-0.24 31.69,-1.57 45.05,2.42 33.87,10.12 70.05,30.94 94.4,56.74 -5.62,3.52 -20.28,9.95 -27.17,13.83 -31.93,17.97 -39.79,37.54 -56.74,67.19 -4.91,7.72 -10.76,17.55 -16.55,24.4 -9.83,-12.62 -25.3,-38.05 -33.67,-52.05 -22.48,-37.56 -45.09,-74.98 -67.68,-112.45 z"/>';
const AX_A_PATHS =
  '<path fill="currentColor" d="m 588.062,752.024 174.685,-0.224 53.755,-0.068 c 15.715,-0.019 33.928,-0.837 49.066,2.517 29.789,6.613 57.14,21.415 78.97,42.737 26.348,25.845 54.579,85.142 74.202,117.77 11.78,19.605 24.21,39.292 36.23,58.777 l 98.24,155.967 c 24.07,37.98 50.87,86.82 80.17,120.02 17.38,19.7 55.92,38.83 82.47,42.78 -0.29,1.21 -0.4,1.43 -0.88,2.59 l -134.69,2.16 c -25.49,0.18 -47.54,1.94 -72.8,-2.48 -79.23,-13.85 -116.137,-82.84 -152.8,-146.01 -7.424,-12.8 -15.182,-25.65 -22.731,-38.43 C 895.564,1048.74 858.527,987.738 820.841,927.138 809.629,909.192 799.285,889.326 787.597,872.141 741.881,804.922 664.519,770.14 587.063,755.158 Z"/>' +
  '<path fill="currentColor" d="m 658.365,806.641 c 63.303,16.54 97.744,57.463 129.107,110.978 l 5.833,10.046 -118.488,190.955 c -25.096,40.26 -57.043,98.09 -89.185,129.38 -23.136,22.52 -52.064,38.19 -83.569,45.26 -25.734,5.72 -56.686,3.14 -83.207,3.42 -40.264,0.43 -81.879,-1.64 -121.951,-1.64 l -1.835,-2.49 c 37.633,-9.76 65.774,-28.12 92.356,-56.66 18.456,-19.83 31.873,-44.87 46.058,-67.99 l 40.955,-65.61 103.264,-165.708 c 25.361,-41.178 53.984,-90.269 80.662,-129.941 z"/>' +
  '<path fill="currentColor" d="m 847.981,1054.45 c 5.645,-0.36 12.752,-0.29 18.519,-0.4 4.667,9.38 17.211,28.66 23.014,38.28 l 42.299,70.09 c 9.146,15 19.995,31.79 28.265,47.1 -19.676,1.2 -47.178,0.36 -67.61,0.38 l -125.968,0.11 -113.012,-0.08 c 47.809,-80.61 89.131,-152.05 194.493,-155.48 z"/>';

function axMark(extraClass = '') {
  return (
    `<svg class="ax-mark ${extraClass}" viewBox="0 0 240 240" xmlns="http://www.w3.org/2000/svg" ` +
    `role="img" aria-label="VulcanAX">` +
    `<g transform="translate(12 79.82539134595558) scale(0.14716001607859439) translate(-295.07 -751.5471127069436)">` +
    AX_X_PATHS + AX_A_PATHS +
    `</g></svg>`
  );
}

// Build the brand palette as CSS custom properties for the shadow root, sourced
// from CONFIG.brand so every value lives in one place (and is options-tunable).
function brandVars() {
  const b = CONFIG.brand ?? {};
  return `:host, .badge {
    --ccm-surface:      ${b.surfaceBg    ?? '#0A0A0B'};
    --ccm-panel:        ${b.panelSurface ?? '#111113'};
    --ccm-nested:       ${b.nestedRow    ?? '#18181B'};
    --ccm-border:       ${b.border       ?? 'rgba(255,255,255,0.08)'};
    --ccm-border-heavy: ${b.borderHeavy  ?? 'rgba(255,255,255,0.14)'};
    --ccm-text:         ${b.textPrimary  ?? '#F5F5F7'};
    --ccm-muted:        ${b.textMuted    ?? '#A1A1AA'};
    --ccm-dim:          ${b.textDim      ?? '#6B6B72'};
    --ccm-ember:        ${b.accentEmber  ?? '#FF7A2D'};
    --ccm-amber:        ${b.warnAmber    ?? '#f59e0b'};
    --ccm-red:          ${b.dangerRed    ?? '#E8232A'};
    --ccm-positive:     ${b.positive     ?? '#4ADE80'};
    --ccm-ax-red:       ${b.axRed        ?? '#E8232A'};
  }`;
}

// ── CSS ───────────────────────────────────────────────────────────────────────
const CSS = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  /* Class selectors outrank the UA stylesheet's [hidden] rule, so anything given
     display: flex/grid/block by a class ignores the attribute — which is why the
     "Send feedback" button stayed visible underneath the form it had just opened.
     Restore it once here rather than writing .thing[hidden] for each case. */
  [hidden] { display: none !important; }

  .badge {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Inter', ui-sans-serif, sans-serif;
    font-size: 11.5px;
    line-height: 1;
    color: var(--ccm-text);
    user-select: none;
    position: relative;
  }
  /* When DM Sans is enabled (config-gated), numeric labels/metadata use it. */
  .badge.font-dmsans .compact-pct,
  .badge.font-dmsans .val,
  .badge.font-dmsans .primary,
  .badge.font-dmsans .ph-text { font-family: 'DM Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }

  /* ── FLOATING mode ─────────────────────────────────────── */
  .badge.floating {
    background: color-mix(in srgb, var(--ccm-surface) 93%, transparent);
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
    border: 1px solid var(--ccm-border);
    border-radius: 10px;
    padding: 8px 11px 7px;
    min-width: 190px;
    max-width: 280px;
    box-shadow: 0 4px 24px rgba(0, 0, 0, 0.5), 0 1px 4px rgba(0, 0, 0, 0.34);
    transition: box-shadow 0.2s ease, border-color 0.2s ease;
    cursor: pointer;
  }
  .badge.floating:hover {
    border-color: var(--ccm-border-heavy);
    box-shadow: 0 6px 32px rgba(0, 0, 0, 0.6), 0 2px 8px rgba(0, 0, 0, 0.4);
  }
  .badge.floating.dragging { cursor: grabbing; }

  /* ── NAV mode ──────────────────────────────────────────── */
  .badge.nav {
    background: var(--ccm-nested);
    border: 1px solid var(--ccm-border);
    border-radius: 7px;
    padding: 3px 9px 3px 7px;
    cursor: pointer;
    transition: background 0.15s, border-color 0.15s;
    display: inline-flex;
    align-items: center;
  }
  .badge.nav:hover { border-color: var(--ccm-border-heavy); background: var(--ccm-nested); }

  /* ── COMPACT row ───────────────────────────────────────── */
  .header {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .badge.floating .header { margin-bottom: 6px; }

  /* ── AX mark (brand identity glyph; replaces the old status dot) ───────── */
  .ax-mark {
    flex-shrink: 0;
    display: block;
    color: var(--ccm-text);   /* the "A" body = currentColor (cream); "X" is red */
  }
  .header .ax-mark { width: 16px; height: 16px; }
  .badge.nav .header .ax-mark { width: 14px; height: 14px; }
  .panel-header .ax-mark { width: 19px; height: 19px; }

  .primary {
    flex: 1;
    font-size: 11.5px;
    font-weight: 500;
    letter-spacing: 0.015em;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--ccm-text);
  }
  .badge.nav .primary { font-size: 11px; }

  .unconfirmed {
    font-size: 8.5px;
    color: var(--ccm-dim);
    vertical-align: super;
    cursor: help;
  }

  .warn-indicator {
    font-size: 10px;
    color: var(--ccm-amber);
    cursor: help;
    flex-shrink: 0;
    display: none;
  }
  .warn-indicator.visible { display: inline; }

  /* ── Refresh button ─────────────────────────────────────── */
  .refresh-btn {
    background: transparent;
    border: none;
    color: var(--ccm-dim);
    font-size: 11px;
    cursor: pointer;
    padding: 0 1px;
    flex-shrink: 0;
    line-height: 1;
    font-family: inherit;
    transition: color 0.15s;
    display: inline-block;
  }
  .refresh-btn:hover { color: var(--ccm-ember); }   /* ember on hover (active state) */
  .refresh-btn.spinning {
    animation: ccm-spin 0.75s linear infinite;
    color: var(--ccm-ember);
    pointer-events: none;
  }
  @keyframes ccm-spin {
    from { transform: rotate(0deg); }
    to   { transform: rotate(360deg); }
  }

  .chevron {
    font-size: 8px;
    color: var(--ccm-dim);
    flex-shrink: 0;
    transition: transform 0.18s ease;
    margin-left: 2px;
  }
  .badge.expanded .chevron { transform: rotate(180deg); }

  /* ── Progress bar (floating only) ─────────────────────── */
  /* Fill colour (ember → amber → red by threshold) is set inline in JS. */
  .bar-track {
    height: 3px;
    background: var(--ccm-border);
    border-radius: 2px;
    overflow: hidden;
  }
  .badge.nav .bar-track { display: none; }
  .bar-fill {
    height: 100%;
    border-radius: 2px;
    background: var(--ccm-ember);
    transition: width 0.5s cubic-bezier(0.4, 0, 0.2, 1), background 0.4s;
    will-change: width;
  }

  /* ── Stale row (warn state → amber) ────────────────────── */
  .stale-row {
    display: none;
    align-items: center;
    gap: 6px;
    margin-top: 6px;
    font-size: 10px;
    color: var(--ccm-amber);
  }
  .stale-row.visible { display: flex; }
  .reset-btn {
    background: color-mix(in srgb, var(--ccm-amber) 12%, transparent);
    border: 1px solid color-mix(in srgb, var(--ccm-amber) 35%, transparent);
    color: var(--ccm-amber);
    border-radius: 4px;
    padding: 2px 6px;
    font-size: 9.5px;
    font-family: inherit;
    cursor: pointer;
    transition: background 0.15s;
  }
  .reset-btn:hover { background: color-mix(in srgb, var(--ccm-amber) 22%, transparent); }

  /* ── Handoff row (ember accent) ────────────────────────── */
  .handoff-row {
    display: none;
    margin-top: 6px;
  }
  .handoff-row.visible { display: block; }
  .handoff-line {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }
  .handoff-icon { font-size: 11px; color: var(--ccm-ember); flex-shrink: 0; }
  .handoff-msg {
    font-size: 10px;
    color: var(--ccm-muted);
    flex: 1;
    min-width: 70px;
  }
  .handoff-btn {
    background: color-mix(in srgb, var(--ccm-ember) 13%, transparent);
    border: 1px solid color-mix(in srgb, var(--ccm-ember) 40%, transparent);
    color: var(--ccm-ember);
    border-radius: 4px;
    padding: 2px 7px;
    font-size: 9.5px;
    font-family: inherit;
    cursor: pointer;
    white-space: nowrap;
    transition: background 0.15s;
  }
  .handoff-btn:hover { background: color-mix(in srgb, var(--ccm-ember) 24%, transparent); }
  .handoff-btn.copy {
    background: color-mix(in srgb, var(--ccm-positive) 14%, transparent);
    border-color: color-mix(in srgb, var(--ccm-positive) 40%, transparent);
    color: var(--ccm-positive);
  }
  .handoff-btn.copy:hover { background: color-mix(in srgb, var(--ccm-positive) 26%, transparent); }
  .handoff-x {
    background: transparent;
    border: none;
    color: var(--ccm-dim);
    font-size: 10px;
    cursor: pointer;
    padding: 0 2px;
    flex-shrink: 0;
  }
  .handoff-x:hover { color: var(--ccm-text); }
  .handoff-note {
    font-size: 9px;
    color: color-mix(in srgb, var(--ccm-ember) 75%, var(--ccm-muted));
    line-height: 1.4;
    margin-top: 4px;
  }
  .handoff-note:empty { display: none; }

  /* ── PANEL ─────────────────────────────────────────────── */
  .panel {
    background: color-mix(in srgb, var(--ccm-panel) 97%, transparent);
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
    border: 1px solid var(--ccm-border);
    border-radius: 10px;
    box-shadow: 0 8px 40px rgba(0, 0, 0, 0.62), 0 2px 8px rgba(0, 0, 0, 0.44);
    min-width: 285px;
    max-width: 340px;
    overflow: hidden;
  }
  .badge.floating .panel {
    margin-top: 8px;
  }
  .badge.nav .panel {
    position: absolute;
    top: calc(100% + 8px);
    right: 0;
    z-index: 2147483647;
  }
  .panel[hidden] { display: none !important; }

  .panel-top {
    padding: 10px 0 0;
  }

  /* ── Section ───────────────────────────────────────────── */
  .section {
    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  }
  .section:last-of-type { border-bottom: none; }

  .sec-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 5px 14px;
    font-size: 11px;
    color: rgba(255, 255, 255, 0.65);
    gap: 8px;
  }
  .section.collapsible .sec-header {
    cursor: pointer;
    transition: background 0.1s;
  }
  .section.collapsible .sec-header:hover { background: rgba(255, 255, 255, 0.03); }

  .sec-right {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
  }

  .sec-chevron {
    font-size: 8px;
    color: rgba(255, 255, 255, 0.22);
    width: 10px;
    text-align: center;
    transition: transform 0.15s;
  }
  .section[aria-expanded="true"] .sec-chevron { transform: rotate(90deg); }

  .sec-body {
    overflow: hidden;
    max-height: 0;
    transition: max-height 0.2s ease;
  }
  .section[aria-expanded="true"] .sec-body { max-height: 400px; }

  .sec-body-inner {
    padding: 0 14px 8px;
  }

  /* ── Item rows ─────────────────────────────────────────── */
  .item-row {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 8px;
    font-size: 10.5px;
    line-height: 1.85;
    color: rgba(255, 255, 255, 0.48);
  }
  .item-label {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .val {
    font-family: 'SF Mono', 'Fira Code', ui-monospace, monospace;
    font-size: 10px;
    color: rgba(255, 255, 255, 0.30);
    white-space: nowrap;
    flex-shrink: 0;
  }
  .sec-header .val { color: rgba(255, 255, 255, 0.38); }

  .sub-label {
    font-size: 9.5px;
    color: rgba(255, 255, 255, 0.25);
    letter-spacing: 0.04em;
    text-transform: uppercase;
    margin: 6px 0 2px;
  }
  .sub-label:first-child { margin-top: 2px; }

  .feat-dot {
    display: inline-block;
    width: 5px; height: 5px;
    border-radius: 50%;
    margin-right: 5px;
    vertical-align: middle;
    flex-shrink: 0;
  }
  .feat-active .feat-dot   { background: var(--ccm-ember); }   /* active = ember */
  .feat-inactive .feat-dot { background: var(--ccm-border-heavy); }
  .feat-inactive { color: var(--ccm-dim); }

  .invoked-note {
    font-size: 9px;
    color: rgba(255, 255, 255, 0.20);
    margin-top: 4px;
    line-height: 1.4;
  }

  .empty-note {
    font-size: 10px;
    color: rgba(255, 255, 255, 0.22);
    font-style: italic;
    line-height: 1.6;
  }

  .closed-badge {
    font-size: 8.5px;
    color: color-mix(in srgb, var(--ccm-amber) 70%, transparent);
    margin-left: 4px;
  }

  .hdr-hint {
    font-size: 8.5px;
    color: rgba(255, 255, 255, 0.28);
    letter-spacing: 0.04em;
    text-transform: uppercase;
    margin-left: 3px;
  }

  /* Per-message drill-down list */
  .msg-list {
    max-height: 330px;
    overflow-y: auto;
  }
  .msg-list::-webkit-scrollbar { width: 6px; }
  .msg-list::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.12); border-radius: 3px; }
  .msg-row .role-dot {
    display: inline-block;
    width: 5px; height: 5px;
    border-radius: 50%;
    margin-right: 6px;
    vertical-align: middle;
    flex-shrink: 0;
  }
  .msg-row.role-human     .role-dot { background: var(--ccm-muted); }
  .msg-row.role-assistant .role-dot { background: var(--ccm-ember); }
  .msg-idx {
    color: rgba(255,255,255,0.30);
    font-variant-numeric: tabular-nums;
    margin-right: 5px;
    font-size: 9.5px;
  }

  /* ── Total + undercount ────────────────────────────────── */
  .panel-bottom {
    border-top: 1px solid rgba(255, 255, 255, 0.08);
    padding: 7px 14px 10px;
  }

  .total-row {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    font-size: 11.5px;
    font-weight: 600;
  }
  .total-row .val {
    font-size: 11px;
    color: var(--ccm-text);
  }
  .accent { transition: color 0.4s; }

  .undercount-note {
    margin-top: 6px;
    font-size: 9.5px;
    color: color-mix(in srgb, var(--ccm-amber) 80%, transparent);
    line-height: 1.45;
  }
  .undercount-note[hidden] { display: none; }

  .source-note {
    margin-top: 5px;
    font-size: 9px;
    color: rgba(255, 255, 255, 0.30);
    line-height: 1.4;
  }
  .source-note .tag {
    display: inline-block;
    font-size: 8.5px;
    padding: 0 4px;
    border-radius: 3px;
    margin-right: 4px;
    vertical-align: middle;
  }
  /* measured = authoritative/good → the one positive-green use; tree = ember
     accent; partial = warn amber; cached/estimated = neutral. Red stays reserved. */
  .tag.measured  { background: color-mix(in srgb, var(--ccm-positive) 16%, transparent); color: var(--ccm-positive); }
  .tag.tree      { background: color-mix(in srgb, var(--ccm-ember) 14%, transparent);    color: var(--ccm-ember); }
  .tag.partial   { background: color-mix(in srgb, var(--ccm-amber) 16%, transparent);    color: var(--ccm-amber); }
  .tag.loading   { background: var(--ccm-nested); color: var(--ccm-muted); }
  .tag.cached    { background: var(--ccm-nested); color: var(--ccm-muted); }
  .tag.estimated { background: var(--ccm-nested); color: var(--ccm-muted); }
  /* Tokenizer provenance: exact = ctok reproduced Claude own count;
     approx = the o200k fallback scaled by a measured constant. Approx is a
     caveat, not an error, so it takes the neutral muted treatment rather than a
     warning colour. */
  .tag.exact     { background: color-mix(in srgb, var(--ccm-positive) 14%, transparent); color: var(--ccm-positive); }
  .tag.approx    { background: var(--ccm-nested); color: var(--ccm-muted); }

  /* ── Compaction prediction ─────────────────────────────── */
  /* Whether this conversation auto-summarizes at the window or stops dead. The
     hard-wall case is the only genuinely actionable warning the meter produces,
     so it gets amber; the benign case stays quiet. */
  .compaction-note {
    margin-top: 6px;
    font-size: 9.5px;
    line-height: 1.45;
    display: flex;
    gap: 5px;
    align-items: baseline;
  }
  .compaction-note[hidden] { display: none; }
  .compaction-note .cmp-dot {
    width: 5px; height: 5px; border-radius: 50%;
    flex-shrink: 0; transform: translateY(-1px);
  }
  .compaction-note.will    { color: rgba(255,255,255,0.34); }
  .compaction-note.will    .cmp-dot { background: var(--ccm-positive); }
  .compaction-note.wall    { color: color-mix(in srgb, var(--ccm-amber) 85%, transparent); }
  .compaction-note.wall    .cmp-dot { background: var(--ccm-amber); }
  .compaction-note.unknown { color: rgba(255,255,255,0.24); }
  .compaction-note.unknown .cmp-dot { background: var(--ccm-muted); }

  /* ── Usage quota (session / weekly allowance) ───────────── */
  /* A DIFFERENT axis from context fill: this is plan allowance spent, which is the
     other way a conversation stops. Hidden entirely when the endpoint gave us
     nothing we could read, rather than rendering an empty or invented bar. */
  .quota { padding: 7px 14px 9px; border-top: 1px solid rgba(255,255,255,0.08); }
  .quota[hidden] { display: none; }
  .quota-head {
    font-size: 9px; letter-spacing: 0.06em; text-transform: uppercase;
    color: rgba(255,255,255,0.30); margin-bottom: 5px;
  }
  .quota-row { margin-top: 5px; }
  .quota-row .qr-top {
    display: flex; justify-content: space-between; align-items: baseline;
    font-size: 9.5px; color: var(--ccm-muted);
  }
  .quota-row .qr-pct { font-variant-numeric: tabular-nums; color: var(--ccm-text); }
  .quota-bar {
    margin-top: 3px; height: 3px; border-radius: 2px;
    background: rgba(255,255,255,0.07); overflow: hidden;
  }
  .quota-bar > i { display: block; height: 100%; border-radius: 2px; transition: width 0.4s, background 0.4s; }

  .note-row {
    font-size: 9.5px;
    color: rgba(255, 255, 255, 0.28);
    font-style: italic;
    line-height: 1.5;
    margin-top: 2px;
  }

  .badge-tag {
    font-size: 8px;
    padding: 0 3px;
    border-radius: 3px;
    margin-left: 4px;
    vertical-align: middle;
    letter-spacing: 0.02em;
  }
  .badge-tag.measured  { background: color-mix(in srgb, var(--ccm-positive) 20%, transparent); color: var(--ccm-positive); }

  /* ── Compact percentage pill (mobile / narrow) ─────────── */
  /* Hidden on desktop; shown when content.js flags the badge .is-compact. */
  .compact-pct {
    display: none;
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.01em;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    flex-shrink: 0;
  }

  /* When compact: shrink the floating widget to an icon + % pill. The full
     "model · used/total" text moves into the expanded panel header. */
  .badge.floating.is-compact {
    min-width: 0;
    max-width: calc(100vw - 16px);
    padding: 7px 9px;
    /* backdrop-filter establishes a containing block, which would trap the
       position:fixed bottom-sheet panel inside the pill. Drop it in compact mode
       so the sheet anchors to the viewport. The pill bg is already near-opaque. */
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
  }
  .badge.is-compact .primary,
  .badge.is-compact .unconfirmed { display: none; }
  .badge.is-compact .compact-pct { display: inline-block; }
  .badge.is-compact .bar-track { display: none; }

  /* ── Panel header (model · used/total) — surfaced inside the panel ─────── */
  .panel-header {
    display: none;
    padding: 9px 14px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.07);
    align-items: center;
    gap: 8px;
  }
  .panel-header .ph-text {
    flex: 1;
    font-size: 11.5px;
    font-weight: 600;
    color: var(--ccm-text);
    line-height: 1.3;
  }
  .panel-close {
    display: none;
    background: transparent;
    border: none;
    color: var(--ccm-muted);
    font-size: 15px;
    cursor: pointer;
    line-height: 1;
    flex-shrink: 0;
    padding: 2px 4px;
    font-family: inherit;
  }
  .panel-close:hover { color: var(--ccm-text); }
  /* Panel header + close are only meaningful in compact (bottom-sheet) mode. */
  .badge.is-compact .panel-header { display: flex; }
  .badge.is-compact .panel-close  { display: inline-block; }

  /* ── Bottom-sheet panel (compact) ──────────────────────── */
  /* position:fixed escapes the shadow host and anchors to the viewport, so the
     panel never clips off-screen regardless of where the pill sits. */
  .badge.is-compact .panel {
    position: fixed;
    left: 0; right: 0; bottom: 0;
    top: auto;
    width: 100vw;
    min-width: 0;
    max-width: 100vw;
    max-height: 82vh;
    overflow-y: auto;
    border-radius: 14px 14px 0 0;
    margin: 0;
    z-index: 2147483647;
    box-shadow: 0 -8px 40px rgba(0, 0, 0, 0.6);
  }
  .badge.is-compact.nav .panel { right: 0; }
  .badge.is-compact .sec-body { transition: none; } /* avoid jank inside a scroll sheet */
  .badge.is-compact .sec-body-inner { padding-bottom: 10px; }

  /* Make long inner drill-down lists scroll within the sheet, not overflow it. */
  .badge.is-compact .msg-list { max-height: 40vh; }
  .badge.is-compact .section[aria-expanded="true"] .sec-body { max-height: 50vh; }

  /* ── Handoff-doc actions (VulcanAX scaffold) ───────────── */
  .hdoc {
    border-top: 1px solid rgba(255, 255, 255, 0.08);
    padding: 10px 14px 12px;
  }
  .hdoc-title {
    font-size: 10.5px;
    font-weight: 600;
    color: rgba(255, 255, 255, 0.55);
    letter-spacing: 0.06em;
    text-transform: uppercase;
    margin-bottom: 9px;
  }
  .hdoc-actions {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }
  .hdoc-btn {
    background: color-mix(in srgb, var(--ccm-ember) 11%, transparent);
    border: 1px solid color-mix(in srgb, var(--ccm-ember) 32%, transparent);
    color: var(--ccm-ember);
    border-radius: 6px;
    padding: 7px 10px;
    font-size: 11px;
    font-family: inherit;
    cursor: pointer;
    width: 100%;
    text-align: left;
    display: flex;
    align-items: center;
    gap: 7px;
    transition: background 0.15s;
  }
  .hdoc-btn:hover { background: color-mix(in srgb, var(--ccm-ember) 22%, transparent); }
  .hdoc-btn .hdoc-icon {
    opacity: 0.75;
    flex-shrink: 0;
    font-size: 12px;
  }
  .hdoc-btn.ok {
    background: color-mix(in srgb, var(--ccm-positive) 16%, transparent);
    border-color: color-mix(in srgb, var(--ccm-positive) 42%, transparent);
    color: var(--ccm-positive);
  }
  .hdoc-note {
    font-size: 10.5px;
    color: rgba(255, 255, 255, 0.38);
    line-height: 1.5;
    margin-top: 9px;
    padding-top: 8px;
    border-top: 1px solid rgba(255, 255, 255, 0.05);
  }

  /* ── Feedback ──────────────────────────────────────────── */
  /* Deliberately the quietest block in the panel: it is always available but
     never competes with the meter for attention. Muted until hovered. */
  .fb { border-top: 1px solid rgba(255,255,255,0.08); padding: 9px 14px 11px; }
  .fb-open {
    background: none;
    border: 1px solid rgba(255,255,255,0.10);
    color: rgba(255,255,255,0.45);
    border-radius: 6px; padding: 6px 10px; width: 100%;
    font-size: 10.5px; font-family: inherit; cursor: pointer; text-align: left;
    display: flex; align-items: center; gap: 7px;
    transition: color 0.15s, border-color 0.15s;
  }
  .fb-open:hover { color: var(--ccm-ember);
                   border-color: color-mix(in srgb, var(--ccm-ember) 34%, transparent); }
  .fb-form[hidden] { display: none; }
  .fb-kinds { display: flex; gap: 5px; margin-bottom: 7px; }
  .fb-kind {
    flex: 1; background: none; border: 1px solid rgba(255,255,255,0.10);
    color: rgba(255,255,255,0.5); border-radius: 5px; padding: 5px 4px;
    font-size: 10px; font-family: inherit; cursor: pointer; transition: all 0.15s;
  }
  .fb-kind[aria-pressed="true"] {
    background: color-mix(in srgb, var(--ccm-ember) 14%, transparent);
    border-color: color-mix(in srgb, var(--ccm-ember) 40%, transparent);
    color: var(--ccm-ember);
  }
  .fb-text {
    width: 100%; box-sizing: border-box; min-height: 62px; resize: vertical;
    background: var(--ccm-nested); color: var(--ccm-text);
    border: 1px solid rgba(255,255,255,0.10); border-radius: 6px;
    padding: 7px 8px; font-size: 11px; font-family: inherit; line-height: 1.45;
  }
  .fb-text:focus { outline: none;
                   border-color: color-mix(in srgb, var(--ccm-ember) 45%, transparent); }
  .fb-diag { margin-top: 7px; font-size: 9.5px; color: rgba(255,255,255,0.34); }
  .fb-diag label { display: flex; align-items: center; gap: 6px; cursor: pointer; }
  .fb-diag input { accent-color: var(--ccm-ember); }
  .fb-diag-detail {
    margin-top: 5px; padding: 6px 7px; border-radius: 5px;
    background: rgba(255,255,255,0.03); line-height: 1.5;
    font-variant-numeric: tabular-nums; word-break: break-word;
  }
  .fb-diag-detail[hidden] { display: none; }
  .fb-row { display: flex; gap: 6px; margin-top: 8px; align-items: center; }
  .fb-send {
    background: color-mix(in srgb, var(--ccm-ember) 14%, transparent);
    border: 1px solid color-mix(in srgb, var(--ccm-ember) 38%, transparent);
    color: var(--ccm-ember); border-radius: 6px; padding: 6px 12px;
    font-size: 11px; font-family: inherit; cursor: pointer; flex: 1;
  }
  .fb-send:hover:not(:disabled) { background: color-mix(in srgb, var(--ccm-ember) 24%, transparent); }
  .fb-send:disabled { opacity: 0.45; cursor: not-allowed; }
  .fb-send.ok {
    background: color-mix(in srgb, var(--ccm-positive) 16%, transparent);
    border-color: color-mix(in srgb, var(--ccm-positive) 42%, transparent);
    color: var(--ccm-positive);
  }
  .fb-send.err {
    background: color-mix(in srgb, var(--ccm-danger) 14%, transparent);
    border-color: color-mix(in srgb, var(--ccm-danger) 40%, transparent);
    color: var(--ccm-danger);
  }
  .fb-cancel {
    background: none; border: none; color: rgba(255,255,255,0.35);
    font-size: 10.5px; font-family: inherit; cursor: pointer; padding: 6px 8px;
  }
  .fb-cancel:hover { color: rgba(255,255,255,0.6); }
  .fb-msg { margin-top: 6px; font-size: 10px; line-height: 1.45; }
  .fb-msg[hidden] { display: none; }
  .fb-msg.err { color: var(--ccm-danger); }
  .fb-msg.ok  { color: var(--ccm-positive); }

  /* ── Touch / coarse-pointer hit targets (≥44px) ────────── */
  @media (pointer: coarse) {
    .refresh-btn, .chevron, .handoff-x, .panel-close {
      min-width: 44px;
      min-height: 44px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    .reset-btn, .handoff-btn, .hdoc-btn {
      min-height: 44px;
      padding-top: 0;
      padding-bottom: 0;
      display: inline-flex;
      align-items: center;
    }
    .sec-header { padding-top: 12px; padding-bottom: 12px; }
    .item-row  { line-height: 2.1; }
  }
`;

// ── HTML template ─────────────────────────────────────────────────────────────
const HTML = `
<div class="badge floating">
  <div class="compact">
    <div class="header">
      ${axMark('ax-pill')}
      <span class="primary">Detecting model…</span>
      <span class="compact-pct" id="compact-pct">—</span>
      <span class="unconfirmed" title=""></span>
      <span class="warn-indicator" id="warn-indicator" title="">⚠</span>
      <button class="refresh-btn" id="refresh-btn" title="Re-fetch conversation — force a full recount">↺</button>
      <span class="chevron">▾</span>
    </div>
    <div class="bar-track"><div class="bar-fill" style="width:0%"></div></div>
    <div class="stale-row" id="stale-row">
      <span>⚠ estimate stale</span>
      <button class="reset-btn" id="reset-btn">reset</button>
    </div>
    <div class="handoff-row" id="handoff-row">
      <div class="handoff-line">
        <span class="handoff-icon">⛓</span>
        <span class="handoff-msg" id="handoff-msg">Context limit near</span>
        <button class="handoff-btn" id="handoff-generate">Generate handoff →</button>
        <button class="handoff-btn copy" id="handoff-copy">Copy handoff</button>
        <button class="handoff-x" id="handoff-dismiss" title="Dismiss">✕</button>
      </div>
      <div class="handoff-note" id="handoff-note"></div>
    </div>
  </div>

  <div class="panel" id="panel" hidden>
    <!-- Header (shown in compact/bottom-sheet mode): full model · used/total line. -->
    <div class="panel-header">
      ${axMark('ax-header')}
      <span class="ph-text" id="ph-text">—</span>
      <button class="panel-close" id="panel-close" title="Close" aria-label="Close">✕</button>
    </div>
    <div class="panel-top">

      <!-- System prompt / baseline -->
      <div class="section collapsible" id="sec-baseline" aria-expanded="false">
        <div class="sec-header">
          <span>System prompt</span>
          <div class="sec-right">
            <span class="val" id="p-baseline">—</span>
            <span class="sec-chevron">▸</span>
          </div>
        </div>
        <div class="sec-body"><div class="sec-body-inner" id="baseline-items"></div></div>
      </div>

      <!-- Tools / features -->
      <div class="section collapsible" id="sec-tools" aria-expanded="false">
        <div class="sec-header">
          <span>Tools / features</span>
          <div class="sec-right">
            <span class="val" id="p-tools">—</span>
            <span class="sec-chevron">▸</span>
          </div>
        </div>
        <div class="sec-body"><div class="sec-body-inner">
          <div class="sub-label">Available (definition loaded)</div>
          <div id="p-tools-available"></div>
          <div class="sub-label">Invoked (already in Messages)</div>
          <div class="item-row">
            <span class="item-label">Tool calls in thread</span>
            <span class="val" id="p-invoked-count">0</span>
          </div>
          <div class="invoked-note">
            Available = definition loaded into context window.<br>
            Invoked = already counted inside Messages above.
          </div>
        </div></div>
      </div>

      <!-- Messages -->
      <div class="section collapsible" id="sec-messages" aria-expanded="false">
        <div class="sec-header">
          <span id="p-messages-label">Messages</span>
          <div class="sec-right">
            <span class="val" id="p-messages">—</span>
            <span class="sec-chevron">▸</span>
          </div>
        </div>
        <div class="sec-body"><div class="sec-body-inner"><div class="msg-list" id="p-messages-list"></div></div></div>
      </div>

      <!-- Project (instructions + knowledge) -->
      <div class="section collapsible" id="sec-project" aria-expanded="false" hidden>
        <div class="sec-header">
          <span>Project</span>
          <div class="sec-right">
            <span class="val" id="p-project">—</span>
            <span class="sec-chevron">▸</span>
          </div>
        </div>
        <div class="sec-body"><div class="sec-body-inner" id="p-project-list"></div></div>
      </div>

      <!-- Attachments -->
      <div class="section collapsible" id="sec-attach" aria-expanded="false">
        <div class="sec-header">
          <span>Attachments</span>
          <div class="sec-right">
            <span class="val" id="p-attach">—</span>
            <span class="sec-chevron">▸</span>
          </div>
        </div>
        <div class="sec-body"><div class="sec-body-inner" id="p-attach-list"></div></div>
      </div>

      <!-- Artifact content (bodies produced in the conversation) -->
      <div class="section collapsible" id="sec-artifacts" aria-expanded="false">
        <div class="sec-header">
          <span>Artifacts <span class="hdr-hint">content</span></span>
          <div class="sec-right">
            <span class="val" id="p-artifacts">—</span>
            <span class="sec-chevron">▸</span>
          </div>
        </div>
        <div class="sec-body"><div class="sec-body-inner" id="p-artifact-list"></div></div>
      </div>

      <!-- Free space -->
      <div class="section">
        <div class="sec-header">
          <span>Free space</span>
          <span class="val" id="p-free">—</span>
        </div>
      </div>

    </div><!-- /panel-top -->

    <div class="panel-bottom">
      <div class="total-row">
        <span class="accent" id="p-label">Context used</span>
        <span class="val accent" id="p-pct">—</span>
      </div>
      <div class="source-note" id="source-note"></div>
      <div class="compaction-note" id="compaction-note" hidden>
        <span class="cmp-dot"></span><span id="compaction-text"></span>
      </div>
      <div class="undercount-note" id="undercount-note" hidden></div>
    </div>

    <!-- Plan allowance, read from the /usage endpoint (unrounded, unlike the
         claude.ai usage page). Stays hidden unless we could actually read it. -->
    <div class="quota" id="quota" hidden>
      <div class="quota-head">Plan usage</div>
      <div id="quota-rows"></div>
    </div>

    <!-- VulcanAX session-handoff doc: stats auto-filled, decisions/next-steps as
         empty slots; chat-side ask copies the in-chat instruction. -->
    <div class="hdoc">
      <div class="hdoc-title">Session Handoff</div>
      <div class="hdoc-actions">
        <button class="hdoc-btn" id="hdoc-generate" title="Copy a VulcanAX handoff doc (stats auto-filled, decisions/next-steps as slots)"><span class="hdoc-icon">⊕</span>Generate handoff</button>
        <button class="hdoc-btn" id="hdoc-download" title="Download the handoff doc as a .md file"><span class="hdoc-icon">↓</span>Download .md</button>
        <button class="hdoc-btn" id="hdoc-ask" title="Copy the one-line instruction to paste into the chat so Claude writes the decisions / next-steps"><span class="hdoc-icon">↵</span>Copy chat-side ask</button>
      </div>
      <div class="hdoc-note" id="hdoc-note">Stats are extension-measured. Decisions &amp; next steps stay empty — paste the chat-side ask into the conversation, then drop Claude's reply into the slots.</div>
    </div>

    <!-- Feedback. Never carries conversation content: the diagnostics block below
         is rendered verbatim from what will actually be transmitted, so the claim
         is inspectable rather than asserted. -->
    <div class="fb" id="fb">
      <button class="fb-open" id="fb-open" title="Send feedback to the developers">
        <span aria-hidden="true">✎</span>Send feedback
      </button>
      <div class="fb-form" id="fb-form" hidden>
        <div class="fb-kinds" role="group" aria-label="Feedback type">
          <button class="fb-kind" id="fb-kind-bug"   data-kind="bug"   aria-pressed="true">Bug</button>
          <button class="fb-kind" id="fb-kind-idea"  data-kind="idea"  aria-pressed="false">Idea</button>
          <button class="fb-kind" id="fb-kind-other" data-kind="other" aria-pressed="false">Other</button>
        </div>
        <textarea class="fb-text" id="fb-text" maxlength="2000"
                  placeholder="What happened, or what would help?"></textarea>
        <div class="fb-diag">
          <label>
            <input type="checkbox" id="fb-diag-toggle" checked>
            Include diagnostics
            <button class="fb-cancel" id="fb-diag-show" style="padding:0 0 0 2px">show</button>
          </label>
          <div class="fb-diag-detail" id="fb-diag-detail" hidden></div>
        </div>
        <div class="fb-row">
          <button class="fb-send" id="fb-send">Send</button>
          <button class="fb-cancel" id="fb-cancel">Cancel</button>
        </div>
        <div class="fb-msg" id="fb-msg" hidden></div>
      </div>
    </div>
  </div><!-- /panel -->
</div><!-- /badge -->
`;

// ── Badge class ───────────────────────────────────────────────────────────────
export class Badge {
  constructor({ placement = 'floating', savedPosition, compact = false,
                onReset, onRefresh,
                onHandoffGenerate, onHandoffCopy, onHandoffDismiss,
                onHandoffDoc, onHandoffDocDownload, onHandoffDocAsk,
                onFeedback, feedbackDiagnostics }) {
    this._onRefresh         = onRefresh;
    this._onHandoffGenerate = onHandoffGenerate;
    this._onHandoffCopy     = onHandoffCopy;
    this._onHandoffDismiss  = onHandoffDismiss;
    this._onHandoffDoc         = onHandoffDoc;
    this._onHandoffDocDownload = onHandoffDocDownload;
    this._onHandoffDocAsk      = onHandoffDocAsk;
    // onFeedback(payload) -> Promise<{ok:boolean, error?:string}>
    this._onFeedback           = onFeedback;
    // Returns the diagnostics object that would be attached, so the panel can show
    // the user exactly what leaves the browser before they agree to send it.
    this._feedbackDiagnostics  = feedbackDiagnostics;
    this._fbKind               = 'bug';
    // Any non-floating placement ('header' / legacy 'nav') uses the inline style.
    const inline = placement !== 'floating';
    this._mode     = inline ? 'header' : 'floating';
    this._expanded = false;
    this._compact  = !!compact;

    this._host = document.createElement('div');
    this._host.id = 'ccm-badge-host';
    this._baseDisplay = inline ? 'inline-block' : 'block';

    this._leftCenter = placement === 'left-center';

    if (!inline) {
      if (this._leftCenter) {
        // Left-center: positioned by content.js via setHostLeft() after measuring the chat column.
        // Drag is disabled in this mode (position is driven by layout, not user drag).
        Object.assign(this._host.style, {
          position:    'fixed',
          left:        '8px',  // initial placeholder; content.js calls setHostLeft()
          top:         '50%',
          transform:   'translateY(-50%)',
          zIndex:      '2147483647',
          touchAction: 'none',
        });
      } else {
        const pos = savedPosition ?? CONFIG.badgePosition;
        Object.assign(this._host.style, {
          position:    'fixed',
          right:       `${pos.right ?? 20}px`,
          bottom:      `${pos.bottom ?? 80}px`,
          zIndex:      '2147483647',
          touchAction: 'none',
        });
      }
    } else {
      // Header mode: inline by default; content.js may override for top-center pin.
      Object.assign(this._host.style, {
        display:  'inline-block',
        position: 'relative',
        zIndex:   '200',
      });
    }

    const shadow = this._host.attachShadow({ mode: 'open' });
    this._shadow = shadow;

    // Brand palette CSS variables first (so the CSS below can reference them).
    const brandEl = document.createElement('style');
    brandEl.textContent = brandVars();
    shadow.appendChild(brandEl);

    const styleEl = document.createElement('style');
    styleEl.textContent = CSS;
    shadow.appendChild(styleEl);

    // Optional DM Sans (config-gated). The font must load in the MAIN document for
    // the shadow tree to use it; we inject a Google Fonts <link> once. MV3-safe
    // (stylesheet link, no remote script). claude.ai CSP may block it — harmless
    // if so, the system font remains.
    if (CONFIG.brand?.useDMSans) ensureDMSans();

    const wrapper = document.createElement('div');
    wrapper.innerHTML = HTML;
    this._badgeEl = wrapper.firstElementChild;

    // Switch CSS mode class (the inline styling lives under `.badge.nav`).
    if (inline) {
      this._badgeEl.classList.remove('floating');
      this._badgeEl.classList.add('nav');
    }
    this._badgeEl.classList.toggle('is-compact', this._compact);
    this._badgeEl.classList.toggle('font-dmsans', !!CONFIG.brand?.useDMSans);

    shadow.appendChild(this._badgeEl);

    this._setupToggle(onReset);
    this._setupSectionToggles();
    this._setupHandoff();
    this._setupHandoffDoc();
    // Drag is disabled in left-center mode (position is layout-driven, not user-dragged).
    if (!inline && !this._leftCenter) this._setupDrag();
  }

  // Update the host's fixed left offset (used in left-center placement mode).
  setHostLeft(px) {
    if (this._host) this._host.style.left = `${px}px`;
  }

  // Return true if this badge instance uses left-center placement.
  get isLeftCenter() { return this._leftCenter; }

  // Toggle the compact (icon+% pill, bottom-sheet panel) layout at runtime.
  // Called by content.js when the viewport crosses the responsive breakpoint.
  setCompact(compact) {
    compact = !!compact;
    if (compact === this._compact) return;
    this._compact = compact;
    this._badgeEl?.classList.toggle('is-compact', compact);
  }

  get compact() { return this._compact; }

  // Attach host to a DOM container. Caller decides where.
  attachTo(container) {
    container.appendChild(this._host);
  }

  // Show/hide the whole badge (used to hide on non-conversation pages).
  setHidden(hidden) {
    if (this._host) this._host.style.display = hidden ? 'none' : this._baseDisplay;
  }

  // ── Public update ─────────────────────────────────────────────────────────
  update({ modelId, modelConfirmed, effort, breakdown, isStale, handoff, treeSource,
           isRefreshing, quota, messageLimit }) {
    if (!breakdown?.contextWindow) return;

    const s = this._shadow;
    const {
      total, contextWindow, pct,
      baseline, tools, featureDetails,
      conversation, files, artifacts,
      attachmentItems, artifactItems, messageItems,
      invokedToolCount, undercountReasons,
      source, measured,
      projectInstructionTokens, projectInstructionMeasured,
      projectKnowledgeManual, projectKnowledgeUnmeasured,
      imageCount, messageCount,
    } = breakdown;

    const free    = Math.max(0, contextWindow - total);
    const pctStr  = `${Math.round(pct * 100)}%`;
    // Bar progression: ember (healthy) → amber (warn) → red (danger). Red is
    // RESTRICTED to the danger threshold (and error states) per brand canon.
    const B = CONFIG.brand ?? {};
    const color   = pct >= CONFIG.thresholds.danger ? (B.dangerRed   ?? '#E8232A')
                  : pct >= CONFIG.thresholds.warn   ? (B.warnAmber   ?? '#f59e0b')
                  : (B.accentEmber ?? '#FF7A2D');

    // ── Compact view ───────────────────────────────────────────────────────
    // Effort shown when known (e.g. "Opus 4.8 · High · 142k/500k (28%)"); the
    // segment is omitted rather than defaulted when effort is undetected.
    // "~" prefix signals a partial (DOM-only) estimate — not authoritative.
    const mLabel  = modelLabel(modelId);
    const effLbl  = effortLabel(effort);
    const effSeg  = effLbl ? `${effLbl} · ` : '';
    // '~' prefix: provisional estimate — not yet confirmed by the tree fetch.
    // Shown while the fetch is in-flight ('loading'), using a stale cache ('cached'),
    // or falling back to DOM-only ('partial'). Cleared once the tree resolves ('tree')
    // or server confirms usage ('measured').
    const partialTilde = (!measured && (treeSource === 'partial' || treeSource === 'loading' || treeSource === 'cached')) ? '~' : '';
    const fullText =
      `${mLabel} · ${effSeg}${partialTilde}${fmtK(total)}/${fmtK(contextWindow)} (${pctStr})`;
    s.querySelector('.primary').textContent = fullText;
    // Compact pill shows just the percentage; the full line lives in the panel header.
    s.getElementById('compact-pct').textContent = `${partialTilde}${pctStr}`;
    s.getElementById('ph-text').textContent = fullText;

    // Refresh button spinner.
    s.getElementById('refresh-btn').classList.toggle('spinning', !!isRefreshing);

    const unconf = s.querySelector('.unconfirmed');
    unconf.textContent = (!modelConfirmed || !modelId) ? '?' : '';
    unconf.title = !modelId ? 'Model unknown — send a message to confirm'
      : !modelConfirmed ? 'Model unconfirmed — detected from DOM, not yet seen in a network request'
      : '';

    // The AX mark keeps its brand colours (cream A / red X); the threshold colour
    // lives on the percentage + bar only, never on the identity glyph.
    const fill = s.querySelector('.bar-fill');
    fill.style.width      = `${Math.min(pct * 100, 100)}%`;
    fill.style.background = color;

    s.getElementById('stale-row').classList.toggle('visible', !!isStale);

    // Handoff row — armed → "Generate", requested/done → "Copy"
    this._renderHandoff(handoff);

    // Undercount indicator in compact view
    const warnEl = s.getElementById('warn-indicator');
    const hasUndercount = undercountReasons?.length > 0;
    warnEl.classList.toggle('visible', hasUndercount);
    warnEl.title = hasUndercount ? 'May undercount: ' + undercountReasons.join('; ') : '';

    for (const el of s.querySelectorAll('.accent')) {
      el.style.color = color;
    }

    // ── Panel ──────────────────────────────────────────────────────────────
    // System prompt section.
    //
    // `baseline` from assemble() INCLUDES project instructions, but the panel also
    // lists Project as its own top-level row. Showing the combined figure here made
    // the visible rows sum to more than the total — 2.5k of project instructions
    // appeared in both lines, so anyone checking the arithmetic got the wrong
    // answer even though the total itself was right. Subtract it: System prompt is
    // the base prompt alone, Project owns its own tokens, and the rows now add up
    // to Context used.
    const baseOnly = Math.max(0, baseline - projectInstructionTokens);
    s.getElementById('p-baseline').textContent = fmtK(baseOnly);
    const baselineItems = s.getElementById('baseline-items');
    baselineItems.innerHTML = '';
    baselineItems.appendChild(makeRow('Base system', fmtK(baseOnly)));
    baselineItems.appendChild(makeNote('Base system prompt is an estimate (~28k). Project instructions are counted under Project.'));

    // Tools section
    s.getElementById('p-tools').textContent = fmtK(tools);
    const toolsList = s.getElementById('p-tools-available');
    toolsList.innerHTML = '';
    for (const f of (featureDetails ?? [])) {
      const row = document.createElement('div');
      row.className = `item-row ${f.active ? 'feat-active' : 'feat-inactive'}`;
      row.innerHTML = `<span class="feat-dot"></span><span class="item-label">${f.label}</span><span class="val">${f.active ? fmtK(f.cost) : '—'}</span>`;
      toolsList.appendChild(row);
    }
    s.getElementById('p-invoked-count').textContent = String(invokedToolCount ?? 0);

    // Messages — total + expandable per-message breakdown
    s.getElementById('p-messages').textContent = fmtK(conversation);
    s.getElementById('p-messages-label').textContent =
      messageCount > 0 ? `Messages (${messageCount})` : 'Messages';
    renderMessageList(s.getElementById('p-messages-list'), messageItems);

    // Project section (instructions + knowledge)
    const projSec  = s.getElementById('sec-project');
    const projList = s.getElementById('p-project-list');
    const showProject = projectInstructionTokens > 0 || projectKnowledgeUnmeasured || projectKnowledgeManual > 0;
    projSec.hidden = !showProject;
    if (showProject) {
      projList.innerHTML = '';
      s.getElementById('p-project').textContent =
        fmtK(projectInstructionTokens + (projectKnowledgeManual || 0));
      if (projectInstructionTokens > 0) {
        projList.appendChild(makeRow(
          `Instructions (${projectInstructionMeasured ? 'measured' : 'manual'})`,
          fmtK(projectInstructionTokens),
        ));
      }
      if (projectKnowledgeManual > 0) {
        projList.appendChild(makeRow('Knowledge (manual est.)', fmtK(projectKnowledgeManual)));
      } else if (projectKnowledgeUnmeasured) {
        projList.appendChild(makeNote('Project Knowledge: unmeasured — RAG retrieval not visible in the payload. Set a manual estimate in Options.'));
      }
    }

    // Attachments
    s.getElementById('p-attach').textContent = fmtK(files);
    const attachList = s.getElementById('p-attach-list');
    attachList.innerHTML = '';
    if (attachmentItems?.length) {
      for (const a of attachmentItems) {
        attachList.appendChild(makeRow(a.name, fmtK(a.tokens), a.sizeText));
      }
    } else {
      attachList.innerHTML = '<div class="empty-note">No attachments detected</div>';
    }

    // Artifacts
    s.getElementById('p-artifacts').textContent = fmtK(artifacts);
    const artifactList = s.getElementById('p-artifact-list');
    artifactList.innerHTML = '';
    if (artifactItems?.length) {
      for (const a of artifactItems) {
        // Tree-sourced artifacts are fully counted; only DOM-cached closed panels
        // get the "(closed)" marker (they're approximations).
        const suffix = (!a.open && !a.fromTree) ? '<span class="closed-badge">(closed)</span>' : '';
        const row = document.createElement('div');
        row.className = 'item-row';
        row.innerHTML = `<span class="item-label">${esc(a.title)}${suffix}</span><span class="val">${fmtK(a.tokens)}</span>`;
        artifactList.appendChild(row);
      }
    } else {
      artifactList.innerHTML = '<div class="empty-note">No artifacts detected</div>';
    }

    // Free / total
    s.getElementById('p-free').textContent  = fmtK(free);
    s.getElementById('p-pct').textContent   = pctStr;
    s.getElementById('p-label').textContent = 'Context used';

    // Source indicator — shows how authoritative the current count is.
    const srcEl = s.getElementById('source-note');
    if (measured) {
      srcEl.innerHTML = `<span class="tag measured">measured</span>total from server token usage (input + live output)`;
    } else if (treeSource === 'loading') {
      srcEl.innerHTML = `<span class="tag loading">loading…</span>fetching conversation tree — count will update shortly`;
    } else if (treeSource === 'tree') {
      srcEl.innerHTML = `<span class="tag tree">tree</span>tokenized from full conversation payload`;
    } else if (treeSource === 'partial') {
      srcEl.innerHTML = `<span class="tag partial">partial</span>visible DOM only — full tree not yet loaded · click ↺ to recount`;
    } else if (treeSource === 'cached') {
      const refreshNote = isRefreshing ? ' · refreshing…' : ' · click ↺ to recount';
      srcEl.innerHTML = `<span class="tag cached">cached</span>from previous visit${refreshNote}`;
    } else {
      srcEl.innerHTML = `<span class="tag estimated">estimated</span>tokenized from full conversation payload`;
    }

    // Tokenizer provenance. Appended rather than replacing the source tag: the two
    // say different things — source = WHERE the text came from (tree/DOM/cache),
    // tokenizer = HOW ACCURATELY it was counted. A tree-sourced count on the
    // approximate tokenizer is still an estimate, and the panel must not imply
    // otherwise.
    if (breakdown.tokenizer === 'approx') {
      srcEl.innerHTML += ` · <span class="tag approx">approx</span>estimated tokenizer`;
    } else if (breakdown.tokenizer === 'exact' && !measured) {
      srcEl.innerHTML += ` · <span class="tag exact">exact</span>Claude tokenizer`;
    }
    if (breakdown.windowConfirmed === false) {
      srcEl.innerHTML += ` · window size unconfirmed for this model`;
    }

    // Compaction prediction — will this chat summarize at the limit, or stop?
    this._renderCompaction(breakdown.compaction);

    // Plan allowance.
    this._renderQuota(quota, messageLimit);

    // Undercount note
    const noteEl = s.getElementById('undercount-note');
    if (hasUndercount) {
      noteEl.hidden = false;
      noteEl.textContent = '⚠ May undercount: ' + undercountReasons.join(', ');
    } else {
      noteEl.hidden = true;
    }
  }

  // ── Keyboard containment ───────────────────────────────────────────────────
  /**
   * Keep our own keystrokes from reaching claude.ai.
   *
   * claude.ai focuses its composer on any keystroke that arrives at the page
   * without an editable target — the usual "type anywhere to start typing" chat
   * behaviour. Its guard checks `document.activeElement`, and shadow DOM
   * RETARGETS at the boundary: with focus on our textarea, the page sees
   * `<div id="ccm-badge-host">`, which is not editable. So every character typed
   * into the feedback box was stolen into the chat composer instead.
   *
   * The listener is on `window` in the CAPTURE phase because that is the
   * earliest point in the propagation path — earlier than any handler the page
   * has on document, in either phase — so the page's handler never runs for
   * events that started inside this shadow root.
   *
   * It stops PROPAGATION only, never the default action, so the character still
   * lands in the field. Events that did not originate here are untouched, so
   * typing everywhere else on claude.ai behaves exactly as before.
   */
  _containKeyboard() {
    const shadow = this._shadow;
    const CONTAINED = [
      'keydown', 'keypress', 'keyup',
      'beforeinput', 'input',
      'paste', 'cut', 'copy',
      // IME composition, or typing in Japanese/Chinese would still leak.
      'compositionstart', 'compositionupdate', 'compositionend',
    ];
    const startedHere = (e) => {
      if (typeof e.composedPath !== 'function') return false;
      return e.composedPath().includes(shadow);
    };
    for (const type of CONTAINED) {
      window.addEventListener(type, (e) => {
        if (startedHere(e)) e.stopPropagation();
      }, true);
    }
  }

  // ── Feedback ───────────────────────────────────────────────────────────────
  _setupFeedback() {
    const s = this._shadow;
    const $ = (id) => s.getElementById(id);
    const form = $('fb-form'), text = $('fb-text'), send = $('fb-send'), msg = $('fb-msg');
    if (!form) return;

    const stop = (e) => e.stopPropagation();   // keep clicks from collapsing the panel
    $('fb').addEventListener('click', stop);

    $('fb-open').addEventListener('click', () => {
      form.hidden = false;
      $('fb-open').hidden = true;
      text.focus();
    });
    const close = () => {
      form.hidden = true;
      $('fb-open').hidden = false;
      msg.hidden = true;
      send.className = 'fb-send';
      send.textContent = 'Send';
      send.disabled = false;
    };
    $('fb-cancel').addEventListener('click', close);

    for (const id of ['fb-kind-bug', 'fb-kind-idea', 'fb-kind-other']) {
      $(id).addEventListener('click', (e) => {
        this._fbKind = e.currentTarget.dataset.kind;
        for (const other of s.querySelectorAll('.fb-kind')) {
          other.setAttribute('aria-pressed', String(other === e.currentTarget));
        }
      });
    }

    $('fb-diag-show').addEventListener('click', () => {
      const box = $('fb-diag-detail');
      if (!box.hidden) { box.hidden = true; $('fb-diag-show').textContent = 'show'; return; }
      const diag = this._feedbackDiagnostics?.() ?? {};
      box.textContent = Object.entries(diag).map(([k, v]) => `${k}: ${v}`).join('  ·  ')
                        || 'nothing to send';
      box.hidden = false;
      $('fb-diag-show').textContent = 'hide';
    });

    send.addEventListener('click', async () => {
      const body = text.value.trim();
      if (!body) { text.focus(); return; }
      send.disabled = true;
      send.textContent = 'Sending…';
      msg.hidden = true;

      const payload = {
        kind: this._fbKind,
        message: body,
        diagnostics: $('fb-diag-toggle').checked
          ? (this._feedbackDiagnostics?.() ?? null)
          : null,
      };
      let res;
      try { res = await this._onFeedback?.(payload); }
      catch (e) { res = { ok: false, error: String(e?.message ?? e) }; }

      if (res?.ok) {
        send.className = 'fb-send ok';
        send.textContent = 'Sent ✓';
        text.value = '';
        setTimeout(close, 1400);
      } else {
        send.className = 'fb-send err';
        send.textContent = 'Failed';
        send.disabled = false;
        msg.hidden = false;
        msg.className = 'fb-msg err';
        msg.textContent = res?.error ?? 'Could not send. Check the feedback endpoint in Options.';
      }
    });
  }

  // ── Compaction prediction ──────────────────────────────────────────────────
  // Anthropic gates automatic context management on code execution being enabled.
  // With it on, a full window degrades quality; with it off, the conversation
  // stops. Nothing else in the panel tells the user which of those they are
  // heading for.
  _renderCompaction(compaction) {
    const el = this._shadow.getElementById('compaction-note');
    if (!el) return;
    if (!compaction || compaction.state === 'unknown') {
      el.hidden = true;
      return;
    }
    el.hidden = false;
    el.className = `compaction-note ${compaction.state}`;
    this._shadow.getElementById('compaction-text').textContent = compaction.label ?? '';
    el.title = compaction.note ?? '';
  }

  // ── Plan allowance ─────────────────────────────────────────────────────────
  // Rendered only from figures we actually read. The /usage endpoint has no
  // published schema, so an unrecognised response hides the section rather than
  // showing zeros — a wrong quota bar is worse than none.
  _renderQuota(quota, messageLimit) {
    const s = this._shadow;
    const box = s.getElementById('quota');
    const rows = s.getElementById('quota-rows');
    if (!box || !rows) return;

    const entries = [];
    const add = (label, w) => {
      if (!w || w.fraction == null || !Number.isFinite(w.fraction)) return;
      entries.push({ label, frac: Math.max(0, Math.min(1, w.fraction)), resetsAt: w.resetsAt });
    };
    if (quota && !quota.error && !quota.unknownShape) {
      add('Session', quota.session);
      add('Weekly', quota.weekly);
      add('Weekly · Opus', quota.opus);
    }
    // The live SSE fraction is exact where the usage page rounds, so it wins for
    // the session row when both are present.
    const liveFrac = Number(messageLimit?.utilization);
    if (Number.isFinite(liveFrac) && liveFrac >= 0 && liveFrac <= 1) {
      const existing = entries.find((e) => e.label === 'Session');
      if (existing) existing.frac = liveFrac;
      else entries.unshift({ label: 'Session', frac: liveFrac, resetsAt: messageLimit?.resetsAt });
    }

    if (!entries.length) { box.hidden = true; rows.textContent = ''; return; }

    const brand = (CONFIG.brand ?? {});
    box.hidden = false;
    rows.textContent = '';
    for (const e of entries) {
      const pct = Math.round(e.frac * 100);
      const colour = e.frac >= 0.90 ? (brand.dangerRed ?? '#E8232A')
                   : e.frac >= 0.70 ? (brand.warnAmber ?? '#f59e0b')
                   : (brand.accentEmber ?? '#FF7A2D');
      const row = document.createElement('div');
      row.className = 'quota-row';
      const top = document.createElement('div');
      top.className = 'qr-top';
      const name = document.createElement('span');
      name.textContent = e.label;
      const val = document.createElement('span');
      val.className = 'qr-pct';
      val.textContent = `${pct}%`;
      top.append(name, val);
      const bar = document.createElement('div');
      bar.className = 'quota-bar';
      const fill = document.createElement('i');
      fill.style.width = `${e.frac * 100}%`;
      fill.style.background = colour;
      bar.append(fill);
      row.append(top, bar);
      if (e.resetsAt) row.title = `Resets ${e.resetsAt}`;
      rows.append(row);
    }
  }

  // ── Handoff row state ──────────────────────────────────────────────────────
  _renderHandoff(handoff) {
    const s = this._shadow;
    const row = s.getElementById('handoff-row');
    const status = handoff?.status ?? 'idle';
    const show = status === 'armed' || status === 'requested' || status === 'done';
    row.classList.toggle('visible', show);
    if (!show) return;

    const genBtn  = s.getElementById('handoff-generate');
    const copyBtn = s.getElementById('handoff-copy');
    const msg     = s.getElementById('handoff-msg');
    const note    = s.getElementById('handoff-note');

    const armed = status === 'armed';
    genBtn.style.display  = armed ? '' : 'none';
    copyBtn.style.display = armed ? 'none' : '';
    msg.textContent =
      armed              ? 'Context limit near'
      : status === 'done' ? 'Handoff ready'
      :                     'Handoff requested';
    note.textContent = handoff?.note ?? '';
  }

  // ── Panel toggle ──────────────────────────────────────────────────────────
  _setupToggle(onReset) {
    const shadow  = this._shadow;
    const panel   = shadow.getElementById('panel');
    const compact = shadow.querySelector('.compact');

    compact.addEventListener('click', (e) => {
      if (e.target.closest('.reset-btn')) return;
      this._expanded = !this._expanded;
      panel.hidden = !this._expanded;
      this._badgeEl.classList.toggle('expanded', this._expanded);
    });

    // Close on outside click
    document.addEventListener('click', (e) => {
      if (!this._expanded) return;
      if (!this._host.contains(e.target)) {
        this._expanded = false;
        panel.hidden = true;
        this._badgeEl.classList.remove('expanded');
      }
    }, true);

    shadow.getElementById('reset-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      onReset?.();
    });

    shadow.getElementById('refresh-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      this._onRefresh?.();
    });

    // Bottom-sheet close (compact mode) — collapses the panel.
    shadow.getElementById('panel-close')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this._expanded = false;
      panel.hidden = true;
      this._badgeEl.classList.remove('expanded');
    });
  }

  // ── Handoff-doc buttons (VulcanAX scaffold) ────────────────────────────────
  // Each callback does the real work in content.js (it owns the measured state)
  // and resolves to a boolean; we flash the button to confirm copy/download.
  _setupHandoffDoc() {
    const s = this._shadow;
    const wire = (id, cb, okText) => {
      const btn = s.getElementById(id);
      if (!btn) return;
      const original = btn.textContent;
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        let ok = false;
        try { ok = await cb?.(); } catch (_) { ok = false; }
        btn.textContent = ok ? okText : 'Failed — try again';
        btn.classList.toggle('ok', ok);
        setTimeout(() => { btn.textContent = original; btn.classList.remove('ok'); }, 1900);
      });
    };
    wire('hdoc-generate', () => this._onHandoffDoc?.(),         'Copied ✓');
    wire('hdoc-download', () => this._onHandoffDocDownload?.(), 'Saved ✓');
    wire('hdoc-ask',      () => this._onHandoffDocAsk?.(),      'Copied ✓');
    this._setupFeedback();
    this._containKeyboard();
  }

  // ── Handoff buttons ───────────────────────────────────────────────────────
  _setupHandoff() {
    const s = this._shadow;
    const stop = (fn) => (e) => { e.stopPropagation(); fn?.(); };
    s.getElementById('handoff-generate')?.addEventListener('click', stop(this._onHandoffGenerate));
    s.getElementById('handoff-copy')?.addEventListener('click',     stop(this._onHandoffCopy));
    s.getElementById('handoff-dismiss')?.addEventListener('click',  stop(this._onHandoffDismiss));
  }

  // ── Section collapsible toggles ───────────────────────────────────────────
  _setupSectionToggles() {
    this._shadow.querySelectorAll('.section.collapsible').forEach((sec) => {
      sec.querySelector('.sec-header')?.addEventListener('click', () => {
        const open = sec.getAttribute('aria-expanded') === 'true';
        sec.setAttribute('aria-expanded', open ? 'false' : 'true');
      });
    });
  }

  // ── Drag (floating only) ──────────────────────────────────────────────────
  _setupDrag() {
    const host   = this._host;
    const shadow = this._shadow;
    let dragging = false, startX = 0, startY = 0, startRight = 0, startBottom = 0;
    let didDrag  = false;

    shadow.querySelector('.compact').addEventListener('pointerdown', (e) => {
      if (e.target.closest('.reset-btn, .refresh-btn, .handoff-btn, .handoff-x')) return;
      dragging = true;
      didDrag  = false;
      startX = e.clientX;
      startY = e.clientY;
      startRight  = parseInt(host.style.right, 10)  || CONFIG.badgePosition.right;
      startBottom = parseInt(host.style.bottom, 10) || CONFIG.badgePosition.bottom;
      e.preventDefault();
      this._badgeEl.classList.add('dragging');
    });

    document.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) didDrag = true;
      host.style.right  = `${Math.max(0, startRight - dx)}px`;
      host.style.bottom = `${Math.max(0, startBottom - dy)}px`;
    });

    document.addEventListener('pointerup', () => {
      if (!dragging) return;
      dragging = false;
      this._badgeEl.classList.remove('dragging');
      if (didDrag) {
        // Suppress the click that fires immediately after pointerup ends a drag
        document.addEventListener('click', (ev) => ev.stopPropagation(), { capture: true, once: true });
        chrome.storage.local.set({
          badgePosition: {
            right:  parseInt(host.style.right, 10),
            bottom: parseInt(host.style.bottom, 10),
          },
        });
      }
    });
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtK(n) {
  if (!Number.isFinite(n)) return '—';
  // Opus 5 / Sonnet 5 have a 1M chat window, so the old k-only formatter rendered
  // it as the unreadable "1000k". Switch to M at a million.
  if (n >= 1_000_000) {
    const m = n / 1_000_000;
    return `${m >= 10 ? Math.round(m) : Math.round(m * 100) / 100}M`;
  }
  if (n >= 1_000) return `${Math.round(n / 100) / 10}k`;
  return `${Math.round(n)}`;
}

// Inject the DM Sans stylesheet <link> into the main document once (config-gated).
// Idempotent; safe no-op if claude.ai's CSP blocks the external sheet.
function ensureDMSans() {
  try {
    if (document.getElementById('ccm-dmsans-font')) return;
    const pre1 = document.createElement('link');
    pre1.rel = 'preconnect'; pre1.href = 'https://fonts.googleapis.com';
    const pre2 = document.createElement('link');
    pre2.rel = 'preconnect'; pre2.href = 'https://fonts.gstatic.com'; pre2.crossOrigin = 'anonymous';
    const link = document.createElement('link');
    link.id  = 'ccm-dmsans-font';
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap';
    (document.head ?? document.documentElement).append(pre1, pre2, link);
  } catch (_) { /* CSP blocked — system font remains */ }
}

function makeNote(text) {
  const el = document.createElement('div');
  el.className = 'note-row';
  el.textContent = text;
  return el;
}

// Per-message rows. For very long threads we show the most recent CAP messages
// and summarize the earlier ones in a single note (keeps the panel manageable).
const MSG_CAP = 60;
function renderMessageList(container, items) {
  if (!container) return;
  container.innerHTML = '';
  if (!items?.length) {
    container.innerHTML = '<div class="empty-note">No messages counted</div>';
    return;
  }
  const overflow = items.length - MSG_CAP;
  if (overflow > 0) {
    const earlier = items.slice(0, overflow).reduce((sum, m) => sum + (m.tokens || 0), 0);
    container.appendChild(makeNote(`+ ${overflow} earlier message${overflow > 1 ? 's' : ''} · ${fmtK(earlier)}`));
  }
  for (const m of items.slice(Math.max(0, overflow))) {
    const row = document.createElement('div');
    row.className = `item-row msg-row role-${m.role === 'assistant' ? 'assistant' : 'human'}`;
    const who = m.role === 'assistant' ? 'Claude' : 'You';
    row.innerHTML =
      `<span class="item-label"><span class="role-dot"></span>` +
      `<span class="msg-idx">${m.idx}</span>${who}</span>` +
      `<span class="val">${fmtK(m.tokens)}</span>`;
    container.appendChild(row);
  }
}

function makeRow(label, valText, sub = '') {
  const row = document.createElement('div');
  row.className = 'item-row';
  const subHtml = sub ? ` <span style="color:rgba(255,255,255,0.18);font-size:9px">${esc(sub)}</span>` : '';
  row.innerHTML = `<span class="item-label">${esc(label)}${subHtml}</span><span class="val">${valText}</span>`;
  return row;
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
