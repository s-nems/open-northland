import { iconCellStyle, uiFoundationArt } from '../../content/own-assets/ui-foundation.js';

/** Line glyphs the DOM HUD draws inline, as `.on-glyph` SVG markup. */
export const GLYPH = {
  close: '<svg aria-hidden="true" class="on-glyph"><use href="#on-close"/></svg>',
  bin: '<svg aria-hidden="true" class="on-glyph" viewBox="0 0 24 24"><path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13M10 11v6M14 11v6"/></svg>',
  menu: '<svg aria-hidden="true" class="on-glyph" viewBox="0 0 24 24"><path d="M5 7h14M5 12h14M5 17h14"/></svg>',
  go: '<svg aria-hidden="true" class="on-glyph on-notice__go" viewBox="0 0 24 24"><path d="m9 5 7 7-7 7"/></svg>',
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
  banner:
    '<svg aria-hidden="true" class="on-glyph" viewBox="0 0 24 24"><path d="M6 3v18M6 4h12l-3 4.5 3 4.5H6M4 21h4"/></svg>',
  scroll:
    '<svg aria-hidden="true" class="on-glyph" viewBox="0 0 24 24"><path d="M6 4h12v13a3 3 0 0 1-3 3H5a2 2 0 0 1-2-2v-1h12M6 4a2 2 0 0 0-2 2v9M9 8h6M9 12h6"/></svg>',
  chest:
    '<svg aria-hidden="true" class="on-glyph" viewBox="0 0 24 24"><path d="M3 10a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4v9H3zM3 12h18M12 12v4M10 14h4"/></svg>',
  forge:
    '<svg aria-hidden="true" class="on-glyph" viewBox="0 0 24 24"><path d="M4 20h16M7 20v-6h10v6M5 14h14l-2-4H7zM10 10V4h4v6M9 4h6"/></svg>',
  road: '<svg aria-hidden="true" class="on-glyph" viewBox="0 0 24 24"><path d="M4 20 9 4h6l5 16M12 6v3M12 12v3M12 18v2"/></svg>',
  wall: '<svg aria-hidden="true" class="on-glyph" viewBox="0 0 24 24"><path d="M3 20V9l3-4 3 4v11M9 12h12v8H9M12 12v-2h3v2M17 12v-2h3v2"/></svg>',
  papers:
    '<svg aria-hidden="true" class="on-glyph" viewBox="0 0 24 24"><path d="M6 3h9l4 4v14H6zM15 3v4h4M9 12h6M9 16h6"/></svg>',
  grid: '<svg aria-hidden="true" class="on-glyph" viewBox="0 0 24 24"><path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z"/></svg>',
  list: '<svg aria-hidden="true" class="on-glyph" viewBox="0 0 24 24"><path d="M4 6h3M10 6h10M4 12h3M10 12h10M4 18h3M10 18h10"/></svg>',
} as const;

/** The residents' counters: filled silhouettes (a dress, a tunic, a small figure), never faces. */
export const FIGURE = {
  woman:
    '<svg aria-hidden="true" class="on-figure" viewBox="0 0 32 32" fill="currentColor"><circle cx="16" cy="5.5" r="3.6"/><path d="M12.5 10.5h7l4.5 12.5H8z"/><rect x="12" y="23" width="3.2" height="8" rx="1"/><rect x="16.8" y="23" width="3.2" height="8" rx="1"/></svg>',
  man: '<svg aria-hidden="true" class="on-figure" viewBox="0 0 32 32" fill="currentColor"><circle cx="16" cy="5.5" r="3.6"/><rect x="9.5" y="10.5" width="13" height="11.5" rx="3"/><rect x="10.5" y="22" width="4.4" height="9" rx="1"/><rect x="17.1" y="22" width="4.4" height="9" rx="1"/></svg>',
} as const;

/** Painted-icon size on a beam action (design px); mirrors `.on-action__art` in foundation.css. */
export const ACTION_ART_PX = 36;

/** The residents token: stylized wooden figures, never faces (FOUNDATION.md). */
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
