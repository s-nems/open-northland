// Reads the diagnostics bundles the app exports; usage in docs/DEVELOPMENT.md.
import { readFileSync } from 'node:fs';

// The exit codes of `diff`: agreement, a named difference, and a comparison that could not be made.
const EXIT_SAME = 0;
const EXIT_DIFFERENT = 1;
const EXIT_UNUSABLE = 2;
const USAGE = 'usage: npm run diag -- diff <a.json> <b.json>';

try {
  process.exit(await main(process.argv.slice(2)));
} catch (err) {
  fail(String(err));
}

async function main(argv) {
  const [command, ...args] = argv;
  if (command !== 'diff' || args.length !== 2) fail(USAGE);
  const { diffDigestInputs, digestInputsFromJson } = await simExports();
  const [pathA, pathB] = args;
  const disputeA = disputeOf(pathA, digestInputsFromJson);
  const disputeB = disputeOf(pathB, digestInputsFromJson);
  if (disputeA.tick !== disputeB.tick) {
    fail(
      `the bundles hold verdicts for different ticks: ${disputeA.tick} in ${pathA}, ${disputeB.tick} in ${pathB}`,
    );
  }
  const difference = diffDigestInputs(disputeA.inputs, disputeB.inputs);
  console.log(`tick ${disputeA.tick}: ${describe(difference)}`);
  return difference === null ? EXIT_SAME : EXIT_DIFFERENT;
}

/** The built sim's fold-input readers; a missing or stale build is reported, not thrown through. */
async function simExports() {
  let sim;
  try {
    sim = await import('../packages/sim/dist/index.js');
  } catch (err) {
    fail(`diag needs the workspace built (npm run build): ${String(err)}`);
  }
  if (typeof sim.diffDigestInputs !== 'function' || typeof sim.digestInputsFromJson !== 'function') {
    fail('packages/sim/dist is older than this tool: run npm run build');
  }
  return sim;
}

/** The bundle's `game.net.dispute`, which must carry the fold inputs of its tick. */
function disputeOf(path, digestInputsFromJson) {
  let bundle;
  try {
    bundle = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    fail(`${path} is not a readable JSON bundle: ${String(err)}`);
  }
  const dispute = bundle?.game?.net?.dispute;
  if (dispute === undefined || dispute === null)
    fail(`${path} has no game.net.dispute: not a relayed session with a verdict`);
  if (!Number.isSafeInteger(dispute.tick) || dispute.tick < 0) {
    fail(`${path}: verdict tick must be a non-negative safe integer`);
  }
  if (dispute.inputs === null || dispute.inputs === undefined) {
    fail(`${path}: the verdict for tick ${dispute.tick} arrived after its inputs left the window`);
  }
  let inputs;
  try {
    inputs = digestInputsFromJson(dispute.inputs);
  } catch (err) {
    fail(`${path}: ${String(err)}`);
  }
  if (inputs.tick !== dispute.tick) {
    fail(`${path}: inputs for tick ${inputs.tick} do not match the verdict for tick ${dispute.tick}`);
  }
  return { tick: dispute.tick, inputs };
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
      if (difference.detail === 'order') {
        return `${difference.domain} components written in a different order, from ${difference.component}`;
      }
      return `component ${difference.component} written on one side only (${difference.detail})`;
    case 'component':
      if (difference.detail === 'order') {
        return `${difference.domain} ${difference.component} entities written in a different order, from entity ${difference.entity}`;
      }
      return `${difference.domain} ${difference.component} entity ${difference.entity} (${difference.detail})`;
    default:
      return JSON.stringify(difference);
  }
}

function fail(message) {
  console.error(message);
  process.exit(EXIT_UNUSABLE);
}
