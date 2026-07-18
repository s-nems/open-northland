# The fuzz generator's `setJob` variant is unreachable (the `default` arm never fires)

**Area:** sim (test tooling) · **Origin:** discovered while adding the `unassignHouse` fuzz variant,
2026-07-18 · **Priority:** P3

`test/core/fuzz-determinism.test.ts` picks a command with `const roll = rng.int(N)` and a `switch`
whose `default:` arm returns a `setJob` command. But every value `0..N-1` is covered by an explicit
`case`, so `default` never runs — the fuzzer has **never generated a `setJob` command**. This was
already true before the `unassignHouse` change (`rng.int(33)` with explicit cases 0–32) and the
change kept the pattern (`rng.int(35)`, explicit cases 0–34).

`setJob` still gets unit coverage elsewhere (e.g. `test/family/family-loop.test.ts` "a woman takes
no trade"), so this is a **fuzz-coverage gap**, not a correctness bug: the run-twice-equality /
replay / invariant sweep never exercises `setJob` under a random command stream interleaved with the
rest.

## Scope

Make the `setJob` roll reachable, then confirm the stream still hashes/replays identically to itself
(the fuzz test is self-consistency, not a stored golden — so extending the generator is safe). Pick
one:

- Bump the modulus by one (`rng.int(36)`) and turn the current `default` into an explicit `case 35`,
  leaving a `default` that throws (`assertNever`-style) so a future modulus/case mismatch fails loudly
  instead of silently dropping a variant. This is the fix that also prevents the gap recurring.
- Or, if `setJob` fuzzing is deliberately excluded, delete the dead `default` arm and say why in the
  commit.

Prefer the first: `setJob` is a real player command and belongs in the interleaved stream.

## Verify

`npm test` (the fuzz suite passes — run-twice hash equality, replay fidelity, invariants). Confirm
the new roll actually fires (e.g. temporarily count how often each `kind` is generated over a seed
sweep, or assert the generator can produce a `setJob` for some seed).
