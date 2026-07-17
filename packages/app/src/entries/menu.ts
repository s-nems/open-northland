import { fetchJsonOrNull } from '../content/net.js';
import { messages } from '../i18n/index.js';
import { SCENES } from '../scenes/index.js';
import { BRAND_BACKDROP } from '../view/brand-art.js';
import { generatedMapPreview } from './menu/map-preview.js';
import { type MapPlayerSlot, mountPlayersPanel, type PlayersPanel } from './menu/players/index.js';
import { bindLocaleFlags, bindMenuSettings, targetSearch } from './menu/settings.js';

const MENU_LOGO = new URL('./menu/assets/logo.webp', import.meta.url).href;

export interface MapIndexEntry {
  readonly id: string;
  readonly name?: string;
  readonly description?: string;
  readonly minimap: boolean;
  /** The map's player roster from its script sidecar (absent when the map ships no playerdata). */
  readonly players?: readonly MapPlayerSlot[];
  /** The map locks its authored team colours (`[multiplayer]` `playerfixcolors`). */
  readonly fixedColors?: boolean;
}

type EntryKind = 'scene' | 'map' | 'tool';

interface MenuEntry {
  readonly id: string;
  readonly kind: EntryKind;
  readonly title: string;
  readonly summary: string;
  readonly search: string;
  readonly preview?: string;
  readonly players?: readonly MapPlayerSlot[];
  readonly fixedColors?: boolean;
}

/** Narrows one `/maps-index` roster row, mirroring the emit-side shape (wrong-typed rows drop).
 *  The lobby fields default to the no-`[multiplayer]`-table reading (claimable follows the
 *  authored type, nothing hidden, AI allowed) for a sidecar predating them. */
function parsePlayerSlot(raw: unknown): MapPlayerSlot | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const { player, type, tribeId, colorId, name, claimable, hidden, aiAllowed } = raw as Record<
    string,
    unknown
  >;
  if (typeof player !== 'number' || !Number.isInteger(player) || player < 0) return undefined;
  if (type !== 'human' && type !== 'ai') return undefined;
  if (typeof tribeId !== 'number' || typeof colorId !== 'number') return undefined;
  return {
    player,
    type,
    tribeId,
    colorId,
    ...(typeof name === 'string' ? { name } : {}),
    claimable: typeof claimable === 'boolean' ? claimable : type === 'human',
    hidden: hidden === true,
    aiAllowed: aiAllowed !== false,
  };
}

export function parseMapsIndex(data: unknown): readonly MapIndexEntry[] {
  if (!Array.isArray(data)) return [];
  const entries: MapIndexEntry[] = [];
  for (const item of data) {
    if (typeof item !== 'object' || item === null) continue;
    const { id, name, description, minimap, players, fixedColors } = item as Record<string, unknown>;
    if (typeof id !== 'string' || id === '') continue;
    const slots = Array.isArray(players) ? players.map(parsePlayerSlot).filter((s) => s !== undefined) : [];
    entries.push({
      id,
      ...(typeof name === 'string' ? { name } : {}),
      ...(typeof description === 'string' ? { description } : {}),
      minimap: minimap === true,
      ...(slots.length > 0 ? { players: slots } : {}),
      ...(fixedColors === true ? { fixedColors: true } : {}),
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
  root.style.setProperty('--menu-backdrop', `url("${BRAND_BACKDROP}")`);
  imageIn(root, '[data-menu-logo]').src = MENU_LOGO;
  translatedShell(root);
  bindMenuSettings(root, params);
  bindLocaleFlags(htmlIn(root, '[data-menu-languages]'));

  const lists: Record<EntryKind, HTMLElement> = {
    scene: htmlIn(root, '[data-menu-list="scenes"]'),
    map: htmlIn(root, '[data-menu-list="maps"]'),
    tool: htmlIn(root, '[data-menu-list="tools"]'),
  };
  const details = htmlIn(root, '.game-menu__details');
  const previewFrame = htmlIn(root, '.game-menu__preview-frame');
  const preview = imageIn(root, '[data-menu-preview]');
  const kind = htmlIn(root, '[data-menu-kind]');
  const title = htmlIn(root, '[data-menu-title]');
  const summary = htmlIn(root, '[data-menu-summary]');
  const settings = htmlIn(root, '[data-menu-settings]');
  const start = buttonIn(root, '[data-menu-start]');
  let activeButton: HTMLButtonElement | null = null;
  let selected: MenuEntry | null = null;
  let previewGeneration = 0;
  // Start stays gated until the person takes a Human seat on a map that ships a roster; the panel
  // reports the gate through `seatClaimed` on every roster change.
  const gateStart = (): void => {
    const gated = !players.seatClaimed;
    start.disabled = gated;
    start.title = gated ? copy.startNeedsSeat : '';
  };
  const players: PlayersPanel = mountPlayersPanel(
    htmlIn(root, '[data-menu-players]'),
    htmlIn(root, '[data-menu-player-list]'),
    gateStart,
  );

  const generatePreview = (entry: MenuEntry, generation: number): void => {
    preview.hidden = true;
    preview.removeAttribute('src');
    previewFrame.classList.add('is-loading');
    preview.dataset.source = 'generated-loading';
    void generatedMapPreview(entry.id).then((source) => {
      if (generation !== previewGeneration || selected !== entry) return;
      previewFrame.classList.remove('is-loading');
      if (source === null) return;
      preview.dataset.source = 'generated';
      preview.src = source;
      preview.hidden = false;
    });
  };

  const showPreview = (entry: MenuEntry): void => {
    const generation = ++previewGeneration;
    previewFrame.classList.remove('is-loading');
    preview.alt = entry.title;
    if (entry.kind === 'map') {
      preview.hidden = false;
      preview.classList.add('is-map');
      if (entry.preview === undefined) {
        generatePreview(entry, generation);
      } else {
        preview.dataset.source = 'static';
        preview.src = entry.preview;
      }
      return;
    }
    // Scenes and tools have no map to preview — leave the frame's black rectangle.
    preview.classList.remove('is-map');
    preview.hidden = true;
    preview.removeAttribute('src');
    preview.dataset.source = 'none';
  };

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
    // A map with a decoded roster shows the player panel and shrinks the preview to make room
    // (`has-players` — see details.css); everything else keeps the full-height preview.
    if (entry.kind === 'map' && entry.players !== undefined) {
      players.show(entry.id, entry.players, entry.fixedColors === true);
    } else {
      players.hide();
    }
    details.classList.toggle('has-players', entry.kind === 'map' && entry.players !== undefined);
    showPreview(entry);
  };

  preview.addEventListener('error', () => {
    if (selected?.kind === 'map' && preview.dataset.source === 'static') {
      generatePreview(selected, previewGeneration);
      return;
    }
    previewFrame.classList.remove('is-loading');
    preview.hidden = true;
  });
  start.addEventListener('click', () => {
    if (selected === null || start.disabled) return;
    // The roster choices ride along as URL params (seat, recolours, vacant-seat modes).
    const search = new URLSearchParams(selected.search);
    for (const [key, value] of players.startParams()) search.set(key, value);
    window.location.search = targetSearch(`?${search.toString()}`);
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
      ...(map.players !== undefined ? { players: map.players } : {}),
      ...(map.fixedColors === true ? { fixedColors: true } : {}),
    })),
  );
}
