/**
 * Estimates a GLSL shader's size after every user function is inlined into its entry point, as the
 * Direct3D shader compiler does before it optimises. The estimate counts texture-operation call sites in the
 * source as written: it folds no constants and removes no dead branches, so it is an approximation of
 * the unoptimised code the compiler starts from, not of the instructions it emits. It is a text scanner
 * for the shapes this package writes, not a GLSL parser.
 */

/** GLSL ES 3.00 built-ins that read a sampler. */
const TEXTURE_OPERATIONS: ReadonlySet<string> = new Set([
  'texture',
  'textureOffset',
  'textureProj',
  'textureProjOffset',
  'textureLod',
  'textureLodOffset',
  'textureProjLod',
  'textureProjLodOffset',
  'textureGrad',
  'textureGradOffset',
  'textureProjGrad',
  'textureProjGradOffset',
  'textureSize',
  'texelFetch',
  'texelFetchOffset',
]);

/** Rescans after which a macro expansion that still changes the text is taken to be self-referential. */
const MAX_MACRO_PASSES = 32;

export interface FragmentCost {
  readonly textureOps: number;
  readonly inlinedFunctionCalls: number;
  /** Headers of loops whose trip count is not a literal or a `const int`; each body counted once. */
  readonly unknownLoopBounds: readonly string[];
}

export function fragmentCost(glsl: string, entry = 'main'): FragmentCost {
  const code = preprocess(stripComments(glsl));
  const estimator = new InlinedCostEstimator(splitFunctions(code), intConstants(code));
  const cost = estimator.functionCost(entry);
  return { ...cost, unknownLoopBounds: [...new Set(cost.unknownLoopBounds)] };
}

/** Comments become whitespace that keeps their line breaks, so directives stay on their own lines. */
function stripComments(glsl: string): string {
  return glsl
    .replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, '');
}

interface Macro {
  /** `null` for an object-like macro. */
  readonly params: readonly string[] | null;
  readonly body: string;
}

/** Applies `#define` and `#undef` in order and drops every other directive; conditionals are refused. */
function preprocess(glsl: string): string {
  const macros = new Map<string, Macro>();
  const output: string[] = [];
  let pending: string[] = [];
  // Consecutive code lines expand together, so a macro call may span lines.
  const flush = (): void => {
    if (pending.length > 0) output.push(expandMacros(pending.join('\n'), macros));
    pending = [];
  };
  for (const line of glsl.replace(/\\\n/g, ' ').split('\n')) {
    const directive = /^\s*#\s*(\w+)\s*(.*)$/.exec(line);
    if (directive === null) {
      pending.push(line);
      continue;
    }
    flush();
    const [, keyword = '', rest = ''] = directive;
    if (keyword === 'define') defineMacro(rest, macros);
    else if (keyword === 'undef') macros.delete(rest.trim());
    else if (/^(if|ifdef|ifndef|elif|else|endif)$/.test(keyword))
      throw new Error(`glsl-cost does not evaluate #${keyword}`);
  }
  flush();
  return output.join('\n');
}

function defineMacro(definition: string, macros: Map<string, Macro>): void {
  const parsed = /^([A-Za-z_]\w*)(\(([^)]*)\))?\s*(.*)$/.exec(definition);
  if (parsed === null) throw new Error(`malformed #define ${definition}`);
  const [, name = '', paramList, params = '', body = ''] = parsed;
  macros.set(name, {
    params:
      paramList === undefined
        ? null
        : params
            .split(',')
            .map((param) => param.trim())
            .filter(Boolean),
    body: body.trim(),
  });
}

function expandMacros(text: string, macros: ReadonlyMap<string, Macro>): string {
  let current = text;
  for (let pass = 0; pass < MAX_MACRO_PASSES; pass++) {
    const next = expandOnce(current, macros);
    if (next === current) return current;
    current = next;
  }
  throw new Error(`macro expansion did not settle after ${MAX_MACRO_PASSES} passes`);
}

