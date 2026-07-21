# Feed the decoded map diplomacy matrix into sim hostility

**Area:** sim · **Priority:** P2

Combat hostility is binary on the owner axis: `packages/sim/src/systems/conflict/targeting.ts`
treats any two different player-owned entities as hostile ("Both player-owned: the OWNER axis alone
decides (binary hostility, no diplomacy)"). The maps author a directed diplomacy matrix —
`diplomacy <from> <to> friend|neutral|enemy` — now decoded and validated per map into
`content/maps/<id>.script.json` (`MapScript.diplomacy`, schema
`packages/data/src/schema/maps/script.ts`), but nothing consumes it: on a coop map (e.g.
`Ciezka_Wspolpraca`, 8 Human slots all friends) allied players' soldiers attack each other.

## Scope

1. A sim-side diplomacy table (content/config data, not code — golden rule 3): seeded at world
   setup from the map script (a `setDiplomacy` command or setup option; app loads the script via
   `slice/map-loader.ts` `loadMapScript`), defaulting to the current everyone-hostile stance when a
   map ships none, so scenes and roster-less maps keep today's behavior.
2. `targeting.ts` consults it where the owner axis decides today; friend/neutral both do not
   auto-engage (semantic split between them — e.g. neutral still retaliates — needs a source-basis
   check against observed original behavior; name the approximation).
3. The `MissionData` `result "SetDiplomacy" <a> <b> "<state>"` opcode (591 occurrences) will later
   mutate it — leave the table mutable behind a command; interpretation itself stays with the
   trigger work (docs/tickets/features/victory-defeat-conditions.md).
4. `playermisc` `relationnotchangeable`/`relationhide` rows (kept lossless in `MapScript.misc`)
   gate a future diplomacy UI, not this sim slice.

## Verify

- Unit test: two players marked friends never auto-engage; enemies still do; default (no script)
  matches today's golden behavior (goldens must not move).
- `npm test`, `npm run check`, `npm run build`; a coop-map hands-on check in the browser.
