# World art direction — A · Stonowany remaster

**Selected direction for future world assets: A · Stonowany remaster (Muted Remaster).**
The selected muted House 1 painting defines the palette, material finish and lighting for buildings,
terrain and environment props. Keep the painted Cultures HQ character with more natural materials
and less candy-like saturation. Existing assets migrate through requested work; this decision does
not imply that every current building, terrain or character has already been repainted.

## Start here

1. Read this document and [AGENTS.md](AGENTS.md).
2. View and attach [the canonical muted House A sprite](buildings/house-1/house-painted-runtime.png).
   Use its painting, restrained palette and neutral daylight; its house architecture is not a template.
3. Label each attached reference and its role in the prompt. Save the exact submitted prompt beside the output.
4. Review beside muted A at intended play size, including current terrain and actors where relevant.

The canonical sprite is the delivered 1024 × 1024 RGBA export, not the checkerboard concept A.png.
SHA-256: `c47642c920b0598e22b01d754847666887a1e91ed5bbbb31122a00d2be60866d`.
Keep this authoring reference unchanged; new generations belong in separate versioned directories.

## Selected finish — muted House A

Use [A · Stonowany remaster](buildings/house-1/README.md)
as the primary visual reference. Previous paintings are production provenance, not competing finish targets.

Aim for grouped directional straw in muted oat/tan and restrained ochre, natural mid-brown matte
wood, quiet warm-grey clay/plaster and neutral grey stone. Use broad painted material groups,
selective grain and edge accents, and neutral upper-left daylight. Avoid golden-hour washes,
orange timber, lemon-yellow straw, glossy model shading, heavy edge outlines and uniform microtexture.
The result should remain welcoming and painted, without becoming photographic, uniformly grey or grimy.
Material diversity and function still matter; do not turn every roof into House A's roof.

The production method remains calibrated 3D render → final 2D paintover → genuine-alpha export →
fresh sprite calibration. Existing geometry can be retained for finish revisions. The muted House A
is a style edit of the previous model-derived painting; it was not projected or baked back onto the mesh.
The API alpha pass smooths fine painting, so the final transparent export is the reference.
See [PIPELINE.md](buildings/PIPELINE.md) for geometry-drift limits and construction-stage handling.

## Visual rules

- Preserve the welcoming old settlement-game atmosphere with HQ material definition and clear shapes.
  Use grounded stylization: more materially convincing than a cartoon, still deliberately non-photoreal.
- Buildings have compact, characterful, asymmetrical masses and functionally distinct silhouettes.
  Floors, entrances, roof arrangements and props should explain the job the building serves.
- Materials: matte natural brown timber, muted oat/ochre straw, warm-grey cream/clay walls, neutral grey
  stone and darker shingles. Keep restrained blue or red accents. Muted A is the colour reference;
  no numeric palette has been approved.
- Use readable material groups and selective detail. Avoid plastic shine, inflated toy roofs, lemon
  yellow glare, elaborate fantasy ornaments, glowing windows everywhere and blanket orange lighting.
- Use a consistent elevated orthographic game view and light from upper left. Exact camera, world
  scale and body export settings still need engine calibration; cast shadows follow the shared profile below. Do not measure settings from AI pixels
  and present them as original-game facts.
- Terrain belongs to the same world. Keep grass/soil variation, stone size, vegetation and shore
  treatment coherent with the buildings. Leave quiet ground areas for people, goods and overlays.
- Terrain should support attention rather than compete with buildings and actors.
  Validate reductions in motion instead of assuming more texture detail means higher quality.

These are artistic decisions based on the selected board and brief, not claims of historical or
original-engine fidelity. A named gameplay function still requires a verified content join for
production integration.

## Shared cast-shadow lighting

[lighting.json](lighting.json) is the numerical source for every new or regenerated cast shadow:
buildings, characters, trees and props. Use the shared camera conversion in
`tools/art-pipeline/authoring/shared/shadow_lighting.py`; do not choose a separate ray or opacity per asset.

The accepted House 1 reference uses incoming sun direction `[5, 8, -14]`, camera elevation 28.5°
and azimuth 22.5°. In image coordinates (+x right, +y down), a point 100 projected pixels above
its ground contact casts its shadow **62.43 pixels right and 21.24 pixels up**: angle −18.79°.
Camera conversion preserves this direction and length relative to projected height even when an
exporter uses a different elevation or azimuth. Facing changes rotate the subject, not the daylight.
Shadow colour is black `[0, 0, 0]`, maximum opacity 0.48, with a 9° sun for building renders.
Characters use a slightly softer opacity of 0.44, with the same direction and black colour.
The character silhouette uses a fixed 0.55 source-output-pixel blur as a small-sprite approximation.
These are own-art choices derived from the accepted building shadow, not original-engine facts.

