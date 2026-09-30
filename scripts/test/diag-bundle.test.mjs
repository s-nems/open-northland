import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

// Exercise the CLI with its real sim readers, independently of pre-existing dist output.
const compiled = await build({
  stdin: {
    contents: `export { diffDigestInputs } from './packages/sim/src/inspect/digest-inputs-diff.ts';
export { digestInputsFromJson } from './packages/sim/src/inspect/digest-inputs-json.ts';`,
    resolveDir: fileURLToPath(new URL('../../', import.meta.url)),
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
});

function bundle(tick = 7) {
  return {
    game: {
      net: {
        dispute: {
          tick,
          inputs: {
            tick,
            rng: -123,
            nextEntityId: 3,
            entityCount: 1,
            allocations: [1, 2, 1],
            fog: [0, 0xffffffff],
            components: [{ name: 'Position', domain: 'movement', entities: [2], words: [17] }],
          },
        },
      },
    },
  };
}

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'on-diag-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'scripts'));
  const dist = join(root, 'packages/sim/dist');
  await mkdir(dist, { recursive: true });
  await writeFile(join(root, 'package.json'), '{"type":"module"}');
  await copyFile(new URL('../diag-bundle.mjs', import.meta.url), join(root, 'scripts/diag-bundle.mjs'));
  await writeFile(join(dist, 'index.js'), compiled.outputFiles[0].text);
  return {
    root,
    dist,
    async write(name, value) {
      await writeFile(join(root, name), JSON.stringify(value));
    },
    run: (args = ['diff', 'a.json', 'b.json']) =>
      spawnSync(process.execPath, ['scripts/diag-bundle.mjs', ...args], { cwd: root, encoding: 'utf8' }),
  };
}

test('returns agreement and names component differences with distinct exit codes', async (t) => {
  const f = await fixture(t);
  await f.write('a.json', bundle());
  await f.write('b.json', bundle());
  let result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /tick 7: no difference/);
  const changed = bundle();
  changed.game.net.dispute.inputs.components[0].words[0] = 18;
  await f.write('b.json', changed);
  result = f.run();
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stdout, /tick 7: movement Position entity 2 \(word\)/);
});

test('rejects unavailable files, malformed JSON and absent or expired verdicts', async (t) => {
  const f = await fixture(t);
  await f.write('b.json', bundle());
  assert.equal(f.run().status, 2);
  await writeFile(join(f.root, 'a.json'), '{');
  assert.match(f.run().stderr, /a.json is not a readable JSON bundle/);
  for (const value of [null, {}, { game: { net: { dispute: null } } }]) {
    await f.write('a.json', value);
    const result = f.run();
    assert.equal(result.status, 2);
    assert.match(result.stderr, /a.json has no game.net.dispute/);
  }
  const expired = bundle();
  expired.game.net.dispute.inputs = null;
  await f.write('a.json', expired);
  assert.match(f.run().stderr, /tick 7 arrived after its inputs left the window/);
});

test('rejects verdicts from different ticks', async (t) => {
  const f = await fixture(t);
  await f.write('a.json', bundle(7));
  await f.write('b.json', bundle(8));
  const result = f.run();
  assert.equal(result.status, 2);
  assert.match(result.stderr, /different ticks: 7 in a.json, 8 in b.json/);
});

test('rejects inputs whose tick differs from the verdict even when both bundles agree', async (t) => {
  const f = await fixture(t);
  const wrongTick = bundle(7);
  wrongTick.game.net.dispute.inputs.tick = 8;
  await f.write('a.json', wrongTick);
  await f.write('b.json', wrongTick);
  const result = f.run();
  assert.equal(result.status, 2);
  assert.match(result.stderr, /a.json.*inputs.*tick 8.*verdict.*7/);
  assert.equal(result.stdout, '');
});

test('rejects verdicts with invalid tick metadata', async (t) => {
  const f = await fixture(t);
  await f.write('b.json', bundle());
  for (const tick of [undefined, null, -1, 1.5, '7', 2 ** 53]) {
    const invalid = bundle();
    invalid.game.net.dispute.tick = tick;
    await f.write('a.json', invalid);
    const result = f.run();
    assert.equal(result.status, 2);
    assert.match(result.stderr, /a.json.*tick.*non-negative safe integer/);
  }
});

test('names the file holding invalid fold inputs instead of reporting agreement', async (t) => {
  const f = await fixture(t);
  await f.write('a.json', bundle());
  const invalid = bundle();
  invalid.game.net.dispute.inputs.components[0].words.push(99);
  await f.write('b.json', invalid);
  const result = f.run();
  assert.equal(result.status, 2);
  assert.match(result.stderr, /b.json.*words.*one word per entity/);
  assert.equal(result.stdout, '');
});

test('reports missing or stale builds and invalid command syntax as unusable', async (t) => {
  const f = await fixture(t);
  await rm(join(f.dist, 'index.js'));
  let result = f.run();
  assert.equal(result.status, 2);
  assert.match(result.stderr, /diag needs the workspace built/);
  await writeFile(join(f.dist, 'index.js'), 'export {};');
  result = f.run();
  assert.equal(result.status, 2);
  assert.match(result.stderr, /older than this tool/);
  for (const args of [[], ['diff', 'a.json'], ['diff', 'a.json', 'b.json', 'c.json'], ['other']]) {
    result = f.run(args);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /usage: npm run diag/);
  }
});
