import type { ToolButtonId } from './layout.js';

export type ToolWindowId = 'menu' | 'goods' | 'extras' | 'stats';

/**
 * What pressing a strip button does, or null for a button v1 draws but does not wire. A window button
 * closes its {@link ToolButtonEffect.closes} list before toggling its own: the three picking windows
 * are mutually exclusive, and the chest and statistics close each other because their rects collide.
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

/** `help` has no window yet, so it stands in for statistics. */
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
  extras: { kind: 'window', toggles: 'extras', closes: ['menu', 'goods', 'stats'], cancelsHeld: true },
  /** The goods drop palette is the mission button's tenant until the mission window exists. */
  mission: { kind: 'window', toggles: 'goods', closes: ['menu', 'extras'], cancelsHeld: true },
  statistics: STATISTICS_EFFECT,
  help: STATISTICS_EFFECT,
  diplomacy: null,
  population: null,
  tech_tree: null,
};

export const toolButtonEffect = (id: ToolButtonId): ToolButtonEffect | null => EFFECTS[id];

/** The surfaces a strip button press acts on, as the mount wires them. */
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
      const unreachable: never = effect; // exhaustive: a new effect kind fails to compile here
      throw new Error(`unhandled tool button effect: ${JSON.stringify(unreachable)}`);
    }
  }
}
