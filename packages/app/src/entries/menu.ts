import { fetchJsonOrNull } from '../content/net.js';
import { messages } from '../i18n/index.js';
import { SCENES } from '../scenes/index.js';
import { bindLocaleFlags, bindMenuSettings, targetSearch } from './menu/settings.js';

const DEFAULT_PREVIEW = new URL('../../../../docs/images/settlement.webp', import.meta.url).href;

export interface MapIndexEntry {
  readonly id: string;
  readonly name?: string;
  readonly description?: string;
  readonly minimap: boolean;
}

type EntryKind = 'scene' | 'map' | 'tool';

interface MenuEntry {
  readonly id: string;
  readonly kind: EntryKind;
  readonly title: string;
  readonly summary: string;
  readonly search: string;
  readonly preview?: string;
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

function templateRoot(): HTMLElement {
  const template = document.getElementById('main-menu-template');
  if (!(template instanceof HTMLTemplateElement)) throw new Error('missing #main-menu-template');
  const fragment = template.content.cloneNode(true);
  if (!(fragment instanceof DocumentFragment)) throw new Error('invalid #main-menu-template');
  const root = fragment.querySelector('.game-menu');
  if (!(root instanceof HTMLElement)) throw new Error('missing menu root');
  document.body.append(fragment);
  return root;
}

function htmlIn(root: ParentNode, selector: string): HTMLElement {
  const node = root.querySelector(selector);
  if (!(node instanceof HTMLElement)) throw new Error(`missing menu element: ${selector}`);
  return node;
}

function imageIn(root: ParentNode, selector: string): HTMLImageElement {
  const node = root.querySelector(selector);
  if (!(node instanceof HTMLImageElement)) throw new Error(`missing menu image: ${selector}`);
  return node;
}

function buttonIn(root: ParentNode, selector: string): HTMLButtonElement {
  const node = root.querySelector(selector);
  if (!(node instanceof HTMLButtonElement)) throw new Error(`missing menu button: ${selector}`);
  return node;
}

function translatedShell(root: HTMLElement): void {
  const copy = messages().menu;
  for (const node of root.querySelectorAll<HTMLElement>('[data-menu-text]')) {
    const key = node.dataset.menuText as keyof typeof copy;
    const value = copy[key];
    if (typeof value === 'string') node.textContent = value;
  }
}

function entryButton(entry: MenuEntry, onSelect: (entry: MenuEntry, button: HTMLButtonElement) => void) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'game-menu__entry';
  button.dataset.entryId = `${entry.kind}:${entry.id}`;
  const title = document.createElement('span');
  title.textContent = entry.title;
  button.append(title);
  button.addEventListener('click', () => onSelect(entry, button));
  return button;
}

function sceneEntries(): readonly MenuEntry[] {
  const sceneCopy = messages().scene;
  return SCENES.flatMap((scene) => {
    const metadata = sceneCopy[scene.id as keyof typeof sceneCopy];
    return metadata === undefined
      ? []
      : [
          {
            id: scene.id,
            kind: 'scene' as const,
            title: metadata.title,
            summary: metadata.summary,
            search: `?scene=${encodeURIComponent(scene.id)}`,
          },
        ];
  });
}

function toolEntries(): readonly MenuEntry[] {
  const copy = messages().menu;
  return [
    {
      id: 'animation',
      kind: 'tool',
      title: copy.animationTitle,
      summary: copy.animationSummary,
      search: '?anim',
    },
    {
      id: 'sound',
      kind: 'tool',
      title: copy.soundTitle,
      summary: copy.soundSummary,
      search: '?sounds',
    },
    {
      id: 'icons',
      kind: 'tool',
      title: copy.iconsTitle,
      summary: copy.iconsSummary,
      search: '?icons',
    },
  ];
}

export async function renderMenu(canvas: HTMLCanvasElement, params: URLSearchParams): Promise<void> {
  canvas.hidden = true;
  const copy = messages().menu;
  const root = templateRoot();
  root.style.setProperty('--menu-backdrop', `url("${DEFAULT_PREVIEW}")`);
  translatedShell(root);
  bindMenuSettings(root, params);
  bindLocaleFlags(htmlIn(root, '[data-menu-languages]'));

  const lists: Record<EntryKind, HTMLElement> = {
    scene: htmlIn(root, '[data-menu-list="scenes"]'),
    map: htmlIn(root, '[data-menu-list="maps"]'),
    tool: htmlIn(root, '[data-menu-list="tools"]'),
  };
  const preview = imageIn(root, '[data-menu-preview]');
  const kind = htmlIn(root, '[data-menu-kind]');
  const title = htmlIn(root, '[data-menu-title]');
  const summary = htmlIn(root, '[data-menu-summary]');
  const settings = htmlIn(root, '[data-menu-settings]');
  const start = buttonIn(root, '[data-menu-start]');
  let activeButton: HTMLButtonElement | null = null;
  let selected: MenuEntry | null = null;

  const select = (entry: MenuEntry, button: HTMLButtonElement): void => {
    activeButton?.classList.remove('is-selected');
    activeButton?.removeAttribute('aria-current');
    activeButton = button;
    activeButton.classList.add('is-selected');
    activeButton.setAttribute('aria-current', 'true');
    selected = entry;
    kind.textContent = copy.entryKinds[entry.kind];
    title.textContent = entry.title;
    summary.textContent = entry.summary;
    settings.hidden = entry.kind === 'tool';
    start.textContent = entry.kind === 'tool' ? copy.open : copy.start;
    preview.classList.toggle('is-map', entry.kind === 'map' && entry.preview !== undefined);
    preview.src = entry.preview ?? DEFAULT_PREVIEW;
    preview.alt = entry.title;
  };

  preview.addEventListener('error', () => {
    preview.classList.remove('is-map');
    preview.src = DEFAULT_PREVIEW;
  });
  start.addEventListener('click', () => {
    if (selected !== null) window.location.search = targetSearch(selected.search);
  });

  const appendEntries = (entries: readonly MenuEntry[]): void => {
    for (const entry of entries) {
      const button = entryButton(entry, select);
      lists[entry.kind].append(button);
      if (selected === null) select(entry, button);
    }
  };

  appendEntries(sceneEntries());
  appendEntries(toolEntries());

  const maps = await loadMapList();
  if (maps.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'game-menu__empty';
    empty.textContent = copy.mapsEmptyTitle;
    lists.map.append(empty);
    return;
  }
  appendEntries(
    maps.map((map) => ({
      id: map.id,
      kind: 'map' as const,
      title: map.name ?? map.id,
      summary: map.description ?? copy.mapFallbackSummary,
      search: `?map=${encodeURIComponent(map.id)}`,
      ...(map.minimap ? { preview: `/maps/${encodeURIComponent(map.id)}.png` } : {}),
    })),
  );
}
