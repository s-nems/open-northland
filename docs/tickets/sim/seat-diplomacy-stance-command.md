# Let a seat change its stance from the diplomacy window

**Area:** sim, app · **Focus:** diplomacy · **Priority:** P2

A seat cannot change its stance toward another player. `setDiplomacy` is a trusted setup command, the
diplomacy window (`hud/tool-panel/diplomacy`) only reads stances, and `mayTarget`
(`systems/conflict/targeting.ts`) refuses every attack, ordered or autonomous, on a player the attacker
does not hold as `enemy`. Map world assembly starts every roster pair a map leaves unset as neutral, as
the original loader does (`withNeutralRosterPairs`), so 37 of the 44 multiplayer maps start at least
one pair of claimable seats neutral or friendly (26 of them through authored rows). A local skirmish
between such seats can never turn hostile: no unit may attack, and the strategic AI campaigns only
against enemies.

Original (the original, a hypothesis to confirm on the owned copy): the diplomacy window issues network
command 0x7f, which `an original routine` runs as
`an original routine(from, to, state)` for one direction. The setter only silences its
message for a pair flagged `relationnotchangeable` (kept in `components/relations.ts`); how the window
treats a locked pair is not examined. An AI seat answers: `an original routine` turns a
neutral AI hostile toward a seat that holds it as enemy or whose people keep standing in its villages,
and a friendly AI copies a lower stance back.

## Scope

- A seat command that sets the issuing seat's own stance toward another player, with the lock rule
  confirmed on the owned copy or named as an approximation.
- Stance controls on the diplomacy window's own-stance card.
- AI seats answering an enemy stance toward them with their own.

## Verify

- Command tests: a seat declares a neutral seat an enemy and an attack order then lands; a locked pair
  and another seat's stance are refused.
- Headless real-content run on `wielka_kolonizacja_ii_1_1` with an AI opponent: after player 0 declares
  war, the AI seat holds player 0 as enemy.
