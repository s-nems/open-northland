# Give a "can't" cue for a refused worker/builder assignment click

**Area:** app (input/feedback) · **Origin:** bmd-build-progress review, 2026-07-14; extended by workplace-assignment review, 2026-07-16 · **Priority:** P3

Two sibling assignment gestures produce a silent refusal with no player feedback:

1. **Foundation, no builder selected.** Right-clicking an under-construction building routes every
   selected settler to the `assignBuilder` command (`packages/app/src/view/unit-controls/orders.ts`).
   The sim gates it to the builder trade (`packages/sim/src/systems/orders/work.ts` —
   `jobAtomics(...).has(BUILD_HOUSE_ATOMIC_ID)`), so a selection containing **no builders** produces a
   logged no-op: the units neither move, assign, nor visibly refuse. Mixed selections work (the builders
   assign, the rest no-op), and a builder-only pin is correct — the gap is only the all-non-builder case.
2. **"Przydziel miejsce pracy", click on a red building / terrain.** In assign mode
   (`packages/app/src/view/unit-controls/index.ts` — `resolveAssign`), a left-click on a red (no open
   slot for the settler's trade) building, on terrain, or on a unit silently exits the mode. The
   vanishing green/red wash is the only feedback; there is no positive "can't" cue for the refused bind.
3. **Out-of-area assignment under signpost navigation.** With `setSignpostNavigation` on, the sim
   refuses `assignWorker` to a building beyond the settler's allowed area (`orders/work.ts`, the same
   rule as a refused move order) — another silent no-op the cue should cover, and the assign-mode
   green/red wash should paint such buildings red for the selected settler.
4. **The other out-of-area refusals under signpost navigation.** A refused move order
   (`orders/movement.ts` — the unit silently stays put), a refused `setWorkFlag` (`orders/work.ts`),
   and the stuck states confinement can produce (a loaded settler holding a load with no in-area sink;
   an idle population with every open workplace out of area) all read as "nothing happened" with no
   explanation. Original evidence for a positive cue: the engine's message string "…zgubił się. Twój
   zwiadowca powinien postawić więcej drogowskazów" ("…got lost. Your scout should erect more
   signposts", `ingameguimessages.ini` 16) — the original NOTIFIES the player about navigation
   failures rather than no-oping silently.
5. **Signpost placement misclick exits the mode.** In erect mode
   (`unit-controls/index.ts`), the handler cancels the mode BEFORE dispatching the click, so a click on
   dimmed/illegal ground both does nothing and silently leaves placement — a retry costs a full
   ring-menu round-trip. Keep the mode armed on an illegal click (or at least give the "can't" cue).

## Scope

- When an assignment gesture is refused (no qualifying builder for a foundation; a red building /
  terrain click in assign mode), surface a "can't" cue — a cursor flash / denied-click sound — instead
  of a silent no-op. Mirror whatever refusal feedback other invalid clicks already use (check
  `unit-controls/orders.ts` + `index.ts` for an existing pattern before adding one).
- Keep the working paths: qualifying builders still assign; a green-building assign-mode click still
  binds and exits; only a wholly-unqualified / red gesture refuses.

## Verify

- Headless: assert the command list is empty for an all-non-builder selection on a foundation, and that
  a red-building click in assign mode enqueues no `assignWorker`.
- Human: right-click a foundation with only a farmer selected, and click a red building in assign mode →
  a visible/audible "can't", no silent nothing.
