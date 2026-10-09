# Building damage

The Graphics option **Building damage** is enabled by default and applies live. It adds structural
scars, local fire, embers and fragments to a building's existing sprite. Disabling it keeps a smaller
smoke cue. These are presentation effects: fire does not spread or change combat, repair, collision,
resources or save state.

## Visual choices and sources

| Reference | Published approach | Choice here |
| --- | --- | --- |
| [OpenRA damage overlays](https://docs.openra.net/en/release/traits/#withdamageoverlay) | Configurable damage-state thresholds and separate overlay animation sequences. | Structural damage precedes smoke; fire starts only at severe damage. |
| [Relic / SEGA destruction diary](https://sega.prezly.com/company-of-heroes-3-destruction-dev-diary) | Local destruction of buildings and their parts changes their appearance. | Preserve the existing material palette around irregular cavities and exposed supports; show fragments when health drops. |
| [Age of Empires II: DE update preview](https://www.ageofempires.com/news/preview-age-of-empires-ii-definitive-edition-update-95810/) | An update fixed a Wonder's destruction animation disappearing. | Transfer the last visible damaged layers into the collapse rather than restoring an intact house. |

These are design references, not implementation sources. The damage geometry, timings and procedural
effect textures are independently authored artistic approximations. Colour and silhouette guide
placement; they do not provide semantic knowledge of every roof or wall. No replacement building
assets, original-effect copies or external generation service are required.

Full health keeps the body intact. Damage blends continuously between six reference appearances at
90/75/60/45/30/20% health: fresh chips, cracks, cavities, chipped roof edges and local soot appear
gradually as health falls between these anchors. Light damage exposes a contrasting
substrate and bright chipped edges. Critical damage deepens local breaches while retaining broad
sections of roof and wall. Seeded rejection sampling varies positions, onset, proportions, orientation
and jagged contours; wounds grow in place and repairs reconstruct from pristine pixels.

Finished buildings expose their own construction back walls and scaffolds inside cavities, aligned
by the existing frame offsets and scales. Finished-body stages are excluded. Incomplete and upgrading
buildings use the procedural fallback to avoid revealing unbuilt work. Where the construction art has
no coverage, a dim interior and irregular timber members provide depth. Members have fixed positions,
grain, side faces and splintered ends; worsening damage breaks some into stubs. Transparency is limited
to small upper-edge chips, rather than removing entire supporting walls.

Fire fades in around 50% health, with later sources staggered; the broadest structural breaches grow
between 45% and 20% health.
Five fire loops vary in tongue count, spread and height. Each wound varies its phase, speed, width,
height and mirroring; critical buildings can show up to four local fires. Smoke shares these origins.
Solid neighbourhoods and a substantial silhouette cross-section filter thin ornaments. Dust patches,
stone chips and short planks accumulate along the body's lower silhouette, drawn as one retained mesh
per building. Small fragments appear first; heavier damage spreads more debris around the foundations.

Unfinished buildings measure health against their built pool. An upgrading building keeps its
standing pool. Fog memories retain the last seen scars without emitting live effects or observing
hidden repairs. Normal portrait subjects follow the live appearance; map views that borrow an
otherwise unpresented subject retain that view path's baseline rendering.

Destruction reverses the building's construction time masks and stage windows: roof covering and
facades disappear to expose its own back walls and timber, then those layers dismantle to the
foundation. The last visible damaged pixels remain the outer layer; destruction never substitutes an
undamaged facade. Incomplete and upgrading sites reverse only the layers and progress already shown.
Without matching construction artwork, the visible body erodes in place from roof to foundation.
Small palette-matched chips and dust originate at sampled removal points; chips fall, bounce once
and settle. Dust gathers at sampled roof and wall positions for six ticks before the structure
starts to dismantle. Each puff has its own shape and drift, stays over the structure through removal
and then slowly spreads outward and thins. Initial swelling is independent of the long dispersal
tail, so extending the tail does not weaken the cover during removal. Reverse construction accelerates along a quadratic curve over 30 ticks; chip
births follow the same curve. The body clears at tick 36 and the longer dust tail clears by tick 136.
Standing layers stay anchored throughout. The timing, shaded breaking edges and particles are artistic
approximations, not a structural simulation. At ×3, removal takes one real second including the
smoke lead, followed by up to 2.8 seconds of lingering dust. Presentation deliberately outlives the
simulation's ruin delay; recovered materials and site availability keep their existing timing.

## Rendering budget

Only the culled draw list and forced portrait subjects are visited. Body blends are quantized to
1/16 of a reference level (96 increments across the health range); each body retains a single baked
blend until this level or the bound source changes. A shared 8 MiB CPU cache retains each recently
painted body's two neighbouring integer appearances; health changes within that interval only blend
their pixels. Old pairs are evicted first, and repair, culling, source replacement and disabling the
option release them. This budget is separate from original pixels and atlas slots, so cache pressure
does not remove another building's damage. Smoke and fire fade without this quantization.
One body preparation and two endpoint paints per frame limit the opening burst. A fractional blend
uses both paint slots; preparation has its own allowance so a changing construction source can still
be painted that frame. Rotating buildings and their body layers prevents a changing construction site
from starving its neighbours or its own other layers. Smoke, flame and fragment nodes are retained;
camera distance reduces particle detail.

Damage uses at most 128 visible nodes, 32 MiB of retained original and construction RGBA pixels and
four 1024-square shared damage atlas pages (16 MiB GPU RGBA plus their CPU canvases). One reusable
readback canvas and a 2 MiB fire/smoke atlas serve the damage renderer; collapse dust uses a separate
64 KiB smoke atlas. With the option disabled, buildings use three smoke sprites and a shared 64 KiB
smoke atlas; fire artwork and fragment geometry are created only when detailed effects are enabled.
Each building retains at most 18 smoke puffs, four flames, four embers and eight impact fragments.
Repair, culling and disposal return texture slots; collapse takes a lease until its animation ends.
Atlas saturation keeps the simpler body/effect cue; a partial collapse capture falls back to the
complete ordinary collapse. These limits are not a frame-time guarantee; use the browser procedure
below to measure a device.

Each visible collapse layer uses one static quad and a dedicated two-texture shader, preserving the
world's pixel-art magnifier. A removal mask is prepared once; only uniforms change during the
animation, avoiding per-frame pixel repaints and atlas uploads. These masks use at most four shared
1024-square pages (16 MiB GPU RGBA plus their CPU canvases), separate from leased damage pixels.
Saturation falls back to a stationary fade. One reusable readback canvas supplies particle origins;
each building retains at most 48 small chips and 14 local dust puffs in ordinary world
batches. Only visible collapses animate; at most 60 nodes remain alive. Captured colour slots, masks,
construction reveal textures and particle geometry are released when the dust settles.
In the six-building demolition scene at 1500×1100, Metal draws 18 body quads with two mask pages;
the whole frame uses 31 GL draws versus 12 while the buildings stand. After preparation, demolition
uploads no texture pixels. This trades extra draws during the short effect for a fixed mask sampled
on the GPU, without adding demolition attributes to every ordinary world sprite.

## Review

Open `?scene=building-damage`: columns show 100%, 82%, 60%, 30% and 8% health; rows show a small timber
home, headquarters, a tiled masonry home and a plastered warehouse. Inspect at ordinary zoom and close
up. Check that roofs remain readable through smoke and that neighbouring wounds differ. Toggle the
option in Graphics while paused, scroll away and back, then inspect selection outlines.
`?scene=building-damage-variants` holds all twenty buildings at 4% health to compare variation and
check that large breaches still have structural support. Inspect the rubble at normal zoom as well.

Use `?scene=siege` for impacts, construction damage and the collapse transition, and `?scene=repair`
for repair. `?scene=building-demolition` has a Demolition stage with a Demolish buildings button:
compare damaged timber, masonry, plaster and headquarters, an intact tower and an unfinished home.
Reload to repeat; inspect the exposed construction, fixed anchors and the empty plot after dust settles.
See [SCENES.md](../SCENES.md) and [TESTING.md](../TESTING.md) for the shared setup and checks.
For an A/B timing, keep camera, resolution and simulation state fixed, warm each mode, then use
`window.__opennorthland.resetPerf()` and `perf()` in a headed browser. Record the GPU backend, visible
building count, window length and world-render CPU time separately from frame cadence.
