# Lessons — the loop's hard-won memory

Commit-grounded gotchas a fresh-context iteration would otherwise re-learn. This is the
compounding half of the work loop: when a step surfaces a non-obvious, generalizable trap
(a determinism pitfall, a "green tests but broke at the real entry point" slip), it lands here so
the next iteration inherits it.

**The entries live in per-area files — read the one(s) matching the code you're about to touch,
not all of them** (that per-area read is what keeps this memory from polluting every context):

- [`lessons/sim.md`](lessons/sim.md) — sim mechanics, determinism, goldens, sim tests.
- [`lessons/pipeline.md`](lessons/pipeline.md) — asset pipeline: decoders, extractors, IR/data.
- [`lessons/render.md`](lessons/render.md) — render & app: Pixi, scenes, bindings, browser glue.
- [`lessons/tooling.md`](lessons/tooling.md) — build/test glue, cross-package traps, docs.

**Scope.** Not rules (those graduate to [`CLAUDE.md`](../CLAUDE.md) /
[`packages/sim/CLAUDE.md`](../packages/sim/CLAUDE.md)), not the plan ([`ROADMAP.md`](ROADMAP.md)),
not deferred reworks ([`TECH-DEBT.md`](TECH-DEBT.md)).

**Contract.**
- Format: `- [<sha>] <lesson> — <fix/why> (<area>)`, filed in the matching area file. Lead with the
  one-line trap statement; detail after the dash. Ground every entry in the commit that taught it.
- Keep it lean: most steps add nothing. Add a line only when re-learning it would cost real time.
- **Before adding, scan the area file for an existing entry on the same trap and *extend* it —
  don't append a near-duplicate.** A trap hit a third time is a rule: graduate it to `CLAUDE.md` /
  the package `CLAUDE.md` and leave one line here.
- Curation (a `/reflect` duty): promote recurring / rule-worthy lessons into `CLAUDE.md` and prune
  them here; drop entries the code has made obsolete; keep each area file under the ~300-line doc
  budget (`npm run scan:structure` flags it — `sim.md` is the standing hotspot). This is the
  anti-bloat valve that keeps the compounding memory honest.
