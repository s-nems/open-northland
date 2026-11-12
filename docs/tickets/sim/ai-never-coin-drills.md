# Let the computer player coin-drill its soldiers

**Area:** sim · **Focus:** computer-player · **Priority:** P3

A computer seat never coin-drills its soldiers. The drill exists only as the player order
`orderCoinDrill` (`packages/sim/src/systems/orders/coin-drill.ts`), and nothing in
`computer-player/` issues it. The seat also has no plan to stock its barracks with coins: a coin
reaches a barracks only when it is the nearest store with room, or when the barracks marks coin as a
priority good. A seat's sword, spear and bow soldiers so fight with the points they earn in battle
alone, while a player's soldiers can drill to `COIN_DRILL_LIMIT` before the first fight.

## Scope

- Decide when a seat spends coins on the drill rather than on what else it buys with them, and name
  the rule's basis (our rule unless evidence says otherwise).
- Stock the seat's barracks with coins for that plan.
- Order idle soldiers who may drill (`mayCoinDrill`) through the same `orderCoinDrill` command a
  player sends, so the barracks' free-coin gate applies unchanged.

Keep the soldiers on towers, in operations and held by a map script out of it.

## Verify

- Headless: a seat with coins and a barracks drills its idle soldiers up to the limit before peace
  ends, and does not pull men out of a campaign or a tower post.
- The computer-player military tests and the replay hash checks still pass.
