import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Encodes the determinism anti-patterns (CLAUDE.md) as a TEST, not just a doc: the sim must contain
 * no ambient nondeterminism. An LLM agent will reach for Math.random/Date.now reflexively; this
 * turns "the agent read the rule" into "the build fails". Scans packages/sim/src only (not tests).
 */
const SIM_SRC = fileURLToPath(new URL('../../src', import.meta.url));

const FORBIDDEN: Array<{ pattern: RegExp; why: string; allowFile?: RegExp }> = [
  { pattern: /\bMath\.random\b/, why: 'use world.rng (seeded) — Math.random is nondeterministic' },
  { pattern: /\bDate\.now\b/, why: 'no wall-clock in sim — use the tick counter' },
  { pattern: /\bnew Date\b/, why: 'no wall-clock in sim' },
  { pattern: /\bperformance\.now\b/, why: 'no wall-clock in sim' },
  {
    // Transcendental/irrational float math: IEEE-754 only pins the basic ops (+ - * /); these may
    // differ in the last bit across engines/CPUs — the classic cross-platform lockstep desync.
    // fixed.ts is exempt: fx.isqrt seeds with Math.sqrt then integer-corrects the result, which is
    // deterministic — it is the sanctioned wrapper everything else must call instead. Known gap: the
    // `**` operator with a fractional exponent is the same hazard as Math.pow, but a regex can't
    // tell it apart from an exact integer power (`2 ** k`), so it is not scanned — reviewers watch it.
    pattern:
      /\bMath\.(?:sqrt|cbrt|sin|cos|tan|asin|acos|atan|atan2|sinh|cosh|tanh|asinh|acosh|atanh|exp|expm1|log|log1p|log2|log10|pow|hypot|fround)\b/,
    why: 'transcendental float math can differ across engines — use fx.* integer helpers (e.g. fx.isqrt)',
    allowFile: /[/\\]core[/\\]fixed\.ts$/,
  },
  {
    // Locale/ICU-dependent output varies by environment (OS, Node build, browser) — another
    // cross-platform desync source if it ever feeds a game decision.
    pattern: /\blocaleCompare\b|\btoLocale[A-Z]\w*\b|\bIntl\./,
    why: 'locale-dependent APIs vary by environment — sort/format by numeric id or codepoint instead',
  },
];

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...tsFiles(p));
    else if (entry.name.endsWith('.ts')) out.push(p);
  }
  return out;
}

/** Strip comments so doc-comments that NAME a forbidden pattern (to warn against it) aren't flagged. */
function stripComments(line: string): string {
  const trimmed = line.trimStart();
  if (trimmed.startsWith('*') || trimmed.startsWith('//') || trimmed.startsWith('/*')) return '';
  return line.replace(/\/\/.*$/, '');
}

describe('determinism hygiene', () => {
  it('packages/sim/src contains no nondeterministic globals', () => {
    const violations: string[] = [];
    for (const file of tsFiles(SIM_SRC)) {
      // Exemption is a per-file fact — resolve it once, not per line × pattern.
      const rules = FORBIDDEN.filter(({ allowFile }) => !allowFile?.test(file));
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((raw, i) => {
        const line = stripComments(raw);
        for (const { pattern, why } of rules) {
          if (pattern.test(line)) violations.push(`${file}:${i + 1}  ${line.trim()}  -> ${why}`);
        }
      });
    }
    expect(violations, violations.join('\n')).toEqual([]);
  });
});
