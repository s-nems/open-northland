# Decide what the AI seat does about its own hunter-gated husbandry chain

**Area:** sim · **Priority:** P2

The seat's opening hunter is retired to the civilian pool once its level-2 bakery stands
(`allocateOpeningHunter`, `packages/sim/src/systems/ai-player/workforce/hunter.ts` - user decision:
the hunt ends when game runs short, and the animal farm is a separate concern). He is the seat's ONLY
hunter: nothing employs a settler on its own any more, and `staffBuildings` never staffs the
headquarters' hunter seat, which is both a harvest slot and a slot on a `storage` building
(`staffing.ts` staffs transport only there).

Verified consequence on real content, with profession progression at its default ON. The enabling
edges live in the `[tribetype]` section, not in `goodtypes.ini` (owned copy:
`DataCnmd/tribetypes12/tribetypes.ini:678-680`, `jobEnablesGood 15 56/21/9`, repeated per playable
tribe; base copy: `Data/logic/tribetypes/tribetypes.cif`; extracted by
`tools/asset-pipeline/src/decoders/ini/types/jobs.ts`). Job 15 is the hunter, and goods 56/21/9 are
prey, meat and leather. Wool (good 10) carries no enabling edge at all, so it stays available.
`goodEnabled` requires a living settler of the enabling trade (`progression/unlocks.ts` ->
`aliveTribeJobs`), so after the retirement:

- the cattle chain stops being summoned at all (`tokenConsumable` refuses to spend an animal's life on
  a locked converter), so the first breeder - restricted to the ox line by
  `CRAFT_RESTRICTIONS_BY_BUILDING_ID` - has nothing to work;
- the feed cycle's meat byproduct is dropped at the deposit gate (`economy/production/cycles.ts`), so
  the farm's only output is wool.

The build order (`build-order/entries.ts`) places `work_animal_farm` well before the `work_bakery_01`
upgrade, so this is the steady state of every AI game, not an edge case.

The same source block carries `jobEnablesJob 15 16/17` (breeder, sewer) and
`jobEnablesHouse 15 17/18/44/45` (animal farm, level-0 sewery, both ships). Building and manual
profession gates are active and scoped to the seat; another player's hunter cannot satisfy them.
Retiring the final hunter can therefore also block later construction and workplace admission.
Script Enable grants persist, but ordinary prerequisites still depend on living workers.

## Scope

Pick one and implement it:

- keep one hunter alive while the seat owns a built livestock workplace (the post, or the trade
  alone - the gate reads aliveness, not employment);
- or accept the wool-only farm and drop the seat's second breeder and its ox-line restriction, so the
  plan stops paying for work it cannot do.

The player-facing half of the same gate is already tracked in
[husbandry player feedback](../features/husbandry-player-feedback.md) and is not this ticket.

## Verify

- A sim test over a seat past the milestone: the farm's cattle chain either runs or the plan no longer
  staffs a second breeder.
- `npm test`, `npm run check`, `npm run build`; `npm run test:content` for the plan-content pins.
