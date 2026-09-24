# Keep a farm's herd rows right after an animal is killed or stolen

**Area:** sim · **Focus:** livestock · **Priority:** P3

A farm's species rows are `Stockpile` state: the farm panel shows them as the herd, and
`outputRoomForCycles` (`systems/economy/production/cycles.ts`) reads them as the breeding recipe's
output room. Only `recountHerdRows` (`systems/livestock/herd.ts`) writes them: from the breeder's
plan, a birth, a slaughter, an adoption or a take. Two losses skip it:

- a farm animal a hunter or a fight kills is reaped by `cleanupSystem` (`systems/lifecycle/cleanup.ts`);
- an enemy scout's claim (`claim` in `systems/livestock/capture.ts`) removes `FarmAnimal`.

The row then reads high until the farm's breeder plans again, which never happens on an unstaffed
farm and not while its breeder is away on a need.

Source basis: `herd.ts` records that the original rewrites the rows once per breeder cycle, so the
original may lag the same way; unconfirmed against the running original. Keeping the rows right is
the chosen behavior either way. Name it as a departure in `herd.ts` if the original is seen to lag.

## Scope

- Recount a farm's rows when it loses an animal outside the breeder cycle, within at most one
  herding period (`LIVESTOCK_ASSIGN_PERIOD_TICKS`).
- The trigger must follow from world state alone. A derived memo such as the herd index starts empty
  after a restore, so a recount keyed on its history would make a restored run diverge.
- Keep livestock rules out of `lifecycle/cleanup.ts`; the livestock systems own the recount.

## Verify

- Unit: a farm without a breeder whose animal is killed, and one whose animal an enemy scout
  steals, reads the right row within one herding period.
- Save and restore across the loss produces the same state hash as an uninterrupted run.
- `npm run check`, `npm run build`, `npm test`.
