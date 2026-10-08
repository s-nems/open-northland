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
assets, original-effect copies, external generation service or new shader program are required.

At 90% health and above the body is intact. Below 90/72/52/32/14%, five stable damage rungs introduce
cracks, cavities, chipped roof edges and local soot. Wounds are seeded by entity id and grow in place;
repairs reconstruct from pristine pixels. Interior breaches keep a dark back surface, while some
roof-edge losses remove coverage. Fire and smoke share the wounds' positions. Small solid
neighbourhoods and a substantial silhouette cross-section exclude thin ornaments from emission.

Unfinished buildings measure health against their built pool. An upgrading building keeps its
standing pool. Fog memories retain the last seen scars without emitting live effects or observing
hidden repairs. Normal portrait subjects follow the live appearance; map views that borrow an
otherwise unpresented subject retain that view path's baseline rendering.

## Rendering budget

Only the culled draw list and forced portrait subjects are visited. Bodies retain their baked pixels
until damage level or the bound source changes. Two read/bake operations per frame, scheduled in
rotating order, limit the opening burst and prevent a changing construction site from starving its
neighbours. Smoke, flame and fragment nodes are retained; camera distance reduces particle detail.

Damage uses at most 128 visible nodes, 32 MiB of retained original RGBA pixels and four 1024-square
shared damage atlas pages (16 MiB GPU RGBA plus their CPU canvases). One reusable readback canvas and
small shared effect atlases serve the renderer. Repair, culling and disposal return texture slots;
collapse takes a lease until its animation ends. Atlas saturation keeps the simpler body/effect cue;
a partial collapse capture falls back to the complete ordinary collapse. These limits are not a
frame-time guarantee; use the browser procedure below to measure a device.

## Review

Open `?scene=building-damage`: columns show 100%, 82%, 60%, 30% and 8% health; rows show a small timber
home, headquarters, a tiled masonry home and a plastered warehouse. Inspect at ordinary zoom and close
up. Check that roofs remain readable through smoke and that neighbouring wounds differ. Toggle the
option in Graphics while paused, scroll away and back, then inspect selection outlines.

Use `?scene=siege` for impacts, construction damage and the collapse transition, and `?scene=repair`
for repair. See [SCENES.md](../SCENES.md) and [TESTING.md](../TESTING.md) for the shared setup and checks.
For an A/B timing, keep camera, resolution and simulation state fixed, warm each mode, then use
`window.__opennorthland.resetPerf()` and `perf()` in a headed browser. Record the GPU backend, visible
building count, window length and world-render CPU time separately from frame cadence.
