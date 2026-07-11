import type { GalleryDirection } from '@vinland/render';
import { VIKING_CHARACTERS, type VikingCharacter } from '../catalog/roster.js';
import { BUTTON_STYLE, el, navButton, PANEL_STYLE, signOffFooter } from '../view/overlay.js';
import type { GalleryView } from './anim-cells.js';

/**
 * The `?anim` gallery's control panel — the character / view / direction selectors + the validation
 * checklist a human reads while judging the animations. Plain DOM (app-layer), split out of `anim.ts`
 * so the entry keeps the atlas loading + Pixi loop and this keeps the chrome. The character/view buttons
 * NAVIGATE (they reload different atlases); only the direction selector is live (drives
 * {@link import('@vinland/render').AnimationGallery.setDirection} through `onDirection`).
 */

/**
 * The eight facing options + "full", in a human-friendly compass order (NOT raw block index order). The
 * `dir` is the `CR_Hum_Body` block index the gallery indexes (`0 SW, 1 W, 2 NW, 3 NE, 4 E, 5 SE, 6 S,
 * 7 N` — source basis "Settler facing"); the label is the screen facing that block draws.
 */
const DIRECTION_OPTIONS: readonly { readonly label: string; readonly dir: GalleryDirection }[] = [
  { label: 'Pełna', dir: 'full' },
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

/** Mount the gallery's control panel: title, character + view + direction selectors, and a validation checklist. */
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
  panel.append(el('div', 'font-weight:700;font-size:14px;margin-bottom:2px', 'Animacje postaci wikinga'));

  // Character selector — navigates (each character is a different body/head atlas set). "Wszystkie" is the
  // no-param roster montage (the default); a character drills into its own animations.
  panel.append(el('div', 'font-weight:700;margin:6px 0 4px', 'Postać:'));
  const charRow = el('div', 'display:flex;flex-wrap:wrap;gap:5px;margin-bottom:8px');
  charRow.append(navButton('Wszystkie', char === null, rosterUrl(params)));
  for (const c of VIKING_CHARACTERS) {
    charRow.append(
      navButton(c.label, char !== null && c.id === char.id, galleryUrl(params, { char: c.id, view: 'anim' })),
    );
  }
  panel.append(charRow);

  // View selector — a drilled-in character: its animation set, its heads montage (only when it has 2+ looks),
  // and its player-COLOUR montage (the walk once per team colour). The roster IS the all-looks view.
  if (char !== null) {
    panel.append(el('div', 'font-weight:700;margin:2px 0 4px', 'Widok:'));
    const viewRow = el('div', 'display:flex;flex-wrap:wrap;gap:5px;margin-bottom:8px');
    viewRow.append(
      navButton('Animacje', view === 'anim', galleryUrl(params, { char: char.id, view: 'anim' })),
    );
    if (char.headBmds.length >= 2) {
      viewRow.append(
        navButton(
          `Głowy (${char.headBmds.length})`,
          view === 'heads',
          galleryUrl(params, { char: char.id, view: 'heads' }),
        ),
      );
    }
    viewRow.append(
      navButton('Kolory (16)', view === 'colors', galleryUrl(params, { char: char.id, view: 'colors' })),
    );
    panel.append(viewRow);
  }

  const summary =
    char === null
      ? `${cellCount} wyglądów wikingów naraz — każdy idzie ten sam walk. Kliknij postać, by zobaczyć jej animacje.`
      : view === 'heads'
        ? `${cellCount} looków (głów) „${char.label}", każdy idzie ten sam walk.`
        : view === 'colors'
          ? `${cellCount} kolorów graczy „${char.label}", każdy idzie ten sam walk. (?color=N = cały set animacji w jednym kolorze.)`
          : `${cellCount} sekwencji „${char.label}" naraz, każda w pętli.`;
  panel.append(el('div', 'opacity:0.85;margin-bottom:8px', summary));

  // Direction selector — LIVE (no reload); applies to every cell.
  panel.append(el('div', 'font-weight:700;margin-bottom:4px', 'Kierunek:'));
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
    const b = el('button', BUTTON_STYLE, opt.label);
    b.addEventListener('click', () => {
      onDirection(opt.dir);
      mark(opt.dir);
      readout.textContent = `Aktualny: ${directionLabel(opt.dir)}`;
    });
    buttons.set(opt.dir, b);
    dirRow.append(b);
  }
  panel.append(dirRow);

  const readout = el('div', 'opacity:0.8;margin-bottom:6px', `Aktualny: ${directionLabel(direction)}`);
  panel.append(readout);
  mark(direction);

  panel.append(el('div', 'font-weight:700;margin:4px 0', 'Sprawdź:'));
  const list = el('ul', 'margin:0 0 8px 0;padding-left:18px');
  const items =
    char === null
      ? [
          'To pełny set wikingów naraz: cywil (12 głów), wojownik (4), kobieta, dzieci, niemowlę',
          'Każdy ma ciało + głowę (żaden bezgłowy ani zniekształcony), głowy się różnią',
          'Po wyborze kierunku wszyscy idą w tę samą, właściwą stronę',
          'Kliknij postać (np. Wojownik), by zobaczyć jej pełne animacje, w tym walki',
          'ZNANY BRAK: kolor skóry/włosów to dziś jedna paleta (warianty = osobny krok w pipeline)',
        ]
      : view === 'heads'
        ? [
            'Każdy look ma ciało + głowę (żaden nie jest bezgłowy ani zniekształcony)',
            'Głowy różnią się (włosy/hełmy/twarze) — to pełny zestaw wyglądów tej postaci',
            'Po wyborze kierunku wszystkie looki patrzą w tę samą, właściwą stronę',
            'ZNANY BRAK: kolor skóry/włosów to dziś jedna paleta (warianty = osobny krok w pipeline)',
          ]
        : view === 'colors'
          ? [
              '16 kolorów graczy naraz (blue/red/yellow/… — 10 z oryginału + 6 dodanych do 16 graczy)',
              'Ten sam wiking w każdej celi — różni się TYLKO kolor ubrania (kamizelka/tunika), nie twarz/skóra/metal',
              'Kolory wyraźnie rozróżnialne (żeby odróżnić graczy w walce)',
              '?color=N (0–15) = pełny set animacji tej postaci w jednym kolorze (np. wojownik w czerwieni)',
            ]
          : [
              'Każda animacja gra płynnie i się zapętla — żadna klatka nie jest zamrożona ani zniekształcona',
              'Postać ma ciało + głowę (nie sam korpus)',
              'RUCH (walk + warianty niesienia/broni) po wyborze kierunku patrzy we właściwą stronę',
              'WOJOWNIK: ataki (miecz/łuk/oszczep/pięści) są czytelne (grają całą sekwencję, 1-kierunkowo)',
              'Animacje 1-kierunkowe (wait, eat, sleep, ataki) ignorują wybór kierunku — grają całą sekwencję',
              'ZNANY BRAK: gesty/praca/ataki mogą mieć błędne kierunki — kolejność per-animacja nieskalibrowana',
            ];
  for (const item of items) list.append(el('li', 'margin:2px 0', item));
  panel.append(list);
  panel.append(signOffFooter('Gdy ocenisz animacje, wróć do czatu i napisz, czy są OK.'));

  document.body.append(panel);
}
