import { readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { approve } from './approval.js';
import { buildAsset } from './build.js';
import { candidate } from './candidate.js';
import { loadAsset } from './catalog.js';
import { json } from './files.js';
import { assertStopped } from './lock.js';
import { preparePreview } from './preview.js';
import { publish } from './publish.js';
import { catalogSchema } from './recipe.js';
import { review } from './review.js';
import { recover } from './transaction.js';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const usage =
  'art list | build <id|all> | validate <id|all> | review <id> [--port 5188] | preview <id> [<id>...] | approve <id> --digest <hash> --reviewer <name> | publish <id> | recover [id]';
try {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: { port: { type: 'string' }, digest: { type: 'string' }, reviewer: { type: 'string' } },
  });
  const [command, id, ...extra] = positionals;
  if (extra.length && command !== 'preview') throw new Error(usage);
  if (command === 'list') {
    console.log(
      catalogSchema
        .parse(await json(resolve(root, 'docs/art/assets.json')))
        .assets.map((a) => a.id)
        .join('\n'),
    );
  } else if (command === 'recover') {
    if (id) {
      await loadAsset(root, id);
      const path = resolve(root, '.art-build', id, 'build.lock');
      await assertStopped(path);
      await rm(path, { recursive: true });
    } else await recover(root);
    console.log(
      id ? 'Abandoned build lock removed; rebuild the asset.' : 'Publication recovered; inspect Git diff.',
    );
  } else {
    if (!id) throw new Error(usage);
    if (command === 'build' || command === 'validate') {
      const ids =
        id === 'all'
          ? catalogSchema.parse(await json(resolve(root, 'docs/art/assets.json'))).assets.map((a) => a.id)
          : [id];
      for (const assetId of ids) {
        const result =
          command === 'build' ? await buildAsset(root, assetId) : (await candidate(root, assetId)).report;
        console.log(`${assetId}: ${Object.keys(result.files).length} files, ${result.digest}`);
      }
    } else if (command === 'preview') console.log(await preparePreview(root, [id, ...extra]));
    else if (command === 'publish') console.log(await publish(root, id));
    else if (command === 'approve') {
      if (!values.digest || !values.reviewer) throw new Error(usage);
      console.log(await approve(root, id, values.digest, values.reviewer));
    } else if (command === 'review') {
      const result = await review(root, id);
      console.log(result);
      if (values.port) {
        const port = Number(values.port);
        if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid review port');
        const bytes = await readFile(result.path);
        const server = createServer((_req, res) => {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(bytes);
        });
        server.listen(port, '127.0.0.1', () => console.log(`Review: http://127.0.0.1:${port}`));
      }
    } else throw new Error(usage);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
