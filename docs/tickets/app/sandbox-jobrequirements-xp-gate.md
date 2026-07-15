# Give the sandbox tribe a jobRequirements XP gate so `settlerMeetsNeed` is exercised headless

**Area:** app (sandbox content) · **Origin:** sandbox-tech-graph branch, 2026-07-15 · **Priority:** P3

The sandbox tribe now carries a real-shaped `jobEnables` tech graph (`content/catalog/tech-graph.ts`), so the
`buildingEnabled`/`goodEnabled`/`jobEnabled` gate is exercised headless. Its sibling gate on the *threshold*
axis — `settlerMeetsNeed` reading `TribeType.jobRequirements` (the `needfor{job,good}` XP thresholds) — is
still **unexercised**: `buildSandboxTribes` sets no `jobRequirements`, so the schema default `[]` means every
sandbox trade is XP-ungated and `settlerMeetsNeed` always returns true. A fresh 0-XP settler failing to qualify
for a threshold-gated trade (the second gate the warehouse-employment investigation flagged) can't be caught in
CI.

Source basis: the real viking tribe carries 115 `jobRequirements` in ir.json (`needforjob <targetId> <amount>
<expType>`); e.g. `{requirement:'need', target:'job', targetId:19, amount:10, experienceTypes:[45]}`. The
sandbox reuses the original job/good ids, so a faithful subset resolves against the same id space (the same
approach `tech-graph.ts` took for `jobEnables`).

## Scope

- Author a small clean-room `jobRequirements` table (a couple of representative `needforjob` edges over
  sandbox job ids) mirroring the real ir.json shape, and wire it into `buildSandboxTribes`. Keep the enabling
  trades used by existing scenes (carrier 24, the rebased farmer/miller/baker slots) ungated, or the chain +
  warehouse scenes' fresh 0-XP workers stop qualifying — mirror how the real HQ bootstrap avoids that.
- Add a headless test asserting both directions of the threshold gate: a 0-XP settler is refused a
  threshold-gated trade; a settler with the accrued XP qualifies. (Twin of `test/sandbox-tech-graph.test.ts`.)
- Confirm the experienceTypes track ids resolve the way `grantWorkExperience` keys XP, so the accrued side of
  the test is real, not vacuous.

## Verify

- `npm test` (the new gate test green, all scene assertions still green), `npm run check`, `npm run build`.
- No browser pass needed — this is a headless mechanic gate, no new pixels.
