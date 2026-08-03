# Un-shadow the fuzz harness's own building types

**Area:** sim · **Priority:** P2

`packages/sim/test/core/fuzz-determinism.test.ts` appends two building types to the shared fixture and
reserves their ids in a comment: `FOOTPRINTED_TYPE = 5` and `HOME_TYPE = 9`. Both ids have since been
taken by `packages/sim/test/fixtures/content/economy.ts` (`farm` at 5, `forge` at 9), and
`contentIndex.buildings` is first-wins, so every system resolves those ids to the FIXTURE's entry.

Verified by printing the parsed entry from inside a fuzz run: `typeId 9` reads back as
`{"id":"forge","kind":"workplace",...}`, and `shelterCapacityOf(fuzzContent(), 9)` returns 0 for a
`fuzz_home` declared with a capacity.

Consequences today: the harness's stated coverage of the family loop (`assignHouse` → wedding → birth,
which the `builtHomeType` gate refuses on a workplace) and of the footprint collision paths is not
running. The fuzz still passes - it asserts determinism and invariants, and both hold on the shadowed
content - so nothing fails when the coverage silently disappears.

## Scope

- Move the harness's appended types onto ids the fixture does not define, and assert the reservation
  instead of stating it in prose (a parse-time check that each appended `typeId` is absent from
  `testContent().buildings` fails loudly the next time the fixture grows).
- Re-run the fuzz seeds afterwards: the family machinery will run for the first time, so treat a new
  invariant violation as a real finding, not as noise from the change.

## Verify

- `npx vitest run packages/sim/test/core/fuzz-determinism.test.ts` - green, and the run reaches the
  home/footprint paths (the `sheltered` flag already pins the defence half the same way).
