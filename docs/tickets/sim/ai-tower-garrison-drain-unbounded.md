# Bound the AI's tower garrison against its field army

**Area:** sim · **Priority:** P2

Every standing tower the AI seat owns takes `TOWER_GARRISON_ARCHERS = 3` archers permanently out of
its field army (`packages/sim/src/systems/ai-player/military/defence/posts.ts`; `takeCensus` drops a
posted man, so he never rejoins a wave). Nothing ever releases a garrison: no rung lowers a post, and
the men are spent for the rest of the game.

The build order's tower entry is perpetual (`{ kind: 'towerCoverage' }` in
`packages/sim/src/systems/ai-player/build-order/entries.ts`), placing a tower per uncovered stretch of
settlement inside `TOWER_DEFENCE_RADIUS_NODES = 19`, and the late tail repeats it at the denser
`DENSE_TOWER_RADIUS_NODES = 14`. A sprawling seat therefore keeps raising towers and keeps paying three
archers each. The draft (`workforce/garrison.ts`) leaves posted archers out of its field count, so it
replaces them, but every one is a man the waves never get: six towers take 18 men before the field army
gains a single one, so the campaign stalls while the walls fill.

## Scope

Pick a rule that keeps the walls manned without eating the army, and name it as the rule:

- a seat-wide cap on posted archers as a fraction of the bow half of the draft;
- posting only towers inside some radius of the seat, leaving outlying ones empty;
- releasing a garrison when the seat's free band falls under `WAVE_MIN_SOLDIERS`, so a tower is manned
  out of surplus rather than out of the wave.

## Verify

- Headless: a seat with N towers and a fixed draft keeps a marchable band above the wave minimum as N
  grows, instead of falling to zero.
- The existing garrison cases still pass: three archers per tower while men are spare, and a posted
  man still leaves the census.
