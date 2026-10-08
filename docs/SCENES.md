# Acceptance scenes

An acceptance scene is a deterministic world setup shared by a headless test and the browser. Use a
scene when a mechanic needs both state assertions and a human check of its presentation.

## Two consumers

| Consumer | Location | Purpose |
| --- | --- | --- |
| Headless | `packages/app/test/scenes/<id>.test.ts` | mechanics and invariants |
| Browser | `?scene=<id>` | pixels, animation, controls, and sound |

A scene does not re-prove same-seed determinism: every mechanic's own suite under `packages/sim/test/`
compares two runs of its scenario, with `core/fuzz-determinism.test.ts` and `core/golden-trace.test.ts`
as the engine-wide tripwires. Nothing checks a scene's own `build()`, so keep pre-tick-zero setup free
of wall clock, unseeded randomness, and payloads shared between runs.

Both consumers use the same seed, sandbox content, setup, and run length. The browser adds local
decoded terrain (required: without generated `content/` the entry halts on the missing-content
notice) and decoded sprites and footprints when served, but the headless test must not require
copyrighted content.

## Scene definition

A `SceneDefinition` in `packages/app/src/scenes/<id>.ts` contains:

- a stable `id`, `seed`, and terrain setup;
- `build(sim)` for pre-tick entities and commands;
- `runTicks` and machine-readable checks;
- optional settings such as needs, fog, or initial zoom.

Player-facing title and summary text belongs in both locale catalogs under `scene.<id>`. Shared goods,
jobs, buildings, controls, and sound bindings belong in the sandbox catalog, not in the scene.

## Add a scene

1. Add a focused scene definition.
2. Register it in `packages/app/src/scenes/index.ts`.
3. Add `packages/app/test/scenes/<id>.test.ts` calling `sceneAcceptance` - one file per scene, so
   Vitest spreads the runs over workers. `registry.test.ts` fails until it exists.
4. Add its title and summary to both locale catalogs.
5. Run `npm test -- scenes`.
6. Open `http://localhost:5173/?scene=<id>` and perform the human checks named by the ticket.

Keep instructions out of the game view. Put durable assertions in tests and short review notes in the
ticket. The normal HUD should remain the thing being tested.

Build the simulation through `createSceneSim` so headless and browser defaults stay aligned. Each
simulation owns its component stores, so tests do not need a global reset between scenes.

See [`TESTING.md`](TESTING.md) for test layers and [`DEVELOPMENT.md`](DEVELOPMENT.md) for browser
entries.

The `farm-construction` scene starts at ×2 and places a working construction crew beside a finished farm.
The `terrain-edits` scene exercises saved terrain palette edits and a scripted build ban. Its western
patch uses a brown vertex palette entry and its eastern patch a green entry from the owned content.

`?scene=movement-continuity` compares barefoot and shod walkers crossing a tan band with road-like
roughness, a diagonal walker, and roaming stags. Repeatedly redirect the diagonal walker with normal
move orders, then watch the straight walkers enter and leave the band. Check that turns preserve the
feet anchor, the walk cycle follows ground travel, and animals retain their heading when stopping.
Original sprite movement remains tick-anchored to preserve foot contact; authored smooth clips keep
their own interpolation.

`?scene=clay-gatherers` places two collectors per civilization beside a clay deposit, in rows:
viking, frank, byzantine, saracen, egyptian. Watch both heads through the shovel cycle and the return
to the flag, especially the byzantine collector with a hat.

`?scene=armed-idle` stands the spearman, swordsman, two-hander, shortbow and longbow of each
civilization in rows: viking, frank, byzantine, saracen, egyptian. Watch them for a while: every idle
fidget keeps the weapon in hand.

`?scene=creatures` places weresnakes and werewolves opposite four swordsmen, with wolves, lions,
lionesses, brown bears and polar bears nearby. Watch the monsters' repeated strikes, the predators'
walk and run cycles, and the animals turning before attacking. Order a soldier to attack a brown bear
to check its retaliation. Reload the scene to repeat the encounter with the same seed.

`?scene=wolf-pack` lets a wolf pack run a scout down to the end of its leash, then sends three
swordsmen on an attack-move into the pack as it walks home. Watch the first blow turn every wolf,
the leader included, on the swordsmen while they are still far from the pack's stay point; no wolf
walks on past them.

`?scene=creature-forms` lines up the five animal-body looks authored for the weresnake tribe: sheep,
chicken, lion, wolf and bear. The lion, wolf and bear forms have soldiers nearby for observing their
combat motions; the sheep and chicken forms remain clear for inspecting their idle and walk poses.

