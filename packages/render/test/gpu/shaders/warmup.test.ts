import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WEATHER_KINDS } from '../../../src/data/weather/types.js';
import { BLOOD_GROUND_SOURCE } from '../../../src/gpu/blood/ground-shader.js';
import { GROUND_WAVE_LIFT_SOURCE } from '../../../src/gpu/ground-waves/ground-wave-lift.js';
import { PRESCALED_SCALERS } from '../../../src/gpu/pixel-art/registry.js';
import { XBRZ_2X_SOURCE } from '../../../src/gpu/pixel-art/xbrz-2x.js';
import { bootShaderPrograms, type ShaderSelection, shaderCatalog } from '../../../src/gpu/shaders/catalog.js';
import {
  type LinkingContext,
  type LinkResult,
  linkPrograms,
  type WarmedProgram,
  type WarmupSettings,
  waitForLinks,
  worldShaderSettings,
} from '../../../src/gpu/shaders/warmup.js';
import { WEATHER_GRADE_SOURCE, WEATHER_VEIL_SOURCE } from '../../../src/gpu/weather/atmosphere.js';
import { ATMOSPHERE_NOISE_BAKE_SOURCE } from '../../../src/gpu/weather/atmosphere-noise.js';
import { GROUND_REACTIONS_SOURCE } from '../../../src/gpu/weather/ground-reactions.js';
import { precipitationSource, WISP_UPSCALE_SOURCE } from '../../../src/gpu/weather/precipitation-shader.js';
import { DEFAULT_SHADOW_STYLE } from '../../../src/gpu/world-batch/shadow-style.js';
import { useHeadlessShaderContext } from '../../support/shader-context.js';

const COMPLETION_STATUS_KHR = 0x91b1;
const LINK_STATUS = 0x8b82;

/** A context whose links complete when the test says so, counting what the warm-up asks of it. */
function fakeContext(failing: ReadonlySet<string> = new Set()) {
  let completed = false;
  let lost = false;
  const calls = {
    links: 0,
    deletedPrograms: 0,
    deletedShaders: 0,
    statusReadsBeforeCompletion: 0,
    /** Deleting a program the driver is still linking blocks the GPU process until the link ends. */
    deletedWhilePending: 0,
  };
  const gl: LinkingContext = {
    VERTEX_SHADER: 0x8b31,
    FRAGMENT_SHADER: 0x8b30,
    LINK_STATUS,
    // WebGL answers null on a lost context, which the DOM types omit.
    createProgram: () => (lost ? null : {}) as WebGLProgram,
    createShader: () => (lost ? null : {}) as WebGLShader,
    shaderSource: () => undefined,
    compileShader: () => undefined,
    attachShader: () => undefined,
    linkProgram: () => {
      calls.links++;
    },
    getProgramParameter: (program, name) => {
      // As WebGL answers every query on a lost context.
      if (lost) return null;
      if (name === COMPLETION_STATUS_KHR) {
        if (!completed) calls.statusReadsBeforeCompletion++;
        return completed;
      }
      if (name === gl.LINK_STATUS) return !failing.has(nameOf(program));
      throw new Error(`unexpected parameter ${name}`);
    },
    deleteShader: () => {
      calls.deletedShaders++;
    },
    deleteProgram: () => {
      calls.deletedPrograms++;
      if (!completed && !lost) calls.deletedWhilePending++;
    },
    isContextLost: () => lost,
  };
  const names = new Map<WebGLProgram, string>();
  const nameOf = (program: WebGLProgram): string => names.get(program) ?? '';
  // The warm-up compiles the fragment text, which names the program; the fake reads it back from there.
  gl.shaderSource = (shader, text) => {
    const name = /#define SHADER_NAME (\S+)-fragment/.exec(text)?.[1];
    if (name !== undefined) names.set(shader as unknown as WebGLProgram, name);
  };
  gl.attachShader = (program, shader) => {
    const name = names.get(shader as unknown as WebGLProgram);
    if (name !== undefined) names.set(program, name);
  };
  const complete = (): void => {
    completed = true;
  };
  const lose = (): void => {
    lost = true;
  };
  return { gl, calls, complete, lose };
}

