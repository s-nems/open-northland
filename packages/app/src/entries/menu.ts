import { fetchJsonOrNull } from '../content/net.js';
import { messages } from '../i18n/index.js';
import { SCENES } from '../scenes/index.js';
import { el } from '../view/overlay.js';
import { settingsPanel, targetSearch } from './menu/settings.js';
import { styleMenu } from './menu/styles.js';

export interface MapIndexEntry {
  readonly id: string;
  readonly name?: string;
  readonly description?: string;
  readonly minimap: boolean;
}

export function parseMapsIndex(data: unknown): readonly MapIndexEntry[] {
  if (!Array.isArray(data)) return [];
  const entries: MapIndexEntry[] = [];
  for (const item of data) {
    if (typeof item !== 'object' || item === null) continue;
    const { id, name, description, minimap } = item as Record<string, unknown>;
    if (typeof id !== 'string' || id === '') continue;
    entries.push({
      id,
      ...(typeof name === 'string' ? { name } : {}),
      ...(typeof description === 'string' ? { description } : {}),
      minimap: minimap === true,
    });
  }
  return entries;
}

async function loadMapList(): Promise<readonly MapIndexEntry[]> {
  return parseMapsIndex(await fetchJsonOrNull<unknown>('/maps-index'));
}

function card(
  kicker: string,
  title: string,
  summary: string,
  entry: string,
  thumbnail?: string,
): HTMLButtonElement {
  const button = el('button', '', '') as HTMLButtonElement;
  button.className = `on-card${thumbnail === undefined ? '' : ' on-map-card'}`;
  if (thumbnail !== undefined) {
    const image = el('img', '') as HTMLImageElement;
    image.className = 'on-map-thumb';
    image.src = thumbnail;
    image.alt = '';
    image.loading = 'lazy';
    button.append(image);
  }
  const kickerLine = el('span', '', kicker);
  kickerLine.className = 'on-card-kicker';
  const titleLine = el('span', '', title);
  titleLine.className = 'on-card-title';
  const summaryLine = el('span', '', summary);
  summaryLine.className = 'on-card-summary';
  button.append(kickerLine, titleLine, summaryLine);
  button.addEventListener('click', () => {
    window.location.search = targetSearch(entry);
  });
  return button;
}

function section(
  title: string,
  subtitle: string,
): { readonly root: HTMLElement; readonly grid: HTMLElement } {
  const root = el('section', '');
  root.className = 'on-section';
  const head = el('div', '');
  head.className = 'on-section-head';
  const text = el('div', '');
  const sub = el('p', '', subtitle);
  sub.className = 'on-subtitle';
  text.append(el('h2', '', title), sub);
  head.append(text);
  const grid = el('div', '');
  grid.className = 'on-grid';
  root.append(head, grid);
  return { root, grid };
}

function menuHeader(): readonly HTMLElement[] {
  const copy = messages().menu;
  const nav = el('div', '');
  nav.className = 'on-nav';
  const brand = el('div', '');
  brand.className = 'on-brand';
  const mark = el('span', '', 'ᛟ');
  mark.className = 'on-mark';
  brand.append(mark, el('span', '', 'OpenNorthland'));
  const note = el('div', '', 'GPL-3.0-or-later · TypeScript');
  note.className = 'on-nav-note';
  nav.append(brand, note);

  const hero = el('header', '');
  hero.className = 'on-hero';
  const heroMain = el('div', '');
  const eyebrow = el('div', '', copy.eyebrow);
  eyebrow.className = 'on-eyebrow';
  const title = el('h1', '', copy.tagline);
  title.className = 'on-title';
  const intro = el('p', '', copy.intro);
  intro.className = 'on-intro';
  heroMain.append(eyebrow, title, intro);
  const heroNote = el('div', '', copy.techNote);
  heroNote.className = 'on-hero-note';
  hero.append(heroMain, heroNote);
  return [nav, hero];
}

export async function renderMenu(_canvas: HTMLCanvasElement, _params: URLSearchParams): Promise<void> {
  styleMenu();
  const copy = messages().menu;
  const root = el('main', '');
  root.className = 'on-menu';
  const shell = el('div', '');
  shell.className = 'on-shell';
  shell.append(...menuHeader(), settingsPanel());

  const scenes = section(copy.scenesTitle, copy.scenesSubtitle);
  const sceneCopy = messages().scene;
  for (const scene of SCENES) {
    const metadata = sceneCopy[scene.id as keyof typeof sceneCopy];
    if (metadata !== undefined) {
      scenes.grid.append(
        card(copy.open, metadata.title, metadata.summary, `?scene=${encodeURIComponent(scene.id)}`),
      );
    }
  }
  shell.append(scenes.root);

  const previews = section(copy.previewsTitle, copy.previewsSubtitle);
  previews.grid.append(
    card(copy.open, copy.animationTitle, copy.animationSummary, '?anim'),
    card(copy.open, copy.soundTitle, copy.soundSummary, '?sounds'),
    card(copy.open, copy.iconsTitle, copy.iconsSummary, '?icons'),
  );
  shell.append(previews.root);

  const mapsSection = section(copy.mapsTitle, copy.mapsSubtitle);
  shell.append(mapsSection.root);
  root.append(shell);
  document.body.append(root);

  const maps = await loadMapList();
  if (maps.length === 0) {
    const empty = el('div', '');
    empty.className = 'on-empty';
    empty.append(el('strong', '', copy.mapsEmptyTitle), document.createTextNode(copy.mapsEmptyDetail));
    mapsSection.root.append(empty);
    return;
  }
  for (const map of maps) {
    mapsSection.grid.append(
      card(
        copy.open,
        map.name ?? map.id,
        map.description ?? copy.mapFallbackSummary,
        `?map=${encodeURIComponent(map.id)}`,
        map.minimap ? `/maps/${encodeURIComponent(map.id)}.png` : undefined,
      ),
    );
  }
}
