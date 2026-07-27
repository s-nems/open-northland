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

A settler reaches the soldier band through the barracks drill, not through this flow: the drill pays
the `trainforjob` schooling that `settlerMeetsNeed` accepts beside the unreachable `needforjob 31 5
69` row, and enlists the recruit as the unarmed base class
([barracks-training](barracks-training.md)). What is missing here is the WEAPON — the step from
`soldier_unarmed` to a spear/sword/bow class.

Close this consequence deliberately: because the schooling path admits any fighter target whose
`trainforjob` row is met, ONE 15 s drill on the real viking clip (7 TRAINING) already qualifies a settler
for the wooden-spear, short-sword and short-bow classes (`trainforjob 32/34/40 5 77`), and a second
adds the iron-spear, long-sword and long-bow classes at amount 10. Nothing gives him the weapon, so
`setJob` to one of those produces an armed class with no arms. It is unreachable through the UI today —
`app/src/catalog/professions.ts` offers one "Żołnierz" row (job 31) — but the command accepts it. The
equip drive is what should own that step.

## Scope

- The equip drive: walk → consume weapon from barracks stock → job/Weapon transform, plus the
  failure path; data-driven off weapons.ini `jobtype`/`goodtype` — no hardcoded weapon table.
- The armed classes' gate rows in the fallback catalog (`sandbox/content/catalog/tribes.ts` carries
  the base class only, because 32..41 are also tower worker slots the sandbox staffs).
- Extend the `?scene=barracks` scene: an enlisted soldier takes a weapon, body/weapon visibly changes.

The remaining schooling work (coin spend, the soldier's own TRAIN clip, the school house) is the
separate follow-up: [barracks-training](barracks-training.md).

## Verify

- `npm test` — existing goldens byte-identical (new mechanic, additive).
- `?scene=barracks` — **user's eyes** on the visible transform.
