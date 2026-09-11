import { windowResolutionFor } from '@open-northland/render';
import type { Application, Container } from 'pixi.js';

export function createPreviewViewport(canvas: HTMLCanvasElement, app: Application, world: Container) {
  const parent = canvas.parentElement;
  if (parent === null) throw new Error('Gallery canvas needs a scroll container');
  const viewport = parent;
  const surface = document.createElement('div');
  viewport.insertBefore(surface, canvas);
  surface.append(canvas);
  canvas.style.position = 'sticky';
  canvas.style.top = '0';
  canvas.style.left = '0';
  let width = 640;
  let height = 320;
  function scroll() {
    world.position.set(-viewport.scrollLeft, -viewport.scrollTop);
  }
  function resize() {
    const w = Math.max(1, Math.min(width, viewport.clientWidth));
    const h = Math.max(1, Math.min(height, viewport.clientHeight));
    const resolution = windowResolutionFor(window.devicePixelRatio || 1, 1);
    if (app.screen.width !== w || app.screen.height !== h || app.renderer.resolution !== resolution)
      app.renderer.resize(w, h, resolution);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    scroll();
  }
  const observer = new ResizeObserver(resize);
  observer.observe(viewport);
  viewport.addEventListener('scroll', scroll);
  window.addEventListener('resize', resize);
  let densityQuery: MediaQueryList;
  function watchDensity() {
    densityQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    densityQuery.addEventListener('change', densityChanged, { once: true });
  }
  function densityChanged() {
    resize();
    watchDensity();
  }
  watchDensity();
  return {
    resize(nextWidth: number, nextHeight: number) {
      width = nextWidth;
      height = nextHeight;
      surface.style.width = `${width}px`;
      surface.style.height = `${height}px`;
      resize();
    },
    destroy() {
      observer.disconnect();
      window.removeEventListener('resize', resize);
      densityQuery.removeEventListener('change', densityChanged);
      viewport.removeEventListener('scroll', scroll);
      viewport.insertBefore(canvas, surface);
      surface.remove();
    },
  };
}
