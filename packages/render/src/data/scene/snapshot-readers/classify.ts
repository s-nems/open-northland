import type { DrawKind } from '../draw-item.js';

/**
 * The marker-classification step: which drawable kind a snapshot entity is, decided by which marker
 * component it carries (in a fixed priority order). Terrain tiles are classified separately.
 */

/** Classify a snapshot entity by which marker component it carries (terrain tiles are separate). */
export function classify(components: Readonly<Record<string, unknown>>): DrawKind | null {
  // An in-flight munition (a bare Projectile + Position entity, the ranged-combat shot) — drawn as the
  // minimal oriented arrow (no decoded arrow bob exists in the extracted [bobseq] lanes; a named gap).
  if ('Projectile' in components) return 'projectile';
  if ('Building' in components) return 'building';
  if ('Resource' in components) return 'resource';
  // A wild berry bush (Position + BerryBush marker) — drawn per-species from the bush atlas, ripe or bare
  // by its forage/regrow state. Checked before Settler/Stockpile (a bush is neither); it carries no
  // Resource, so it never collides with the resource path above.
  if ('BerryBush' in components) return 'berrybush';
  // A felled tree's leftover stump/debris — pure decor (a Position + Stump marker, no other drawable
  // component), drawn by a per-good {@link import('../../sprites/index.js').ResourceTypeBinding} like a resource
  // node but from the dead-tree/debris atlas. Checked before Settler/Stockpile (a stump is neither).
  if ('Stump' in components) return 'stump';
  // A scout-erected signpost (Position + Owner + Signpost) — drawn as the guidepost post, with its
  // direction boards synthesized as extra items by the scene collector.
  if ('Signpost' in components) return 'signpost';
  if ('Settler' in components) return 'settler';
  // A designated delivery flag — a pure marker (Position + DeliveryFlag, no Stockpile: it holds no goods,
  // the harvest piles as separate loose heaps around it). Drawn as the flag graphic and painted on top of
  // any co-located heap. Checked before the Stockpile paths since a flag carries no Stockpile of its own.
  if ('DeliveryFlag' in components) return 'stockpile';
  // A freshly-felled trunk still on the ground (a Stockpile carrying the GroundDrop marker) draws its
  // pickup-stage LOG graphic, distinct from a tidy delivery pile — the original shows a different object
  // for uncollected harvest than for the stored heap. Checked before the plain Stockpile so a marked drop
  // never falls through to the flag/heap path.
  if ('GroundDrop' in components && 'Stockpile' in components) return 'grounddrop';
  // A bare Stockpile with no Building is a loose ground pile (the gathering economy's dropped goods heaps,
  // the yard a flag-bound gatherer stacks around its flag). Checked after Building so a warehouse/HQ store —
  // which carries both Building and Stockpile — stays a `building`, matching the sim's own ground-pile rule
  // (`nearestGroundPile`: Stockpile ∧ Position ∧ ¬Building).
  if ('Stockpile' in components) return 'stockpile';
  return null; // an entity with a Position but no drawable marker is skipped (e.g. a pure mover)
}
