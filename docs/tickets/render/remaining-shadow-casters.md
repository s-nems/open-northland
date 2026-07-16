# Extend cast shadows to the remaining casters (animals, vehicles, decor)

**Area:** render (+ app content binding) · **Origin:** building/tree cast-shadow work, 2026-07-16 ·
**Priority:** P4

Buildings, trees and the other tall/pooled landscape casters now draw cast shadows from the decoded
shadow-twin atlases (`SpriteLayer.shadow`, `MapObjectSprite.shadow`; the pipeline's
`convertShadowBmdTree` already bakes EVERY referenced shadow `.bmd`, including the creature/vehicle
ones). Settlers stay shadow-less by design (user decision). Not yet drawing:

- **Animals and vehicles/ships** — their animation sets name a `shadowlib`
  (`ir.json` `bobSequences[].shadowlib`, 15 sets) whose frames parallel the body bob ids, same as the
  landscape/house convention. When animals/vehicles get real render bindings (see
  `animal-render-binding.md`), attach the shadow twin to their body layer the way
  `shadowStemsByAtlasStem` does for buildings (`packages/app/src/content/sprite-sheet/human-sheet.ts`)
  and the moving shadow follows for free via `shadowLayerFor`.
- **Flat decor map objects** — `TallObjectLayer` draws map-object shadows; the decor batch
  (waves, grass, mine stains, signs) ignores `MapObjectSprite.shadow` (named approximation in
  `map-object-sprite.ts`). Most decor `.bmd`s hold few/no shadow bobs (`ls_temp_s.bmd`: 7 of 35
  slots), so first audit which decor records actually resolve a silhouette before batching shadows
  into `decor-batch.ts`.

## Verify

- Animals/vehicles: shadow follows the walk cycle in `?scene=` with animals once bound; user's eyes.
- Decor: an audit script over `landscapeGfx` decor rows × their `_s` atlases; only implement if any
  real caster surfaces.
