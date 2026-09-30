import { writeFile } from 'node:fs/promises';
import { cpus, loadavg, platform } from 'node:os';
import { resolve } from 'node:path';

export function machineLoad() {
  const cpuCount = cpus().length;
  const loads = loadavg();
  const available = platform() !== 'win32' && cpuCount > 0;
  return { available, cpuCount, loads, loadPerCpu: available ? loads[0] / cpuCount : null };
}

export async function guardCamera(page, camera) {
  await page.evaluate((expectedCamera) => {
    const d = window.__opennorthland;
    d.cameraCtl.setSuspended(true);
    d.cameraCtl.jumpTo(expectedCamera);
    const canvas = d.renderer.app.canvas;
    const guard = {
      expectedCamera,
      width: canvas.width,
      height: canvas.height,
      dpr: devicePixelRatio,
      drift: false,
    };
    window.__measurementGuard = guard;
    guard.check = () => {
      const actual = d.cameraCtl.camera();
      guard.drift ||=
        actual.offsetX !== expectedCamera.offsetX ||
        actual.offsetY !== expectedCamera.offsetY ||
        (actual.scale ?? 1) !== (expectedCamera.scale ?? 1) ||
        canvas.width !== guard.width ||
        canvas.height !== guard.height ||
        devicePixelRatio !== guard.dpr;
    };
    for (const name of ['keydown', 'keyup', 'wheel', 'pointerdown', 'pointermove', 'pointerup'])
      window.addEventListener(
        name,
        (event) => {
          event.stopImmediatePropagation();
          if (event.cancelable) event.preventDefault();
        },
        { capture: true, passive: false },
      );
  }, camera);
}

