/**
 * The environment header — the boot-time facts that make a tester's log actionable (the part every
 * studied engine writes first: OpenRA's debug.log header, Spring's infolog preamble). Logged once
 * into the ring on channel `boot`; browser-only, so it lives apart from the DOM-free logger core.
 */
import { type DiagLog, diag } from './log.js';

/**
 * The GPU the page actually got — the first question for any rendering report. Uses a throwaway
 * WebGL context (released via `WEBGL_lose_context`); `null` when the renderer string is masked or
 * WebGL is unavailable.
 */
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

/** Write the one-time boot header into the log ring. Call once from `main.ts` before routing. */
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
