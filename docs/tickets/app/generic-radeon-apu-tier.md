# Classify a Radeon APU that reports no model name

**Area:** app · **Focus:** view/graphics · **Priority:** P3

Ryzen APUs report the WebGL renderer `ANGLE (AMD, AMD Radeon(TM) Graphics (0x<device id>) Direct3D11
vs_5_0 ps_5_0, D3D11)`, with no model. The pinned `@pmndrs/detect-gpu` 6.0.27 database matches that
name at 1920x1080 to `intel radeong 0.4 on amd tonga` (119 fps), and without the device id to
`amd radeon polaris` (60 fps): unrelated discrete cards, tier 3, so every such APU starts on Quality.
APUs of very different sizes share that name, from two-unit parts such as the Radeon 610M upwards.

Quality fits the Radeon Vega 7 (device 0x1636, seven compute units): `bench:gpu-settings` reads the
densest `magiczny_las` town at 4.7 ms per frame at zoom 1 and 6.5 ms at zoom 0.5, 9.1 ms at zoom 1 in snow
([laptop GPUs](../../GRAPHICS.md#laptop-gpus-at-19201080)). A two- or three-unit part has roughly a third of that
throughput by its published unit count and clock, so it would draw the same view at about 14 to 20 ms:
an estimate, not a measurement.

## Scope

- For a model-less `AMD Radeon(TM) Graphics` renderer, choose the profile from the PCI device id ANGLE
  reports, from the published PCI ID list: the two- and three-unit families (for example Mendocino
  and Raphael's 610M) get Balanced, every other id keeps the library's result. Record the rule in
  `view/graphics/defaults.ts` or `tier.ts` and the reason in the boot diagnostics.
- Keep the library's result for every renderer that names a model.

## Verify

- `packages/app/test/view/graphics/tier.test.ts` cases for a weak and a strong device id and for the
  name without an id.
- If a two-unit APU is available, `npm run bench:gpu-settings` on it at 1920x1080, and the measured row
  added to the cost basis.
