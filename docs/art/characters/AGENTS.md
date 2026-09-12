# Character art contract

Read [PIPELINE.md](PIPELINE.md) for reproduction and [MODULARITY.md](MODULARITY.md) for assembly.
`appearances/man-silver` is the male reference; `shared/body/` owns its body and cameras.
`appearances/woman-blonde` owns the woman's body and animation binding.

- Keep appearance IDs descriptive and stable across source folders, runtime folders, selection and catalog.
- Generate bald, clean-shaven bodies; replace the temporary head with exactly one complete head.
- Fit each head once in rest space with neutral animated bone scales. Apply the shared male
  `shared/body/proportions.json` profile after assembly, through the recipe’s `bodyProportions` binding.
- Preserve the fitted head pivot, neck-parented socket and torso-connected neck overlap. Check the nape below the collar during turns.
- Match face, ears and neck to the painted arms. Keep fractional edge alpha and the soft-separation export.
- Reuse shared camera receipts and saved layouts. Target 88 screen pixels at zoom 2 and character scale 0.5.
- Sample continuously moving own-art clips at 24 frames per second of playback. Derive frame count from duration; 12–16 total poses do not cover a long clip smoothly. Sparse poses and long holds require an intentional held-pose design and visual review.
- Preserve `walkCalibration` and `walkPlayback`: 0.8 cadence, shared E-facing stride reference. Do not compensate with sim speed or another directional depth correction.
- Prefer Meshy-generated full-body work motion. Preserve torso, shoulder, hip and knee motion during cleanup; do not freeze the body around an animated tool arm.
- Bind work through `atomicId`/`atomicClips`; all male variants must share the same clip layout. Gameplay events remain sim-owned.
- Only approved appearances belong in runtime selection. Pixel or timing changes require review on playable maps.
- Keep source models, matching textures, prompts, API receipts, recipes and selected strips. Remove obsolete comparisons and reproducible scratch output.
- Keep documentation factual and current: dependencies, commands and constraints. Omit experiment histories, spending summaries and repeated explanations; link to the owning file.

Update [the board](index.html) after exports. Follow the parent art contract for original-game references.
