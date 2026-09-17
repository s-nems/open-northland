/** Shared inline SVG symbols for the DOM HUD: window ornaments, the close cross and the residents token. */
export const HUD_SYMBOLS = `<svg aria-hidden="true" width="0" height="0" style="position:absolute"><defs>
<symbol id="on-close" viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18"/></symbol>
<symbol id="on-corner" viewBox="0 0 30 30"><path d="M3 27V9q0-6 6-6h18" fill="none" stroke="currentColor" stroke-width="2.4"/><path d="M8 22V12q0-4 4-4h10" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M6 6q6-2 8 4t-4 8" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="14" cy="14" r="1.8" fill="currentColor"/></symbol>
<symbol id="on-knot" viewBox="0 0 64 20"><path d="m4 10 10-7 12 14L38 3l12 14 10-7-10-7-12 14L26 3 14 17Z" fill="none" stroke="currentColor" stroke-width="1.2"/></symbol>
<symbol id="on-pawns" viewBox="0 0 64 64"><g stroke="#402e1e" stroke-width="1.4"><path d="M9 46 14 29h7l5 17q-8 5-17 0Z"/><circle cx="17.5" cy="22" r="6"/><path d="m38 46 5-17h7l5 17q-8 5-17 0Z"/><circle cx="46.5" cy="22" r="6"/><path d="m20 54 7-22h10l7 22q-12 7-24 0Z"/><circle cx="32" cy="23" r="8"/></g><path d="M28 38 25 50M15 33l-3 10M44 33l-3 10" stroke="#edce94" opacity=".65" stroke-width="2"/></symbol>
<linearGradient id="on-pawn-wood"><stop stop-color="#debe83"/><stop offset=".55" stop-color="#a4804d"/><stop offset="1" stop-color="#61482d"/></linearGradient>
</defs></svg>`;

/** The four knot corners and the top knot every framed window carries. */
export const WINDOW_ORNAMENTS = `<svg aria-hidden="true" class="on-window__knot"><use href="#on-knot"/></svg>${[
  'tl',
  'tr',
  'bl',
  'br',
]
  .map(
    (corner) =>
      `<svg aria-hidden="true" class="on-window__corner on-window__corner--${corner}"><use href="#on-corner"/></svg>`,
  )
  .join('')}`;
