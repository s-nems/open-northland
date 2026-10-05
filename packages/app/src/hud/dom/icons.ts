import { iconCellStyle, uiFoundationArt } from '../../content/ui-foundation.js';

/** Line glyphs the DOM HUD draws inline, as `.on-glyph` SVG markup. */
export const GLYPH = {
  exit: '<svg aria-hidden="true" class="on-glyph" viewBox="0 0 24 24"><path d="M13 8V4H4v16h9v-4M9 12h12M17 8l4 4-4 4"/></svg>',
  close: '<svg aria-hidden="true" class="on-glyph"><use href="#on-close"/></svg>',
  bin: '<svg aria-hidden="true" class="on-glyph" viewBox="0 0 24 24"><path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13M10 11v6M14 11v6"/></svg>',
  menu: '<svg aria-hidden="true" class="on-glyph" viewBox="0 0 24 24"><path d="M5 7h14M5 12h14M5 17h14"/></svg>',
  go: '<svg aria-hidden="true" class="on-glyph on-notice__go" viewBox="0 0 24 24"><path d="m9 5 7 7-7 7"/></svg>',
  down: '<svg aria-hidden="true" class="on-glyph" viewBox="0 0 24 24"><path d="m5 9 7 7 7-7"/></svg>',
  pin: '<svg aria-hidden="true" class="on-glyph" viewBox="0 0 24 24"><path d="M12 21s-6-5.5-6-11a6 6 0 0 1 12 0c0 5.5-6 11-6 11Z"/><circle cx="12" cy="10" r="2.2"/></svg>',
  center:
    '<svg aria-hidden="true" class="on-glyph" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12 3v4M12 17v4M3 12h4M17 12h4"/></svg>',
  orders:
    '<svg aria-hidden="true" class="on-glyph" viewBox="0 0 24 24"><path d="M5 6h14M5 12h9M5 18h6M17 15l2 2 4-4"/></svg>',
  house:
    '<svg aria-hidden="true" class="on-glyph" viewBox="0 0 24 24"><path d="m3 11 9-7 9 7M5 10v10h14V10M9 20v-6h6v6"/></svg>',
  swords:
    '<svg aria-hidden="true" class="on-glyph" viewBox="0 0 24 24"><path d="M4 4l11 11M20 4 9 15M15 15l3 3M9 15l-3 3M17 13l4 4-2 2-4-4M7 13l-4 4 2 2 4-4"/></svg>',
  skull:
    '<svg aria-hidden="true" class="on-glyph" viewBox="0 0 24 24"><path d="M12 3a7 7 0 0 0-7 7c0 2.6 1.3 4.2 3 5.4V19h8v-3.6c1.7-1.2 3-2.8 3-5.4a7 7 0 0 0-7-7Z"/><circle cx="9.5" cy="10.5" r="1.4"/><circle cx="14.5" cy="10.5" r="1.4"/><path d="M10 19v2M14 19v2M12 13l-1 2h2Z"/></svg>',
  shield:
    '<svg aria-hidden="true" class="on-glyph" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="2.6"/><path d="M12 3.5v5.9M12 14.6v5.9M3.5 12h5.9M14.6 12h5.9"/></svg>',
  banner:
    '<svg aria-hidden="true" class="on-glyph" viewBox="0 0 24 24"><path d="M6 3v18M6 4h12l-3 4.5 3 4.5H6M4 21h4"/></svg>',
  scroll:
    '<svg aria-hidden="true" class="on-glyph" viewBox="0 0 24 24"><path d="M6 4h12v13a3 3 0 0 1-3 3H5a2 2 0 0 1-2-2v-1h12M6 4a2 2 0 0 0-2 2v9M9 8h6M9 12h6"/></svg>',
  chest:
    '<svg aria-hidden="true" class="on-glyph" viewBox="0 0 24 24"><path d="M3 10a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4v9H3zM3 12h18M12 12v4M10 14h4"/></svg>',
  forge:
    '<svg aria-hidden="true" class="on-glyph" viewBox="0 0 24 24"><path d="M4 20h16M7 20v-6h10v6M5 14h14l-2-4H7zM10 10V4h4v6M9 4h6"/></svg>',
  /* A cobbled track bending away, a stake fence, and a gate between two stakes: no highway
     markings, no battlements. */
  road: '<svg aria-hidden="true" class="on-glyph" viewBox="0 0 24 24"><path d="M4 21c2-5 2-9 4-12s5-4 8-6M16 21c0-5-1-8 1-11s3-3 4-5"/><path d="M8 17h1M11 17h1M14 17h1M10 12h1M13 12h1M12 8h1M15 8h1"/></svg>',
  palisade:
    '<svg aria-hidden="true" class="on-glyph" viewBox="0 0 24 24"><path d="M3 21V9l2.5-4 2.5 4v12M9.5 21V7l2.5-4 2.5 4v14M16 21V9l2.5-4 2.5 4v12M2 16h20"/></svg>',
  gate: '<svg aria-hidden="true" class="on-glyph" viewBox="0 0 24 24"><path d="M3 21V7l2.5-4 2.5 4v14M16 21V7l2.5-4 2.5 4v14M8 21V12a4 4 0 0 1 8 0v9M8 21h8M8 8h8"/><path d="M12 12v9M8 16.5h8"/></svg>',
  papers:
    '<svg aria-hidden="true" class="on-glyph" viewBox="0 0 24 24"><path d="M6 3h9l4 4v14H6zM15 3v4h4M9 12h6M9 16h6"/></svg>',
  grid: '<svg aria-hidden="true" class="on-glyph" viewBox="0 0 24 24"><path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z"/></svg>',
  back: '<svg aria-hidden="true" class="on-glyph" viewBox="0 0 24 24"><path d="m14 6-6 6 6 6"/></svg>',
  list: '<svg aria-hidden="true" class="on-glyph" viewBox="0 0 24 24"><path d="M4 6h3M10 6h10M4 12h3M10 12h10M4 18h3M10 18h10"/></svg>',
  search:
    '<svg aria-hidden="true" class="on-glyph" viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6"/><path d="m15 15 6 6"/></svg>',
  /* What a resident goes without: a hammer, a boot, a heart, a cradle, a blade and a mug. */
  tool: '<svg aria-hidden="true" class="on-glyph" viewBox="0 0 24 24"><path d="M14 4l6 6-3 3-6-6ZM12.5 8.5 4 17l3 3 8.5-8.5"/></svg>',
  boot: '<svg aria-hidden="true" class="on-glyph" viewBox="0 0 24 24"><path d="M6 4h5v9l7 3q2 1 2 4H6Z M6 16h8"/></svg>',
  heart:
    '<svg aria-hidden="true" class="on-glyph" viewBox="0 0 24 24"><path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.5-7 10-7 10Z"/></svg>',
  cradle:
    '<svg aria-hidden="true" class="on-glyph" viewBox="0 0 24 24"><path d="M5 9h14v4a7 7 0 0 1-14 0ZM3 20q9-5 18 0M12 9V5"/></svg>',
  blade:
    '<svg aria-hidden="true" class="on-glyph" viewBox="0 0 24 24"><path d="M19 3 8 14M6 12l6 6M4 20l4-4M19 3h-4M19 3v4"/></svg>',
  mug: '<svg aria-hidden="true" class="on-glyph" viewBox="0 0 24 24"><path d="M6 9h10v9a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2ZM16 11h2a2 2 0 0 1 2 2v1a2 2 0 0 1-2 2h-2M9 5v1M12 4v2M15 5v1"/></svg>',
  /* The selection panel's controls: the counter's steps, a lock, browsing, rename, an exchange; a pick
     on the map (assign a home, a workplace, a trade house) carries the house above. */
  minus: '<svg aria-hidden="true" class="on-glyph" viewBox="0 0 24 24"><path d="M6 12h12"/></svg>',
  plus: '<svg aria-hidden="true" class="on-glyph" viewBox="0 0 24 24"><path d="M12 6v12M6 12h12"/></svg>',
  lock: '<svg aria-hidden="true" class="on-glyph" viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
  next: '<svg aria-hidden="true" class="on-glyph" viewBox="0 0 24 24"><path d="m10 6 6 6-6 6"/></svg>',
  pen: '<svg aria-hidden="true" class="on-glyph" viewBox="0 0 24 24"><path d="m4 20 4-1L19 8l-3-3L5 16zM14 7l3 3"/></svg>',
  arrow:
    '<svg aria-hidden="true" class="on-glyph" viewBox="0 0 24 24"><path d="M4 12h16M14 6l6 6-6 6"/></svg>',
  arrowLeft:
    '<svg aria-hidden="true" class="on-glyph" viewBox="0 0 24 24"><path d="M20 12H4M10 6l-6 6 6 6"/></svg>',
  /* Two opposed arrows: a good balanced between two houses. */
  swap: '<svg aria-hidden="true" class="on-glyph" viewBox="0 0 24 24"><path d="M4 8h15M15 4l4 4-4 4M20 16H5M9 12l-4 4 4 4"/></svg>',
  /* A balance scale: the trade window, set up between a trader's two houses. */
  scales:
    '<svg aria-hidden="true" class="on-glyph" viewBox="0 0 24 24"><path d="M12 4v16M8 20h8M4 7h16M4 7l-2.5 7M4 7l2.5 7M20 7l-2.5 7M20 7l2.5 7M1.5 14h5a2.5 2.5 0 0 1-5 0ZM17.5 14h5a2.5 2.5 0 0 1-5 0Z"/></svg>',
  armor:
    '<svg aria-hidden="true" class="on-glyph" viewBox="0 0 24 24"><path d="M12 3 5 6v6c0 4 3 7 7 9 4-2 7-5 7-9V6z"/></svg>',
  /* A spoked cart wheel: the vehicle row's pick. */
  wheel:
    '<svg aria-hidden="true" class="on-glyph" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2"/><path d="M12 4v6M12 14v6M4 12h6M14 12h6M6.3 6.3l4.3 4.3M13.4 13.4l4.3 4.3M17.7 6.3l-4.3 4.3M10.6 13.4l-4.3 4.3"/></svg>',
  /* Two wedding bands, linked: the family row's find-a-partner order. */
  rings:
    '<svg aria-hidden="true" class="on-glyph" viewBox="0 0 24 24"><circle cx="9" cy="13" r="5.5"/><circle cx="15" cy="13" r="5.5"/><path d="M7 7.5 9 4M17 7.5 15 4"/></svg>',
  /* The vehicle panel's orders: halt, an anchor to moor, a ship to board or leave, a burning house, a
     crosshair on a spot, and a person with a plus to seat one. */
  stop: '<svg aria-hidden="true" class="on-glyph" viewBox="0 0 24 24"><path d="M7 7h10v10H7z"/></svg>',
  anchor:
    '<svg aria-hidden="true" class="on-glyph" viewBox="0 0 24 24"><path d="M12 4v16M8 7h8M5 13a7 7 0 0 0 14 0M5 13l-1.5 1.5M19 13l1.5 1.5"/></svg>',
  boardShip:
    '<svg aria-hidden="true" class="on-glyph" viewBox="0 0 24 24"><path d="M3 15h18l-3 5H6zM12 4v9M12 4l6 7h-6M8 9l4-4"/></svg>',
  leaveShip:
    '<svg aria-hidden="true" class="on-glyph" viewBox="0 0 24 24"><path d="M3 15h18l-3 5H6zM12 13V4M8 8l4-4 4 4"/></svg>',
  siegeHouse:
    '<svg aria-hidden="true" class="on-glyph" viewBox="0 0 24 24"><path d="m3 11 9-7 9 7M5 10v10h14V10M12 11c-2 2 1 3 0 5M14 13c1 1 0 3-2 3"/></svg>',
  crosshair:
    '<svg aria-hidden="true" class="on-glyph" viewBox="0 0 24 24"><path d="M12 3v5M12 16v5M3 12h5M16 12h5"/><circle cx="12" cy="12" r="4"/></svg>',
  /* The building panel's orders: a house raised a tier, the raise called off, the alarm bell and a
     house knocked down. */
  upgrade:
    '<svg aria-hidden="true" class="on-glyph" viewBox="0 0 24 24"><path d="m3 12 9-7 9 7M6 11v9h12v-9M12 19v-7M9 15l3-3 3 3"/></svg>',
  cancelUpgrade:
    '<svg aria-hidden="true" class="on-glyph" viewBox="0 0 24 24"><path d="m3 12 9-7 9 7M6 11v9h12v-9M10 13l4 4M14 13l-4 4"/></svg>',
  people:
    '<svg aria-hidden="true" class="on-glyph" viewBox="0 0 24 24"><circle cx="9" cy="8" r="3"/><path d="M3 20v-1a6 6 0 0 1 12 0v1M16 5a3 3 0 0 1 0 6M18 14a5 5 0 0 1 3 5v1"/></svg>',
  book: '<svg aria-hidden="true" class="on-glyph" viewBox="0 0 24 24"><path d="M4 5c3-1 6-1 8 1v14c-2-2-5-2-8-1ZM20 5c-3-1-6-1-8 1v14c2-2 5-2 8-1Z"/></svg>',
  bell: '<svg aria-hidden="true" class="on-glyph" viewBox="0 0 24 24"><path d="M6 16v-5a6 6 0 0 1 12 0v5l2 2H4zM10 20a2 2 0 0 0 4 0M12 3v2"/></svg>',
  demolish:
    '<svg aria-hidden="true" class="on-glyph" viewBox="0 0 24 24"><path d="m3 11 9-7 9 7M6 10v10h5l-1-3 2-2-1-3M14 20h4V10M16 4l2-2M19 6l2-1"/></svg>',
  /* A tick and a crossed circle: a household ware allowed or forbidden in every home. */
  check: '<svg aria-hidden="true" class="on-glyph" viewBox="0 0 24 24"><path d="m5 12 5 5 9-10"/></svg>',
  ban: '<svg aria-hidden="true" class="on-glyph" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="m6.5 6.5 11 11"/></svg>',
  addPerson:
    '<svg aria-hidden="true" class="on-glyph" viewBox="0 0 24 24"><circle cx="9" cy="6.5" r="2"/><path d="M6 20v-6l1-4h4l1 4v6M18 8v8M14 12h8"/></svg>',
} as const;

