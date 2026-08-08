import type { ToolButtonId } from './layout.js';
import type { ToolWindowId } from './windows.js';

/**
 * What pressing a strip button does, or null for a button that is drawn but not wired. A window button
 * closes its `closes` list before toggling its own.
 */
export type ToolButtonEffect =
  | {
      readonly kind: 'window';
      readonly toggles: ToolWindowId;
      readonly closes: readonly ToolWindowId[];
      /** Cancel an active building placement / good drop first - one held thing at a time. */
      readonly cancelsHeld: boolean;
    }
  | { readonly kind: 'speed' }
  | { readonly kind: 'systemMenu' };

/** `help` has no window yet, so it stands in for statistics. An informational window drops only the
 *  chest window and leaves the pickers open, so reading stats never cancels a pick in progress. */
const STATISTICS_EFFECT: ToolButtonEffect = {
  kind: 'window',
  toggles: 'stats',
  closes: ['extras'],
  cancelsHeld: false,
};

const EFFECTS: Readonly<Record<ToolButtonId, ToolButtonEffect | null>> = {
  speed: { kind: 'speed' },
  options: { kind: 'systemMenu' },
  buildings: { kind: 'window', toggles: 'menu', closes: ['goods', 'extras'], cancelsHeld: true },
  extras: {
    kind: 'window',
    toggles: 'extras',
    closes: ['menu', 'goods', 'stats', 'diplomacy'],
    cancelsHeld: true,
  },
  /** The goods drop palette is the mission button's tenant until the mission window exists. */
  mission: { kind: 'window', toggles: 'goods', closes: ['menu', 'extras'], cancelsHeld: true },
  statistics: STATISTICS_EFFECT,
  help: STATISTICS_EFFECT,
  /** Informational like statistics. */
  diplomacy: { kind: 'window', toggles: 'diplomacy', closes: ['extras'], cancelsHeld: false },
  population: null,
  tech_tree: null,
};

export const toolButtonEffect = (id: ToolButtonId): ToolButtonEffect | null => EFFECTS[id];

export interface ToolButtonSurfaces {
  readonly windows: Readonly<Record<ToolWindowId, { toggle(): void; close(): void }>>;
  readonly cancelHeld: () => void;
  readonly cycleSpeed: () => void;
  readonly openSystemMenu: () => void;
}

export function applyToolButtonEffect(surfaces: ToolButtonSurfaces, id: ToolButtonId): void {
  const effect = toolButtonEffect(id);
  if (effect === null) return;
  switch (effect.kind) {
    case 'speed':
      surfaces.cycleSpeed();
      return;
    case 'systemMenu':
      surfaces.openSystemMenu();
      return;
    case 'window': {
      if (effect.cancelsHeld) surfaces.cancelHeld();
      for (const closing of effect.closes) surfaces.windows[closing].close();
      surfaces.windows[effect.toggles].toggle();
      return;
    }
    default: {
      const unreachable: never = effect;
      throw new Error(`unhandled tool button effect: ${JSON.stringify(unreachable)}`);
    }
  }
}
