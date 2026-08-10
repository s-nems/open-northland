import { messages } from '../../i18n/index.js';
import { type LaunchEntry, swapToEntry } from '../../launch.js';
import { bindDisplayMode } from '../../view/fullscreen.js';
import { startBackdropRotation } from './backdrops.js';
import { creditsScreen } from './credits.js';
import { mountFullscreenPrompt } from './fullscreen-prompt.js';
import { lobbyScreen } from './lobby/index.js';
import type { RosterState } from './lobby/roster-state.js';
import { releaseMapPreviews } from './map-preview.js';
import { mapSelectScreen } from './map-select.js';
import { initialMapSelectMemory, type MapSelectItem } from './map-select-model.js';
import { backTarget, MAIN_NAV, type MainNavItem, type MenuScreen, moveFocus, VERSION_LINE } from './model.js';
import { screenHead } from './screen-head.js';
import { settingsScreen } from './settings.js';
import { adoptStoredSettings, initialSettingsMemory, updateSettings } from './settings-state.js';

type SubScreen = Exclude<MenuScreen, 'main'>;

/** Grade layers above the scene, bottom to top; the scene layer itself is built as the backdrop host. */
const OVERLAY_LAYERS = ['tint', 'shade', 'aurora-green', 'aurora-blue'] as const;

function navButton(item: MainNavItem, open: (screen: MenuScreen) => void): HTMLButtonElement {
  const copy = messages().mainMenu;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'main-menu__nav-item';
  button.dataset.navId = item.id;
  const label = document.createElement('span');
  label.textContent = copy.items[item.id];
  button.append(label);
  if (item.kind === 'comingSoon') {
    button.classList.add('is-coming-soon');
    button.disabled = true;
    const badge = document.createElement('span');
    badge.className = 'main-menu__badge';
    badge.textContent = copy.comingSoon;
    button.append(badge);
  } else if (item.kind === 'exit') {
    button.classList.add('is-exit');
    // Quits without confirmation. In a plain browser tab `close()` is a no-op.
    button.addEventListener('click', () => window.close());
  } else {
    button.addEventListener('click', () => open(item.id));
  }
  return button;
}

function mainScreen(open: (screen: MenuScreen) => void): HTMLElement {
  const copy = messages().mainMenu;
  const home = document.createElement('div');
  home.className = 'main-menu__home';

  const brand = document.createElement('div');
  brand.className = 'main-menu__brand';
  const eyebrow = document.createElement('div');
  eyebrow.className = 'main-menu__eyebrow';
  eyebrow.textContent = copy.eyebrow;
  const logo = document.createElement('h1');
  logo.className = 'main-menu__logo';
  logo.append('OPEN', document.createElement('br'), 'NORTHLAND');
  const version = document.createElement('div');
  version.className = 'main-menu__version';
  version.textContent = VERSION_LINE;
  brand.append(eyebrow, logo, version);

  const nav = document.createElement('nav');
  nav.className = 'main-menu__nav';
  for (const item of MAIN_NAV) nav.append(navButton(item, open));

  home.append(brand, nav);
  return home;
}

function placeholderScreen(screen: SubScreen, open: (screen: MenuScreen) => void): HTMLElement {
  const copy = messages().mainMenu;
  const section = document.createElement('section');
  section.className = 'main-menu__screen';

  const head = screenHead(screen, open);

  const wip = document.createElement('p');
  wip.className = 'main-menu__wip';
  wip.textContent = copy.underConstruction;

  section.append(head, wip);
  return section;
}

