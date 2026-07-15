# Overlay hand-authored gathering/mining balance onto the real content so the economy lives

**Area:** app (`game/sandbox/` + catalog) · **Origin:** global-content plan reconciliation,
2026-07-12 · **Blocked by:** [real-content-rekey](real-content-rekey.md) · **Priority:** P1

**The dead-economy trap (confirmed against today's ir.json):** raw real content is
graphics-complete but gameplay-thin — all 11 goods carrying a `gathering` block have
`chopsToFell/yieldPerNode/depositSize/depositLevels` = 0, so real content fells and mines nothing.
The hand-authored pins that must be overlaid live in `catalog/felling.ts` (`WOOD_CHOPS_TO_FELL`,
`WOOD_YIELD_PER_NODE`) and `catalog/mining.ts` (`*_DEPOSIT_UNITS`, `MINE_LEVELS`), consumed in
`game/sandbox/content/`.

## Scope

- Real ContentSet as base; overlay felling/mining balance onto the zeroed `gathering` blocks.
- Note: real content has 55 buildings vs the 41-building hand-authored catalog — surface, don't hide,
  the 14 unmodeled ones (count + skip with a log).
- The tuning/animation rebind onto real ids is the next ticket:
  [real-content-tuning-rebind](real-content-tuning-rebind.md).

## Verify

- Headless test: the merged gathering balance is alive — wood fells, a deposit depletes.
- Determinism preserved (seeded RNG only); sim-package goldens byte-identical.