describe('world shader settings', () => {
  it('reads the batch variant the way the renderer applies the enhancements', () => {
    expect(worldShaderSettings({ enhancedSampling: true, pixelArtScaler: 'xbr', softShadows: true })).toEqual(
      {
        magnification: 'xbr',
        shadow: DEFAULT_SHADOW_STYLE,
      },
    );
    expect(
      worldShaderSettings({ enhancedSampling: false, pixelArtScaler: 'xbr', softShadows: false }),
    ).toEqual({
      magnification: 'off',
      shadow: null,
    });
  });
});

const EVERY_EFFECT: ShaderSelection = {
  magnification: 'xbr',
  shadow: DEFAULT_SHADOW_STYLE,
  weather: true,
  blood: true,
  groundWaves: true,
};
const NO_EFFECT: ShaderSelection = {
  magnification: 'off',
  shadow: null,
  weather: false,
  blood: false,
  groundWaves: false,
};
const namesOf = (programs: readonly { readonly name: string }[]): string[] =>
  programs.map((program) => program.name);

describe('boot shader programs', () => {
  it('selects the batch variants for the device limit and settings beside the fixed programs', () => {
    const names = namesOf(bootShaderPrograms(16, { ...EVERY_EFFECT, magnification: 'xbr', shadow: null }));
    expect(names.filter((name) => name.startsWith('world-batch/'))).toEqual([
      'world-batch/textures16/xbr/no-shadow',
      'world-batch/textures16/xbr/no-shadow/unmagnified',
    ]);
    expect(
      namesOf(bootShaderPrograms(16, NO_EFFECT)).filter((name) => name.startsWith('world-batch/')),
    ).toEqual(['world-batch/textures16/off/no-shadow']);
    expect(names).toContain('shaded-terrain');
    expect(names).toContain('decor-shadow');
    expect(names).toContain('paletted-sprite');
    expect(new Set(names).size).toBe(names.length);
  });

  it('caps the batch limit at the largest compiled variant', () => {
    expect(bootShaderPrograms(64, EVERY_EFFECT)[0]?.name).toBe('world-batch/textures32/xbr/shadow');
  });

  it('leaves out the programs a setting keeps the renderer from drawing', () => {
    const fixed = (selection: ShaderSelection): string[] =>
      namesOf(bootShaderPrograms(16, selection)).filter((name) => !name.startsWith('world-batch/'));
    const everything = fixed(EVERY_EFFECT);
    const nothing = fixed(NO_EFFECT);
    const turnedOff = everything.filter((name) => !nothing.includes(name));
    expect(turnedOff.sort()).toEqual(
      namesOf([
        BLOOD_GROUND_SOURCE,
        GROUND_WAVE_LIFT_SOURCE,
        ATMOSPHERE_NOISE_BAKE_SOURCE,
        WEATHER_GRADE_SOURCE,
        WEATHER_VEIL_SOURCE,
        GROUND_REACTIONS_SOURCE,
        ...WEATHER_KINDS.map((kind) => precipitationSource(kind)),
        WISP_UPSCALE_SOURCE,
      ]).sort(),
    );
    expect(nothing.every((name) => everything.includes(name))).toBe(true);
  });

  it("adds a prescaled scaler's passes beside the prescaled batch variant", () => {
    const names = namesOf(bootShaderPrograms(16, { ...EVERY_EFFECT, magnification: 'xbrz' }));
    expect(names[0]).toBe('world-batch/textures16/prescaled/shadow');
    expect(names).toContain(XBRZ_2X_SOURCE.name);
    expect(namesOf(bootShaderPrograms(16, EVERY_EFFECT))).not.toContain(XBRZ_2X_SOURCE.name);
  });

  it('picks only programs the catalog lists, and every fixed one under some settings', () => {
    const catalog = new Set(namesOf(shaderCatalog()));
    const prescaled = PRESCALED_SCALERS.map((magnification) => ({ ...EVERY_EFFECT, magnification }));
    const picked = new Set(
      [EVERY_EFFECT, NO_EFFECT, ...prescaled].flatMap((selection) =>
        namesOf(bootShaderPrograms(16, selection)),
      ),
    );
    for (const name of picked) expect(catalog.has(name)).toBe(true);
    const fixed = [...catalog].filter((name) => !name.startsWith('world-batch/'));
    for (const name of fixed) expect(picked.has(name)).toBe(true);
  });
});

/** The timers the link polls and the stall clock read, faked so no test waits out a real poll. */
/** The warm-up polls through these; the rest of the clock stays real. */
const fakePollTimers = () => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });

