import type { KnowledgeView } from '../../hud/dom/knowledge/context.js';
import { currentLocale, installNameOverlay, messages, type NameOverlay } from '../../i18n/index.js';
import { node } from './dom.js';
import type { MenuScreen, MountedScreen } from './model.js';
import { screenHead } from './screen-head.js';
import './knowledge.css';

interface LoadedView {
  readonly view: KnowledgeView;
  /** What the menu's other screens read once this one is left. */
  readonly menuNames: NameOverlay;
}

/** Everything the screen reads, imported only here: the menu's first paint downloads none of it. The
 *  game's names go in as a world's boot installs them, and only while the screen is still wanted. */
async function loadView(wanted: () => boolean): Promise<LoadedView | null> {
  const [{ loadRealContent }, { loadIr }, gui, names, base, view, art, icons] = await Promise.all([
    import('../../content/real-content.js'),
    import('../../content/ir/load.js'),
    import('../../content/gui/gfx.js'),
    import('../../content/gui/original-names.js'),
    import('../../hud/knowledge/base.js'),
    import('../../hud/dom/knowledge/view.js'),
    import('../../hud/dom/knowledge/art.js'),
    import('../../hud/dom/good-art.js'),
    import('../../hud/dom/foundation.css'),
  ]);
  const locale = currentLocale();
  const [content, ir, help, strings, menuNames] = await Promise.all([
    loadRealContent(),
    loadIr(),
    gui.loadObjectHelp(locale),
    gui.loadGuiStrings(locale),
    names.originalTribeNameOverlay(locale),
  ]);
  if (content === null || !wanted()) return null;
  try {
    if (strings !== null) names.installOriginalNames(locale, strings, content);
    return {
      view: view.createKnowledgeView({
        base: base.createKnowledgeBase(content, help),
        art: art.createKnowledgeArt({ ir, goodIcon: icons.createGoodIconPainter(null, content) }),
        settlement: null,
      }),
      menuNames,
    };
  } catch (error) {
    installNameOverlay(locale, menuNames);
    throw error;
  }
}

/** Knowledge with no game running: fills the view, reads the served content when it opens, and hands the
 *  shell's Esc to the view first. */
export function knowledgeScreen(open: (screen: MenuScreen) => void): MountedScreen {
  const copy = messages().knowledge.menuScreen;
  const element = node('section', 'main-menu__screen main-menu__knowledge');
  const body = node('div', 'main-menu__knowledge-body on-hud');
  const status = node('p', 'main-menu__knowledge-status', copy.loading);
  status.setAttribute('role', 'status');
  body.append(status);
  element.append(screenHead('knowledge', open), body);

  let loaded: LoadedView | null = null;
  let left = false;
  loadView(() => !left)
    .then((made) => {
      if (left) return;
      if (made === null) {
        status.textContent = copy.unavailable;
        return;
      }
      loaded = made;
      body.replaceChildren(made.view.element);
      made.view.open();
    })
    .catch((error: unknown) => {
      status.textContent = copy.unavailable;
      throw error; // installCrashCapture's unhandledrejection hook owns the reporting
    });
  return {
    element,
    escape: () => loaded?.view.escape() === true,
    dispose: () => {
      left = true;
      loaded?.view.close();
      loaded?.view.dispose();
      if (loaded !== null) installNameOverlay(currentLocale(), loaded.menuNames);
    },
  };
}
