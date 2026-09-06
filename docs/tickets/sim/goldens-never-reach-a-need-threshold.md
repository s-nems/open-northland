# Cover need-drive thresholds in the integration golden

**Area:** sim · **Priority:** P3

`test/core/golden-trace.test.ts` is the integration tripwire, and its header says the needs retune is
"baked into this hash". It isn't, in the way that matters: **no settler in the slice ever reaches the
eat or sleep trigger**, so none of the needs *drives* is covered by a golden at all.

The arithmetic, from the slice's own constants:

- starting deficits are seeded over `NEED_INIT_SPREAD_UNITS` = 0–50% of a bar
  (`systems/lifecycle/needs/system.ts` `rollInitialNeed`);
- a bar drains one reserve unit per tick plus whatever the swing clips spend, so the slice's
  `TICKS = 1000` window adds well under half a bar for its one woodcutter;
- worst case a settler still ends under `NEED_DRIVE_THRESHOLD`, so no drive ever fires.

The needs *rise* is hashed (the bars are component state), but eating, foraging, sleeping, the
rest-spot walk-aside and the sleep-at-home rung are all invisible to it.

## Scope

- Make the integration golden reach the drives. Cheapest honest options, in preference order:
  either lengthen `TICKS` past the threshold crossing, or seed one settler in the slice with an
  authored high starting deficit. Prefer whichever keeps the trace readable.
- The atomic-action trace should then contain eat (10) and sleep (8) entries - that is the point, so
  assert it rather than leaving it implicit.
- Landing this **moves the golden hash and trace on purpose**; name the mechanic in the commit, as
  `packages/sim/AGENTS.md` requires.
- Fix the stale header claim in `golden-trace.test.ts` either way - right now it overstates what the
  hash covers, which is what made the gap easy to miss.

## Verify

- `npm test` - the golden moves once, deliberately, and holds after.
- Sanity check the new trace actually contains the needs atomics; a golden that still never fires them
  has not fixed anything.
