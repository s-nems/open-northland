import type { UiCue } from '@open-northland/audio';
import type { ContentSet } from '@open-northland/data';
import type { Camera } from '@open-northland/render';
import type { PlayerCommand, WorldSnapshot } from '@open-northland/sim';
import type { ActionOrderId } from '../../hud/action-ring/index.js';
import { isActionHotkey } from '../../hud/hotkeys.js';
import type { KeyBindings, KeybindingAction } from '../../hud/keybindings.js';
import {
  globalDefenceOrders,
  SELECTION_KEY_ACTIONS,
  selectionKeyEffect,
  storeJumpTargets,
} from './keyboard-picks.js';

export interface KeyboardOrdersDeps {
  readonly bindings: KeyBindings;
  readonly snapshot: () => WorldSnapshot;
  readonly content: ContentSet;
  /** The player the keys act for; null while the viewer plays no seat. */
  readonly player: () => number | null;
  readonly selected: () => ReadonlySet<number>;
  readonly select: (ids: readonly number[], add: boolean) => void;
  readonly camera: () => Camera;
  /** Centre the camera on an entity's ground anchor; false when it stands nowhere. */
  readonly centreOn: (id: number) => boolean;
  readonly enqueue: (command: PlayerCommand) => void;
  /** The action ring's order for the selected settlers that may take it; false when none may. */
  readonly ringOrder: (id: ActionOrderId) => boolean;
  readonly cue: (cue: UiCue) => void;
}

/** Where the store key last put the camera, so the next press steps on while it still stands there. */
interface StoreJump {
  readonly index: number;
  readonly x: number;
  readonly y: number;
}

/**
 * The single-press keys that select by kind, jump the camera, assign a settler or switch every
 * building's defence. True when the press was one of them.
 */
export function createKeyboardOrders(deps: KeyboardOrdersDeps): (e: KeyboardEvent) => boolean {
  let lastStoreJump: StoreJump | null = null;

  const jumpToStore = (player: number): void => {
    const targets = storeJumpTargets(deps.snapshot(), deps.content, player);
    if (targets.length === 0) return;
    const camera = deps.camera();
    const stillThere =
      lastStoreJump !== null && lastStoreJump.x === camera.offsetX && lastStoreJump.y === camera.offsetY;
    const index = stillThere && lastStoreJump !== null ? (lastStoreJump.index + 1) % targets.length : 0;
    const target = targets[index];
    if (target === undefined || !deps.centreOn(target)) return;
    const moved = deps.camera();
    lastStoreJump = { index, x: moved.offsetX, y: moved.offsetY };
  };

  return (e) => {
    const pressed = (action: KeybindingAction): boolean => isActionHotkey(e, deps.bindings, action);
    const player = deps.player();
    if (player === null) return false;

    const selectionKey = SELECTION_KEY_ACTIONS.find(pressed);
    if (selectionKey !== undefined) {
      const effect = selectionKeyEffect(selectionKey, deps.snapshot(), deps.content, player, deps.selected());
      if (effect !== null) {
        deps.select(effect.ids, effect.add);
      }
      return true;
    }
    if (pressed('jumpToStore')) {
      jumpToStore(player);
      return true;
    }
    // A builder takes a building site and anyone else a work place, as the original's key offers either;
    // only a builder's trade passes the building-site gate, so it is asked first.
    if (pressed('assignWorkplace')) {
      if (!deps.ringOrder('assignBuildingSite')) deps.ringOrder('assignWorkPlace');
      return true;
    }
    if (pressed('assignHome')) {
      deps.ringOrder('assignHome');
      return true;
    }
    const defence = pressed('defenceOn') ? true : pressed('defenceOff') ? false : null;
    if (defence !== null) {
      const orders = globalDefenceOrders(deps.snapshot(), deps.content, player, defence);
      for (const order of orders) deps.enqueue(order);
      deps.cue(orders.length > 0 ? 'confirm' : 'fail');
      return true;
    }
    return false;
  };
}
