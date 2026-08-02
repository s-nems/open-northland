import { messages } from '../../i18n/index.js';
import { BRAND_BACKDROP } from '../../view/brand-art.js';
import { backTarget, MAIN_NAV, type MainNavItem, type MenuScreen, moveFocus } from './model.js';

/** Shown verbatim under the logo, per the accepted design frame. */
const VERSION_LINE = 'pre-alpha 0.1 · GPL-3.0';

type SubScreen = Exclude<MenuScreen, 'main'>;

/** Background layers, bottom to top (docs/design/main-menu/README.md "Background stack").
 *  `scene` is the brand backdrop until the live-scene slice replaces it. */
const BACKGROUND_LAYERS = ['scene', 'tint', 'shade', 'aurora-green', 'aurora-blue'] as const;

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
    // The design quits without confirmation. In the desktop shell this closes the window;
    // in a plain browser tab close() is a no-op and the button simply does nothing.
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

  const head = document.createElement('div');
  head.className = 'main-menu__screen-head';
  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'main-menu__back';
  back.textContent = `← ${copy.back}`;
  back.addEventListener('click', () => open(backTarget(screen) ?? 'main'));
  const title = document.createElement('h1');
  title.className = 'main-menu__screen-title';
  title.textContent = copy.screenTitles[screen];
  head.append(back, title);

  const wip = document.createElement('p');
  wip.className = 'main-menu__wip';
  wip.textContent = copy.underConstruction;

  section.append(head, wip);
  return section;
}

export async function renderMainMenu(canvas: HTMLCanvasElement): Promise<void> {
  canvas.hidden = true;
  const root = document.createElement('main');
  root.className = 'main-menu';
  root.style.setProperty('--menu-scene-art', `url("${BRAND_BACKDROP}")`);
  for (const layer of BACKGROUND_LAYERS) {
    const element = document.createElement('div');
    element.className = `main-menu__${layer}`;
    root.append(element);
  }
  const content = document.createElement('div');
  content.className = 'main-menu__content';
  root.append(content);
  document.body.append(root);

  let screen: MenuScreen = 'main';
  const show = (next: MenuScreen): void => {
    screen = next;
    root.classList.toggle('is-sub', next !== 'main');
    content.replaceChildren(next === 'main' ? mainScreen(show) : placeholderScreen(next, show));
    content.classList.remove('is-entering');
    void content.offsetWidth; // reflow so the crossfade animation restarts
    content.classList.add('is-entering');
    // replaceChildren drops focus to <body>; hand it to the back link so Esc/Enter keep working
    // without tabbing from the document top. The main screen stays unfocused until an arrow key.
    if (next !== 'main') content.querySelector<HTMLButtonElement>('.main-menu__back')?.focus();
  };
  show('main');

  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      const target = backTarget(screen);
      if (target !== null) show(target);
      return;
    }
    if (screen !== 'main' || (event.key !== 'ArrowDown' && event.key !== 'ArrowUp')) return;
    event.preventDefault();
    const buttons = [...content.querySelectorAll<HTMLButtonElement>('.main-menu__nav-item')];
    const delta = event.key === 'ArrowDown' ? 1 : -1;
    const focused = buttons.findIndex((button) => button === document.activeElement);
    // With nothing focused yet, Down enters at the first interactive item, Up at the last.
    const from = focused >= 0 ? focused : delta === 1 ? -1 : 0;
    buttons[moveFocus(MAIN_NAV, from, delta)]?.focus();
  });
}
