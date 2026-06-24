import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Encodes the determinism anti-patterns (CLAUDE.md) as a TEST, not just a doc: the sim must contain
 * no ambient nondeterminism. An LLM agent will reach for Math.random/Date.now reflexively; this
 * turns "the agent read the rule" into "the build fails". Scans packages/sim/src only (not tests).
 */
const SIM_SRC = fileURLToPath(new URL('../src', import.meta.url));

const FORBIDDEN: Array<{ pattern: RegExp; why: string }> = [
  { pattern: /\bMath\.random\b/, why: 'use world.rng (seeded) — Math.random is nondeterministic' },
  { pattern: /\bDate\.now\b/, why: 'no wall-clock in sim — use the tick counter' },
  { pattern: /\bnew Date\b/, why: 'no wall-clock in sim' },
  { pattern: /\bperformance\.now\b/, why: 'no wall-clock in sim' },
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
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((raw, i) => {
        const line = stripComments(raw);
        for (const { pattern, why } of FORBIDDEN) {
          if (pattern.test(line)) violations.push(`${file}:${i + 1}  ${line.trim()}  -> ${why}`);
        }
      });
    }
    expect(violations, violations.join('\n')).toEqual([]);
  });
});
