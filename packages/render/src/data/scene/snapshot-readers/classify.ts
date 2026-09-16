import type { SpriteKind } from '../draw-item.js';

/** Which drawable kind a snapshot entity is, by the first marker component it carries. */
export function classify(components: Readonly<Record<string, unknown>>): SpriteKind | null {
  if ('Projectile' in components) return 'projectile';
  if ('Building' in components) return 'building';
  if ('Resource' in components) return 'resource';
  if ('BerryBush' in components) return 'berrybush';
  if ('Chest' in components || 'OpenedChest' in components) return 'chest';
  if ('Stump' in components) return 'stump';
  if ('Signpost' in components) return 'signpost';
  if ('Settler' in components) return 'settler';
  // A delivery flag draws in the stockpile family but holds no goods of its own: it carries no
  // Stockpile, so the harvest piles beside it as separate loose heaps.
  if ('DeliveryFlag' in components) return 'stockpile';
  if ('GroundDrop' in components && 'Stockpile' in components) return 'grounddrop';
  // Building is matched earlier, so a store carrying both stays a `building` - the sim's own
  // ground-pile rule (`nearestGroundPile`: Stockpile ∧ Position ∧ ¬Building).
  if ('Stockpile' in components) return 'stockpile';
  return null;
}
