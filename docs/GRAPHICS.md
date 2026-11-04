# First-launch graphics defaults

The browser and desktop app seed graphics settings before opening any entry, only when
`open-northland.settings` is absent. Saved settings, including partial records, belong to the player.
No frame loop, display change, GPU change or subsequent release reapplies the recommendation.
**Restore defaults** explicitly selects the current hardware recommendation again. If storage is
blocked, the choice and subsequent edits survive menu/game transitions in that document only.
Initialization waits for detection before entries read settings, and rechecks storage before writing
so a user edit or another tab wins over a pending result.

## Profiles

GPU classification comes from the pinned `@pmndrs/detect-gpu` dependency and its matching benchmark
database. The game owns only the mapping in
[`graphics/defaults.ts`](../packages/app/src/view/graphics/defaults.ts):

| Library result | Game profile | Original art filter | Other optional world enhancements |
| --- | --- | --- | --- |
| `BENCHMARK`, tier 3 | Quality | xBR | All enabled |
| `BENCHMARK`, tier 2 | Balanced | Off | All enabled |
| `BENCHMARK`, tier 0 or 1 | Performance | Off | Enhanced shadows, water, environment motion, building grounding, detailed building damage, day and night, weather and post effects disabled |
| Missing, blocked, failed or fallback detection | Performance | Off | Same as above |

Every profile keeps blood, bone fading and sprite smoothing enabled. Disabling detailed damage
retains basic smoke; disabling enhanced shadows retains authored shadows. Render scale stays at 1,
the frame cap is 60, and HUD/input/audio preferences keep their ordinary defaults.
xBRZ, Super-xBR and MMPX remain manual choices; automatic selection uses only xBR or Off. The mapping
remains a project quality policy requiring game-specific calibration.

The library's default tier boundaries are 15, 30 and 60 benchmark FPS. These are database scores,
not a measurement or prediction of this game's FPS. For a matched model, the library selects the
sample nearest the display's physical pixel count. The app supplies the larger of the current
window and screen dimensions in CSS pixels, allowing for a later fullscreen launch; the library
multiplies by DPR in both axes. There is no additional 1440p threshold or model-family table.
If a model has only one resolution sample, resizing cannot improve that evidence.

With the pinned database at 1920×1080, RTX 4090 and GTX 1650 match tier 3, while Intel UHD 620 and
HD 4000 match tier 1. These are tested library outputs, not performance measurements of this game.

Ryzen APUs report `AMD Radeon(TM) Graphics` with a PCI device id and no model. The database matches that
name to an unrelated discrete card (`intel radeong 0.4 on amd tonga` at 119 fps with the id,
`amd radeon polaris` at 60 fps without), so every such APU gets tier 3 whatever its size.

## Cost basis