// Instrumented windows stay separate from the baseline frame measurements.
export async function profileBrowser({ page, cameras, restore, seconds, output, metadata, cameraName }) {
  async function startDiagnostic() {
    metadata.loadAtStart = machineLoad();
    await page.evaluate(() => {
      const d = window.__opennorthland;
      d.resetPerf();
      const p = {
        startMs: performance.now(),
        startTick: d.host.tick,
        frames: 0,
        hidden: document.hidden,
        stop: false,
      };
      window.__diagnosticProbe = p;
      const gpu = window.__gpuProbe;
      if (gpu) {
        gpu.startMs = p.startMs;
        gpu.startTick = p.startTick;
        gpu.active = true;
      }
      const visibility = () => {
        p.hidden ||= document.hidden;
      };
      document.addEventListener('visibilitychange', visibility);
      p.cleanup = () => document.removeEventListener('visibilitychange', visibility);
      const frame = () => {
        if (!p.stop) {
          window.__measurementGuard.check();
          p.frames++;
          requestAnimationFrame(frame);
        }
      };
      requestAnimationFrame(frame);
    });
  }
  async function finishDiagnostic() {
    const result = await page.evaluate(async () => {
      const p = window.__diagnosticProbe;
      p.stop = true;
      p.cleanup();
      const endMs = performance.now();
      const endTick = window.__opennorthland.host.tick;
      const gpu = window.__gpuProbe;
      if (gpu) {
        gpu.active = false;
        gpu.endMs = endMs;
        gpu.endTick = endTick;
      }
      return {
        valid: !p.hidden && !document.hidden && !window.__measurementGuard.drift,
        guard: { ...window.__measurementGuard, check: undefined },
        elapsedMs: endMs - p.startMs,
        startTick: p.startTick,
        endTick,
        frames: p.frames,
        perf: await window.__opennorthland.perf(),
        hidden: document.hidden,
        camera: window.__opennorthland.cameraCtl.camera(),
      };
    });
    result.loadAtStart = metadata.loadAtStart;
    result.loadAtEnd = machineLoad();
    result.invalidSystemLoad = [result.loadAtStart, result.loadAtEnd].some(
      (load) => load.available && load.loadPerCpu > 1.5,
    );
    result.valid &&= !result.invalidSystemLoad;
    return result;
  }
  await restore();
  await guardCamera(page, cameras[cameraName]);
  await page.evaluate(async (camera) => {
    const d = window.__opennorthland;
    d.cameraCtl.jumpTo(camera);
    d.setSpeed(3);
    await d.setPaused(false);
  }, cameras[cameraName]);
  await page.waitForTimeout(5000);
  await page.evaluate(() => {
    const app = window.__opennorthland.renderer.app;
    const gl = app.renderer.gl;
    const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    const state = { available: !!ext, active: false, samples: [], disjoint: 0, pending: [], discarded: 0 };
    window.__gpuProbe = state;
    if (!ext) return;
    state.poll = () => {
      if ((state.active || state.pending.length) && gl.getParameter(ext.GPU_DISJOINT_EXT)) {
        state.disjoint++;
        state.discarded += state.pending.length;
        for (const q of state.pending) gl.deleteQuery(q);
        state.pending.length = 0;
      }
      while (state.pending.length && gl.getQueryParameter(state.pending[0], gl.QUERY_RESULT_AVAILABLE)) {
        const q = state.pending.shift();
        state.samples.push(gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6);
        gl.deleteQuery(q);
      }
    };
    state.discard = () => {
      state.discarded += state.pending.length;
      for (const q of state.pending) gl.deleteQuery(q);
      state.pending.length = 0;
    };
    const render = app.render;
    app.render = function (...args) {
      state.poll();
      const q = state.active && state.pending.length < 16 ? gl.createQuery() : null;
      if (q) gl.beginQuery(ext.TIME_ELAPSED_EXT, q);
      try {
        return render.apply(this, args);
      } finally {
        if (q) {
          gl.endQuery(ext.TIME_ELAPSED_EXT);
          state.pending.push(q);
        }
      }
    };
  });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 1000 });
  await startDiagnostic();
  await cdp.send('Profiler.start');
  await page.waitForTimeout(seconds * 1000);
  const { profile } = await cdp.send('Profiler.stop');
  metadata.cpuDiagnostic = await finishDiagnostic();
  metadata.cpuDiagnostic.profileElapsedMs = (profile.endTime - profile.startTime) / 1000;
  const gpu = await page.evaluate(async () => {
    const state = window.__gpuProbe;
    const deadline = performance.now() + 2000;
    let drainFrames = 0;
    while (state.pending.length && drainFrames < 12 && performance.now() < deadline) {
      await Promise.race([
        new Promise((resolve) => requestAnimationFrame(resolve)),
        new Promise((resolve) => setTimeout(resolve, 200)),
      ]);
      state.poll();
      drainFrames++;
    }
    state.discard?.();
    const { available, samples, disjoint, discarded, startMs, endMs, startTick, endTick } = state;
    samples.sort((a, b) => a - b);
    const at = (q) => samples[Math.min(samples.length - 1, Math.floor(samples.length * q))] ?? null;
    return {
      available,
      valid: !available || (samples.length > 0 && disjoint === 0),
      frames: samples.length,
      disjoint,
      discarded,
      drainFrames,
      startMs,
      endMs,
      elapsedMs: endMs - startMs,
      startTick,
      endTick,
      mean: samples.length ? samples.reduce((a, b) => a + b, 0) / samples.length : null,
      p50: at(0.5),
      p95: at(0.95),
      p99: at(0.99),
      scope:
        'app.render main-stage submission including world, HUD and weather during explicit active interval; excludes later portrait/map-view renders and compositor; CPU profiler active',
    };
  });
  metadata.gpuDiagnostic = gpu;
  await writeFile(resolve(output, `${cameraName}-x3.cpuprofile`), JSON.stringify(profile));
  const cpuByNode = new Map();
  for (let i = 0; i < (profile.samples?.length ?? 0); i++) {
    const id = profile.samples[i];
    cpuByNode.set(id, (cpuByNode.get(id) ?? 0) + (profile.timeDeltas?.[i] ?? 1000));
  }
  const cpuSummary = profile.nodes
    .map((n) => ({
      function: n.callFrame.functionName,
      url: n.callFrame.url,
      line: n.callFrame.lineNumber + 1,
      selfMs: (cpuByNode.get(n.id) ?? 0) / 1000,
    }))
    .sort((a, b) => b.selfMs - a.selfMs)
    .slice(0, 40);
  const totalSampleMs = [...cpuByNode.values()].reduce((a, b) => a + b, 0) / 1000;
  await writeFile(
    resolve(output, `${cameraName}-cpu-summary.json`),
    JSON.stringify(
      {
        metadata: metadata.cpuDiagnostic,
        totalSampleMs,
        rows: cpuSummary.map((row) => ({
          ...row,
          selfPercent: totalSampleMs ? (row.selfMs / totalSampleMs) * 100 : 0,
        })),
      },
      null,
      2,
    ),
  );
  await writeFile(
    resolve(output, `${cameraName}-gpu-diagnostic.json`),
    JSON.stringify({ ...gpu, metadata: metadata.cpuDiagnostic }, null, 2),
  );
  await restore();
  await guardCamera(page, cameras[cameraName]);
  await page.evaluate(async (camera) => {
    const d = window.__opennorthland;
    d.cameraCtl.jumpTo(camera);
    d.setSpeed(3);
    await d.setPaused(false);
  }, cameras[cameraName]);
  await page.waitForTimeout(5000);
  await cdp.send('HeapProfiler.enable');
  await startDiagnostic();
  await cdp.send('HeapProfiler.startSampling', {
    samplingInterval: 32768,
    includeObjectsCollectedByMajorGC: true,
    includeObjectsCollectedByMinorGC: true,
  });
  await page.waitForTimeout(seconds * 1000);
  const allocation = await cdp.send('HeapProfiler.stopSampling');
  metadata.allocationDiagnostic = await finishDiagnostic();
  await writeFile(resolve(output, `${cameraName}-x3.heapprofile`), JSON.stringify(allocation.profile));
  const allocationSummary = [];
  const visit = (n) => {
    if (n.selfSize)
      allocationSummary.push({
        function: n.callFrame.functionName,
        url: n.callFrame.url,
        line: n.callFrame.lineNumber + 1,
        bytes: n.selfSize,
      });
    for (const child of n.children) visit(child);
  };
  visit(allocation.profile.head);
  allocationSummary.sort((a, b) => b.bytes - a.bytes);
  const totalBytes = allocationSummary.reduce((sum, row) => sum + row.bytes, 0);
  await writeFile(
    resolve(output, `${cameraName}-allocation-summary.json`),
    JSON.stringify(
      {
        metadata: metadata.allocationDiagnostic,
        totalBytes,
        bytesPerTick:
          totalBytes /
          Math.max(1, metadata.allocationDiagnostic.endTick - metadata.allocationDiagnostic.startTick),
        rows: allocationSummary.slice(0, 40),
      },
      null,
      2,
    ),
  );
}
