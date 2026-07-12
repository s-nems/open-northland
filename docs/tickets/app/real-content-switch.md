# Feed the merged real content to the scene sim and vertical slice

**Area:** app · **Origin:** global-content plan reconciliation, 2026-07-12 · **Blocked by:**
[real-content-balance-overlay](real-content-balance-overlay.md)

`createSceneSim` still builds on `sandboxContent(scene.terrain, extras)`
(`packages/app/src/scenes/runtime.ts`) and `runSlice`/`runAuthoredSlice` still call
`sandboxContent(...)` (`slice/vertical-slice.ts`). Panels need no change — they read `sim.content`
generically (details panel `def.stock`, tool panel `menuEntriesFromContent`, sprite resolution off
`sim.content.goods`), and stockpiles seed from `type.stock[].initial` at placement
(`packages/sim/src/systems/command.ts`), so real per-building stock flows in for free.

## Scope

- Point the two entry points at the merged content behind the loader; verify no gameplay
  regression (economy lives, buildings place/select).

## Verify

- In-browser `?scene=sandbox`: places/selects real buildings, Magazyn shows a real store's larder
  with icons, economy runs, no console errors — **user's eyes** (screenshot first yourself).
- Any sim-package golden moving = a real-content leak into the pure sim → stop.
