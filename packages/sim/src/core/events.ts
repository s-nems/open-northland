import type { Entity } from '../ecs/world.js';
import { nodeOfPosition } from '../nav/halfcell.js';
import type { Fixed } from './fixed.js';

/**
 * One-shot things that happened during a tick (a building appeared, a settler died, an atomic
 * completed → trigger a sound/effect). Render and audio consume these; they NEVER reach into sim
 * component stores. Events are PRODUCED into an append-only per-tick buffer and exposed READ-ONLY
 * on the snapshot — never delivered via callbacks (a callback could mutate sim state and break
 * determinism). This is the decoupling seam that keeps render a pure consumer.
 *
 * COORDINATES: every positioned event's `at` is a HALF-CELL NODE `(hx, hy)` — the sim's one grid
 * vocabulary, the same space command payloads use (`core/commands.ts`, `nav/halfcell.ts`).
 * Emitters mint it via {@link eventAt} (or pass a command's node through verbatim); consumers
 * project it through the node lattice (render's `halfCellToScreen`), never as a tile coordinate.
 *
 * Deterministic: the buffer is cleared at the start of each tick and sealed at the end, so the
 * event list for tick N is a pure function of the sim — reproducible, replayable, hashable.
 */
export type SimEvent =
  | {
      readonly kind: 'buildingPlaced';
      readonly entity: Entity;
      readonly at: { readonly x: number; readonly y: number };
    }
  | {
      readonly kind: 'boatPlaced';
      readonly entity: Entity;
      readonly at: { readonly x: number; readonly y: number };
    }
  | { readonly kind: 'buildingFinished'; readonly entity: Entity }
  | { readonly kind: 'buildingUpgraded'; readonly entity: Entity; readonly level: number }
  | { readonly kind: 'settlerBorn'; readonly entity: Entity }
  | {
      /**
       * Two settlers became spouses this tick — the pair finished its wedding kiss (FamilySystem) and
       * now carries mirrored {@link import('../components/family.js').Marriage} components. `at` is the
       * kiss node (where the ceremony stood), for a render/audio cue — the original's marriage jingle
       * (`DM_MUSIC_TYPE_JINGLE_MARRIAGE`, `logicdefines.inc`).
       */
      readonly kind: 'settlersMarried';
      readonly a: Entity;
      readonly b: Entity;
      readonly at: { readonly x: number; readonly y: number };
    }
  | {
      /**
       * A combatant was reaped this tick — its {@link import('../components/combat.js').Health} pool hit 0
       * and `cleanupSystem` removed it. `cause` is a render/audio hint (`'damage'` today). `player` is the
       * dead unit's {@link import('../components/ownership.js').Owner} slot, read before the destroy (the
       * entity is gone by the snapshot, so a consumer can't look it up) — `null` for an unowned death
       * (wildlife / a neutral), so audio can play the "your settler died" stinger for the local player only.
       * `at` is the death node (the reaped unit's last position), so render can leave a cadaver/bones marker
       * there; omitted only if the dying entity somehow carried no `Position`.
       */
      readonly kind: 'settlerDied';
      readonly entity: Entity;
      readonly cause: string;
      readonly player: number | null;
      readonly at?: { readonly x: number; readonly y: number };
    }
  | { readonly kind: 'atomicCompleted'; readonly entity: Entity; readonly atomicId: number }
  | {
      /**
       * An atomic reached its authored PLAY_SOUND_FX frame this tick — the mid-animation cue the
       * original triggers the action's sound at (`ATOMIC_ANIMATION_EVENT_TYPE_PLAY_SOUND_FX`, e.g. the
       * builder's hammer knock at frame 4 of its 15-frame swing). Distinct from `atomicCompleted` (the
       * swing end): audio plays the per-swing SFX here so it lands on the visual strike instead of trailing
       * to completion. Fires only for an atomic whose animation carries the cue; the emitter's snapshot
       * position locates the sound.
       */
      readonly kind: 'atomicSound';
      readonly entity: Entity;
      readonly atomicId: number;
    }
  | {
      /**
       * A melee blow connected this tick — an in-place `attack` swing reached a live target and drained its
       * {@link import('../components/combat.js').Health} at the ATTACK-event frame. `at` is the victim's
       * node (where the wound is), so render draws its blood there and audio plays the weapon-impact SFX
       * from that spot; `weaponMainType` is the striker's weapon class (1 fist / 2 spear / 3 sword /
       * 4 saber / 5 axe — `WEAPON_MAIN_TYPE_*`, ranged classes never emit this) so the impact sound can be
       * weapon-specific, `undefined` when the weapon lists no class. A swing that struck air resolves
       * nothing and emits no `combatHit` — "miss = no blood" falls out of the hit-resolution guard. The
       * ranged twin is {@link 'projectileHit'}, which render/audio treat the same way.
       */
      readonly kind: 'combatHit';
      readonly attacker: Entity;
      readonly target: Entity;
      readonly weaponMainType?: number;
      readonly at: { readonly x: number; readonly y: number };
    }
  | {
      /**
       * A melee swing was loosed this tick — a fighter started an in-place `attack` (the swoosh, at the
       * attacker's node), the melee twin of `projectileLaunched`. Fires on every melee swing whether it
       * connects or whiffs, so combat is audible throughout the animation and not just at the brief connect;
       * the impact clang is the separate {@link 'combatHit'}. Render ignores it (no wound → no blood); it
       * drives only the swing SFX. Ranged swings emit `projectileLaunched` instead.
       */
      readonly kind: 'combatSwing';
      readonly attacker: Entity;
      readonly at: { readonly x: number; readonly y: number };
    }
  | {
      readonly kind: 'goodProduced';
      readonly building: Entity;
      readonly goodType: number;
      readonly amount: number;
    }
  | {
      /**
       * A {@link import('../components/economy/index.js').Felling} node was chopped down this tick — the
       * standing node `node` was destroyed and replaced at `at` by a bare `Stockpile` `trunk` (a
       * {@link import('../components/economy/index.js').GroundDrop} holding the whole `amount` of `goodType`)
       * plus a {@link import('../components/economy/index.js').Stump} decor. Render/audio use it for the
       * felling cue (a "timber!" sound, a falling-tree effect); render otherwise reconciles the new
       * trunk/stump straight from the snapshot, so this is a one-shot notification, not the source of truth.
       */
      readonly kind: 'resourceFelled';
      readonly node: Entity;
      readonly trunk: Entity;
      readonly stump: Entity;
      readonly goodType: number;
      readonly amount: number;
      readonly at: { readonly x: number; readonly y: number };
    }
  | {
      /**
       * A ranged weapon LOOSED a {@link import('../components/combat.js').Projectile} this tick — the
       * `shooter` released an arrow/rock (`munitionType`: 1 arrow / 2 rock) at `target` from `at`, at its
       * ATTACK-event frame. `projectile` is the entity now in flight (render draws it from the snapshot each
       * frame; this one-shot is the launch cue — a bow-twang sound, a muzzle puff). Paired with
       * {@link 'projectileHit'}.
       */
      readonly kind: 'projectileLaunched';
      readonly projectile: Entity;
      readonly shooter: Entity;
      readonly target: Entity;
      readonly munitionType: number;
      readonly at: { readonly x: number; readonly y: number };
    }
  | {
      /**
       * A {@link import('../components/combat.js').Projectile} LANDED its blow this tick — the arrow/rock
       * `projectile` (loosed by `shooter`, `munitionType` 1 arrow / 2 rock) reached `target` at `at` and
       * dealt its damage; the projectile entity is destroyed the same tick. Render/audio use it for the
       * impact cue (a thunk sound, a hit spark) — the ranged twin of an `atomicCompleted` melee swing. A
       * projectile whose target died mid-flight expires silently (no hit event).
       */
      readonly kind: 'projectileHit';
      readonly projectile: Entity;
      readonly shooter: Entity;
      readonly target: Entity;
      readonly munitionType: number;
      readonly at: { readonly x: number; readonly y: number };
    }
  | {
      /**
       * A {@link import('../components/economy/index.js').Resource} node was EXHAUSTED and removed this tick —
       * a mined {@link import('../components/economy/index.js').MineDeposit} deposit whose last unit was chipped
       * off, or a trivial direct-pickup node (a mushroom) after its single harvest. Distinct from
       * `resourceFelled` (a tree coming down, which leaves a trunk + stump): a depleted node just vanishes,
       * its yield already dropped/carried. Render reaps the sprite straight from the snapshot, so this is a
       * one-shot cue for audio/effects and the seam that unblocks the node's collision on removal.
       */
      readonly kind: 'resourceDepleted';
      readonly node: Entity;
      readonly goodType: number;
      readonly at: { readonly x: number; readonly y: number };
    }
  | {
      /**
       * One unit was chipped off a still-standing {@link import('../components/economy/index.js').MineDeposit}
       * node this tick — the node survives (its `remaining` is the value after the chip; the removal of the
       * last unit emits `resourceDepleted` instead). The cue a consumer needs the moment a virgin node is
       * first worked: the `?map=` view hands the node from its retained static decor layer to the live
       * sprite pool here, so the drawn deposit starts shrinking with its levels; audio can hook a chip
       * effect.
       */
      readonly kind: 'resourceMined';
      readonly node: Entity;
      readonly goodType: number;
      readonly at: { readonly x: number; readonly y: number };
    }
  | {
      /**
       * A {@link import('../components/economy/index.js').BerryBush} was just FORAGED — its last ripe fruit
       * eaten this tick, so it flips ripe→bare and starts regrowing. The cue a consumer needs the moment a
       * virgin bush is first worked: the `?map=` view hands the bush from its retained static decor layer
       * (drawn always-fruited) to the live sprite pool here, so from now on the drawn bush tracks its
       * ripe/bare state (ripe again when the BerryGrowthSystem regrows it). Audio can hook a rustle/pick
       * effect.
       */
      readonly kind: 'berryForaged';
      readonly bush: Entity;
      readonly at: { readonly x: number; readonly y: number };
    };

export type SimEventKind = SimEvent['kind'];

/** Mint a positioned event's `at` from a fixed-point Position: the HALF-CELL NODE the position
 *  truncates to — the one coordinate space every `at` carries (see the header note). */
export function eventAt(x: Fixed, y: Fixed): { readonly x: number; readonly y: number } {
  const n = nodeOfPosition(x, y);
  return { x: n.hx, y: n.hy };
}

/** A simple deterministic per-tick event buffer. Cleared each tick, read-only via `current`. */
export class EventBuffer {
  private events: SimEvent[] = [];

  emit(e: SimEvent): void {
    this.events.push(e);
  }

  /** Read the current tick's events (do not mutate). */
  current(): readonly SimEvent[] {
    return this.events;
  }

  /** Clear at tick start. */
  clear(): void {
    this.events = [];
  }
}
