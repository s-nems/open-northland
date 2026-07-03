# Vinland docs — index

Start with the **contract** (`../CLAUDE.md`) — the golden rules override everything here. This file
maps the rest.

## Read in this order (design)

1. [ARCHITECTURE.md](ARCHITECTURE.md) — the big picture: package boundaries, the one-way
   commands-in/snapshot-out data flow, why each technology was chosen, save/load & multiplayer.
2. [ECS.md](ECS.md) — the simulation core: entities/components/systems, the **atomic-action model**
   (the soul of Cultures), the progression/tech graph, system execution order per tick.
3. [DATA-FORMAT.md](DATA-FORMAT.md) — the intermediate representation (IR): the zod-validated content
   model, numeric-vs-string ids, sprite/animation/map manifests.
4. [TESTING.md](TESTING.md) — the determinism/self-validation pyramid and what an agent **cannot**
   self-validate (pixels).
5. [SCENES.md](SCENES.md) — acceptance scenes: one scene, two consumers (a headless test + a human
   sign-off); how to add one.

## Fidelity & planning

- [FIDELITY.md](FIDELITY.md) — **is the rebuild *faithful*, not just self-consistent?** The
  conformance ledger; the axis no test covers. Read before tuning a mechanic.
- [ROADMAP.md](ROADMAP.md) — the phased plan and the **current target**. The executor works the top
  unchecked item.
- [ROADMAP-ARCHIVE.md](ROADMAP-ARCHIVE.md) — the completed-work verification trail, swept out of the
  live roadmap. Reflection-only; the executor never reads it.

## Reference

- [SOURCES.md](SOURCES.md) — original file formats (`.cif`/`.bmd`/`.pcx`/`.lib`/`.ini`, `map.dat`),
  how to use the OpenVikings oracle, and the **canonical legal statement** (Legal line).
- [PRIOR-ART.md](PRIOR-ART.md) — practices borrowed from other engine reimplementations: adopted /
  deferred / consciously different.

## Process / working notes

- **Workflows** (`.claude/commands/`): **`/worktree` is the primary workflow** — the user authors
  the task/plan, the agent executes it faithfully in an isolated worktree, the user verifies
  manually and gives the explicit merge go. `/audit` runs the domain review lenses
  (determinism / RTS-perf / fidelity + correctness, `.claude/agents/`) over any diff, report-only.
  `/iterate` + `/reflect` + the `iterate-supervisor` workflow are the **autonomous roadmap loop,
  kept as an alternative** — not the default; don't push them.
- [LESSONS.md](LESSONS.md) — hard-won gotchas: the index + contract; the entries live in per-area
  files under [lessons/](lessons/) so an iteration reads only the area it touches.
- [plans/original-ui.md](plans/original-ui.md) — user-driven `/worktree` plan: step-by-step agent
  prompts to extract and rebuild the original in-game HUD. Consumed in order; deleted when done.
- [plans/gathering-economy.md](plans/gathering-economy.md) — user-driven `/worktree` plan:
  step-by-step agent prompts for the faithful gathering economy (per-good node graphics, visible
  piles/flags, multi-chop tree felling, shrinking mineral deposits, data-driven resource
  collision, chop cadence). Consumed in order; deleted when done.
- [TECH-DEBT.md](TECH-DEBT.md) — trigger-gated / speculative reworks deliberately parked (not a
  structural-health queue — `/reflect` owns and *executes* structure), plus the reflection log.

## Per-package contracts

Load-on-demand rules next to the code they bind: `../packages/sim/CLAUDE.md` (determinism contract),
`../packages/render/CLAUDE.md` (RTS-scale drawing), `../packages/app/CLAUDE.md` (URL flags + scenes),
`../tools/asset-pipeline/CLAUDE.md` (prefer the mod's `.ini`; validate decoders vs the oracle).

## Keeping these docs lean (anti-bloat convention)

Three docs are **read by the executor every `/iterate`** and re-bloat fastest: **ROADMAP.md**,
**FIDELITY.md**, **lessons/**. Keep them scannable (`npm run scan:structure` flags the budgets):

- **ROADMAP.md** — a completed item collapses to a one-line summary + `→ archive` pointer. Its full
  "Hands-on:" verification trail goes **into ROADMAP-ARCHIVE.md**, not inline (a live item never
  accretes its trail — that is the ratchet `/reflect` keeps having to sweep).
- **FIDELITY.md** — each ledger row is `status + one line on how it's pinned` (source + the one key
  verified number). The blow-by-blow lives in the commit message, not the row.
- **lessons/*.md** — one entry per trap, filed by area, headline first; **extend an existing entry
  rather than appending a near-duplicate**; graduate a thrice-hit trap to a `CLAUDE.md`.
- **ROADMAP-ARCHIVE.md** — one entry per roadmap item, filed under its phase; a re-sweep **updates
  that entry in place**, never appends a new dated section.

Detail always survives in git history and commit messages — the docs carry the *current* state, not
the narrative of how it got there.
