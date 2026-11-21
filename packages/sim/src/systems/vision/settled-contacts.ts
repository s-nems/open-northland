import { Palisade } from '../../components/index.js';
import type { World } from '../../ecs/world.js';
import type { FogState } from './state.js';

/** A viewer, the players it has met and its group's mask, hoisted out of the contact pass. */
export interface ViewerBits {
  readonly viewer: number;
  bits: number;
  readonly mask: Uint8Array | undefined;
}

/**
 * What the last contact pass left: no entity it could visit stood on ground a viewer that had not met
 * its owner had explored. That still holds for every entity unchanged since, while the masks, the
 * viewers and the palisade store stand and no viewer forgot a contact, so the next pass visits only the
 * changed entities. Derived state, never saved: a fresh one makes the next pass visit every entity.
 */
export class SettledContacts {
  private fog: FogState | undefined;
  /** The fog generation the masks stood at when the pass ended. */
  private generation = 0;
  private palisades = 0;
  private readonly viewers: number[] = [];
  private readonly masks: (Uint8Array | undefined)[] = [];
  /** Per viewer, the players it had met when the pass ended. */
  private readonly bits: number[] = [];

  /** The fog the last pass ran over, undefined before one. */
  fogOf(): FogState | undefined {
    return this.fog;
  }

  /** Whether the last pass's result still stands for `viewers` over `fog` as it is now. */
  holds(world: World, fog: FogState, viewers: readonly ViewerBits[]): boolean {
    if (this.fog !== fog || this.generation !== fog.generation) return false;
    // A palisade may join without a write the eye feeds watch.
    if (this.palisades !== world.componentGeneration(Palisade)) return false;
    if (this.viewers.length !== viewers.length) return false;
    for (let i = 0; i < viewers.length; i++) {
      const v = viewers[i] as ViewerBits;
      if (this.viewers[i] !== v.viewer || this.masks[i] !== v.mask) return false;
      if (((this.bits[i] as number) & ~v.bits) !== 0) return false;
    }
    return true;
  }

  /** Record the pass that just ended over `viewers`, the masks standing at `fog`'s generation. */
  settle(world: World, fog: FogState, viewers: readonly ViewerBits[]): void {
    this.fog = fog;
    this.generation = fog.generation;
    this.palisades = world.componentGeneration(Palisade);
    this.viewers.length = viewers.length;
    this.masks.length = viewers.length;
    this.bits.length = viewers.length;
    for (let i = 0; i < viewers.length; i++) {
      const v = viewers[i] as ViewerBits;
      this.viewers[i] = v.viewer;
      this.masks[i] = v.mask;
      this.bits[i] = v.bits;
    }
  }
}
