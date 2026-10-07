# Boot with the default enhancements on a software renderer

**Area:** render · **Focus:** gpu shaders · **Priority:** P2

The production build does not reach a drawn world on any software renderer with the default
graphics settings. `npm run test:boot -- --angle=swiftshader` on macOS stays in the `hud` boot phase
past 90 s on every map; in the Playwright container (`npm run test:boot -- --docker`) SwiftShader
closes the loading screen after about 45 s, then logs "PixiJS Error: Could not initialize shader" and
"Could not retrieve shader source (WebGL context may be lost)" over a white world canvas, and ANGLE
over Mesa's llvmpipe stays in `hud` past 90 s. Metal boots the same maps in under 4 s. The picture is
the one Windows players saw in 0.2.1: a long "Preparing the interface", then a white, frozen page.

With every enhancement off, macOS SwiftShader boots in about 21 s and keeps drawing; turning them on
one at a time, only `enhancedSampling` (the original-art filter: xBR world sprites and bicubic
terrain) brings the stall back. The shader catalogue compiles and links on SwiftShader in seconds
(`npm run test:shaders -- --angle=swiftshader`), so the stall sits at first draw, where the Vulkan
pipeline for the world batch xBR variant is built: a process sample shows SwiftShader's queue thread
spinning in its JIT while the GPU main thread waits. Direct3D 11 pays for the same shader at link
time instead ([graphics-enhancement-frame-cost.md](graphics-enhancement-frame-cost.md), "Direct3D
compile time").

A machine without usable GPU acceleration, a virtual machine or a remote desktop session falls back
to a software device: WARP on Windows, which the compile check shows linking the xBR variant for
half a minute to a minute, and SwiftShader or llvmpipe elsewhere, which never finish here.

## Scope

The production build boots and draws on SwiftShader and on Mesa llvmpipe with the default settings,
within the boot check's budget. Either path, or both:

- make the world batch shader cheap enough for a JIT compiler: cut the sampler if-chain out of the
  magnifier taps (the cost ticket above owns the shape and the Direct3D measurement);
- treat a software renderer as a device the filter is off on by default: read the renderer string
  at renderer creation (`SwiftShader`, `llvmpipe`, `Microsoft Basic Render Driver`), start with
  `enhancedSampling` off there, and say so once in the settings window. The player may still turn it
  on. This needs the owner's ruling on the default and the wording.

## Verify

- `npm run test:boot -- --angle=swiftshader` and `npm run test:boot -- --docker` pass with the
  default settings; then make them part of the default backend list in `scripts/boot-check/backends.mjs`
  and of the release checks in `docs/DEVELOPMENT.md`.
- `npm run test:boot` on Metal still passes, and a Metal screenshot with the filter on is unchanged.
- `npm run check`, `npm run build`, `npm test`.
