# Capture crashes and ship a downloadable diagnostics bundle (full repro artifact)

**Area:** app + sim · **Origin:** diagnostics research discussion 2026-07-16 · **Priority:** P2
**Blocked by:** docs/tickets/app/diagnostics-logger.md

Today an uncaught exception vanishes: no `window.onerror`, no `unhandledrejection` handler, no
try/catch at the frame-loop boundary (`view/runtime/frame-loop.ts`) — the game just wedges and a
tester has nothing to send. Every studied engine converges on one artifact testers attach
(OpenRA `exception-*.log`, Spring `infolog.txt` + BAR's one-click "Upload Log", Factorio's
auto-uploaded log + desync zip). Our version can be strictly better: because the sim is
deterministic and command-driven, **seed + command log IS the full session repro**
(`docs/ARCHITECTURE.md`; `CommandQueue.log` in `packages/sim/src/core/command-queue.ts`) — a
tester's bundle lets a dev replay their exact session tick-by-tick with `replay()` /
`localizeDivergence` (`packages/sim/src/replay/`).

Overlaps `docs/tickets/features/save-load-game.md`: both serialize
`{seed, contentVersion, map, commandLog}`. Whichever lands first defines that JSON shape; the other
reuses it — do not invent two formats.

Source basis: none needed — self-consistency tooling.

## Scope

1. **Global capture** at `main.ts` boot: `window.onerror` + `unhandledrejection` append
   `{message, stack, source}` to the logger ring (channel `crash`) and show a minimal DOM overlay
   (the game may be wedged — no Pixi dependency): the error message, a "Download diagnostics
   report" button, and a one-line "attach this file to your report" hint.
2. **Bundle builder** — one downloadable JSON file containing:
   - the environment header + full logger ring (from the logger ticket),
   - sim identity: seed, map/scene id, content version, current tick,
   - the **full command log** (`sim.commands.log`) — the repro payload,
   - recent `HashTrace` hashes when recording is on (below),
   - the latest perf readout (the `PerfInfo` the overlay shows).
   JSON now; zip later only if size demands it.
3. **Manual trigger** too — a system-menu entry or debug toggle that downloads the same bundle
   without a crash ("something looks wrong" reports, not just exceptions).
4. **Hash recording wiring** in `frame-loop.ts`: `HashTrace` (hashes only, `snapshotCapacity: 0`)
   recorded after `step()`. Decide the cost gate explicitly: `hashState()` hashes the whole world,
   so per-tick recording is NOT scale-free — either gate it behind `?debug=diag` or sample every N
   ticks (0 A.D. full-hashes every 20 turns). The command log needs no gate — it already exists.
5. **Dev-side consumption**: a test helper (or documented harness snippet) that loads a bundle
   JSON, replays the command log from the seed, and compares final/traced hashes — proving a
   tester's bundle actually reproduces their session.

## Verify

- Unit test: bundle serialize → parse → replay reproduces the recorded final hash (synthetic
  content, headless).
- `npm test`, `npm run check`, `npm run build`.
- Manual (browser): trigger a thrown test error (temporary debug hook) mid-`?scene=` run → overlay
  appears over the wedged game, the downloaded bundle parses, and the replay helper reproduces the
  session. Human confirms the overlay is readable and the download works.