/** The stock categories' tab faces, indexed by stock tab (`good-categories.ts`), as solid silhouettes
 *  with cut-out detail like the residents' figures: a loaf, a tankard, a log, bricks, a mallet, a boot,
 *  a sword and a potion flask for the rest. */
export const STOCK_TAB_GLYPHS: readonly string[] = [
  '<svg aria-hidden="true" class="on-glyph on-glyph--solid" viewBox="0 0 24 24"><path fill-rule="evenodd" d="M4 15.5C4 11.4 7.6 8.5 12 8.5s8 2.9 8 7c0 1.6-.9 2.5-2.3 2.5H6.3C4.9 18 4 17.1 4 15.5ZM7.3 14.2l2.3-3.2 1.3.9-2.3 3.2ZM11 14.2l2.3-3.4 1.3.9-2.3 3.4ZM14.7 14.2 17 11l1.3.9-2.3 3.2Z"/></svg>',
  '<svg aria-hidden="true" class="on-glyph on-glyph--solid" viewBox="0 0 24 24"><path d="M4.9 8.3c-.7-1.9.6-3.7 2.5-3.4.6-1.4 2.4-2 3.7-1.1 1.2-1 3.1-.6 3.7.8 1.7-.1 2.7 1.7 1.9 3.7Z"/><path fill-rule="evenodd" d="M5.5 9.3h9.5v9.2a1.5 1.5 0 0 1-1.5 1.5H7a1.5 1.5 0 0 1-1.5-1.5ZM7.7 11.6h1.2v5.9H7.7ZM11.6 11.6h1.2v5.9h-1.2Z"/><path d="M15 10.5h2.3a2.7 2.7 0 0 1 2.7 2.7v2.1a2.7 2.7 0 0 1-2.7 2.7H15v-1.9h2.2a.9.9 0 0 0 .9-.9v-1.9a.9.9 0 0 0-.9-.9H15Z"/></svg>',
  '<svg aria-hidden="true" class="on-glyph on-glyph--solid" viewBox="0 0 24 24"><path d="M14 6.5H7.5C5.3 6.5 3.5 9 3.5 12s1.8 5.5 4 5.5H14C11.3 15 11.3 9 14 6.5Z"/><path fill-rule="evenodd" d="M16.5 6.5c2.1 0 3.8 2.5 3.8 5.5s-1.7 5.5-3.8 5.5-3.8-2.5-3.8-5.5 1.7-5.5 3.8-5.5Zm0 3.3c-.7 0-1.3 1-1.3 2.2s.6 2.2 1.3 2.2 1.3-1 1.3-2.2-.6-2.2-1.3-2.2Z"/></svg>',
  '<svg aria-hidden="true" class="on-glyph on-glyph--solid" viewBox="0 0 24 24"><rect x="3" y="4.5" width="8.3" height="4" rx=".6"/><rect x="12.7" y="4.5" width="8.3" height="4" rx=".6"/><rect x="3" y="10" width="3.8" height="4" rx=".6"/><rect x="8.2" y="10" width="7.6" height="4" rx=".6"/><rect x="17.2" y="10" width="3.8" height="4" rx=".6"/><rect x="3" y="15.5" width="8.3" height="4" rx=".6"/><rect x="12.7" y="15.5" width="8.3" height="4" rx=".6"/></svg>',
  '<svg aria-hidden="true" class="on-glyph on-glyph--solid" viewBox="0 0 24 24"><path d="M11.9 2.6l7.8 7.8-3.9 3.9-7.8-7.8ZM12.6 10.4l1.4 1.4-8.4 8.4a1 1 0 0 1-1.4 0 1 1 0 0 1 0-1.4Z"/></svg>',
  '<svg aria-hidden="true" class="on-glyph on-glyph--solid" viewBox="0 0 24 24"><rect x="4.5" y="3" width="7.2" height="2.6" rx=".6"/><path d="M5.2 6.9H11v5.9l5.6 2.3c1.5.6 2.6 1.6 2.9 2.9H5.2ZM5 19h14.7c0 1.1-.6 1.8-1.6 1.8H5Z"/></svg>',
  '<svg aria-hidden="true" class="on-glyph on-glyph--solid" viewBox="0 0 24 24"><path d="M12 1.8l2.6 3.4v8.4H9.4V5.2ZM5.5 13.6h13v2.6h-13ZM10.7 16.2h2.6v2.6h-2.6Z"/><circle cx="12" cy="20.4" r="1.9"/></svg>',
  '<svg aria-hidden="true" class="on-glyph on-glyph--solid" viewBox="0 0 24 24"><path fill-rule="evenodd" d="M9.5 3h5v2.2h-.9v3.4c3.1 1 5.4 3.8 5.4 7 0 3.8-3.1 6.4-7 6.4s-7-2.6-7-6.4c0-3.2 2.3-6 5.4-7V5.2h-.9ZM11.6 10c-2.3.8-3.9 2.3-4.3 4.2h9.4c-.4-1.9-2-3.4-4.3-4.2l-.2-.1V6.6h-.4v3.3Z"/></svg>',
];

