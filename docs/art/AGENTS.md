# Art contract

For building, terrain, vegetation, water or environment asset work, read
[WORLD-STYLE.md](WORLD-STYLE.md) and view its canonical reference image before generating or editing.
The selected direction is **A · Stonowany remaster**, covering buildings, terrain and environment props.
View and attach the canonical muted House A runtime sprite linked in WORLD-STYLE.md as the primary
palette, painting and lighting reference. The older orange House A and Farm G are not current finish targets.

The approved character painting and sprite-generation method lives in
[characters/README.md](characters/README.md). Its selected civilian reference and export settings
apply to characters, not to world-wide resolution or environment style.
Do not change character assets or force the environment into their present pixel treatment as part
of unrelated environment work.

Keep the approved reference image unchanged. Save new generations separately with their exact prompt,
reference roles and source basis. A generated candidate does not become a new canonical reference
without an explicit style decision.

Building sprites must be generated with a transparent background. Validate actual alpha pixels before
integration; a painted checkerboard is a failed export. Do not repair such exports with hand-authored
silhouette masks or background keying. Preserve generated alpha and record any export limitations.
For model-based buildings, follow [the building pipeline](buildings/PIPELINE.md): calibrated Blender
render → final 2D paintover → validated transparent export. Projection onto geometry is optional.
Use built-in imagegen by default; an authorized API export is a valid route to genuine alpha.
Explicit session authorization for other background processing takes precedence over the default
mask/keying restriction; record the method and inspect the resulting edges.

The repository source/legal rules apply to art references. Original screenshots, extracted sprites
and comparison pages containing original pixels stay local and outside commits.

Integrate terrain first. Every building design requires individual approval before runtime integration;
existing architecture studies are not approved replacements for gameplay buildings.
