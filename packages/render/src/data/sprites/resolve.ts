import type { DrawItem } from '../scene/index.js';
import { DECOR_BINDING_KEY, type SpriteBindings } from './bindings.js';
import {
  resolveBuildingDraw,
  resolveCraftFxDraw,
  resolvePalisadeDraw,
  resolveResourceDraw,
  resolveSignpostDraw,
  resolveStockpileDraw,
} from './layered.js';
import { resolveSettlerBobId } from './settler.js';
import { resolveVehicleDraw } from './vehicle.js';

/**
 * Frame selection alone, without the atlas lookup, so the GPU layer can draw one id from several
 * layered atlases without re-deciding per layer. `null` means a terrain tile or an unbound kind.
 */
export function resolveSpriteBobId(
  item: DrawItem,
  bindings: SpriteBindings,
  tick = 0,
  // The motion-scaled walk-cycle clock, which only a settler reads.
  gaitClock: number = tick,
): number | null {
  // The unbound checks cover the required-typed keys too: the binding record is content-built, and a
  // caller outside the type system gets the placeholder rather than a crash.
  switch (item.kind) {
    case 'tile':
      return null;
    case 'projectile':
      return null;
    case 'fish': {
      const binding = bindings.fish;
      if (binding === undefined || binding.bobs.length === 0) return null;
      const frame = Math.floor(tick / Math.max(1, binding.ticksPerFrame)) + item.ref;
      return (
        binding.bobs[((frame % binding.bobs.length) + binding.bobs.length) % binding.bobs.length] ?? null
      );
    }
    case 'settler':
      return bindings.settler === undefined
        ? null
        : resolveSettlerBobId(bindings.settler, item, tick, gaitClock);
    case 'building':
      return bindings.building === undefined ? null : resolveBuildingDraw(bindings.building, item).bob;
    case 'palisade':
      return bindings.palisade === undefined ? null : resolvePalisadeDraw(bindings.palisade, item).bob;
    case 'resource':
    case 'stump':
    case 'berrybush':
    case 'chest':
    case 'grounddrop': {
      const binding = bindings[item.kind === 'resource' ? 'resource' : DECOR_BINDING_KEY[item.kind]];
      // Unlike the GPU path, this one collapses a data-pinned invisible level to the placeholder.
      return binding === undefined ? null : (resolveResourceDraw(binding, item)?.bob ?? null);
    }
    case 'signpost':
      return resolveSignpostDraw(bindings.signpost, item)?.bob ?? null;
    case 'craftfx':
      return resolveCraftFxDraw(bindings.craftfx, item, tick)?.bob ?? null;
    case 'stockpile':
      return bindings.stockpile === undefined
        ? null
        : resolveStockpileDraw(bindings.stockpile, item, tick).bob;
    case 'vehicle':
      return resolveVehicleDraw(bindings.vehicle, item, tick)?.bob ?? null;
    default: {
      const _exhaustive: never = item.kind;
      void _exhaustive;
      return null;
    }
  }
}
