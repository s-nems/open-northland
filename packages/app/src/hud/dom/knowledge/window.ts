import { diag } from '../../../diag/index.js';
import type { ScreenSize } from '../../nav-beam.js';
import type { ToolWindow } from '../../tool-panel/window-shell.js';
import { centralWindowPlacer, createHudWindow } from '../window.js';
import type { KnowledgeTarget, KnowledgeView } from './context.js';

/** Largest size that still leaves the game in view, design px. */
const WINDOW_MAX_W = 1080;
const WINDOW_MAX_H = 720;
/** Room kept on each side of the window. */
const SIDE_GAP = 12;

/** As wide as the design allows, always in the middle of the screen. */
export function knowledgeWindowWidth(screen: ScreenSize): number {
  return Math.min(WINDOW_MAX_W, Math.max(0, screen.width - 2 * SIDE_GAP));
}

export interface KnowledgeWindowDeps {
  readonly plane: HTMLElement;
  readonly title: string;
  readonly art: string;
  readonly closeLabel: string;
  /** Builds the view on the first open, so a game that never opens Knowledge never loads it. */
  readonly createView: () => Promise<KnowledgeView>;
  /** Reads the seat as of now, before each render. */
  readonly refresh: () => Promise<void>;
  readonly buildingId: (typeId: number) => string | undefined;
}

export interface KnowledgeWindow extends ToolWindow {
  /** Open on a target; without one the reader lands where they left off. */
  show(target?: KnowledgeTarget): void;
  /** Open on a building's entry, or where the reader left off for a type no entry holds. */
  showBuilding(typeId: number): void;
  /** One Esc: the pin or search first; false when nothing of the view took it. */
  escape(): boolean;
  /** Re-place an open window; a closed one does nothing else. */
  place(): void;
  onDismiss(listener: () => void): void;
  dispose(): void;
}

export function createKnowledgeWindow(deps: KnowledgeWindowDeps): KnowledgeWindow {
  const window = createHudWindow(deps.plane, {
    title: deps.title,
    art: deps.art,
    closeLabel: deps.closeLabel,
    width: WINDOW_MAX_W,
    compact: true,
  });
  window.element.classList.add('kn-window');
  window.element.style.height = `min(100%, ${WINDOW_MAX_H}px)`;
  window.body.classList.add('on-window__body--column', 'kn-body');
  // The biggest window of the game stays in the middle; it does not step aside for the minimap.
  const placeWindow = centralWindowPlacer(window, deps.plane, knowledgeWindowWidth, { centred: true });

  let view: KnowledgeView | null = null;
  let building: Promise<KnowledgeView> | null = null;
  /** Bumped by every open, so only the last one renders when its reads land. */
  let opens = 0;

  const close = (): void => {
    window.close();
    view?.close();
  };
  window.onDismiss(() => view?.close());

  const show = (target?: KnowledgeTarget): void => {
    window.open();
    placeWindow();
    opens += 1;
    const ask = opens;
    building ??= deps.createView().then((made) => {
      view = made;
      window.element.querySelector('.on-window__close')?.before(made.head);
      window.body.append(made.element);
      return made;
    });
    Promise.all([building, deps.refresh()])
      .then(([made]) => {
        if (ask === opens && window.isOpen()) made.open(target);
      })
      .catch((error: unknown) => {
        building = view === null ? null : building;
        diag.warn('hud', `knowledge window: ${String(error)}`);
      });
  };

  return {
    isOpen: window.isOpen,
    toggle: () => (window.isOpen() ? close() : show()),
    close,
    show,
    showBuilding: (typeId) => {
      const id = deps.buildingId(typeId);
      show(id === undefined ? undefined : { entry: { kind: 'building', id } });
    },
    escape: () => view?.escape() ?? false,
    place: () => {
      placeWindow();
    },
    onDismiss: window.onDismiss,
    dispose: () => {
      view?.dispose();
      window.dispose();
    },
  };
}