export async function renderMainMenu(canvas: HTMLCanvasElement, params: URLSearchParams): Promise<void> {
  // Runs before anything reads the locale or the URL.
  adoptStoredSettings(params);
  // Owns the handlers this module binds outside `root`, so `closeMenu` releases them in one step.
  const scope = new AbortController();
  // Through the menu's own writer, so the settings session it caches stays in step with the store.
  bindDisplayMode(
    params,
    (displayMode) => {
      updateSettings({ displayMode });
    },
    scope.signal,
  );
  const root = document.createElement('main');
  root.className = 'main-menu';
  // The scene layer hosts the opening still and the rotating ones above it. The menu draws no GL, so
  // the shared canvas stays hidden.
  const sceneLayer = document.createElement('div');
  sceneLayer.className = 'main-menu__scene';
  canvas.hidden = true;
  root.append(sceneLayer);
  for (const layer of OVERLAY_LAYERS) {
    const element = document.createElement('div');
    element.className = `main-menu__${layer}`;
    root.append(element);
  }
  const content = document.createElement('div');
  content.className = 'main-menu__content';
  root.append(content);
  document.body.append(root);
  void startBackdropRotation(sceneLayer, scope.signal);
  const fullscreenPrompt = mountFullscreenPrompt(root, params, scope.signal);

  const closeMenu = (): void => {
    scope.abort();
    root.remove();
    canvas.hidden = false;
    releaseMapPreviews();
  };
  // Set from the click, not from the handover: the entry's module has to download first, and the
  // screens must not start another game or walk back to a different map in the meantime.
  let launching = false;
  const launch: LaunchEntry = (search) => {
    if (launching) return;
    launching = true;
    root.classList.add('is-launching');
    void swapToEntry(search, closeMenu).catch((err: unknown) => {
      // A load that failed before the handover leaves the menu on screen, and it takes input again.
      if (root.isConnected) {
        launching = false;
        root.classList.remove('is-launching');
      }
      throw err; // installCrashCapture's unhandledrejection hook owns the reporting
    });
  };

  let screen: MenuScreen = 'main';
  // Screen state that outlives the screens themselves, so a round trip keeps the filter and seats.
  const mapSelectMemory = initialMapSelectMemory();
  const settingsMemory = initialSettingsMemory();
  const rosters = new Map<string, RosterState>();
  let lobbyMap: MapSelectItem | null = null;
  const openLobby = (item: MapSelectItem): void => {
    lobbyMap = item;
    show('lobby');
  };
  const screenFor = (next: MenuScreen): HTMLElement => {
    if (next === 'main') return mainScreen(show);
    if (next === 'newGame') return mapSelectScreen(show, mapSelectMemory, openLobby, launch);
    if (next === 'lobby' && lobbyMap !== null) return lobbyScreen(lobbyMap, show, rosters, launch);
    if (next === 'settings') return settingsScreen(show, settingsMemory, scope.signal);
    if (next === 'credits') return creditsScreen(show);
    return placeholderScreen(next, show);
  };
  const show = (next: MenuScreen): void => {
    if (launching) return;
    screen = next;
    root.classList.toggle('is-sub', next !== 'main');
    content.replaceChildren(screenFor(next));
    content.classList.remove('is-entering');
    void content.offsetWidth; // reflow so the crossfade animation restarts
    content.classList.add('is-entering');
    // `replaceChildren` drops focus to <body>; the back link takes it so Esc and Enter keep working.
    // The main screen stays unfocused until an arrow key.
    if (next !== 'main') content.querySelector<HTMLButtonElement>('.main-menu__back')?.focus();
    // The prompt sits outside `content`, so a language change reaches it only from here.
    fullscreenPrompt.relabel();
  };
  show('main');

  const onKeydown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      // Esc inside a non-empty text field is the field's own clear; only an empty field lets it
      // bubble up into back-navigation.
      const field = event.target;
      if (
        field instanceof HTMLInputElement &&
        (field.type === 'search' || field.type === 'text') &&
        field.value !== ''
      )
        return;
      const target = backTarget(screen);
      if (target !== null) show(target);
      return;
    }
    if (screen !== 'main' || (event.key !== 'ArrowDown' && event.key !== 'ArrowUp')) return;
    event.preventDefault();
    const buttons = [...content.querySelectorAll<HTMLButtonElement>('.main-menu__nav-item')];
    const delta = event.key === 'ArrowDown' ? 1 : -1;
    const active = document.activeElement;
    const focused = active instanceof HTMLButtonElement ? buttons.indexOf(active) : -1;
    // With nothing focused yet, Down enters at the first interactive item, Up at the last.
    const from = focused >= 0 ? focused : delta === 1 ? -1 : 0;
    buttons[moveFocus(MAIN_NAV, from, delta)]?.focus();
  };
  window.addEventListener('keydown', onKeydown, { signal: scope.signal });
}