describe('linkPrograms', () => {
  useHeadlessShaderContext();
  beforeEach(() => {
    fakePollTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });
  const programs = bootShaderPrograms(16, EVERY_EFFECT);
  const tick = async (ms: number): Promise<void> => {
    await vi.advanceTimersByTimeAsync(ms);
  };
  const ended = async (links: ReadonlyMap<string, Promise<LinkResult>>): Promise<string[]> => {
    const all = Promise.all([...links.values()]);
    await vi.runAllTimersAsync();
    return (await all).map((result) => result.outcome);
  };

  it('requests every link before waiting, then ends each once the driver completes it', async () => {
    const { gl, calls, complete } = fakeContext(new Set(['decor-shadow']));
    let finished = 0;
    const links = linkPrograms(gl, programs, () => finished++);
    await tick(40);
    expect(calls.links).toBe(programs.length);
    expect(calls.statusReadsBeforeCompletion).toBeGreaterThan(0);
    expect(calls.deletedPrograms).toBe(0);
    complete();
    const outcomes = await ended(links);
    expect([...links.keys()].filter((_, index) => outcomes[index] === 'failed')).toEqual(['decor-shadow']);
    expect(calls.deletedPrograms).toBe(programs.length);
    expect(calls.deletedShaders).toBe(2 * programs.length);
    expect(calls.deletedWhilePending).toBe(0);
    expect(finished).toBe(1);
  });

  it('keeps the links of a stalled driver, freeing the context only once they complete', async () => {
    const { gl, calls, complete } = fakeContext();
    let finished = 0;
    const links = linkPrograms(gl, programs, () => finished++);
    await tick(60);
    expect(calls.deletedPrograms).toBe(0);
    expect(finished).toBe(0);
    complete();
    await ended(links);
    expect(calls.deletedWhilePending).toBe(0);
    expect(finished).toBe(1);
  });

  it('ends every pending link failed once the context is lost', async () => {
    const { gl, lose } = fakeContext();
    let finished = 0;
    const links = linkPrograms(gl, programs, () => finished++);
    lose();
    expect((await ended(links)).every((outcome) => outcome === 'failed')).toBe(true);
    expect(finished).toBe(1);
  });

  it('ends the rest failed when the context is lost among the parallel requests', async () => {
    const { gl, calls, lose } = fakeContext();
    const lostAfter = 3;
    const link = gl.linkProgram;
    gl.linkProgram = (program) => {
      link(program);
      if (calls.links === lostAfter) lose();
    };
    const outcomes = await ended(linkPrograms(gl, programs));
    expect(calls.links).toBe(lostAfter);
    expect(outcomes.every((outcome) => outcome === 'failed')).toBe(true);
  });

  it('ends a link failed, without throwing, where the context creates no program', async () => {
    const { gl } = fakeContext();
    let created = 0;
    gl.createProgram = () => (created++ === 0 ? (null as unknown as WebGLProgram) : ({} as WebGLProgram));
    gl.getProgramParameter = () => true;
    const outcomes = await ended(linkPrograms(gl, programs));
    expect(outcomes[0]).toBe('failed');
    expect(outcomes.slice(1).every((outcome) => outcome === 'linked')).toBe(true);
  });
});

