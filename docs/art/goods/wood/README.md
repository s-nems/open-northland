# Wood goods

First own-art goods package: five ground quantities and one independently painted UI icon.
The runtime binds `wood` by slug in both real and fallback content. The fifth world frame also
represents larger piles; the sixth frame is reserved for the building panel icon.

Sources and exact prompts: [source/v1/generation.json](source/v1/generation.json).
Build and prepare a candidate with `npm run art -- build goods/wood` and
`npm run art -- preview goods/wood`; see [production workflow](../../PIPELINE.md) for review and publication.
The candidate gallery selects `?art=gallery&tab=goods&asset=goods/wood`.

World art uses half a world pixel per delivered source pixel. Native generated masters are retained;
only downsampling occurs. Pile size and contact anchors are provisional artistic calibration.
No cast shadow is authored. Trees, stumps, pickup-stage trunks and carried equipment remain separate.
The six-frame presentation is approved and published; the receipt is retained by the shared pipeline.
