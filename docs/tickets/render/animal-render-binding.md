# Bind the cr_ani animal atlases so animal entities have bodies

**Area:** render + app content · **Priority:** P2

The sim has a full herd system (`spawnAnimalHerd`, `seedAnimalHerds`, `HerdMember`, herding +
combat aggression — animals ARE the settler entity/AI model), but a spawned animal has no art: no
`cr_ani` atlas binding exists in the app (grep hits only a pipeline test). Atlases
`cr_ani_body_00.{bear01,cattle01,deer01,chicken01,wolves01,…}` exist in `content/`.

Blocks [map-authored-animals](../features/map-authored-animals.md) — no point placing invisible
animals.

## Scope

- Bind the `cr_ani_body_00.<species>` atlases into the sprite sheet, mirroring the settler body
  resolution in `packages/app/src/content/settler-gfx/` (simpler — no head overlay).
- Draw idle/stand frames per facing; locomotion frames if the lanes are present.

## Verify

- `npm test`; a spawned herd in a scene draws visible deer/bears — screenshot yourself first,
  **user's eyes for fidelity**.