Review cast shadows together on terrain at ×2; painted surface shading and contact shading are
separate effects. Current woodland cutouts have painted root/contact shading but no separate
cast-shadow delivery. Adding their directional shadows requires its own geometry or reviewed source
and must use this profile. Do not infer lighting consistency from that existing contact shading.

## Independent designs and reference roles

The selected ship-headquarters architecture is [hull-roof B](buildings/headquarters/README.md).
Its scoped reference set uses muted House A for finish and the local original ship HQ for identity.

Create new architecture in this visual language. Do not make 1:1 reconstructions, trace original
sprites, or preserve an original building layout merely by repainting it in HQ.
Landmark functions need a distinctive structural idea and silhouette. For headquarters, a normal
house or longhouse with a porch/banner is insufficient. Its local original references show a supported
ship-building and a stacked round hall: study how construction gives them identity, then invent new
architecture with comparable specificity. Keep these original reference pixels in ignored content.
Original screenshots can be additional local atmosphere/scale references, clearly labelled as such;
The House A finish reference is sufficient to start ordinary building generations without them.

Do not progressively substitute the last generated asset for muted A: use the canonical sprite to check visual drift.

## Quality and characters

The working review target is **world camera zoom ×2** relative to the existing world projection.
Apply it equally to terrain, buildings, actors and world distances; keep UI scale independent.
Do not double map cells, simulation coordinates, footprints or navigation. Existing maps stay valid.
The current civilian contains about 88 source pixels of body height, mapped to about 44 world
pixels, so ×2 displays it at about 88 screen pixels before device/backing-store scaling.
This is a provisional visual target, not a frozen character export contract or a global runtime default.
Author enough real detail for this view; upscaling a PNG does not create new detail. Review terrain
repetition, alpha edges and motion at ×2, and retain zoom-out for settlement management.

Calibrate building scale from doors relative to actors, not the outer sprite rectangle. A doorway
around 1.09 adult heights (roughly 96 screen pixels at ×2) is the current artistic trial target.
The earlier 104-pixel HQ doorway looked slightly too large beside the actor. Measure the clear
opening, excluding its timber frame; verify each generated candidate rather than trusting the prompt.
Camera zoom cannot repair incorrect relative proportions.

Working building camera: orthographic, elevation 28.5° above the horizon (30° comparison), roll 0°,
azimuth about 22.5–25° from the front normal for Viking studies. This is an approximate fit reported
in ignored `content/local-camera-study/REPORT.md`, not recovered original renderer metadata.
Use a projected geometry reference and inspect output edges; prompt angles alone do not verify a render.

Keep high-quality master images. Source texture size, on-screen size and apparent detail are separate
decisions; a building need not have the same pixel dimensions as a person.
No 44/88 px limit, toon-band count, palette quantization or nearest-neighbour filter is fixed for
the world. Character art and animation can improve or change independently.

Use the current [character references](characters/README.md) for actor scale and export settings.
Original-game comparison captures remain local and outside commits.

## Producing the next assets

Generate distinct new subjects using muted A as the primary style reference, with an explicit subject, function,
material mix, framing and output purpose. Preserve the canonical reference and save candidates separately.
Record model/tool, exact prompt, supplied images and their roles, and any crop/edit/post-processing.
Do not save API keys, signed download links or original-game images with the deliverable.
For buildings, follow the [generation and export workflow](buildings/PIPELINE.md).

For terrain, first specify whether the output is a material study, tile, transition, overlay or prop.
Material studies are not automatically seamless textures or usable transition masks. Tile dimensions,
repetition, shoreline blending, elevation and map compatibility need their own implementation checks.

Before treating a new asset as ready:

- Compare all world colour/lighting and building finish with the canonical muted House A.
- Compare it with other functions and ground, using the latest available actors as a provisional check.
- Inspect normal play size and supported zooms; look for lost function cues, noise, shimmer and seams.
- Separate visual approval from technical checks: alpha, bounds, anchors, camera, tile joins and
  engine integration remain task-dependent. Use the relevant package contract for implementation.

Still open: an assembled settlement reference scene, calibrated camera and relative scale,
production resolutions/filtering/alpha, remaining cast-shadow coverage, and seamless terrain/transition design.
These do not reopen the muted A style selection. Do not start unrelated production integration merely
because the visual direction has been chosen.
