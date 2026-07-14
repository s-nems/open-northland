import type { GalleryDirection } from '@open-northland/render';
import { characterLabel, VIKING_CHARACTERS, type VikingCharacter } from '../catalog/roster.js';
import { formatMessage, messages } from '../i18n/index.js';
import { BUTTON_STYLE, el, navButton, PANEL_STYLE } from '../view/overlay.js';
import type { GalleryView } from './anim-cells.js';

/**
 * The `?anim` gallery's control panel — the character / view / direction selectors + the validation
 * summary a human reads while judging the animations. Plain DOM (app-layer), split out of `anim.ts`
 * so the entry keeps the atlas loading + Pixi loop and this keeps the chrome. The character/view buttons
 * navigate (they reload different atlases); only the direction selector is live (drives
 * {@link import('@open-northland/render').AnimationGallery.setDirection} through `onDirection`).
 */

/**
 * The eight facing options + "full", in a human-friendly compass order (not raw block index order). The
 * `dir` is the `CR_Hum_Body` block index the gallery indexes (`0 SW, 1 W, 2 NW, 3 NE, 4 E, 5 SE, 6 S,
 * 7 N` — source basis "Settler facing"); the label is the screen facing that block draws.
 */
const DIRECTION_OPTIONS: readonly { readonly label: string; readonly dir: GalleryDirection }[] = [
  { label: '', dir: 'full' },
  { label: 'N', dir: 7 },
  { label: 'NE', dir: 3 },
  { label: 'E', dir: 4 },
  { label: 'SE', dir: 5 },
  { label: 'S', dir: 6 },
  { label: 'SW', dir: 0 },
  { label: 'W', dir: 1 },
  { label: 'NW', dir: 2 },
];

/** Human label for a `GalleryDirection` (the readout line). */
function directionLabel(dir: GalleryDirection): string {
  if (dir === 'full') return messages().animation.fullDirection;
  return DIRECTION_OPTIONS.find((o) => o.dir === dir)?.label ?? String(dir);
}

/** The URL for the same gallery with some params overridden (character / view navigation). */
function galleryUrl(base: URLSearchParams, changes: Readonly<Record<string, string>>): string {
  const next = new URLSearchParams(base);
  next.set('anim', ''); // keep the `?anim` entry itself
  for (const [k, v] of Object.entries(changes)) next.set(k, v);
  return `?${next.toString()}`;
}

/** The URL of the no-param roster montage — drop the character/view drill-down keys ("Wszystkie"). */
function rosterUrl(base: URLSearchParams): string {
  const next = new URLSearchParams(base);
  next.set('anim', '');
  next.delete('char');
  next.delete('view');
  return `?${next.toString()}`;
}

/** Mount the gallery's control panel: title, character, view, direction selectors, and a short summary. */
export function mountGalleryOverlay(
  params: URLSearchParams,
  state: {
    readonly char: VikingCharacter | null;
    readonly view: GalleryView;
    readonly cellCount: number;
    readonly direction: GalleryDirection;
  },
  onDirection: (d: GalleryDirection) => void,
): void {
  const { char, view, cellCount, direction } = state;
  const panel = el('div', PANEL_STYLE);
  const copy = messages().animation;
  panel.append(el('div', 'font-weight:700;font-size:14px;margin-bottom:2px', copy.title));

  // Character selector — navigates (each character is a different body/head atlas set). "Wszystkie" is the
  // no-param roster montage (the default); a character drills into its own animations.
  panel.append(el('div', 'font-weight:700;margin:6px 0 4px', copy.character));
  const charRow = el('div', 'display:flex;flex-wrap:wrap;gap:5px;margin-bottom:8px');
  charRow.append(navButton(copy.allCharacters, char === null, rosterUrl(params)));
  for (const c of VIKING_CHARACTERS) {
    charRow.append(
      navButton(
        characterLabel(c),
        char !== null && c.id === char.id,
        galleryUrl(params, { char: c.id, view: 'anim' }),
      ),
    );
  }
  panel.append(charRow);

  // View selector — a drilled-in character: its animation set, its heads montage (only when it has 2+ looks),
  // and its player-colour montage (the walk once per team colour). The roster is the all-looks view.
  if (char !== null) {
    panel.append(el('div', 'font-weight:700;margin:2px 0 4px', copy.view));
    const viewRow = el('div', 'display:flex;flex-wrap:wrap;gap:5px;margin-bottom:8px');
    viewRow.append(
      navButton(copy.animations, view === 'anim', galleryUrl(params, { char: char.id, view: 'anim' })),
    );
    if (char.headBmds.length >= 2) {
      viewRow.append(
        navButton(
          `${copy.heads} (${char.headBmds.length})`,
          view === 'heads',
          galleryUrl(params, { char: char.id, view: 'heads' }),
        ),
      );
    }
    viewRow.append(
      navButton(
        `${copy.colors} (16)`,
        view === 'colors',
        galleryUrl(params, { char: char.id, view: 'colors' }),
      ),
    );
    panel.append(viewRow);
  }

  const summaryCopy =
    view === 'heads' ? copy.summaryHeads : view === 'colors' ? copy.summaryColors : copy.summaryAnimations;
  const summary = `${cellCount} · ${summaryCopy}`;
  panel.append(el('div', 'opacity:0.85;margin-bottom:8px', summary));

  // Direction selector — live (no reload); applies to every cell.
  panel.append(el('div', 'font-weight:700;margin-bottom:4px', copy.direction));
  const dirRow = el('div', 'display:flex;flex-wrap:wrap;gap:5px;margin-bottom:8px');
  const buttons = new Map<GalleryDirection, HTMLButtonElement>();
  const mark = (active: GalleryDirection): void => {
    for (const [dir, b] of buttons) {
      const on = dir === active;
      b.style.background = on ? '#6b5840' : '#3a2f22';
      b.style.fontWeight = on ? '700' : '400';
    }
  };
  for (const opt of DIRECTION_OPTIONS) {
    const b = el('button', BUTTON_STYLE, directionLabel(opt.dir));
    b.addEventListener('click', () => {
      onDirection(opt.dir);
      mark(opt.dir);
      readout.textContent = formatMessage(copy.current, { direction: directionLabel(opt.dir) });
    });
    buttons.set(opt.dir, b);
    dirRow.append(b);
  }
  panel.append(dirRow);

  const readout = el(
    'div',
    'opacity:0.8;margin-bottom:6px',
    formatMessage(copy.current, { direction: directionLabel(direction) }),
  );
  panel.append(readout);
  mark(direction);

  document.body.append(panel);
}