describe('waitForLinks', () => {
  beforeEach(() => {
    fakePollTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });
  const after = (ms: number, outcome: LinkResult['outcome'] = 'linked'): Promise<LinkResult> =>
    new Promise((resolve) => setTimeout(() => resolve({ outcome, ms, contextLost: false }), ms));
  const never = (): Promise<LinkResult> => new Promise(() => undefined);
  const outcomesOf = (warmed: readonly { readonly outcome: string }[]): string[] =>
    warmed.map((program) => program.outcome);
  const settled = async (
    links: ReadonlyMap<string, Promise<LinkResult>>,
    stallMs?: number,
  ): Promise<readonly WarmedProgram[]> => {
    const pending = waitForLinks(links, stallMs);
    await vi.runAllTimersAsync();
    return pending;
  };

  it('settles once every link has ended, with each outcome', async () => {
    const warmed = await settled(
      new Map([
        ['a', after(5)],
        ['b', after(10, 'failed')],
      ]),
    );
    expect(warmed.map((program) => `${program.name} ${program.outcome}`)).toEqual(['a linked', 'b failed']);
  });

  it('stops waiting once no link has ended for the stall limit, reading the rest as pending', async () => {
    const warmed = await settled(
      new Map([
        ['a', after(5)],
        ['b', never()],
      ]),
      50,
    );
    expect(outcomesOf(warmed)).toEqual(['linked', 'pending']);
  });

  it('keeps waiting while links keep ending, however long they take together', async () => {
    const gapMs = 30;
    const stallMs = 200;
    const names = Array.from({ length: 16 }, (_, index) => `p${index}`);
    // Every gap is well inside the stall limit, the whole run well past it.
    const warmed = await settled(
      new Map(names.map((name, index) => [name, after((index + 1) * gapMs)])),
      stallMs,
    );
    expect(outcomesOf(warmed).every((outcome) => outcome === 'linked')).toBe(true);
  });

  it('credits a link that ended between two checks a held-back tab ran back to back', async () => {
    // A zero limit reads as stalled at the first check; the link ends before the second one.
    const warmed = await settled(new Map([['a', after(20)]]), 0);
    expect(outcomesOf(warmed)).toEqual(['linked']);
  });
});

