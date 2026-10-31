import { checkMaxIfStatementsInShader } from 'pixi.js';
import type { WorldMagnification } from '../pixel-art/registry.js';
import { DEFAULT_SHADOW_STYLE, type ShadowStyle } from '../world-batch/shadow-style.js';
import type { WorldEnhancements } from '../world-renderer/frame.js';
import { bootShaderPrograms, type ShaderSelection } from './catalog.js';
import { type GlslProgramSource, glProgramFor } from './program-source.js';

/**
 * Links the programs a world will draw with in a context of its own, ahead of the renderer. The browser
 * caches linked programs by their text across contexts and, on disk, across runs, so the renderer's own
 * link of the same text is answered from the cache instead of compiling: on Direct3D that compile is
 * seconds per program, and with `KHR_parallel_shader_compile` the driver runs it on its own threads
 * while the caller keeps loading. Without the extension a link here would block this thread as long as
 * the renderer's own link, so nothing is warmed: Firefox keeps no linked programs, not even within one
 * context, and lacks the extension. The cache key also covers the shader-visible extensions and the
 * bound attribute locations, which the renderer leaves as this context has them.
 */
export interface ShaderWarmup {
  /** Settles once no program is waited for: each linked, failed, or still with a driver that stopped
   *  completing links. A failure is reported, never thrown, since the renderer reports its own. */
  readonly done: Promise<readonly WarmedProgram[]>;
}

/** `pending`: still with the driver when the warm-up stopped waiting for it. */
export type WarmOutcome = 'linked' | 'failed' | 'pending';

export interface WarmedProgram {
  readonly name: string;
  readonly outcome: WarmOutcome;
  /** Wall time from the request to the link's completion, or to when the warm-up stopped waiting;
   *  parallel compiles overlap. */
  readonly ms: number;
}

/** A link's end, once the driver has it. */
export interface LinkResult {
  readonly outcome: Exclude<WarmOutcome, 'pending'>;
  readonly ms: number;
  /** The context was lost when the link ended, which failed the link rather than the program. */
  readonly contextLost: boolean;
}

/** The world batch variant a setting pair selects; the renderer applies the same reading. */
export interface WorldShaderSettings {
  readonly magnification: WorldMagnification;
  readonly shadow: ShadowStyle | null;
}

export function worldShaderSettings(
  enhancements: Pick<WorldEnhancements, 'enhancedSampling' | 'pixelArtScaler' | 'softShadows'>,
): WorldShaderSettings {
  return {
    magnification: enhancements.enhancedSampling ? enhancements.pixelArtScaler : 'off',
    shadow: enhancements.softShadows ? DEFAULT_SHADOW_STYLE : null,
  };
}

/** How often a pending parallel link is asked whether it has completed. */
const COMPLETION_POLL_MS = 16;
/** How long links may go without one completing before `done` stops waiting: a slow driver keeps
 *  completing them, while one under load from a dozen other tabs drawing maps was observed with none
 *  completing for over a minute. A cold Direct3D compile of the heaviest program took 8 s on CI. */
const STALL_LIMIT_MS = 20_000;
/** How often a stalled link is still asked: nobody waits on it any more, but its context is freed only
 *  once it completes, since deleting a program the driver is still linking blocks the GPU process
 *  until the link ends. */
const STALLED_POLL_MS = 1000;

const KHR_PARALLEL_SHADER_COMPILE = 'KHR_parallel_shader_compile';
/** `COMPLETION_STATUS_KHR` of the extension; the GL enum, so no typed extension object is needed. */
const COMPLETION_STATUS_KHR = 0x91b1;

interface PendingLink {
  readonly program: WebGLProgram;
  readonly shaders: readonly WebGLShader[];
  readonly startedAt: number;
  readonly resolve: (result: LinkResult) => void;
}

/** The calls the warm-up makes on its context, so a test can drive it without a GPU. */
export type LinkingContext = Pick<
  WebGL2RenderingContext,
  | 'VERTEX_SHADER'
  | 'FRAGMENT_SHADER'
  | 'LINK_STATUS'
  | 'createProgram'
  | 'createShader'
  | 'shaderSource'
  | 'compileShader'
  | 'attachShader'
  | 'linkProgram'
  | 'getProgramParameter'
  | 'deleteShader'
  | 'deleteProgram'
  | 'isContextLost'
>;

/** The player settings that pick which programs a world can draw with. */
export type WarmupSettings = Pick<
  WorldEnhancements,
  'enhancedSampling' | 'pixelArtScaler' | 'softShadows' | 'environmentMotion'
> & {
  readonly weather: boolean;
  readonly blood: boolean;
};

export function shaderSelection(settings: WarmupSettings): ShaderSelection {
  return {
    ...worldShaderSettings(settings),
    weather: settings.weather,
    blood: settings.blood,
    groundWaves: settings.environmentMotion,
  };
}

/** Every link this page requested, by program name, so warm-ups for different settings share the
 *  programs they have in common and none is compiled twice. */
