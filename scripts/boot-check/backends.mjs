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

/** What this machine runs natively. The software renderers are opt-in (`--angle=swiftshader`,
 *  `--docker`): with the default enhancements on they do not boot today, see
 *  docs/tickets/render/software-renderer-boot.md, so a default run would be red on every checkout. */
const HOST_DEFAULTS = { darwin: ['metal'], win32: ['d3d11'] };
const FALLBACK_DEFAULTS = ['swiftshader'];
/** The Playwright image has Mesa: ANGLE over its llvmpipe OpenGL is a second shader compiler there. */
export const CONTAINER_DEFAULTS = ['swiftshader', 'gl'];

export function hostDefaultBackends() {
  return HOST_DEFAULTS[process.platform] ?? FALLBACK_DEFAULTS;
}

/** Chromium flags for one backend. The GPU blocklist would refuse Mesa's software rasterizer. */
export function backendArgs(id) {
  return ['--mute-audio', `--use-angle=${BACKENDS[id].angle}`, '--ignore-gpu-blocklist'];
}
