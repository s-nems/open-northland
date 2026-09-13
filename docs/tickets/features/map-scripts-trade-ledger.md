# Record completed player trades for mission goals

**Area:** sim · **Priority:** P2

`NumberOfGoodsTraded` is unsupported. It requires trade history between players, which current
inventory totals cannot establish.

## Scope

- Verify against owned scripts and original behavior which transfers count, the direction of the
  player pair, the quantity unit and treatment of cancelled or partial trades.
- Record qualifying completed trades at the authoritative trade completion seam. If that seam is
  incomplete, implement the bounded gameplay path before exposing the mission goal.
- Keep deterministic cumulative counters per relevant player pair; exclude unrelated stock moves,
  tribute and script grants unless original evidence establishes otherwise.
- Evaluate `NumberOfGoodsTraded` from this ledger and preserve it through save/load. Establish
  sub-mission ledger lifetime and document any approximation.
- Update opcode support and MISSIONS.md.

## Verify

Cover successful, cancelled and partial trades, direction, player isolation, exact thresholds and
save/load without double counting. Exercise the goal through actual trade completion and run normal gates.
