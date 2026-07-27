# Route the JobSystem's trade stamp through the trade-change reset

**Area:** sim (economy/jobs + orders/work) · **Priority:** P2

`setJob`/`assignWorker` reset a settler through `reidleAsJob` (`systems/orders/work/employment.ts`),
which stamps the new trade's default military stance and sheds the gear the new trade may not wear.
The JobSystem's automatic employment writes the trade directly instead:

- `systems/economy/jobs/system.ts:110` - `settler.jobType = open.jobType;` then `bind(...)`.

So an auto-hired settler skips both. That is reachable with real content: `content/ir.json` gives
`tower_00`/`tower_01` `workers` slots for job types 40 and 41, both inside the fighter band, and
`resolveOpenWorkerJob` (`jobs/openings.ts:143`) admits a settler that clears their `needforjob`
thresholds (viking: 5 repeats of experience 69 for job 40). Verified consequences for such a hire:

- it keeps its worn tool, although a fighter is refused one everywhere else (`shedToolOnEnlist`,
  the `equipGood` refusal, the assistant skip, and the panel row);
- it keeps its civilian `MILITARY_MODE.FLEE` stance, so a tower guard runs from what it was hired to
  fight. (This half predates the equipment work - `stampDefaultStance` has only ever run on the order
  paths.)

## Scope

- Give the JobSystem the same reset the order handlers use, or extract the shared "the settler's trade
  changed" step both call. Keep the seam small: the JobSystem must not gain the order-only concerns
  (`PlayerOrder` clearing, `DeferredOrder`, the load drop).
- Decide the stance question deliberately: stamping `ATTACK` on tower guards is a behavior change, so
  check the golden traces and the AI-seat scenarios before adopting it.

## Verify

- A headless case: a settler wearing a tool is auto-employed into a fighter-band worker slot; the slot
  ends empty, the shed unit is on the ground or in a store, and the stance matches the new trade.
- `npm test` (goldens included - a stance change moves them only if a golden world has such a slot),
  `npm run test:content`.
