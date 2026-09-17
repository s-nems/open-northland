import { iconCellStyle, uiFoundationArt } from '../../content/own-assets/ui-foundation.js';

/** Line glyphs the DOM HUD draws inline, as `.on-glyph` SVG markup. */
export const GLYPH = {
  close: '<svg aria-hidden="true" class="on-glyph"><use href="#on-close"/></svg>',
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
  woman:
    '<svg aria-hidden="true" class="on-glyph" viewBox="0 0 32 32"><circle cx="16" cy="11" r="6"/><path d="M16 17v12m-5-5h10"/></svg>',
  man: '<svg aria-hidden="true" class="on-glyph" viewBox="0 0 32 32"><circle cx="13" cy="19" r="6"/><path d="m17.5 14.5 9-9M19 5h8v8"/></svg>',
  child:
    '<svg aria-hidden="true" class="on-glyph" viewBox="0 0 32 32"><circle cx="16" cy="8" r="4"/><path d="M16 14v9m-7-8 7 3 7-3m-7 8-5 6m5-6 5 6"/></svg>',
} as const;

/** The residents token: stylized wooden figures, never faces (FOUNDATION.md). */
/** Painted-icon size on a beam action (design px); mirrors `.on-action__art` in foundation.css. */
export const ACTION_ART_PX = 36;

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