function expandOnce(text: string, macros: ReadonlyMap<string, Macro>): string {
  const identifier = /\b[A-Za-z_]\w*\b/g;
  let output = '';
  let copied = 0;
  for (let match = identifier.exec(text); match !== null; match = identifier.exec(text)) {
    const macro = macros.get(match[0]);
    if (macro === undefined) continue;
    let end = identifier.lastIndex;
    let replacement = macro.body;
    if (macro.params !== null) {
      const open = /^\s*\(/.exec(text.slice(end));
      // A function-like macro's name without arguments is left alone, as in C.
      if (open === null) continue;
      const close = matchingClose(text, end + open[0].length - 1, '(', ')');
      const args = splitTopLevel(text.slice(end + open[0].length, close), ',').map((arg) => arg.trim());
      const params = macro.params;
      replacement = macro.body.replace(/\b[A-Za-z_]\w*\b/g, (word) => {
        const index = params.indexOf(word);
        return index < 0 ? word : (args[index] ?? '');
      });
      end = close + 1;
    }
    output += `${text.slice(copied, match.index)}${replacement}`;
    copied = end;
    identifier.lastIndex = end;
  }
  return output + text.slice(copied);
}

/** Index of the bracket closing the one at `open`. */
function matchingClose(text: string, open: number, opener: string, closer: string): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === opener) depth++;
    else if (text[i] === closer && --depth === 0) return i;
  }
  throw new Error(`unbalanced ${opener} at ${text.slice(open, open + 40)}`);
}

