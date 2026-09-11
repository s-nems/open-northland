#!/usr/bin/env node
// How much of the local corpus's mission scripts this build can run: every `[MissionData]` goal and
// result line of every generated map sidecar, split into the opcodes the sim evaluates and the ones
// it reports as unsupported. Each stage of the map-scripts epic states its coverage delta with this.
//
// Usage: node scripts/mission-coverage.mjs [--per-map] [--top <n>]
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { contentDir } from './content-dir.mjs';

// The npm command builds these packages before loading their opcode tables.
let decodeMissionGoal;
let decodeMissionResult;
let systems;
try {
  ({ decodeMissionGoal, decodeMissionResult } = await import('../packages/data/dist/index.js'));
  ({ systems } = await import('../packages/sim/dist/index.js'));
} catch (err) {
  console.error(`mission-coverage needs the workspace built (npx tsc --build): ${String(err)}`);
  process.exit(1);
}

const args = process.argv.slice(2);
const perMap = args.includes('--per-map');
const topIndex = args.indexOf('--top');
const top = topIndex >= 0 ? Number.parseInt(args[topIndex + 1] ?? '20', 10) : 20;

const mapsDir = resolve(contentDir(), 'maps');
if (!existsSync(mapsDir)) {
  console.error(`mission-coverage needs generated content - no maps under ${mapsDir}`);
  console.error('Generate it with: npm run pipeline -- --game "../Cultures 8th Wonder" --out content');
  process.exit(1);
}

const supported = {
  goal: new Set(systems.SUPPORTED_GOALS),
  result: new Set(systems.SUPPORTED_RESULTS),
};

const totals = { goal: { ran: 0, missing: 0 }, result: { ran: 0, missing: 0 } };
/** opcode -> lines, for the unsupported ones only: the list that orders the remaining stages. */
const missingByOpcode = new Map();
const perMapRows = [];
let missions = 0;
let completeMissions = 0;
let unknownLines = 0;
let tokenMismatches = 0;

for (const file of readdirSync(mapsDir)
  .filter((f) => f.endsWith('.script.json'))
  .sort()) {
  const script = JSON.parse(readFileSync(resolve(mapsDir, file), 'utf8'));
  const row = { map: file.replace('.script.json', ''), ran: 0, missing: 0 };
  for (const mission of script.missions ?? []) {
    missions++;
    const missingBefore = row.missing;
    count('goal', mission.goals ?? [], decodeMissionGoal, row);
    count('result', mission.results ?? [], decodeMissionResult, row);
    if (row.missing === missingBefore) completeMissions++;
  }
  perMapRows.push(row);
}

function count(phase, lines, decode, row) {
  for (const line of lines) {
    let unknown;
    const { opcode } = decode(line, (warning) => {
      if (warning.reason === 'unknownOpcode') unknown = warning.opcode;
      else tokenMismatches++;
    });
    if (unknown !== undefined) unknownLines++;
    const ran = unknown === undefined && supported[phase].has(opcode);
    totals[phase][ran ? 'ran' : 'missing']++;
    row[ran ? 'ran' : 'missing']++;
    if (!ran) {
      const key = `${phase} ${unknown === undefined ? opcode : `unknown ${JSON.stringify(unknown)}`}`;
      missingByOpcode.set(key, (missingByOpcode.get(key) ?? 0) + 1);
    }
  }
}

const share = (ran, missing) =>
  ran + missing === 0 ? '100.0%' : `${((100 * ran) / (ran + missing)).toFixed(1)}%`;

console.log(`mission coverage over ${perMapRows.length} maps, ${missions} missions (${mapsDir})`);
for (const phase of ['goal', 'result']) {
  const { ran, missing } = totals[phase];
  console.log(
    `  ${phase}s:   ${ran} implemented, ${missing} unsupported or unknown (${share(ran, missing)} of ${ran + missing})`,
  );
}
const ran = totals.goal.ran + totals.result.ran;
const missing = totals.goal.missing + totals.result.missing;
console.log(`  overall: ${ran} of ${ran + missing} lines (${share(ran, missing)})`);
console.log(`  missions with every opcode implemented: ${completeMissions} of ${missions}`);
console.log(`  decoder warnings: ${unknownLines} unknown lines, ${tokenMismatches} token-count mismatches`);
console.log('Static opcode coverage only; this does not prove successful execution or map completion.');
console.log('Partial executors: AllowJob/AllowHouse/AllowGood and SetExternalFlag have no gameplay reader;');
console.log(
  '  EnableHouse has no placement gate; SetLandscape has no chest interaction or final-flag behavior.',
);
console.log('Terrain, vision and presentation fidelity limits are recorded in docs/formats/MISSIONS.md.');

console.log(`\nthe ${top} unsupported opcodes costing the most lines:`);
for (const [key, lines] of [...missingByOpcode].sort((a, b) => b[1] - a[1]).slice(0, top)) {
  console.log(`  ${String(lines).padStart(6)}  ${key}`);
}

if (perMap) {
  console.log('\nper map, least covered first:');
  for (const row of [...perMapRows].sort(
    (a, b) => a.ran / (a.ran + a.missing || 1) - b.ran / (b.ran + b.missing || 1),
  )) {
    console.log(
      `  ${share(row.ran, row.missing).padStart(6)}  ${String(row.ran + row.missing).padStart(6)} lines  ${row.map}`,
    );
  }
}
