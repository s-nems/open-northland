# Decide a trade stop's side from its current owner

**Area:** sim · **Focus:** trade · **Priority:** P2

`applyTradeCommand` (`packages/sim/src/systems/trade/commands.ts`) stores `TradeStop.foreign` once,
when the house joins the route, and the drive, the cart effects, `activeAgreement` and the trader
view read that stored flag from then on. Map scripts change owners mid-game
(`systems/missions/results/ownership.ts`: `ChangeHousesPlayerId`, `ChangeHumanPlayerId`,
`ChangePlayerIdInArea`, `ChangePlayerPlayerId`), and a stale flag then misplays the route:

- a trader handed to another player keeps treating its old owner's houses as its own and carts goods
  between another player's houses under the domestic rules;
- a trading house handed to the trader's player stays "foreign", so the trader keeps running the
  agreement exchange with its own house and the `NumberOfGoodsTraded` ledger counts it.

## Scope

Derive whether a stop is foreign from the live owners of the house and the trader wherever the flag
is read, and drop the stored field. That changes the saved `TradeRoute` layout: bump the save format
version and regenerate its fixture in the same commit. A route change that clears state today keeps
doing so; nothing else about trade routes changes.

## Verify

Sim tests over the existing trade-route fixture: a trader handed to another player by a script stops
moving goods between its old owner's houses, and a trading house handed to the trader's player stops
the exchange and the ledger count. The save round-trip test still matches hashes after the version
bump.
