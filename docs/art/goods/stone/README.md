# Stone goods

Second own-art goods package: five ground quantities of quarried stone blocks and one independently
painted UI icon. The runtime binds `stone` by slug in both real and fallback content. The fifth
world frame also represents larger piles; the sixth frame is reserved for the building panel icon.

Sources and exact prompts: [source/v1/generation.json](source/v1/generation.json). Every image was
generated through the OpenAI Images API with a transparent background; the raw piles drifted warm and
two grew cast shadows, so the selected masters are a colour and shadow normalisation edit of each
raw pile against the single block master. Build and prepare a candidate with
`npm run art -- build goods/stone` and `npm run art -- preview goods/stone`; see
[production workflow](../../PIPELINE.md) for review and publication.
The candidate gallery selects `?art=gallery&tab=goods&asset=goods/stone`.

World art uses half a world pixel per delivered source pixel. Native generated masters are retained;
only downsampling occurs. Block proportions vary between generated piles, so the box sizes are a
provisional calibration keeping one block roughly constant across quantities. No cast shadow is
authored; frames 1 and 4 keep a faint generated contact shading. Natural rocks, deposits and
carried goods remain separate.
