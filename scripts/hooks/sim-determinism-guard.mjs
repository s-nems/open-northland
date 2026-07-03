/**
 * PostToolUse hook (wired in .claude/settings.json): the edit-time echo of the determinism
 * hygiene test. After every Edit/Write into packages/sim/src it re-scans the touched file for the
 * forbidden nondeterminism patterns and feeds violations straight back to the agent (exit 2 →
 * stderr), so a violation surfaces the moment it is written instead of at the next `npm test`.
 *
 * packages/sim/test/core/hygiene.test.ts is the AUTHORITATIVE scan — it gates `npm test` + CI and
 * covers the whole tree. This guard mirrors its patterns for instant feedback and must never grow
 * past it: when adding a pattern, add it to the test first, then mirror it here.
 */
import { readFileSync } from 'node:fs';

const FORBIDDEN = [
  { pattern: /\bMath\.random\b/, why: 'use world.rng (seeded) — Math.random is nondeterministic' },
  { pattern: /\bDate\.now\b/, why: 'no wall-clock in sim — use the tick counter' },
  { pattern: /\bnew Date\b/, why: 'no wall-clock in sim' },
  { pattern: /\bperformance\.now\b/, why: 'no wall-clock in sim' },
  {
    pattern:
      /\bMath\.(?:sqrt|cbrt|sin|cos|tan|asin|acos|atan|atan2|sinh|cosh|tanh|asinh|acosh|atanh|exp|expm1|log|log1p|log2|log10|pow|hypot|fround)\b/,
    why: 'transcendental float math can differ across engines — use fx.* integer helpers (e.g. fx.isqrt)',
    allowFile: /[/\\]core[/\\]fixed\.ts$/,
  },
  {
    pattern: /\blocaleCompare\b|\btoLocale[A-Z]\w*\b|\bIntl\./,
    why: 'locale-dependent APIs vary by environment — sort/format by numeric id or codepoint instead',
  },
];

/** Strip comments so doc-comments that NAME a forbidden pattern aren't flagged (mirrors the test). */
function stripComments(line) {
  const trimmed = line.trimStart();
  if (trimmed.startsWith('*') || trimmed.startsWith('//') || trimmed.startsWith('/*')) return '';
  return line.replace(/\/\/.*$/, '');
}

try {
  const input = JSON.parse(readFileSync(0, 'utf8'));
  const file = input?.tool_input?.file_path ?? '';
  if (/[/\\]packages[/\\]sim[/\\]src[/\\].*\.ts$/.test(file)) {
    const rules = FORBIDDEN.filter(({ allowFile }) => !allowFile?.test(file));
    const violations = [];
    readFileSync(file, 'utf8')
      .split('\n')
      .forEach((raw, i) => {
        const line = stripComments(raw);
        for (const { pattern, why } of rules) {
          if (pattern.test(line)) violations.push(`${file}:${i + 1}  ${line.trim()}  -> ${why}`);
        }
      });
    if (violations.length > 0) {
      console.error(
        `sim determinism guard: forbidden nondeterministic pattern(s) in the file you just edited\n${violations.join(
          '\n',
        )}\nFix before committing — the authoritative gate is packages/sim/test/core/hygiene.test.ts (fails npm test + CI).`,
      );
      process.exit(2);
    }
  }
} catch {
  // Never block an edit because the guard itself failed — the hygiene test is the real gate.
}
process.exit(0);
