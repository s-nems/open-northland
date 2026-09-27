// Shared helpers for the mission window proposals. The runtime glyph and symbol sources are read as
// text, so the window chrome is the game's own. Page data comes from the local review directory
// (/mission-review/, never committed): decoded briefing pages, goals and world captures.

const source = async (path) => (await fetch(path)).text();
const [iconsTs, symbolsTs] = await Promise.all([source('/hud/dom/icons.ts'), source('/hud/dom/symbols.ts')]);

export const GLYPH = Object.fromEntries(
  [...iconsTs.matchAll(/(\w+):\s*'(<svg[^']*)'/g)].map((match) => [match[1], match[2]]),
);
export const SYMBOLS = symbolsTs.match(/HUD_SYMBOLS = `([\s\S]*?)`;/)?.[1] ?? '';
export const ORNAMENTS = `<svg aria-hidden="true" class="on-window__knot"><use href="#on-knot"/></svg>${['tl', 'tr', 'bl', 'br']
  .map((c) => `<svg aria-hidden="true" class="on-window__corner on-window__corner--${c}"><use href="#on-corner"/></svg>`)
  .join('')}`;

export const MISSIONS = await (await fetch('/mission-review/missions.json')).json();

export const STAGE = { w: 1365, h: 768 };
/** The central region the game's windows live in: under the summary bar, above the beam, between
 *  the notification column and the right edge (design px on the 1365 × 768 plane). */
export const CENTRAL = { x: 190, y: 64, w: 985, h: 620 };

export const esc = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/** The standard framed window, as `createHudWindow` builds it. `head` false gives the headless frame. */
export function hudWindow({ title, art = '', kicker, width, body, cls = '', style = '', head = true }) {
  const heading = head
    ? `<header class="on-window__head"><div class="on-window__heading">${art}<div>${
        kicker ? `<p class="on-window__kicker">${esc(kicker)}</p>` : ''
      }<h2 class="on-window__title">${esc(title)}</h2></div></div><button type="button" class="on-medallion on-window__close" aria-label="Zamknij">${GLYPH.close}</button></header>`
    : `<button type="button" class="on-medallion on-window__close" aria-label="Zamknij">${GLYPH.close}</button>`;
  return `<section class="on-window on-panel${head ? '' : ' on-window--headless'} ${cls}" style="width:${width}px;${style}" aria-label="${esc(title)}">${ORNAMENTS}${heading}<div class="on-window__body">${body}</div></section>`;
}

export const closeMedallion = (cls = '') =>
  `<button type="button" class="on-medallion ${cls}" aria-label="Zamknij">${GLYPH.close}</button>`;

/** Blocks in the player's language, falling back to English. */
export function pageBlocks(page, lang = 'pl') {
  return (lang === 'en' ? page.en : page.pl) ?? page.pl ?? page.en ?? [];
}

