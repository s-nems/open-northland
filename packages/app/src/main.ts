import { FixedTimestep } from '@vinland/sim';

/**
 * App shell entry point. Wires input -> sim commands, runs the fixed-timestep loop, and asks the
 * renderer to draw with the interpolation alpha. This is the ONLY package that depends on both
 * `sim` and `render`.
 *
 * Phase-2 stub: the loop scaffolding is here; the Simulation needs a loaded ContentSet + map (from
 * the asset pipeline) and a PixiRenderer implementation before it does anything visible.
 * See docs/ROADMAP.md.
 */
function main(): void {
  const canvas = document.getElementById('game');
  if (!(canvas instanceof HTMLCanvasElement)) throw new Error('missing #game canvas');

  const timestep = new FixedTimestep();
  let lastMs = performance.now();

  // TODO(Phase 1): load content set produced by the asset pipeline.
  // TODO(Phase 2): const sim = new Simulation({ seed, content, map });
  // TODO(Phase 2): const renderer = new PixiRenderer(); await renderer.init(canvas);

  function frame(nowMs: number): void {
    const elapsed = nowMs - lastMs;
    lastMs = nowMs;

    const alpha = timestep.advance(elapsed, () => {
      // sim.step();   // advance one deterministic tick (enable in Phase 2)
    });
    void alpha;

    // renderer.draw(sim, alpha);   // enable in Phase 2
    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
  // eslint-disable-next-line no-console
  console.log('Vinland shell up. Loop running; sim/renderer pending (see docs/ROADMAP.md).');
}

main();
