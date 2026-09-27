// Reads the diagnostics bundles the app exports; usage in docs/DEVELOPMENT.md.
import { readFileSync } from 'node:fs';

const EXIT_DIFFERENCE = 0;
const EXIT_NO_DIFFERENCE = 1;
const EXIT_UNUSABLE = 2;
const USAGE = 'usage: npm run diag -- diff <a.json> <b.json>';

let diffDigestInputs;
let digestInputsFromJson;
try {
  ({ diffDigestInputs, digestInputsFromJson } = await import('../packages/sim/dist/index.js'));
} catch (err) {
  fail(`diag needs the workspace built (npm run build): ${String(err)}`);
}

const [command, ...args] = process.argv.slice(2);
if (command !== 'diff' || args.length !== 2) fail(USAGE);
const [pathA, pathB] = args;
const disputeA = disputeOf(pathA);
const disputeB = disputeOf(pathB);
if (disputeA.tick !== disputeB.tick) {
  fail(
    `the bundles hold verdicts for different ticks: ${disputeA.tick} in ${pathA}, ${disputeB.tick} in ${pathB}`,
  );
}
const difference = diffDigestInputs(
  digestInputsFromJson(disputeA.inputs),
  digestInputsFromJson(disputeB.inputs),
);
console.log(`tick ${disputeA.tick}: ${describe(difference)}`);
process.exit(difference === null ? EXIT_NO_DIFFERENCE : EXIT_DIFFERENCE);

/** The bundle's `game.net.dispute`, which must carry the fold inputs of its tick. */
function disputeOf(path) {
  let bundle;
  try {
    bundle = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    fail(`${path} is not a readable JSON bundle: ${String(err)}`);
  }
  const dispute = bundle?.game?.net?.dispute;
  if (dispute === undefined || dispute === null)
    fail(`${path} has no game.net.dispute: not a relayed session with a verdict`);
  if (dispute.inputs === null || dispute.inputs === undefined) {
    fail(`${path}: the verdict for tick ${dispute.tick} arrived after its inputs left the window`);
  }
  return dispute;
}

function describe(difference) {
  if (difference === null) return 'no difference in the retained inputs';
  switch (difference.kind) {
    case 'rng':
      return 'rng state differs';
    case 'entities':
      return `entity allocation differs (${difference.detail})`;
    case 'fog':
      return `fog differs at word ${difference.index}`;
    case 'componentSet':
      return `component ${difference.component} written on one side only (${difference.detail})`;
    case 'component':
      return `${difference.domain} ${difference.component} entity ${difference.entity} (${difference.detail})`;
    default:
      return JSON.stringify(difference);
  }
}

function fail(message) {
  console.error(message);
  process.exit(EXIT_UNUSABLE);
}
