# Implement barracks recruitment: the equip drive

**Area:** sim + app · **Priority:** P2

Entirely un-started; the seam is explicitly reserved in code: `components/equipment.ts` ("wiring
the two together … is the deferred 'equip drive'"), `components/combat.ts`, `readviews/classes/`.
Barracks data is present: logictype 39 in `app/src/catalog/buildings.ts`, worker slots in
`game/sandbox/content/`.

**Source basis (extracted):** barracks logictype 39, maintype 4 LEARN, `logicSchoolSize 25`, stocks
weapons 37–42 / armors 33–36 / coins 8 (houses.ini); weapon→class binding via weapons.ini
`jobtype`+`goodtype` (e.g. short bow → job 40). The recruit flow itself (setJob → walk to door →
consume weapon → `Weapon`+job flip; best-available armor) is **observed approximation** — the
original's exact flow is oracle-blocked; name it. No weapon in stock ⇒ typed boundary failure, not
a silent no-op.

## Scope

- The equip drive: walk → consume weapon from barracks stock → job/Weapon transform, plus the
  failure path; data-driven off weapons.ini `jobtype`/`goodtype` — no hardcoded weapon table.
- A `?scene=barracks` acceptance scene: civilian sent to recruit, body/weapon visibly changes.

Training/exercise (coin spend, XP buckets, unlock gates) is the separate follow-up:
[barracks-training](barracks-training.md).

## Verify

- `npm test` — existing goldens byte-identical (new mechanic, additive).
- `?scene=barracks` — **user's eyes** on the visible transform.
