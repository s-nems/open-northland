# Give the enjoyment (company) need a satisfier drive

**Area:** sim + content · **Origin:** needs-tuning worktree, 2026-07-16 · **Priority:** P3

Enjoyment (`Settler.enjoyment`, the HUD's *Towarzystwo* bar) now drains at the same brisk rate as hunger
for every non-fighter (10% of a bar per 1min20s at 1× — `ENJOYMENT_RISE_PER_TICK` in
`packages/sim/src/systems/lifecycle/needs.ts`). But it has **no satisfier drive**: the `enjoy`/`make_love`
atomics reset it (`AtomicSystem`), yet nothing in the planner ever chooses them, because — unlike `pray`
(walk to a temple) — there is no readable building satisfier in the source data to walk to. Net effect: a
civilian's company bar climbs to empty within ~13 min and **stays pinned there forever**.

Today this is only cosmetic — enjoyment carries no penalty (only hunger→starvation does), so a pinned bar
does not break play. But it reads as a permanently-broken stat once a player inspects a unit, and it made
the fast drain more visible, which is why it is filed now rather than left implicit in a code comment.

## Scope

- Decide the satisfier: a gathering-place building (tavern/well/square) the planner walks a settler to,
  mirroring the `pray`/temple target-bound drive (`drives-needs.ts`, `nearestTemple`), OR an in-place
  social atomic gated on nearby settlers. State the source basis for whichever is chosen — the original's
  leisure satisfier is **unreadable in the `.ini`/`.cif`** (investigate-first; do not guess a building id).
- Wire the drive in `packages/sim/src/systems/agents/drives-needs.ts` with a threshold like the existing
  ¾-bar `PIETY_PRAY_THRESHOLD`, routing to the chosen satisfier; the reset atomic already exists.
- If no faithful satisfier can be pinned, the fallback is to slow enjoyment's drain back down (or freeze
  it) so the bar does not sit permanently empty — a named approximation, not a silent revert.

## Verify

- A headless test: a civilian past the threshold walks to the satisfier and its enjoyment resets (the
  eat/sleep/pray-drive tests are the template).
- `npm test`, then a human eyeballs the *Towarzystwo* bar recovering in `?map=<id>` — **user judges the
  pacing/feel**.
