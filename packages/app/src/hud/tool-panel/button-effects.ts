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
  | { readonly kind: 'systemMenu' }
  | { readonly kind: 'messagePriority' };

/** An informational window drops only the chest window and leaves the pickers open, so reading stats
 *  never cancels a pick in progress. */
const STATISTICS_EFFECT: ToolButtonEffect = {
  kind: 'window',
  toggles: 'stats',
  closes: ['extras', 'mission'],
  cancelsHeld: false,
};

const EFFECTS: Readonly<Record<ToolButtonId, ToolButtonEffect | null>> = {
  speed: { kind: 'speed' },
  options: { kind: 'systemMenu' },
  buildings: { kind: 'window', toggles: 'menu', closes: ['goods', 'extras', 'mission'], cancelsHeld: true },
  extras: {
    kind: 'window',
    toggles: 'extras',
    closes: ['menu', 'goods', 'stats', 'diplomacy', 'mission'],
    cancelsHeld: true,
  },
  /** The mission sheet covers the screen's middle and holds the game paused, so it never shares the
   *  screen with another pop-up in either direction. */
  mission: {
    kind: 'window',
    toggles: 'mission',
    closes: ['menu', 'goods', 'extras', 'stats', 'diplomacy'],
    cancelsHeld: true,
  },
  statistics: STATISTICS_EFFECT,
  /** The goods drop palette is the help button's tenant until a help window exists. */
  help: { kind: 'window', toggles: 'goods', closes: ['menu', 'extras', 'mission'], cancelsHeld: true },
  /** Informational like statistics. */
  diplomacy: { kind: 'window', toggles: 'diplomacy', closes: ['extras', 'mission'], cancelsHeld: false },
  population: null,
  tech_tree: null,
  message_priority: { kind: 'messagePriority' },
};

export const toolButtonEffect = (id: ToolButtonId): ToolButtonEffect | null => EFFECTS[id];

export interface ToolButtonSurfaces {
  readonly windows: Readonly<Record<ToolWindowId, { toggle(): void; close(): void }>>;
  readonly cancelHeld: () => void;
  readonly cycleSpeed: () => void;
  readonly openSystemMenu: () => void;
  readonly cycleMessagePriority: () => void;
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
    case 'messagePriority':
      surfaces.cycleMessagePriority();
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
