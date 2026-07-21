# Decoder notes

The decoders are small modules with synthetic tests. Keep byte parsing separate from the stage that
joins decoded records into `ContentSet` or runtime assets.

Supported container work includes CIF object graphs, BMD frames, PCX images, LIB archives, CUR
resources, fonts, map `hoix` chunks, and the X6el map-layer packing used by terrain conversion.

When adding a binary field:

1. document the byte-level evidence near the decoder;
2. add valid and malformed synthetic fixtures;
3. keep bounds checks in the decoding layer;
4. run `npm run test:pipeline` before treating the owned corpus as supported.

Format summaries for contributors live in [`docs/formats/`](../../../../docs/formats/).
