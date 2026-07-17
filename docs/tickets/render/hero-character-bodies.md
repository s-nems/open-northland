# Extract and bind the named heroes' own bodies/heads (they currently borrow warrior bodies)

**Area:** render + app content + pipeline · **Origin:** map children/soldier-equipment worktree, 2026-07-17 · **Priority:** P3

The decoded maps place the named heroes heavily via `sethuman` (`hero_sword_bjarni` ×~1000,
`heroine_bow_xena` ×~250, `hero_spear_siegfried`, `hero_saber_hatschi`, `hero_axe`,
`hero_unarmed` — `jobtypes.ini` ids 42–47). Since the normalized role join landed they spawn and
fight, but `ADULT_CHARACTER_BY_JOB` (`packages/app/src/content/settler-gfx/character-specs.ts`)
maps each to its weapon class's generic warrior body, and `WEAPON_GOOD_BY_JOB` gives it the matching
weapon good — a named approximation. In the original each hero is a unique named character with its
own look.

## Scope

- The bodies exist: `DataCnmd/types/humanstype/jobgraphics.ini` binds per-tribe `[jobbasegraphics]`
  for logicjobs 42–47 (e.g. tribe 1 job 44 → `CR_Hum_Body_60`, job 45 → `CR_Hum_Body_64`, tribe 3
  job 42 → `CR_Hum_Body_73`; tribe 1 job 46 hero_axe → the generic `CR_Hum_Body_00`). Extract those
  atlases and document the evidence like the existing roster entries.
- Extend the pipeline/roster (`packages/app/src/catalog/roster.ts`, `settler-gfx/character-specs.ts`)
  with the hero specs and swap the 42–47 borrow entries to them.
- Decide whether a hero's `Equipment.weapon` should keep the class weapon good (panel Broń row) —
  today it carries the borrowed body's good so look and equipment agree.

## Verify

- `?anim&char=<hero>` gallery shows the hero body in all 8 facings.
- A map that places heroes (e.g. one of the BJARNI missions) draws them distinct from plain
  soldiers; human sign-off for pixels.
