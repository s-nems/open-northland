import type { DrawKind } from '../scene/index.js';
import type { BuildingTypeBinding, ResourceTypeBinding, StockpileBinding } from './layered-bindings.js';
import type { SettlerStateBinding } from './settler-bindings.js';

/**
 * The root sprite-binding vocabulary — the per-kind {@link SpriteBindings} record content fills from the
 * extracted IR, composing the settler binding types ({@link import('./settler-bindings.js')}) and the
 * layered building/resource/stockpile types ({@link import('./layered-bindings.js')}). The pure resolvers
 * ({@link import('./settler.js')}, {@link import('./layered.js')}, {@link import('./resolve.js')}) consume
 * it. Keeping the vocabulary separate from the resolution logic keeps both under a readable size.
 */

/** Atlas-frame kinds the scene binds — the drawable {@link DrawKind}s (terrain tiles bind separately). */
export type SpriteKind = Exclude<DrawKind, 'tile'>;

/**
 * Which atlas bob id draws a given drawable kind. The minimal binding is one representative still
 * frame per kind (`settler` / `building` / `resource`). The settler entry may instead be a
 * {@link SettlerStateBinding} — a per-{@link import('../scene/index.js').SpriteState} (and
 * per-atomic-id) table — for the richer animation binding (a settler's walk/chop frames, keyed off
 * `tribetypes` `setatomic`); the building entry may be a {@link BuildingTypeBinding} — a
 * per-{@link import('../scene/index.js').DrawItem.typeId} table — so each building type draws its own
 * house bob (the `[GfxHouse]` `LogicType` → `GfxBobId` join). A plain number stays valid for either
 * (back-compat: it's the all-types/all-states frame), so old bindings need no change.
 *
 * The `resource` entry may likewise be a {@link ResourceTypeBinding} (a per-good node table) and the
 * optional `stockpile` a {@link StockpileBinding} (per-good ground piles + a delivery flag) — the
 * gathering-economy bindings. A plain-number `resource` and an absent `stockpile` keep old sheets valid
 * (the synthetic marker sheet, older callers): a stockpile with no binding just draws the placeholder box.
 */
export type SpriteBindings = Readonly<{
  settler: number | SettlerStateBinding;
  building: number | BuildingTypeBinding;
  resource: number | ResourceTypeBinding;
  stockpile?: number | StockpileBinding;
  /** A felled tree's stump/debris binding — the {@link ResourceTypeBinding} twin for a `Stump` decor
   *  entity, drawn per-good from the dead-tree/debris atlas (`ls_trees_dead`). Reuses the resource
   *  resolver ({@link import('./layered.js').resolveResourceDraw}); absent keeps old sheets valid
   *  (stump draws the placeholder). */
  stump?: number | ResourceTypeBinding;
  /** A loose dropped-wood binding — the {@link ResourceTypeBinding} twin for a `GroundDrop` entity, the
   *  freshly-felled trunk lying on the ground (the `landscapeToPickup` stage) before a collector carries
   *  it off. Drawn per-good like the node; absent keeps old sheets valid (the drop draws the placeholder). */
  trunk?: number | ResourceTypeBinding;
  /** A wild berry bush binding — the {@link ResourceTypeBinding} twin for a `BerryBush` entity, drawn per
   *  fruited-record variant (`byGfxIndex`) with a two-frame level list (1 = bare, 2 = ripe) so the drawn
   *  bush tracks its forage/regrow state. Reuses the resource resolver ({@link import('./layered.js').resolveResourceDraw});
   *  absent keeps old sheets valid (a bush draws the placeholder). */
  berrybush?: number | ResourceTypeBinding;
}>;