/** Splits on `separator` outside parentheses and brackets. */
function splitTopLevel(text: string, separator: string, braces = false): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '(' || char === '[' || (braces && char === '{')) depth++;
    else if (char === ')' || char === ']' || (braces && char === '}')) depth--;
    else if (char === separator && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

/** Bodies of the top-level function definitions, by name; an overloaded name keeps every body. */
function splitFunctions(code: string): ReadonlyMap<string, readonly string[]> {
  const functions = new Map<string, string[]>();
  let declarationStart = 0;
  for (let i = 0; i < code.length; i++) {
    if (code[i] === ';') declarationStart = i + 1;
    if (code[i] !== '{') continue;
    const close = matchingClose(code, i, '{', '}');
    const header = /([A-Za-z_]\w*)\s*\([^()]*\)\s*$/.exec(code.slice(declarationStart, i));
    if (header?.[1] !== undefined) {
      const bodies = functions.get(header[1]) ?? [];
      bodies.push(code.slice(i + 1, close));
      functions.set(header[1], bodies);
    }
    i = close;
    declarationStart = close + 1;
  }
  return functions;
}

/** `const int NAME = <literal>;` at any scope; a name declared twice keeps its last value. */
function intConstants(code: string): ReadonlyMap<string, number> {
  const constants = new Map<string, number>();
  for (const match of code.matchAll(
    /\bconst\s+(?:(?:highp|mediump|lowp)\s+)?int\s+(\w+)\s*=\s*(-?\d+)\s*;/g,
  )) {
    const [, name = '', value = ''] = match;
    constants.set(name, Number.parseInt(value, 10));
  }
  return constants;
}

interface MutableCost {
  textureOps: number;
  inlinedFunctionCalls: number;
  unknownLoopBounds: string[];
}

const zeroCost = (): MutableCost => ({ textureOps: 0, inlinedFunctionCalls: 0, unknownLoopBounds: [] });

function addCost(total: MutableCost, part: FragmentCost, times = 1): void {
  total.textureOps += part.textureOps * times;
  total.inlinedFunctionCalls += part.inlinedFunctionCalls * times;
  total.unknownLoopBounds.push(...part.unknownLoopBounds);
}

class InlinedCostEstimator {
  private readonly costs = new Map<string, FragmentCost>();
  /** Bodies being expanded, so a call back into one of them is reported instead of looping. */
  private readonly inProgress = new Set<string>();

  constructor(
    private readonly functions: ReadonlyMap<string, readonly string[]>,
    private readonly constants: ReadonlyMap<string, number>,
  ) {}

  /** An overloaded name costs as its dearest body: the scan does not resolve argument types. */
  functionCost(name: string): FragmentCost {
    const known = this.costs.get(name);
    if (known !== undefined) return known;
    const bodies = this.functions.get(name);
    if (bodies === undefined) throw new Error(`no function ${name}`);
    // A call to this name from inside one of its bodies can only mean another overload.
    const open = bodies.filter((body) => !this.inProgress.has(body));
    if (open.length === 0) throw new Error(`recursive call to ${name}, which GLSL forbids`);
    let dearest: FragmentCost = zeroCost();
    for (const body of open) {
      this.inProgress.add(body);
      const cost = this.segmentCost(body);
      this.inProgress.delete(body);
      if (cost.textureOps >= dearest.textureOps) dearest = cost;
    }
    if (open.length === bodies.length) this.costs.set(name, dearest);
    return dearest;
  }

  /** A `for` body counts once per iteration; the code around it counts once. */
  private segmentCost(code: string): FragmentCost {
    const loop = /\bfor\s*\(/.exec(code);
    if (loop === null) return this.straightCost(code);
    const headerOpen = loop.index + loop[0].length - 1;
    const headerClose = matchingClose(code, headerOpen, '(', ')');
    const header = code.slice(headerOpen + 1, headerClose);
    const bodyStart = code.slice(headerClose + 1).search(/\S/) + headerClose + 1;
    const bodyEnd =
      code[bodyStart] === '{' ? matchingClose(code, bodyStart, '{', '}') : statementEnd(code, bodyStart);
    const total = zeroCost();
    addCost(total, this.straightCost(code.slice(0, headerOpen)));
    addCost(total, this.straightCost(header));
    const trips = tripCount(header, this.constants);
    if (trips === null) total.unknownLoopBounds.push(`for (${header.trim()})`);
    addCost(total, this.segmentCost(code.slice(bodyStart, bodyEnd + 1)), trips ?? 1);
    addCost(total, this.segmentCost(code.slice(bodyEnd + 1)));
    return total;
  }

  private straightCost(code: string): FragmentCost {
    const total = zeroCost();
    for (const call of code.matchAll(/\b([A-Za-z_]\w*)\s*\(/g)) {
      const name = call[1] ?? '';
      if (TEXTURE_OPERATIONS.has(name)) total.textureOps++;
      else if (name === 'while') total.unknownLoopBounds.push('while');
      else if (this.functions.has(name)) {
        total.inlinedFunctionCalls++;
        addCost(total, this.functionCost(name));
      }
    }
    return total;
  }
}

/** Index of the `;` ending the statement that starts at `start`; a braced block inside it, as in an
 *  unbraced loop body holding an `if` block, ends with the block. */
function statementEnd(code: string, start: number): number {
  const end = splitTopLevel(code.slice(start), ';', true)[0]?.length ?? code.length - start;
  return start + end;
}

/** Iterations of `for (int i = A; i < B; i++)` and its `<=`, `>`, `>=`, `--`, `+=` and `-=` forms. */
function tripCount(header: string, constants: ReadonlyMap<string, number>): number | null {
  const [init = '', condition = '', step = ''] = splitTopLevel(header, ';').map((part) => part.trim());
  const start = /^(?:(?:highp|mediump|lowp)\s+)?(?:int\s+)?(\w+)\s*=\s*(.+)$/.exec(init);
  const bound = /^(\w+)\s*(<=|<|>=|>)\s*(.+)$/.exec(condition);
  const variable = start?.[1];
  if (variable === undefined || bound?.[1] !== variable) return null;
  const from = intValue(start?.[2] ?? '', constants);
  const to = intValue(bound[3] ?? '', constants);
  const stride = stepSize(step, variable, constants);
  if (from === null || to === null || stride === null || stride === 0) return null;
  const comparison = bound[2];
  const inclusive = comparison === '<=' || comparison === '>=';
  const ascending = comparison === '<' || comparison === '<=';
  if (ascending !== stride > 0) return null;
  const span = Math.abs(to - from);
  const magnitude = Math.abs(stride);
  if (ascending ? to < from : to > from) return 0;
  return inclusive ? Math.floor(span / magnitude) + 1 : Math.ceil(span / magnitude);
}

function stepSize(step: string, variable: string, constants: ReadonlyMap<string, number>): number | null {
  if (step === `${variable}++` || step === `++${variable}`) return 1;
  if (step === `${variable}--` || step === `--${variable}`) return -1;
  const compound = /^(\w+)\s*([+-])=\s*(.+)$/.exec(step);
  if (compound?.[1] !== variable) return null;
  const amount = intValue(compound[3] ?? '', constants);
  if (amount === null) return null;
  return compound[2] === '-' ? -amount : amount;
}

function intValue(expression: string, constants: ReadonlyMap<string, number>): number | null {
  const text = expression.trim();
  if (/^-?\d+$/.test(text)) return Number.parseInt(text, 10);
  return constants.get(text) ?? null;
}
