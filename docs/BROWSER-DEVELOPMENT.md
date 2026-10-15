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
| `lang=pol\|eng\|ger\|rus` | Language; `pl`, `en`, `de`, `ru` also work |
| `seed=<n>` | Reproducible world seed; without it the app chooses one and adds it to the URL |
| `player=<seat\|observer\|overseer>` | Player/view role |
| `tribe=<id>` | Civilization of your own seat (1 viking, 2 frank, 3 byzantine, 4 saracen, 7 egypt); computer seats keep theirs |
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
| `weathermode=map\|variable\|winter` | Match weather; default `map` |
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
| Original art filter (`enhancedSampling`, `pixelArtScaler`) | `xbr` smooths pixel-art edges; `sharp` preserves texel interiors; `bilinear` uses linear sampling. Also filters original terrain and finished buildings. HUD icons keep their own sampling. |
| Enhanced shadows (`softShadows`) | Softens silhouettes and adds projected character/animal shadows. Cache failures keep hard shadows. Flat decor retains its authored shadow under either setting. |
| Enhanced water (`enhancedWater`) | Crossing swells, stronger colors and a moving glint on deep water |
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
| `notices` | One notification of each type per second on the player's entities; use `?scene=sandbox&debug=notices` |

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
| `await host.run(ticks)` | Step a paused session |
| `await setPaused(true)`, `setSpeed(1)` | Pause or set a baseline speed |
| `resetPerf()`, `await perf()` | Start a measurement window and read its report |
| `audioStats()` | Sound counts; compare two reads |
| `renderer`, `sheet`, `cameraCtl` | Live rendering objects |

Pause before reading the stopped tick: the map's simulation worker may be ahead of the drawn state.
Do not trust timings when `sampling.hidden` is true. See [PERFORMANCE.md](PERFORMANCE.md) for metrics
and repeatable benchmarks.

## Screenshots

```bash
npm run shot -- --seed 7 --ticks 20 --out shot.png
```

Options: `--map <id>`, `--atlas [real]`, `--terrain`, `--zoom <n>`, `--no-hud`.
Screenshots need visual review.

Menu backdrops are 2560×1440 JPEGs in `packages/app/src/assets/menu-backdrops/`, named after their map.
Use a settlement or landscape with no HUD or map edge. The boot card uses the last menu still.
Update `scripts/check-repository-assets.mjs` when changing the set.