/** The overview tab before the categories: three bars, longest first, the largest stocks. */
export const STOCK_OVERVIEW_GLYPH =
  '<svg aria-hidden="true" class="on-glyph on-glyph--solid" viewBox="0 0 24 24"><rect x="3" y="4.5" width="18" height="4" rx=".6"/><rect x="3" y="10" width="13" height="4" rx=".6"/><rect x="3" y="15.5" width="8" height="4" rx=".6"/></svg>';

/** The residents' counters: filled silhouettes (a dress, a tunic, a small figure), never faces. */
export const FIGURE = {
  woman:
    '<svg aria-hidden="true" class="on-figure" viewBox="0 0 32 32" fill="currentColor"><circle cx="16" cy="5.5" r="3.6"/><path d="M12.5 10.5h7l4.5 12.5H8z"/><rect x="12" y="23" width="3.2" height="8" rx="1"/><rect x="16.8" y="23" width="3.2" height="8" rx="1"/></svg>',
  man: '<svg aria-hidden="true" class="on-figure" viewBox="0 0 32 32" fill="currentColor"><circle cx="16" cy="5.5" r="3.6"/><rect x="9.5" y="10.5" width="13" height="11.5" rx="3"/><rect x="10.5" y="22" width="4.4" height="9" rx="1"/><rect x="17.1" y="22" width="4.4" height="9" rx="1"/></svg>',
} as const;

/** Painted-icon size on a beam action (design px); mirrors `.on-action__art` in foundation.css. */
export const ACTION_ART_PX = 36;

/** The residents token: stylized wooden figures, never faces. */
export const RESIDENTS_TOKEN =
  '<svg aria-hidden="true" class="on-token on-action__art" fill="url(#on-pawn-wood)"><use href="#on-pawns"/></svg>';

/** The game-menu medallion art: the painted door, or the line glyph while the pack is unpublished. */
export function menuArt(size: number): string {
  return uiFoundationArt() === null ? GLYPH.menu : paintedIcon('menu', size);
}

/** One painted cell of the delivered icon atlas in a `size` px box; an empty box while the pack is
 *  unpublished or the name is not in the atlas. */
export function paintedIcon(name: string, size: number): string {
  const art = uiFoundationArt();
  const style = art === null ? null : iconCellStyle(art.manifest.icons, name, size);
  const geometry =
    style === null
      ? ''
      : `background-size:${style.backgroundSize};background-position:${style.backgroundPosition};`;
  return `<span class="on-icon" aria-hidden="true" style="width:${size}px;height:${size}px;${geometry}"></span>`;
}
