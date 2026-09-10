# Decide whether `jobEnablesJob` still gates anything

**Area:** sim · **Priority:** P3

The `job` kind of the `jobEnables` tech-graph gates no order. Its one reader is `jobEnabled`
(`progression/unlocks.ts`), which answers the map script's `JobEnabled` goal beside the script's own
`EnableJob` grant; no command consults it. The automatic employment pass that once did is gone. The
extracted edges are still parsed (`core/content-index/progression.ts`) and still in `ir.json`.

The rule they encode is real: `jobEnablesJob <jobType> <targetJob>` means a tribe cannot take up a
specialization until a settler of the prerequisite trade exists (a smith unlocking a weaponsmith).
Employment deliberately does not apply it - a hand assignment staffs a built workshop with its own
trade rather than silently downgrading to the carrier slot (the "mennica → tragarz" rule) - so if the
gate belongs anywhere now, it is the profession picker (`setJob`), which today enforces only the
per-settler `needforjob` XP threshold.

## Scope

Decide one:

- apply the gate in `setJob` (and grey the row out in the picker, with the enabling trade named), or
- record the rule as deliberately unmodeled at the `JobEnablesKind` seam, leaving the `job` edges to
  the mission goal alone.

Either way the outcome must be visible in the source, not implied by an absent call.

## Verify

`npm test`, `npm run check`, `npm run build`. If the gate lands in `setJob`, a case for both arms
(prerequisite alive / absent) plus one proving `assignWorker` still relaxes it.
