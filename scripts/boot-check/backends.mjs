// The ANGLE backends a boot check can ask Chromium for, and how each one shows in the WebGL renderer
// string. Chromium falls back to SwiftShader without a word when a backend cannot start (macOS has no
// GL or Vulkan backend, a container has no GPU), so a run is only counted when the string matches.

export const BACKENDS = {
  metal: { angle: 'metal', matches: (renderer) => renderer.includes('ANGLE Metal Renderer') },
  swiftshader: { angle: 'swiftshader', matches: (renderer) => renderer.includes('SwiftShader') },
  // ANGLE's SwiftShader backend is Vulkan on SwiftShader, so a SwiftShader device is the fallback here.
  vulkan: {
    angle: 'vulkan',
    matches: (renderer) => renderer.includes('Vulkan') && !renderer.includes('SwiftShader'),
  },
  gl: {
    angle: 'gl',
    matches: (renderer) => renderer.includes('OpenGL') && !renderer.includes('SwiftShader'),
  },
  d3d11: { angle: 'd3d11', matches: (renderer) => renderer.includes('Direct3D11') },
};

/** What this machine runs natively, then SwiftShader: the device a machine without usable GPU
 *  acceleration, a virtual machine or a remote desktop falls back to, where a shader is compiled by
 *  a JIT at its first draw. Mesa's llvmpipe needs the container (`--docker`). */
const HOST_DEFAULTS = { darwin: ['metal', 'swiftshader'], win32: ['d3d11', 'swiftshader'] };
const FALLBACK_DEFAULTS = ['swiftshader'];
/** The Playwright image also has Mesa, whose llvmpipe OpenGL is a second software compiler (`gl`), but
 *  it stays opt-in: there the drawn world arrives a minute or more after the `hud` phase and then
 *  runs at about a frame a second, although every catalogue program compiles and draws first within
 *  2 s (the cost sits past the first draw, likely in llvmpipe's per-draw-state variants, unverified).
 *  Chromium without a GPU falls back to SwiftShader, not to the system's Mesa, so no player sees it. */
export const CONTAINER_DEFAULTS = ['swiftshader'];

export function hostDefaultBackends() {
  return HOST_DEFAULTS[process.platform] ?? FALLBACK_DEFAULTS;
}

/** Chromium flags for one backend. The GPU blocklist would refuse Mesa's software rasterizer. */
export function backendArgs(id) {
  return ['--mute-audio', `--use-angle=${BACKENDS[id].angle}`, '--ignore-gpu-blocklist'];
}
