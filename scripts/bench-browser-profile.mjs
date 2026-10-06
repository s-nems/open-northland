import { writeFile } from 'node:fs/promises';
import { cpus, loadavg, platform } from 'node:os';
import { resolve } from 'node:path';

export function machineLoad() {
  const cpuCount = cpus().length;
  const loads = loadavg();
  const available = platform() !== 'win32' && cpuCount > 0;
  return { available, cpuCount, loads, loadPerCpu: available ? loads[0] / cpuCount : null };
}

/**
 * Slow the page's main thread by `record.rate`, the weak-CPU proxy. The emulation is per thread and
 * Chromium refuses it for workers, so the sim worker keeps full speed; every worker the page starts is
 * still asked through auto-attach, and `record.workers` keeps each worker script's answer once.
 */
export async function throttleCpu(page, record) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: record.rate });
  record.page = 'applied';
  record.workers = {};
  let nextId = 1;
  const pending = new Map();
  cdp.on('Target.receivedMessageFromTarget', ({ message }) => {
    const reply = JSON.parse(message);
    const url = pending.get(reply.id);
    if (url === undefined) return;
    pending.delete(reply.id);
    record.workers[url] = reply.error === undefined ? 'applied' : `refused: ${reply.error.message}`;
  });
  cdp.on('Target.attachedToTarget', ({ sessionId, targetInfo }) => {
    if (targetInfo.type !== 'worker') return;
    // A blob worker's URL is fresh each time; the scheme names the kind.
    const url = targetInfo.url.startsWith('blob:') ? 'blob:' : targetInfo.url;
    const id = nextId++;
    pending.set(id, url);
    const message = JSON.stringify({
      id,
      method: 'Emulation.setCPUThrottlingRate',
      params: { rate: record.rate },
    });
    cdp.send('Target.sendMessageToTarget', { sessionId, message }).catch((error) => {
      record.workers[url] = `unreachable: ${error.message}`;
    });
  });
  await cdp.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: false });
}

/**
 * Count the WebGL calls a frame issues (draws, texture binds, program switches, buffer uploads) from
 * now on; `window.__glCalls.report()` gives them per rendered frame. Driver cost per call is far higher
 * on integrated GPUs than here, so the counts are a result of their own, not only the milliseconds.
 */
export async function countGlCalls(page) {
  await page.evaluate(() => {
    const app = window.__opennorthland.renderer.app;
    const gl = app.renderer.gl;
    const counts = { frames: 0, draws: 0, textureBinds: 0, programs: 0, uploads: 0, uploadBytes: 0 };
    if (window.__glCalls === undefined) {
      const wrap = (name, count) => {
        const original = gl[name].bind(gl);
        gl[name] = (...args) => {
          count(window.__glCalls.counts, args);
          return original(...args);
        };
      };
      wrap('drawElements', (c) => c.draws++);
      wrap('drawArrays', (c) => c.draws++);
      wrap('bindTexture', (c) => c.textureBinds++);
      wrap('useProgram', (c) => c.programs++);
      // (target, byteOffset, source, sourceOffset, length): a ranged upload names its element count.
      wrap('bufferSubData', (c, a) => {
        c.uploads++;
        const source = a[2];
        const element = source?.BYTES_PER_ELEMENT ?? 1;
        c.uploadBytes +=
          a[4] !== undefined ? a[4] * element : (source?.byteLength ?? 0) - (a[3] ?? 0) * element;
      });
      wrap('bufferData', (c, a) => {
        c.uploads++;
        c.uploadBytes += a[1]?.byteLength ?? 0;
      });
      const render = app.render;
      app.render = function (...args) {
        window.__glCalls.counts.frames++;
        return render.apply(this, args);
      };
    }
    window.__glCalls = {
      counts,
      report: () => {
        const c = window.__glCalls.counts;
        const per = (n) => (c.frames === 0 ? 0 : n / c.frames);
        return {
          frames: c.frames,
          drawsPerFrame: per(c.draws),
          textureBindsPerFrame: per(c.textureBinds),
          programsPerFrame: per(c.programs),
          uploadsPerFrame: per(c.uploads),
          uploadKbPerFrame: per(c.uploadBytes) / 1024,
        };
      },
    };
  });
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

/**
 * A channel to the page's sim worker over the page's CDP session: workers attach through auto-attach
 * and answer through `Target.sendMessageToTarget`, so the channel follows the worker a reload restarts.
 */
export async function simWorkerChannel(page) {
  const cdp = await page.context().newCDPSession(page);
  let worker = null;
  let nextId = 1;
  const pending = new Map();
  cdp.on('Target.receivedMessageFromTarget', ({ message }) => {
    const reply = JSON.parse(message);
    const waiter = pending.get(reply.id);
    if (waiter === undefined) return;
    pending.delete(reply.id);
    if (reply.error === undefined) waiter.resolve(reply.result);
    else waiter.reject(new Error(reply.error.message));
  });
  cdp.on('Target.attachedToTarget', ({ sessionId, targetInfo }) => {
    if (targetInfo.type === 'worker' && targetInfo.url.includes('sim-worker')) worker = { sessionId };
  });
  cdp.on('Target.detachedFromTarget', ({ sessionId }) => {
    if (worker?.sessionId === sessionId) worker = null;
  });
  await cdp.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: false });
  return {
    send(method, params = {}) {
      if (worker === null) return Promise.reject(new Error('no sim worker attached'));
      const id = nextId++;
      const message = JSON.stringify({ id, method, params });
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        cdp.send('Target.sendMessageToTarget', { sessionId: worker.sessionId, message }).catch(reject);
      });
    },
  };
}

/** The share of a CPU profile's sampled wall time the thread spent outside idle. */
export function busyShare(profile) {
  const idle = new Set(
    profile.nodes.filter((n) => ['(idle)', '(program)'].includes(n.callFrame.functionName)).map((n) => n.id),
  );
  let total = 0;
  let busy = 0;
  profile.samples.forEach((id, i) => {
    const dt = profile.timeDeltas[i] ?? 0;
    total += dt;
    if (!idle.has(id)) busy += dt;
  });
  return { sampledMs: total / 1000, busyMs: busy / 1000 };
}
