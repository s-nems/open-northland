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

- [LESSONS.md](LESSONS.md) — hard-won gotchas, one per commit, so a later agent doesn't relearn them.
- [TECH-DEBT.md](TECH-DEBT.md) — trigger-gated / speculative reworks deliberately parked (not a
  structural-health queue — `/reflect` owns and *executes* structure), plus the reflection log.

## Per-package contracts

Load-on-demand rules next to the code they bind: `../packages/sim/CLAUDE.md` (determinism contract),
`../packages/render/CLAUDE.md` (RTS-scale drawing), `../packages/app/CLAUDE.md` (URL flags + scenes),
`../tools/asset-pipeline/CLAUDE.md` (prefer the mod's `.ini`; validate decoders vs the oracle).

## Keeping these docs lean (anti-bloat convention)

Three docs are **read by the executor every `/iterate`** and re-bloat fastest: **ROADMAP.md**,
**FIDELITY.md**, **LESSONS.md**. Keep them scannable:

- **ROADMAP.md** — a completed item collapses to a one-line summary + `→ archive` pointer. Its full
  "Hands-on:" verification trail goes **into ROADMAP-ARCHIVE.md**, not inline (a live item never
  accretes its trail — that is the ratchet `/reflect` keeps having to sweep).
- **FIDELITY.md** — each ledger row is `status + one line on how it's pinned` (source + the one key
  verified number). The blow-by-blow lives in the commit message, not the row.
- **LESSONS.md** — one line per lesson; **extend an existing entry rather than appending a near-duplicate**.
- **ROADMAP-ARCHIVE.md** — one entry per roadmap item, filed under its phase; a re-sweep **updates
  that entry in place**, never appends a new dated section.

Detail always survives in git history and commit messages — the docs carry the *current* state, not
the narrative of how it got there.
