# The sandbox acceptance scene times out under full-suite load

**Area:** app · **Origin:** sim refactor-cleanup review battery (deferred), 2026-07-17 · **Priority:** P2
(flaky gate — fails `npm test` intermittently, on main as well as on branches)

## Context

`packages/app/test/scenes.test.ts` gives every acceptance scene a `SCENE_RUN_TIMEOUT_MS = 60_000` budget
(`:15`). The `sandbox` scene sits close enough to that ceiling that it passes when the file runs alone and
**times out when the whole suite runs**, where vitest's worker pool contends for CPU. Observed twice in one
session on an otherwise-green tree; the identical tree passed a full run minutes earlier.

This is not branch-specific. Measured on the same machine, same 20 scenes, file run alone:

| tree | test time |
| --- | --- |
| `main` @ 44c088e9 | 247.8 s |
| `refactor/sim-cleanup` | 133.4 s |

So the headroom problem is pre-existing (main is *slower*), and a passing run is luck about scheduling
rather than a claim about the code. A gate that fails on load is a gate people learn to re-run and ignore,
which is worse than no gate.

## Scope

Diagnose before tuning — do not simply raise the constant, which hides the trend:

- Profile the sandbox scene's headless run (`eee5ac46`'s per-system sim bench harness is the tool) and find
  where its ticks go. If one system dominates, that is a sim ticket, not a test ticket.
- Then choose deliberately: cut the scene's tick count / population to what its assertions actually need, or
  raise the budget with a comment stating the measured runtime and the headroom factor.
- Consider whether the acceptance scenes should run in their own vitest project so they do not contend with
  ~280 fast unit files.

## Done when

- A full `npm test` under load passes the scenes repeatedly (run it several times, not once).
- The chosen budget is justified in a comment by a measured number, not a guess.
