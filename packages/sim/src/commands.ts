import type { Entity } from './ecs/world.js';

/**
 * Player commands are the ONLY way sim state mutates (CommandSystem applies them). They must be
 * serializable (a save is a command log; lockstep MP exchanges them) and exhaustively handled.
 *
 * This is a discriminated union, not a bag of methods or numeric opcodes — adding a variant forces
 * every handler's `switch` to acknowledge it (via assertNever), which is the modern guard against
 * the original's "magic number opcode" fragility. Grow this as Phase 2 systems land.
 */
export type Command =
  | {
      readonly kind: 'placeBuilding';
      readonly buildingType: number;
      readonly x: number;
      readonly y: number;
      readonly tribe: number;
    }
  | {
      readonly kind: 'spawnSettler';
      readonly jobType: number;
      readonly x: number;
      readonly y: number;
      readonly tribe: number;
    }
  | { readonly kind: 'setProduction'; readonly building: Entity; readonly goodType: number }
  | { readonly kind: 'demolish'; readonly building: Entity };

export type CommandKind = Command['kind'];

/**
 * The effect an atomic action applies on completion. Keeps the numeric `atomicId` as the content
 * cross-reference (required for fidelity), but the EFFECT a system applies is a typed union so the
 * AtomicSystem's apply switch is exhaustive and golden traces are human-readable, not opaque ints.
 */
export type AtomicEffect =
  | { readonly kind: 'move'; readonly to: { x: number; y: number } }
  | { readonly kind: 'harvest'; readonly resource: Entity; readonly goodType: number }
  | {
      readonly kind: 'pickup';
      readonly goodType: number;
      readonly amount: number;
      /** The store the goods come OUT of (a workplace's stockpile a carrier hauls from), or null
       *  for a sourceless pickup (the goods appear on the settler's back without a source). Goods
       *  are conserved: a pickup `from` a store removes exactly what it adds to the carrier. */
      readonly from: Entity | null;
    }
  | { readonly kind: 'pileup'; readonly store: Entity }
  | { readonly kind: 'produce'; readonly recipeOutput: number }
  | { readonly kind: 'eat'; readonly goodType: number }
  | { readonly kind: 'attack'; readonly target: Entity }
  | { readonly kind: 'idle' };

export type AtomicEffectKind = AtomicEffect['kind'];
