# Repair damaged buildings with builders, and keep menders out of a fight

**Area:** sim, app · **Focus:** construction, builders · **Priority:** P2

A damaged building stays damaged for good: nothing in the sim raises `Health` on a finished `Building`,
and the panel offers no repair. Walls already mend on their own. `repairDamagedPalisade` puts an owned
wall below full health back on the builders' list as an `UnderConstruction` site with
`Palisade.repairing`, and one builder at a time restores `repairPerStrike` hitpoints per hammer strike.
Buildings should follow the same rule, and both kinds need two limits the wall version lacks.

## Scope

- Confirm the original's building repair against readable data or the running original before
  choosing numbers: whether builders mend houses unasked, what a strike restores, whether it costs goods,
  and how many menders one house takes. Name every value the evidence does not give as an approximation.
- Put an owned finished building below full health on the builders' list without a player order, the
  way walls are. A building under repair keeps working, housing and storing, stays drawn as finished, and
  a blow during the repair pulls the job back with its hitpoints.
- Hold a mender back while an enemy fighter is near the damaged wall or building, and let the job resume
  once the area is quiet. Walls under attack today draw builders into melee range for as long as the
  attack lasts.
- Decide the rule for structures a map authors below full health: an owned wall with a low authored
  valency enters repair as soon as the map loads. Keep that rule, or wait for the first damage, and apply
  the same rule to buildings.

## Verify

- Sim tests: a blow on an owned building opens a repair and a builder closes it; an unowned building
  stays damaged; the repair holds while an enemy fighter stands within the chosen radius and resumes after
  it leaves; the authored-damage rule holds for both walls and buildings.
- The palisade scene breach and a building attacked in the siege scene show menders waiting out the fight.
- `npm run check`, `npm run build`, `npm test`, plus a browser pass on a real map.
