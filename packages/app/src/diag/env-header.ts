/** Boot-time environment facts for the log ring; browser-only, so they sit apart from the logger core. */
import { type DiagLog, diag } from './log.js';

/** The unmasked GPU renderer string, or `null` when it is masked or WebGL is unavailable. */
function webglRenderer(): string | null {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    if (gl === null) return null;
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = info === null ? null : (gl.getParameter(info.UNMASKED_RENDERER_WEBGL) as unknown);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return typeof renderer === 'string' ? renderer : null;
  } catch {
    return null;
  }
}

/** Call once at boot, before routing. */
export function logBootHeader(target: DiagLog = diag): void {
  target.info('boot', 'environment', {
    href: window.location.href,
    userAgent: navigator.userAgent,
    language: navigator.language,
    hardwareConcurrency: navigator.hardwareConcurrency,
    screen: { width: window.screen.width, height: window.screen.height, dpr: window.devicePixelRatio },
    webglRenderer: webglRenderer(),
  });
}
