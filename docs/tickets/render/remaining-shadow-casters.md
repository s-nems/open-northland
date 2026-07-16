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
  `map-object-sprite.ts`). Audit done (decoded owned-copy `_s.bmd` non-empty silhouette counts):
  `ls_ground_s` 88/90, `ls_mushrooms_s` 12/12, `ls_meadows_s` 27/124 (the bush range, ids 97–123),
  `ls_misc_s` only 4/134 — ground/mushroom/bush decor are real casters worth batching into
  `decor-batch.ts`.

Notes pinned by the shadow research (2026-07-16):

- The original stacks overlapping shadows — `PrintBob_Shadow` → `ShadePixel16/32` is a per-blit
  destination multiply with no "already shadowed" guard (OpenVikings `CBobManager.cs`). Do NOT add a
  shared shadow-mask/single-darken pass; per-sprite alpha black is the faithful model.
- The pipeline intentionally bakes `cr_hum_*_s` shadow atlases nothing loads (settlers are
  shadow-less by user decision) — do not "fix" them into the loader; the animal/vehicle subset is
  the part this ticket will consume.

## Verify

- Animals/vehicles: shadow follows the walk cycle in `?scene=` with animals once bound; user's eyes.
- Decor: shadows under mushrooms/bushes/ground props on a real map; user's eyes.