const requested = new Map<string, Promise<LinkResult>>();
/** The batch texture limit the first probe found; one GPU answers every context the same. */
let batchTextureLimit: number | null = null;

const SETTLED: ShaderWarmup = { done: Promise.resolve([]) };
/** Whether the first probed context offered parallel links; every context of one browser answers alike. */
let parallelLinks: boolean | null = null;

/** Forgets every link requested so far, so the next warm-up links its programs again: a GPU process
 *  that restarted holds none of them, and a restored renderer would link them all in its first frame. */
export function forgetShaderLinks(): void {
  requested.clear();
}

/** The warm-up for `settings`: null, and nothing linked, where the driver cannot link off this thread. */
export function startShaderWarmup(settings: WarmupSettings): ShaderWarmup | null {
  if (parallelLinks === false) return null;
  const selection = shaderSelection(settings);
  if (batchTextureLimit !== null) {
    const programs = bootShaderPrograms(batchTextureLimit, selection);
    if (programs.every((program) => requested.has(program.name))) return warmupOf(programs);
  }
  const gl =
    typeof document === 'undefined'
      ? null
      : document.createElement('canvas').getContext('webgl2', { antialias: false, depth: false });
  // No usable WebGL 2 here: the renderer will say so itself.
  if (gl === null || gl.isContextLost()) return SETTLED;
  const release = (): void => gl.getExtension('WEBGL_lose_context')?.loseContext();
  parallelLinks = gl.getExtension(KHR_PARALLEL_SHADER_COMPILE) !== null;
  if (!parallelLinks) {
    release();
    return null;
  }
  batchTextureLimit ??= probeBatchTextureLimit(gl);
  if (batchTextureLimit === null) {
    release();
    return SETTLED;
  }
  const programs = bootShaderPrograms(batchTextureLimit, selection);
  const fresh = programs.filter((program) => !requested.has(program.name));
  for (const [name, link] of linkPrograms(gl, fresh, release)) {
    requested.set(
      name,
      link.then((result) => {
        // Asked at the link's end: the context is freed, and so lost, once every link has ended.
        if (result.contextLost) requested.delete(name);
        return result;
      }),
    );
  }
  return warmupOf(programs);
}

function warmupOf(programs: readonly GlslProgramSource[]): ShaderWarmup {
  const links = new Map<string, Promise<LinkResult>>();
  for (const program of programs) {
    const link = requested.get(program.name);
    if (link !== undefined) links.set(program.name, link);
  }
  return { done: waitForLinks(links) };
}

/**
 * The limit the renderer will find for its own context: WebGL 2 guarantees the batch's sampler
 * if-chain at 16, and Pixi halves the limit where a larger chain fails to compile. Null on a context
 * lost before or during the probe, whose every compile reports failure: Pixi's probe would halve to 0
 * and never return, so it runs here on a context that answers success once the halving is spent.
 */