describe('starting a warm-up', () => {
  type WarmupModule = typeof import('../../../src/gpu/shaders/warmup.js');
  let warmup: WarmupModule;
  const settings: WarmupSettings = {
    enhancedSampling: true,
    pixelArtScaler: 'xbr',
    softShadows: true,
    environmentMotion: true,
    weather: true,
    blood: true,
  };

  interface ContextBehaviour {
    readonly lost: boolean;
    readonly parallel: boolean;
    /** The probe's answer to its `n`th compile check on this context, counting from 1. */
    readonly compileAnswer: (n: number) => unknown;
    /** Loses the context with its first link request, as a GPU reset during the warm-up does. */
    readonly loseOnLink: boolean;
    /** Whether a link that ends succeeds; false for a program the driver rejects. */
    readonly links: boolean;
  }
  const HEALTHY: ContextBehaviour = {
    lost: false,
    parallel: true,
    compileAnswer: () => true,
    loseOnLink: false,
    links: true,
  };

  /** Canvases whose contexts answer as a test sets, the `index`th one by `behaviour(index)`, counting
   *  what the warm-ups did with them. */
  function stubContexts(behaviour: (index: number) => Partial<ContextBehaviour>) {
    const seen = { contexts: 0, programs: 0, probeCompiles: 0, released: 0, linkedNames: [] as string[] };
    const makeContext = (does: ContextBehaviour) => {
      let lost = does.lost;
      let compiles = 0;
      let fragmentName = '';
      return {
        MAX_TEXTURE_IMAGE_UNITS: 0x8872,
        FRAGMENT_SHADER: 0x8b30,
        VERTEX_SHADER: 0x8b31,
        COMPILE_STATUS: 0x8b81,
        LINK_STATUS,
        isContextLost: () => lost,
        getParameter: () => 16,
        getExtension: (name: string) =>
          name === 'WEBGL_lose_context'
            ? {
                loseContext: () => {
                  seen.released++;
                  lost = true;
                },
              }
            : name === 'KHR_parallel_shader_compile' && does.parallel
              ? {}
              : null,
        createShader: () => (lost ? null : {}),
        shaderSource: (_shader: unknown, text: string) => {
          fragmentName = /#define SHADER_NAME (\S+)-fragment/.exec(text)?.[1] ?? fragmentName;
        },
        compileShader: () => undefined,
        getShaderParameter: () => {
          seen.probeCompiles++;
          const answer = does.compileAnswer(++compiles);
          // WebGL answers null once it has flagged the context lost.
          if (answer === null) lost = true;
          return answer;
        },
        deleteShader: () => undefined,
        createProgram: () => {
          if (lost) return null;
          seen.programs++;
          return {};
        },
        attachShader: () => undefined,
        linkProgram: () => {
          seen.linkedNames.push(fragmentName);
          if (does.loseOnLink) lost = true;
        },
        getProgramParameter: (_program: unknown, name: number) =>
          lost ? null : name === LINK_STATUS ? does.links : true,
        deleteProgram: () => undefined,
      };
    };
    vi.stubGlobal('document', {
      createElement: () => ({
        getContext: () => makeContext({ ...HEALTHY, ...behaviour(seen.contexts++) }),
      }),
    });
    return seen;
  }

  beforeEach(async () => {
    vi.resetModules();
    warmup = await import('../../../src/gpu/shaders/warmup.js');
  });
  /** The programs a warm-up settled with; every context here offers parallel links unless a test says. */
  const warmed = (asked: WarmupSettings): Promise<readonly WarmedProgram[]> => {
    const started = warmup.startShaderWarmup(asked);
    if (started === null) throw new Error('the warm-up linked nothing');
    return started.done;
  };
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('settles without probing a context that is lost from the start', async () => {
    const seen = stubContexts(() => ({ lost: true }));
    expect(await warmed(settings)).toEqual([]);
    // Pixi's if-limit probe never returns on a lost context, so it must not run.
    expect(seen.probeCompiles).toBe(0);
  });

  it('gives up its probe on a context that fails every compile, as one lost mid-probe does', async () => {
    const seen = stubContexts(() => ({ compileAnswer: () => false }));
    expect(await warmed(settings)).toEqual([]);
    expect(seen.probeCompiles).toBeLessThan(10);
    expect(seen.programs).toBe(0);
    expect(seen.released).toBe(1);
  });

  it('warms nothing where links would block, asking only the first context', () => {
    const seen = stubContexts(() => ({ parallel: false }));
    expect(warmup.startShaderWarmup(settings)).toBeNull();
    expect(warmup.startShaderWarmup({ ...settings, weather: false })).toBeNull();
    expect(seen.probeCompiles).toBe(0);
    expect(seen.contexts).toBe(1);
    expect(seen.released).toBe(1);
  });

  it('links each program once, however many warm-ups ask for it', async () => {
    const seen = stubContexts(() => ({}));
    const [all, some, again] = await Promise.all([
      warmed(settings),
      warmed({ ...settings, weather: false }),
      warmed(settings),
    ]);
    expect(all.every((program) => program.outcome === 'linked')).toBe(true);
    expect(some.length).toBeLessThan(all.length);
    expect(again).toEqual(all.map((program) => ({ ...program, ms: expect.any(Number) })));
    expect(seen.programs).toBe(all.length);
    // The later warm-ups found every program requested, so they never opened a context.
    expect(seen.contexts).toBe(1);
  });

  it('gives up its probe on an answer from a context lost mid-probe', async () => {
    const seen = stubContexts(() => ({ compileAnswer: () => null }));
    expect(await warmed(settings)).toEqual([]);
    expect(seen.programs).toBe(0);
  });

  it('names the batch variant for the limit the renderer will find, as Pixi halves it', async () => {
    const seen = stubContexts(() => ({ compileAnswer: (n) => n > 1 }));
    await warmed(settings);
    expect(seen.linkedNames).toContain('world-batch/textures8/xbr/shadow');
  });

  it('opens a context only for the programs no earlier warm-up asked for', async () => {
    const seen = stubContexts(() => ({}));
    const some = await warmed({ ...settings, weather: false });
    const all = await warmed(settings);
    expect(seen.contexts).toBe(2);
    expect(seen.programs).toBe(all.length);
    expect(seen.linkedNames.slice(some.length).every((name) => name.startsWith('weather-'))).toBe(true);
  });

  it('asks again for a program whose context was lost', async () => {
    const seen = stubContexts((index) => ({ loseOnLink: index === 0 }));
    const lost = await warmed(settings);
    expect(lost.every((program) => program.outcome === 'failed')).toBe(true);
    const retried = await warmed(settings);
    expect(retried.every((program) => program.outcome === 'linked')).toBe(true);
    expect(seen.contexts).toBe(2);
  });

  it('links every program again once the links are forgotten, as after a GPU process restart', async () => {
    const seen = stubContexts(() => ({}));
    const first = await warmed(settings);
    warmup.forgetShaderLinks();
    await warmed(settings);
    expect(seen.contexts).toBe(2);
    expect(seen.programs).toBe(2 * first.length);
  });

  it('does not link again a program the driver rejected', async () => {
    const seen = stubContexts(() => ({ links: false }));
    const rejected = await warmed(settings);
    expect(rejected.every((program) => program.outcome === 'failed')).toBe(true);
    await warmed(settings);
    expect(seen.contexts).toBe(1);
  });
});
