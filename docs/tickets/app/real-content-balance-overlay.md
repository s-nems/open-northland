# Overlay clean-room gathering/mining balance onto the real content so the economy lives

**Area:** app (`game/sandbox/` + catalog) · **Origin:** global-content plan reconciliation,
2026-07-12 · **Blocked by:** [real-content-rekey](real-content-rekey.md)

**The dead-economy trap (confirmed against today's ir.json):** raw real content is
graphics-complete but gameplay-thin — all 11 goods carrying a `gathering` block have
`chopsToFell/yieldPerNode/depositSize/depositLevels` = 0, so real content fells and mines nothing.
The clean-room pins that must be overlaid live in `catalog/felling.ts` (`WOOD_CHOPS_TO_FELL`,
`WOOD_YIELD_PER_NODE`) and `catalog/mining.ts` (`*_DEPOSIT_UNITS`, `MINE_LEVELS`), consumed in
`game/sandbox/content.ts`.

## Scope

- Real ContentSet as base; overlay felling/mining balance onto the zeroed `gathering` blocks.
- Rebind gatherer/carrier/soldier tuning, `atomicAnimations` lengths, and tribe `atomicBindings`
  to real job ids.
- Re-key the farm haul-out routing on the field-producer signal (the `fix/farmer-carrier-logistics`
  follow-up) now that the real economy path exists.
- Note: real content has 55 buildings vs the 41-building clean-room catalog — surface, don't hide,
  the 14 unmodeled ones (count + skip with a log).

## Verify

- Headless test: the merged economy is alive — wood fells, a deposit depletes, joinery (or its
  plank replacement) produces.
- Determinism preserved (seeded RNG only); sim-package goldens byte-identical.
