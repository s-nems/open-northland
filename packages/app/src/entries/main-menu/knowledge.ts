import type { KnowledgeView } from '../../hud/dom/knowledge/context.js';
import { currentLocale, messages } from '../../i18n/index.js';
import { node } from './dom.js';
import type { MenuScreen, MountedScreen } from './model.js';
import { screenHead } from './screen-head.js';
import './knowledge.css';

/** Everything the screen reads, imported only here: the menu's first paint downloads none of it. */
async function loadView(): Promise<KnowledgeView | null> {
  const [{ loadRealContent }, { loadIr }, { loadObjectHelp }, base, view, art, icons] = await Promise.all([
    import('../../content/real-content.js'),
    import('../../content/ir/load.js'),
    import('../../content/gui/gfx.js'),
    import('../../hud/knowledge/base.js'),
    import('../../hud/dom/knowledge/view.js'),
    import('../../hud/dom/knowledge/art.js'),
    import('../../hud/dom/good-art.js'),
    import('../../hud/dom/foundation.css'),
  ]);
  const [content, ir, help] = await Promise.all([
    loadRealContent(),
    loadIr(),
    loadObjectHelp(currentLocale()),
  ]);
  if (content === null) return null;
  return view.createKnowledgeView({
    base: base.createKnowledgeBase(content, help),
    art: art.createKnowledgeArt({ ir, goodIcon: icons.createGoodIconPainter(null, content) }),
    settlement: null,
  });
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

  let view: KnowledgeView | null = null;
  let left = false;
  loadView()
    .then((loaded) => {
      if (left) {
        loaded?.dispose();
        return;
      }
      if (loaded === null) {
        status.textContent = copy.unavailable;
        return;
      }
      view = loaded;
      body.replaceChildren(loaded.element);
      loaded.open();
    })
    .catch((error: unknown) => {
      status.textContent = copy.unavailable;
      throw error; // installCrashCapture's unhandledrejection hook owns the reporting
    });
  return {
    element,
    escape: () => view?.escape() === true,
    dispose: () => {
      left = true;
      view?.dispose();
    },
  };
}