| Option | Work it adds | Measured cost |
| --- | --- | --- |
| xBR / enhanced sampling | Multi-tap sprite/palette sampling and edge arithmetic; also enhanced terrain sampling and building minification. Cost depends on covered pixels, DPR and zoom. | See [laptop GPUs](#laptop-gpus-at-19201080) |
| xBRZ / Super-xBR / MMPX | One GPU redraw of each plain page a view draws at twice its size, at most 1 Mi texels a frame, then the twins' memory: up to a 1.5 GiB budget against 433 MB for the pages themselves on `magiczny_las` late game. Characters, flat decor (trees, rocks, grass), construction sites and damage overlays keep xBR, terrain filtering or the sharp path. | See the magnifier scenarios of `npm run bench:gpu`; a dense 1440×900 view holds 1.45 GB of twins |
| Enhanced shadows | Cached blur baking and uploads; flat decor uses a 6×6 sampling footprint. | None at zoom 1; on is cheaper than off below zoom 1 and on a DPR 2 display (14% of the frame there), because a soft bake samples once where the authored silhouette goes through the magnifier |
| Weather | Screen-covering procedural atmosphere, precipitation, ground reactions and cover updates. | See the weather scenarios of `npm run bench:gpu` |
| Environment motion | Per-frame vegetation updates; visible shore waves also draw a lift map over the waves' rectangle, copy the ground under them and redraw the wave quads. | No GPU cost above noise on the M2; shore waves in view at ×3 cost 0.65 ms at 1080p and 3.4 ms at 4K on an Intel UHD 770 |
| Enhanced water | Terrain shader swell and domain-warped noise shimmer on water pixels, and the swash on the coast band; shore waves are owned by environment motion. | On an Apple M2 Pro at 1440×900, a coast view on `arabskie_wyspy_wolna_gra_mieszana` with half the screen sea: 0.2 ms of a 0.95 ms frame at zoom 1 and 0.16 ms of 0.9 ms at zoom 2, the swash about 0.07 ms of it; zoomed out to 0.35, 0.13-0.15 ms of 1.1-1.4 ms |
| Building grounding / damage | Cached source-pixel analysis, baking and uploads; extra overlays or detailed smoke/flame/debris sprites. | Grounding: on an Intel UHD 770 at 1080p, 1.0 to 1.1 ms of a 13.4 ms dense-town frame with xBR at zoom 1 and 0.35 ms of 6 ms with the filter off, nearly all of it the shade and cover overlays' fill; damage: none above noise without fires in view |
| Day and night | While a night darkens the scene: the world drawn into a texture with a one-byte lit mask beside it, a half-resolution light map of the house and fire pools, the weather and chrome drawn into it in a second pass, and one composite pass. Light-bearers mark their own quads, so no draws are added. | `magiczny_las` t100000 at 1920×1080, ×3, densest town, night against a flat night: on an Intel UHD 770 0.4 ms CPU and 0.6 ms GPU at zoom 1, 0.9 ms CPU and 1.0 ms GPU at zoom 0.5; on an RTX 4090 0.3 ms CPU and no GPU cost above noise |
| Post effects | One screen-covering vignette sprite, not a separate render of the world. | Under 1% of the GPU frame |
| Blood | Combat-event history and visible spray/stain rendering; not a constant full-screen workload. | CPU only: about 0.6 ms a frame at ×3 in a battle, mostly the contact walk of fresh bursts |
| Bone fading | Age-based opacity. Disabling it retains piles indefinitely. | No cost above noise |
| Render scale | Every world pixel at the scale squared, and at zoom 1 every sprite magnified. | 1.5 costs about 3.6 times the frame and 2 about 6.5 times; a DPR 2 display at scale 1 about 7 times |
| Dense displays (`backingDensity`, default `auto`) | From 1.5 device pixels per CSS pixel times render scale, the world draws at one texel per CSS pixel and one pass upscales it: xBR with enhanced sampling on, sharp-bilinear with it off; the HUD, minimap and portraits stay native. `native` keeps every device pixel. | Intel UHD 770 at 3840x2160 (DPR 2), dense `magiczny_las` town at zoom 1 with xBR: 98.6 ms native, 15.9 ms sharp, 19.5 ms xbr; Apple M2 Pro at 1440x900 DPR 2: 18.8 ms native, 2.9 ms sharp, 3.5 ms xbr |

The measured column comes from an Apple M2 Pro at 1440×900 with every other option on, `magiczny_las`
(six hard AI) and `piec_dolin` (fifteen) at tick 100000: GPU time of the paused, GPU-bound
[per-setting loop](PERFORMANCE.md#per-setting-gpu-cost) with the option on against off, interleaved,
and renderer CPU time at ×3. It ranks the options; it does
not predict a weak GPU's milliseconds, validate the tier-to-settings mapping or quantify weather.
Weak-device weather defaults are precautionary.

### Laptop GPUs at 1920×1080

`npm run bench:gpu-settings` (6 cycles, two runs; a cell gives both runs' medians when they differ) on
`magiczny_las` at tick 100000, the densest town, every other option on with xBR, Windows Chrome 156 on
ANGLE Direct3D 11: a Radeon Vega 7 (Ryzen 7 4800HS, `AMD Radeon(TM) Graphics`) and a GeForce GTX 1660 Ti
Max-Q. Both GPUs match tier 3, Quality.

| Row | Vega 7, zoom 1 | Vega 7, zoom 0.5 | GTX 1660 Ti, zoom 1 | GTX 1660 Ti, zoom 0.5 |
| --- | --- | --- | --- | --- |
| Frame, every option on | 4.67 / 4.71 ms | 6.53 ms | 2.10 / 2.24 ms | 3.02 / 3.03 ms |
| xBR against art filter off | 1.05 | 1.77 / 1.71 | none above noise | none above noise |
| xBRZ, Super-xBR, MMPX against off | 1.56-1.59 | - | 0.08-0.20 | - |
| Enhanced shadows | 0.10 | -0.17 / -0.16 (on is cheaper) | none above noise | none above noise |
| Building grounding | 0.21 | 0.24 / 0.22 | 0.27 / 0.22 | 0.33 / 0.38 |
| Enhanced water, environment motion, building damage, post effects | 0.08 or less | 0.08 or less | none above noise | none above noise |
| Coast (36 shore waves in view): environment motion, enhanced water | 0.04 / 0.05, 0.17 / 0.14 | - | none above noise | - |
| Day and night, at night | 0.75 / 0.73 of a 5.6 ms frame | 0.93 / 0.97 of 7.7 ms | 0.14 / 0.22 | 0.18 / 0.23 |
| Weather: rain, snow | 3.33 / 3.27, 4.15 / 3.89 | - | 0.11 / 0.13, 0.25 / 0.07 | - |
| Sprite smoothing off (a separate load) | 5.02 / 5.01 ms frame | 7.31 / 6.95 ms frame | 2.15 ms frame (one run; the other's load was noisy) | 3.08 / 3.10 ms frame |
| Render scale 1.5 (a separate load) | 17.75 / 17.56 ms frame | - | 3.15 / 3.16 ms frame | - |

The loop's control rows stay within 0.1 ms; a separate load's frame differs from the `day` session's by
up to 0.3 ms at zoom 1 on the Vega 7 with nothing changed. On the GTX 1660 Ti the page's own script
takes 1.3 ms of the 2.2 ms redraw at zoom 1 and 2.3 of 3.0 ms at zoom 0.5, and render scale 1.5 adds
only half the frame, so the GPU work of a setting there hides under the frame's CPU work. On the
Vega 7 the Quality frame takes 9.1 ms at zoom 1 in snow and 7.7 ms at zoom 0.5 at night, inside a
60 fps frame's 16.7 ms.

The WebGL timer `npm run bench:gpu` reads on the Vega 7 takes one of two clock modes for seconds at a
time, about 5 or 13 ms for the same view, so its per-scenario milliseconds there are not setting costs.

## Detection and calibration

The short-lived WebGL probe uses the renderer's default power preference. Its cached adapter name
is passed to the library; diagnostics record the raw name, library result, profile and pixel budget.
This observes the adapter chosen by WebGL, not the strongest installed card. A subsequent driver/OS
adapter switch cannot be inferred from that observation. Renderer information is optional and may
be hidden for privacy, as described by the
[Khronos extension specification](https://registry.khronos.org/webgl/extensions/WEBGL_debug_renderer_info/).

The [library documentation](https://github.com/pmndrs/detect-gpu) describes its GFXBench data and
result types. Its upstream data source stopped updating in December 2025, so a new GPU may have no
matching sample. The library also supplies an estimated M-series floor when Safari reports only
`Apple GPU`; a `BENCHMARK` result does not always identify one exact model. We preserve the result
type in diagnostics and never interpret a fallback tier as a measured score.

The Vite plugin ships the dependency's database and MIT license at `/gpu-benchmarks/<version>/`
in both development and production, including the desktop bundle. No external CDN is contacted
for GPU detection. Updating the pinned dependency updates the classifier and bundled database
together. A failed lookup or a three-second deadline selects Performance; it cannot stall startup
or overwrite later edits. An explicit restore-defaults action can retry a failed lookup.

Unreal exposes a
[hardware benchmark](https://dev.epicgames.com/documentation/en-us/unreal-engine/BlueprintAPI/Settings/RunHardwareBenchmark)
and stresses reproducible scenes across hardware and resolutions in its
[scalability guidance](https://dev.epicgames.com/documentation/en-us/unreal-engine/scalability-and-the-developer-for-unreal-engine).
Before changing the tier-to-settings mapping, measure representative hardware in a muted headed
browser with the [browser benchmark](DEVELOPMENT.md#measuring-performance): fixed developed-map
checkpoint, camera, physical resolution, xBR and weather variants. Separate CPU work from GPU timer
queries and discard disjoint/contended measurements. Headless timings and RAF residuals do not
prove GPU capacity.