function probeBatchTextureLimit(gl: WebGL2RenderingContext): number | null {
  const units: unknown = gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS);
  if (typeof units !== 'number' || units < 1) return null;
  const halvings = Math.floor(Math.log2(units)) + 1;
  let compiles = 0;
  const bounded = new Proxy(gl, {
    get(target, key) {
      if (key === 'getShaderParameter') {
        return (shader: WebGLShader, name: GLenum): unknown => {
          const answer: unknown = target.getShaderParameter(shader, name);
          compiles++;
          return typeof answer !== 'boolean' || compiles > halvings ? true : answer;
        };
      }
      const value: unknown = Reflect.get(target, key);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  const limit = checkMaxIfStatementsInShader(units, bounded);
  return gl.isContextLost() || limit < 1 ? null : limit;
}

/**
 * Waits for `links`, settling once every one has ended or none has for `stallMs`; those still with the
 * driver then read as pending. A stall needs two checks in a row, so a hidden tab whose throttled
 * timers fire together still credits a link that completed in the same batch.
 */
export function waitForLinks(
  links: ReadonlyMap<string, Promise<LinkResult>>,
  stallMs = STALL_LIMIT_MS,
): Promise<readonly WarmedProgram[]> {
  return new Promise((resolve) => {
    const startedAt = performance.now();
    const ended = new Map<string, LinkResult>();
    let progressAt = startedAt;
    let stallSeen = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let settled = false;
    const settle = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const now = performance.now();
      resolve(
        [...links.keys()].map((name): WarmedProgram => {
          const end = ended.get(name);
          return end === undefined
            ? { name, outcome: 'pending', ms: now - startedAt }
            : { name, outcome: end.outcome, ms: end.ms };
        }),
      );
    };
    for (const [name, link] of links) {
      void link.then((result) => {
        ended.set(name, result);
        progressAt = performance.now();
        stallSeen = false;
        if (ended.size === links.size) settle();
      });
    }
    if (links.size === 0) {
      settle();
      return;
    }
    const check = (): void => {
      const stalled = performance.now() - progressAt > stallMs;
      if (stalled && stallSeen) {
        settle();
        return;
      }
      stallSeen = stalled;
      timer = setTimeout(check, COMPLETION_POLL_MS);
    };
    timer = setTimeout(check, COMPLETION_POLL_MS);
  });
}

/**
 * Links `programs` on `gl` through the driver's own threads, each link's end by program name;
 * `onFinished` runs once none is left with the driver, so the context can be freed. A program is
 * deleted only after its link has ended.
 */
export function linkPrograms(
  gl: LinkingContext,
  programs: readonly GlslProgramSource[],
  onFinished: () => void = () => undefined,
): ReadonlyMap<string, Promise<LinkResult>> {
  // Every source is resolved before the first GL call, so a dropped one leaves no link behind.
  const sources = programs.map((program) => ({ name: program.name, ...glProgramText(program) }));
  const ends = new Map<string, Promise<LinkResult>>();
  const resolvers = new Map<string, (result: LinkResult) => void>();
  for (const { name } of sources) {
    ends.set(
      name,
      new Promise((resolve) => {
        resolvers.set(name, resolve);
      }),
    );
  }
  const resolverOf = (name: string): ((result: LinkResult) => void) =>
    resolvers.get(name) ?? (() => undefined);
  linkInParallel(gl, sources, resolverOf, onFinished);
  return ends;
}

interface ProgramText {
  readonly name: string;
  readonly vertex: string;
  readonly fragment: string;
}

function glProgramText(source: GlslProgramSource): Omit<ProgramText, 'name'> {
  const { vertex, fragment } = glProgramFor(source);
  if (vertex === undefined || fragment === undefined) throw new Error(`Pixi dropped ${source.name}'s source`);
  return { vertex, fragment };
}

/** Requests every link up front, then polls the driver's threads until none is left. */
function linkInParallel(
  gl: LinkingContext,
  sources: readonly ProgramText[],
  resolverOf: (name: string) => (result: LinkResult) => void,
  onFinished: () => void,
): void {
  let pending: PendingLink[] = [];
  for (const source of sources) {
    const link = requestLink(gl, source, resolverOf(source.name));
    if (link !== null) pending.push(link);
  }
  let progressAt = performance.now();
  const poll = (): void => {
    // A lost context links nothing more, so its pending links are failures already.
    const lost = gl.isContextLost();
    const still: PendingLink[] = [];
    for (const link of pending) {
      if (lost || gl.getProgramParameter(link.program, COMPLETION_STATUS_KHR) === true) finishLink(gl, link);
      else still.push(link);
    }
    const now = performance.now();
    if (still.length < pending.length) progressAt = now;
    pending = still;
    if (pending.length === 0) {
      onFinished();
      return;
    }
    setTimeout(poll, now - progressAt > STALL_LIMIT_MS ? STALLED_POLL_MS : COMPLETION_POLL_MS);
  };
  if (pending.length === 0) onFinished();
  else setTimeout(poll, COMPLETION_POLL_MS);
}

/**
 * Compiles and links the text Pixi will hand the renderer; the driver may defer both. Null, with the
 * link resolved failed, where the context creates no objects: lost, or out of resources.
 */
function requestLink(
  gl: LinkingContext,
  source: ProgramText,
  resolve: (result: LinkResult) => void,
): PendingLink | null {
  const startedAt = performance.now();
  // The DOM types omit the null a context without objects to give answers.
  const program = gl.createProgram() as WebGLProgram | null;
  const vertexShader = program === null ? null : (gl.createShader(gl.VERTEX_SHADER) as WebGLShader | null);
  const fragmentShader =
    vertexShader === null ? null : (gl.createShader(gl.FRAGMENT_SHADER) as WebGLShader | null);
  if (program === null || vertexShader === null || fragmentShader === null) {
    // Nothing was compiled or linked yet, so freeing never waits on the driver.
    if (vertexShader !== null) gl.deleteShader(vertexShader);
    if (program !== null) gl.deleteProgram(program);
    resolve({ outcome: 'failed', ms: 0, contextLost: gl.isContextLost() });
    return null;
  }
  for (const [shader, text] of [
    [vertexShader, source.vertex],
    [fragmentShader, source.fragment],
  ] as const) {
    gl.shaderSource(shader, text);
    gl.compileShader(shader);
    gl.attachShader(program, shader);
  }
  gl.linkProgram(program);
  return { program, shaders: [vertexShader, fragmentShader], startedAt, resolve };
}

/** Reads the outcome of a link that has ended, or that a lost context ended, and frees its objects. */
function finishLink(gl: LinkingContext, link: PendingLink): void {
  const outcome = gl.getProgramParameter(link.program, gl.LINK_STATUS) === true ? 'linked' : 'failed';
  for (const shader of link.shaders) gl.deleteShader(shader);
  gl.deleteProgram(link.program);
  link.resolve({ outcome, ms: performance.now() - link.startedAt, contextLost: gl.isContextLost() });
}
