# Browser development

## Browser entries

`npm run dev` opens the main menu. Use queries for focused checks:

| Query | Opens |
| --- | --- |
| `?scene=<id>` | Deterministic acceptance scene |
| `?map=<id>` | Converted map |
| `?relay=<ws url>&room=<id\|new>` | Relay session; see [Relay server](DEVELOPMENT.md#relay-server) |
| `?anim` | Character animation gallery |
| `?icons` | Sprite-frame gallery |
| `?sounds` | Sound studio using the game's mixer |
| `?shot` | Screenshot harness entry |

Common options:

| Parameter | Effect |
| --- | --- |
| `lang=pol\|eng\|ger\|rus\|chs\|cht` | Language; a language tag also works (`pl`, `en-GB`, `zh-Hant`, `zh-TW`; a bare `zh` is Simplified) |
| `seed=<n>` | Reproducible world seed; without it the app chooses one and adds it to the URL |
| `player=<seat\|observer>` | Player/view role |
| `tribe=<id>` | Civilization of your own seat (1 viking, 2 frank, 3 byzantine, 4 saracen, 7 egypt) and of what the script hands it ([rule](formats/MISSIONS.md#seats-played-as-another-civilization)); computer seats keep theirs |
| `computer=<seat,...>` | Give selectable seats to the computer |
| `idle=<seat,...>` | Keep selectable seats' entities without AI control |
| `absent=<seat,...>` | Omit claimable seats where the map allows None |
| `fog=off\|classic\|classic-fow\|recon\|recon-fow` | Match fog setting; `off` reveals the map, `-fow` adds fog of war |
| `intro=off` | Skip automatic briefing windows; mission scripts and the mission book still work |
| `sound=off` | Mute game sound |
| `fullscreen=off` | Prevent fullscreen changes and preference writes during a probe |
| `zoom=<n>` | Fixed map zoom |
| `uiscale=<n>` | Fixed UI scale for this entry; not carried across menu/game switches |
| `postfx=on\|off` | Override stored post effects |
| `weathermode=map\|variable\|winter\|off` | Match weather; default `map` |
| `daynight=map\|on\|off` | Match day and night cycle; default `map` |
| `peace=30\|45\|60\|75\|90\|120\|180` | Minutes of peace from the match start among the human, idle and lobby computer seats; default none |
| `weather=rain\|snow\|sand\|clear[:percent]` | View-only weather; default intensity 30; leaves simulation weather unchanged |
| `weather=ambient[:percent]` | Hold the game's weather; 100 is light, 300 is a storm |
| `tint=<palette index>` | Hold a view-only map tint |
| `originalGameCheck` | Enable the original-game gate on a dev server |

Selectable authored AI seats default to Computer, human seats to Idle. Reserved AI seats keep the
map's controls without `computer=`; closed seats spawn nothing. Examples:

```text
/?map=magiczny_las&intro=off&sound=off&fullscreen=off
/?map=magiczny_las&computer=1,2,3,4,5&intro=off&sound=off&fullscreen=off
```

The first is useful for HUD work; the second for playable matches and elimination checks. Idle
settlements do not count toward elimination. Omit `intro=off` to test briefings.

Without `lang`, the browser language is used, falling back to English. Missing map translations use
available source text. Project UI translations live in `packages/app/src/i18n/catalogs/`.
Desktop gate controls are `ON_ORIGINAL_GAME_CHECK=1` and `ON_ORIGINAL_GAME_DIR=<folder>`.

## Graphics checks

Player settings live in the settings screen and persist. Initial values follow
[GRAPHICS.md](GRAPHICS.md); later choices are preserved. Render scale and frame cap are not URL options.
HUD scale depends on display height and the saved interface scale; use `uiscale` and `zoom` for repeatable captures.

Keep the map and camera fixed for comparisons. Include zoom 2 and a zoomed-out pan.

| Setting | Visible effect and limits |
| --- | --- |
| Original art filter (`enhancedSampling`, `pixelArtScaler`) | `xbr` smooths pixel-art edges at any zoom. `xbrz`, `superxbr` and `mmpx` redraw each plain atlas page a view draws at twice its size on the GPU, within a memory budget (`renderer.prescaleStats()` reports the twins, their memory and the pages over budget), and sample it sharp; paletted characters keep `xbr`, construction sites and damage overlays draw through the sharp path. Also filters original terrain and finished buildings. HUD icons keep their own sampling. |
| Enhanced shadows (`softShadows`) | Softens silhouettes and adds projected character/animal shadows. Cache failures keep hard shadows. Flat decor retains its authored shadow under either setting. |
| Enhanced water (`enhancedWater`) | Crossing swells under drifting calm and rough patches, a noise shimmer, surf washing up and off the beach, and stronger colors. Off keeps one swell and one shimmer. Both run on the water clock, one pace at every game speed. |
| Environment motion (`environmentMotion`) | Interpolates fish and adds tree motion. Static-layer vegetation moves; harvested/restored objects in the sprite pool do not. |
| Grounded buildings (`groundedBuildings`) | Adds shaded feet and terrain cover to finished buildings, palisades and built walls. This is an invented look. Construction, placement and collapse keep the plain body. |

Shadow and grounding bakes use a per-frame budget after initial rendering, so enabling them can
update a town over several frames. Missing pixels or a full cache fall back to the plain rendering.
Building filter bakes run on first use and can cause a frame-time spike. Terrain sampling stays
inside each tile; it does not replace mipmaps at extreme zoom-out.

Original walkers keep tick-aligned body and animation frames to avoid sliding feet. Original work,
tree and building clips keep authored images and durations. Projectiles, smoke, fades and collapse
use interpolated presentation clocks. Presentation packs keep their own sampling and motion bindings.

## Debug modes

Combine flags, for example `?debug=profile,trace`.

| Flag | Purpose |
| --- | --- |
| `diag` | Replay/hash diagnostics and invariant checks every 120 ticks; worker mirror and index checks |
| `perf` | Browser performance marks, including `frame/audio` |
| `trace` | Exportable trace |
| `profile` | Per-system simulation cost |
| `missions` | Mission execution inspector |
| `playtest` | Local editable-session preparation, event journal and named checkpoints |
| `notices` | One notification of each type per second on the player's entities; use `?scene=sandbox&debug=notices` |
| `crash`, `crash-worker`, `freeze` | Development server only. Five seconds into a `?map=` game: an uncaught main-thread error, an uncaught simulation worker error (the game stops), or a 12 s main-thread freeze; each raises the bug report dialog and, with automatic reports on, sends a real report to the API. A browser under automation (`navigator.webdriver`) sends one by itself only with an explicit `?api=` |

For a relay desync, export both clients' diagnostic bundles, build the workspace, then run:

```bash
npm run diag -- diff a.json b.json
```

`game.net.dispute` records the verdict and digest inputs. The command finds the first differing input.
Exit codes: 0 equal, 1 different, 2 not comparable (missing data/build, different ticks or invalid JSON).

## Debug tools

Enable **Gameplay > Debug tools** to show the wrench button. Tools apply live, persist in settings,
and are unavailable in relay sessions. The FPS counter is a separate graphics setting.

| Tab | Tools |
| --- | --- |
| Objects | Spawn people, soldiers, wildlife, vehicles, resources and structures for a chosen owner |
| Actions | Targeted orders such as Set health |
| Settings | Needs, visibility, speeds up to ×30, building grid and unlimited zoom out |

Set health accepts 1–100% and applies on the next tick. It keeps at least one hitpoint; construction
uses the built pool and upgrades use the standing building's pool. Normal repair/regeneration continues.

## Browser automation

Launch test browsers with `--mute-audio`; also use `sound=off&fullscreen=off`.
Fullscreen preferences can otherwise resize the window on the first click.

A running game exposes `window.__opennorthland`:

| Member | Use |
| --- | --- |
| `host.tick`, `host.snapshot()` | Read the current drawn state |
| `await host.hashState()` | Hash and its tick |
| `await host.run(ticks)` | Step a paused session; a run ends early on the tick a sub-mission starts or ends or a mission video plays |
| `await setPaused(true)`, `setSpeed(1)` | Pause or set a baseline speed |
| `resetPerf()`, `await perf()` | Start a measurement window and read its report |
| `audioStats()` | Sound counts; compare two reads |
| `renderer`, `sheet`, `cameraCtl` | Live rendering objects |

Pause before reading the stopped tick: the map's simulation worker may be ahead of the drawn state.
Do not trust timings when `sampling.hidden` is true. See [PERFORMANCE.md](PERFORMANCE.md) for metrics
and repeatable benchmarks.

### Mission playtest preparation

With `debug=playtest`, an editable local session also exposes `window.__opennorthland.playtest`.
Relay and read-only sessions expose no playtest handle. Use normal UI for quests, conversations,
choices and mission-book interactions. Preparation submits the existing replayable admin commands:

The stepping example below is for worker-backed `?map=` sessions, where `host.run()` delivers each
tick's events through the runtime before resolving. Inline `?scene=` hosts step directly without
that delivery; use the normal running clock there to exercise presentation and collect the journal.

```js
const game = window.__opennorthland;
await game.setPaused(true);
const test = game.playtest;
test.prepare({ kind: 'debugTeleport', target: 42, x: 20, y: 30 });
await game.host.run(1);
const journal = test.events();
await test.checkpoint('before conversation'); // Inspect { kind: 'saved' } or { kind: 'failed' }.
// Later: await test.restore('before conversation'); // Loads through the normal save flow/reload.
```

`prepare` accepts `debugTeleport`, `debugKill`, `debugSetHealth`, `debugSetNeeds`,
`debugFillStockpile`, `debugCompleteConstruction` and `spawnSettler`. It validates payloads and
returns `{ status: 'submitted', kind, tick }`; inspect the resulting state to establish application.
Coordinates are half-cell nodes. Spawn accepts `jobType`, `x`, `y`, `tribe`, `owner`, `hitpoints`,
`weaponTypeId`, `armorClass`, `equipment` and `experience`; script identities and behavior overrides
are excluded. Health percent is 1–100; needs are 0–100.

Fill-all stock can grant quest items and trigger missions. To prepare one resource, use
`test.prepare({ kind: 'debugFillStockpile', target: 42, goodType: 3 })`. The optional `goodType`
fills only that building type's declared slot to capacity, leaving other goods untouched; an
undeclared good is a no-op. Omitting it retains fill-all behavior. A construction site receives its
construction bill instead of the finished building's stock.

`events(afterCursor = 0)` returns detached `{ rows, nextCursor, overflow }`. Each row has `cursor`,
`observedTick` and `event`. The 512-row tail records all delivered mission events, player verdicts,
existing `*Refused` events and preparation validation failures. The runtime combines events from
every tick it delivers in a frame: `observedTick` is that batch's drawn tick, not each event's sim tick.
Commands that silently do nothing do not acquire a rejection event. Pass `nextCursor` into the next
read; `overflow` means earlier rows were dropped. Cursors start again at zero for each new world or
reload; reacquire the handle and discard old cursors after restore.

Checkpoints use ordinary save slots prefixed `playtest: `, overwrite a same-named checkpoint and
preserve the existing save flow's session metadata, view and accepted pending commands. They appear
in the normal save list. Names must contain 1–80 characters. Restore returns the normal load outcome
and reloads on success; the journal is intentionally not persisted.

## Screenshots

```bash
npm run shot -- --seed 7 --ticks 20 --out shot.png
```

Options: `--map <id>`, `--atlas [real]`, `--terrain`, `--zoom <n>`, `--no-hud`.
Screenshots need visual review.

Menu backdrops are 2560×1440 JPEGs in `packages/app/src/assets/menu-backdrops/`, named after their map.
Use a settlement or landscape with no HUD or map edge. The boot card uses the last menu still.
Update `scripts/check-repository-assets.mjs` when changing the set.