`?scene=army-control` starts 1000 swordsmen with one attack-move gesture. Box-select the company,
redirect it across the clearing, and switch between movement and attack-move. All members should
respond together, allowing for their existing turns, collisions and combat. Shift deliberately
queues a waypoint; a normal click replaces it. This local scene checks controls and presentation;
`army-session.test.ts` verifies the same group payload across two and eight constrained relay links.

`?scene=army-passage` sends the same army through a narrow land passage. Watch the approach, the
constriction and the spread after crossing; redirect the group before everyone has passed. In both
army scenes, inspect the whole march and the settled destination, where soldiers should occupy
distinct spaces rather than form dense clumps. The open clearing should retain a broad marching
front; the passage should narrow it only where the ground requires.

## Real map acceptance

`?scene=mission-map` opens the decoded `wielkie_sprzatanie` map through the normal map entry with
automatic script execution and `debug=missions`. The menu lists it under test scenes. The URL becomes a map URL,
so save/load uses the real map identity. Explicit mission and fog overrides remain effective.

Real-map scenes live in `scenes/map-scenes.ts`, separately from synthetic `SceneDefinition` worlds.
Their headless checks require owned content and run under `npm run test:content`:
`packages/app/test/content/map-mission-acceptance.test.ts` exercises the untouched script's opening,
the hero's ordinary move order to reinforcements, and identical continuation after save/load.
`packages/app/test/map-mission-scene.test.ts` checks routing and the execution-log projection without
owned content.

This is a scripted single-player free map, not a base campaign. Its opening and reinforcements do not
prove its ending or campaign completion. The inspector shows saved execution ticks and counts;
unsupported and refused results remain in the diagnostic log.

`?scene=school` shows a collector walking to school and acquiring an individual carpentry qualification.
Another collector is available for choosing a course through the school dialog.

`?scene=grown-up-training` grows a boy into a civilian a few seconds in, between a school and a
barracks. Sending him to either clears his grown-up note as he sets off.

`?scene=school-graduates` sends two collectors to learn carpentry with the assistant's "send graduates
to work" switch on. The first graduate takes the joinery's only joiner slot. The second finds no free
slot and stays in the school yard, and walks back there whenever it has nothing to do.

`?scene=technology` shows map permission followed by a player-owned profession unlocking housing.

`?scene=gatherer-flag-follow` turns on the assistant's "gatherers move flags to resources" switch for a
collector with two trees beside his flag. Once both are felled the flag moves 3-5 tiles from a tree of
the grove to the east, between the grove and the headquarters, and he goes on felling there.

`?scene=porter-flag` puts a stone miner at a quarry far east of the headquarters. The headquarters
porter holds a pickup flag beside the miner's yard: he carries the quarry stone and the flour of an
unstaffed mill near the flag home, leaves the heap beside the headquarters alone and waits at the flag
when nothing lies there. Select him to plant, move
or take away the flag from the settler panel's Area row or the action ring; without it he fetches the
heap too.

`?scene=idle-work` places three bakeries and a collector on empty grass. Ingrid's bakery lacks water
and flour; Sigrid has bread production set to zero; Freya's bread shelf is full; Bjorn has no resources
to collect. Select a worker or bakery and hover or keyboard-focus the status strip to read the full
reason. An idle notification selects its worker and opens the current diagnosis. Enable Sigrid's bread
production to see the reason change to missing ingredients.

`?scene=far-post` posts Olaf to a bakery 52 tiles from the camp, with no signposts between. He keeps
the post but stands lost by the camp: his status reads "Zgubił się" in amber, with the workplace beyond
signpost reach as the detail. The strip's jump button centres the view on the bakery door. While he is
selected, the door carries a pale blue ring with darts and the minimap a diamond of the same colour.
Clicking the lost note selects him. Right-click the other settlers onto the far home, or walk them past
the signposts, for the same note; the headquarters beside the camp raises none. Once the scout's
signposts reach the bakery, Olaf walks to work and the mark lifts.

`?scene=store-reach` places two bakeries and a headquarters 60 tiles east, with no signposts between
them. Freya's full bakery names the bread no store in reach takes; Ingrid's empty bakery names the
ingredients the headquarters holds outside her reach.

`?scene=combat-blood` compares sword, spear and fist hits on the left with arrows and a fatal
hit on the right. Watch the short sprays settle beneath fighters, the larger stain left by the
casualty, and the drying marks. In Settings → Graphics, switching Blood off clears existing marks
even while paused; switching it back on admits new hits. `?scene=battle` exercises the same effect
with 1000 fighters per side on a 96 × 80 cell field. Both armies attack across the field with
independently shuffled swords, broadswords, spears, short bows and long bows, and bare, cloth, leather,
chain and plate armor. Zoom into the front to inspect sprays and the ground left behind it.
