import { readFile } from 'node:fs/promises';
import { errorMessage } from '../log.js';
import { parseNewsBytes } from './document.js';

/** `node packages/api/dist/news/check.js <file>`: judges a news file as the server would. */
const path = process.argv[2];
if (path === undefined) {
  process.stderr.write('usage: check.js <news.json>\n');
  process.exit(1);
}
try {
  const result = parseNewsBytes(await readFile(path));
  if (result.ok) {
    process.stdout.write(`ok: ${result.value.entries.length} entries\n`);
  } else {
    process.stderr.write(`${result.reason}\n`);
    process.exitCode = 1;
  }
} catch (error) {
  process.stderr.write(`${errorMessage(error)}\n`);
  process.exitCode = 1;
}
