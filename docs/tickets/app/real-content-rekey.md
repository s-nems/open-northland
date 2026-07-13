# Re-key the sandbox economy onto real engine good/job ids (decide the base architecture first)

**Area:** app (`game/sandbox/`) · **Origin:** global-content plan reconciliation, 2026-07-12 ·
**Priority:** P1 · **Blocked by:** [real-content-loader](real-content-loader.md)
**Needs user:** open architectural decision (hybrid-base vs real-base ids) — get the user's call
before executing.

**Decide before coding (user decision):** the codebase converged on a deliberate hybrid — real
extracted footprints/names overlaid ONTO the sandbox base via `SandboxContentExtras`
(`game/sandbox/content.ts`), fabricated ids kept, the id unification labeled "deferred". The
retired plan's thesis was the opposite: real ir.json as the base with a balance overlay ("a re-key
+ balance overlay, not a swap"). Whether to flip the base or keep the hybrid forever is a live
architectural fork recorded only here — confirm with the user, then execute.

**Source basis (pinned id migration recipe):** sandbox fabricated ids (`game/sandbox/ids.ts`:
`WOOD=1, PLANK=2, COIN=3, STONE=4, MUD=5, IRON=6, GOLD=7, MUSHROOM=8`) vs real engine numbering
(verified in `content/ir.json`: `water=1, mud=2, stone=3, wheat=4, wood=5, iron=6, gold=7, coin=8,
… mushroom=14`). Map: `WOOD→5, STONE→3, MUD→2, IRON→6, GOLD→7, MUSHROOM→14, COIN→8`; jobs
`collector=8, builder=7`.

**The plank fork (still open, confirmed 2026-07-12):** no `plank` good exists in real content —
either retarget the joinery recipe to a real produced good or inject a synthetic recipe on a real
workplace; NAME the approximation in a comment.

## Scope

- Re-key sandbox good/job ids to the real numbering; `parseContentSet` still passes; decide plank.
- The balance overlay that makes the real economy live is the next ticket:
  [real-content-balance-overlay](real-content-balance-overlay.md).

## Verify

- `npm test` + `npm run check` + `npm run build`; app goldens may move deliberately (fabricated
  ids appear in app tests), **sim-package goldens must stay byte-identical**.
