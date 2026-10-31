import { diag } from '../../../diag/index.js';
import type { Rect } from '../../geometry.js';
import type { ScreenSize } from '../../nav-beam.js';
import type { ToolWindow } from '../../tool-panel/window-shell.js';
import { centralWindowPlacer, createHudWindow } from '../window.js';
import type { KnowledgeTarget, KnowledgeView } from './context.js';

/** Largest and smallest width that still leaves the game in view, design px. */
const WINDOW_MAX_W = 1240;
const WINDOW_MIN_W = 920;
/** Room kept beside the plane's edge when the window stands beside the minimap. */
const EDGE_GAP = 8;
/** Room kept on each side on a screen too narrow to clear the minimap. */
const NARROW_GAP = 12;

/** As wide as the design allows beside the minimap; a screen too narrow for that gives up clearing it. */
export function knowledgeWindowWidth(screen: ScreenSize, overlay: Rect | null): number {
  const clear = overlay === null ? 0 : overlay.x + overlay.w;
  const beside = Math.min(WINDOW_MAX_W, screen.width - clear - EDGE_GAP);
  return beside >= WINDOW_MIN_W ? beside : Math.max(0, screen.width - 2 * NARROW_GAP);
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
  window.element.style.height = '100%';
  window.body.classList.add('on-window__body--column', 'kn-body');
  const placeWindow = centralWindowPlacer(window, deps.plane, knowledgeWindowWidth);

  let view: KnowledgeView | null = null;
  let building: Promise<KnowledgeView> | null = null;
  /** Bumped by every open, so only the last one renders when its reads land. */
  let opens = 0;

  const show = (target?: KnowledgeTarget): void => {
    window.open();
    placeWindow();
    opens += 1;
    const ask = opens;
    building ??= deps.createView().then((made) => {
      view = made;
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
    toggle: () => (window.isOpen() ? window.close() : show()),
    close: window.close,
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
