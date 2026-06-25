# Fidelity — is the rebuild *faithful*, not just self-consistent?

Vinland's goal is a **faithful** rebuild of *Cultures – 8th Wonder* that can *then* be modded and
improved. "Faithful" is a different axis from "correct" in the test sense, and that difference is the
whole reason this file exists.

- **`npm test` proves self-consistency + determinism.** The pyramid (determinism, invariants — goods
  conservation, no-deadlock, path validity — golden traces) runs against the **synthetic fixture**. It
  proves the sim is reproducible and internally lawful. It does **not** prove the sim behaves like the
  original game. An agent can build a fully-green, fully-deterministic economy that plays nothing like
  *Cultures*, and no test would fire.
- **This file tracks the other axis: does each mechanic match the original?** It is a conformance
  ledger, maintained by `/iterate` (the per-step `fidelityBasis`) and `/reflect` (audits + tending).

## Why there is no automatic mechanics oracle

Fidelity is *partly* free and *mostly* not (see `docs/SOURCES.md`):

| Layer | Oracle? | How fidelity is pinned |
|---|---|---|
| **Data params** (recipes, ranges, timings, worker counts, atomic vocab) | **Yes — by construction** | Extracted from the original `.ini`/`.cif`; the pipeline verifies record counts (65 goods, 55 jobs, 105 weapons, …). Faithful as long as extraction is faithful. |
| **Assets** (`.pcx`/`.bmd` → PNG/atlas) | **Yes — OpenVikings pixel-oracle** | OpenVikings renders the originals; diff decoded output pixel-for-pixel + decoder round-trip tests. (Pending an owned game copy + the oracle.) |
| **Sim behavior** (atomic planner, economy loops, AI, pathing, combat, atomic timings) | **No** | OpenVikings' logic tick is a stub counter; the behavior is in neither the data nor the reverse-engineering. It can only be pinned by (a) the data-derived parameters, (b) the readable `.ini` *semantics*, (c) **calibration-by-observation** against the running original. Because nothing automatic catches drift here, **it must be tracked in this file.** |

## The faithful-first rule

A mechanic must match the original's behavior, pinned to one of the sources above. **Conscious
deviations are deferred and recorded — never the default.** If you intentionally diverge (a bug-fix, a
quality-of-life change, a simplification), log it under *Deviations* with the reason, so the faithful
baseline stays knowable and a future "faithful mode" / mod toggle remains possible. The content-is-data
architecture exists precisely so fidelity lives in data, not hard-coded systems.

## Conformance ledger

Status: `not-started` · `approximated` (running but not pinned to the original) · `faithful` (matches a
named source). Update the relevant row when a mechanic lands or is calibrated.

### Pipeline / formats (Phase 0–1)
| Area | Status | Source / how pinned |
|---|---|---|
| `.cif` decrypt + container | faithful | round-trip tested; layout solved vs `XBStorable.cs`/`XBTools.cs` (SOURCES.md) |
| `.lib` / `.pcx` / `.bmd` / `.ini` decoders | faithful (structure) | round-trip tests + real-data record counts; **pixel-oracle diff still pending** |
| Data extraction (goods/jobs/tribes/weapons/buildings/atomics) | faithful (params) | extracted from readable `.ini`; counts verified; cross-refs resolve |
| Decoded-asset **pixel** fidelity | not-verified | OpenVikings pixel-diff not yet run (an agent can't self-judge; needs human + owned copy) |

### Simulation mechanics (Phase 2+)
| Mechanic | Status | Source / how pinned |
|---|---|---|
| _none landed yet_ | not-started | atomic planner, economy, AI, pathing, combat — fill in as each lands, each declaring its fidelity basis |

> **Reflection TODO:** as Phase-2 mechanics land, every row here gets a fidelity basis or an explicit
> "approximated — calibration-by-observation pending". An empty/non-`faithful` mechanics table sitting
> under a wall of green tests is the exact blind spot this file exists to surface.

## Deviations (conscious divergences from the original)

_None yet._ Format: `- <mechanic>: <how it differs> — <why> (<commit>)`.