const SIGNATURE = /^(~+.*~+|by\s+\S.*|made by\s+\S.*)$/i;
/** A speaker is one or two capitalised words before the colon ("Ares:", "Pan Proszak:"). */
const SPEAKER = /^([A-ZŁŚŻŹĆŃÓĘĄ][\p{L}\-']{0,20}(?: [A-ZŁŚŻŹĆŃÓĘĄ][\p{L}\-']{0,20})?):\s+(.+)$/su;
const QUOTED = /^["„”«»].+/s;

/**
 * A page as structured segments, so a proposal can lay it out beyond the original's line stack:
 * `title`, `para` (narration), `speech` (a speaker line, from "Name: text", or a quoted line after a
 * portrait picture), `picture`, `mapview` (a `<usericon>` world view), `signature` (the author line).
 * The heuristics are this mockup's; the real page is a flat block list.
 */
export function analysePage(page, lang = 'pl') {
  const blocks = pageBlocks(page, lang);
  const segments = [];
  let title = '';
  let portrait = null;
  for (const b of blocks) {
    if (b.kind === 'blank') continue;
    if (b.kind === 'picture') {
      portrait = b;
      segments.push({ kind: 'picture', file: b.file, width: b.width, height: b.height, src: pictureUrl(b.file) });
      continue;
    }
    if (b.kind === 'icons') {
      for (const icon of b.icons) if (icon[0] === 1 || icon[0] === 2) segments.push({ kind: 'mapview', icon });
      continue;
    }
    const text = b.text.trim();
    if (b.style === 'title') {
      if (title === '') title = text;
      else segments.push({ kind: 'heading', text });
      continue;
    }
    if (SIGNATURE.test(text)) {
      segments.push({ kind: 'signature', text: text.replace(/^~+\s*|\s*~+$/g, '') });
      continue;
    }
    const spoken = text.match(SPEAKER);
    if (spoken !== null) {
      segments.push({ kind: 'speech', speaker: spoken[1].trim(), text: spoken[2].trim() });
      continue;
    }
    if (QUOTED.test(text) && portrait !== null && segments.at(-1)?.kind === 'picture') {
      segments.pop();
      segments.push({ kind: 'speech', speaker: null, text, portrait: pictureUrl(portrait.file) });
      continue;
    }
    segments.push({ kind: 'para', text, align: b.align ?? 'left', link: b.link ?? null });
  }
  if (title === '') {
    const first = segments.find((s) => s.kind === 'para' || s.kind === 'speech');
    const words = (first?.text ?? '').split(/\s+/).slice(0, 5).join(' ');
    title = words === '' ? 'Bez tytułu' : `${words.replace(/[.,:;!?]+$/, '')}…`;
  }
  return { id: page.id, title, segments };
}

export const pictureUrl = (file) => `/mission-review/pictures/${file}`;
export const worldUrl = (map) => `/mission-review/world-${map}.png`;
export const currentUrl = (map) => `/mission-review/current-${map}.png`;

/**
 * Inline style painting a world view for a `<usericon>` as a crop of the map's capture (in game the
 * renderer paints the live world around the node). The crop moves with the node so views differ.
 */
export function mapViewStyle(map, icon, w = 280, h = 220) {
  const [, a, b] = icon;
  const x = 260 + ((a * 37 + b * 11) % 560);
  const y = 90 + ((a * 13 + b * 29) % 330);
  return `background:#223 url(${worldUrl(map)}) -${x}px -${y}px / 1365px 768px no-repeat;width:${w}px;height:${h}px`;
}

/** The default segment renderer: plain HTML a proposal can restyle through its own classes. */
export function segmentsHtml(map, segments, { mapW = 280, mapH = 220, cls = 'mp' } = {}) {
  return segments
    .map((s) => {
      switch (s.kind) {
        case 'heading':
          return `<h4 class="${cls}-heading">${esc(s.text)}</h4>`;
        case 'para':
          return `<p class="${cls}-para" style="text-align:${s.align === 'justify' ? 'justify' : s.align}">${esc(s.text).replace(/\n/g, '<br>')}</p>`;
        case 'speech':
          return `<p class="${cls}-speech">${s.speaker ? `<b>${esc(s.speaker)}</b> ` : ''}${esc(s.text)}</p>`;
        case 'picture':
          return `<img class="${cls}-picture" src="${s.src}" width="${s.width}" height="${s.height}" alt="">`;
        case 'mapview':
          return `<button type="button" class="${cls}-mapview" style="${mapViewStyle(map, s.icon, mapW, mapH)}" aria-label="Pokaż na mapie"></button>`;
        case 'signature':
          return `<p class="${cls}-signature">${esc(s.text)}</p>`;
        default:
          return '';
      }
    })
    .join('');
}

/** The map's display name in the player's language, title-cased from the all-caps menu name. */
export function missionName(mission, lang = 'pl') {
  const raw = (lang === 'en' ? mission.name.eng : mission.name.pol) ?? mission.name.eng ?? '';
  return raw.toLowerCase().replace(/(^|[\s:(„-])(\p{L})/gu, (_, p, c) => p + c.toUpperCase());
}

export function goalText(goal, lang = 'pl') {
  return (lang === 'en' ? goal.en : goal.pl) ?? goal.pl ?? goal.en ?? '';
}

/** A believable in-game time stamp for the n-th received briefing (simulation clock). */
export function receivedAt(index) {
  const minutes = [0, 7, 16, 24, 31, 42, 55, 63, 78, 91][index] ?? index * 9;
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}:${String((index * 17) % 60).padStart(2, '0')}`;
}

const ICON_NAMES = ['build', 'assistant', 'statistics', 'mission', 'diplomacy', 'knowledge', 'menu'];
const ICON_COLUMNS = 3;

/** One painted cell of the delivered HUD icon atlas (`assets/ui/foundation/icons.png`) in a `size` px box. */
export function paintedIcon(name, size) {
  const at = ICON_NAMES.indexOf(name);
  const col = at % ICON_COLUMNS;
  const row = Math.floor(at / ICON_COLUMNS);
  return `<span class="on-icon" aria-hidden="true" style="width:${size}px;height:${size}px;background-size:${size * ICON_COLUMNS}px;background-position:-${col * size}px -${row * size}px"></span>`;
}
