import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ignoredDirectories = new Set(['.git', 'content', 'coverage', 'dist', 'node_modules']);
const failures = [];

async function markdownFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await markdownFiles(path)));
    else if (entry.isFile() && entry.name.endsWith('.md')) files.push(path);
  }
  return files;
}

function withoutFencedCode(markdown) {
  return markdown.replace(/^```[\s\S]*?^```\s*$/gm, '');
}

function displayPath(path) {
  return relative(repoRoot, path).replaceAll('\\', '/');
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function localTarget(target) {
  const trimmed = target.trim().replace(/^<|>$/g, '');
  if (/^(?:https?:|mailto:|data:|#)/i.test(trimmed)) return null;
  const pathOnly = trimmed.split('#', 1)[0].split('?', 1)[0];
  if (pathOnly.length === 0 || pathOnly.includes('<')) return null;
  return decodeURIComponent(pathOnly);
}

async function checkLinks(path, markdown) {
  const content = withoutFencedCode(markdown);
  const links = content.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g);
  for (const match of links) {
    const target = localTarget(match[1]);
    if (target === null) continue;
    const resolved = target.startsWith('/')
      ? resolve(repoRoot, `.${target}`)
      : resolve(dirname(path), target);
    if (!(await exists(resolved))) {
      failures.push(`${displayPath(path)}: broken local link '${match[1]}'`);
    }
  }
}

function ticketDependencyTargets(path, markdown) {
  const targets = [];
  const content = withoutFencedCode(markdown);
  const lines = content.split('\n');
  for (let index = 0; index < lines.length; index++) {
    if (!lines[index].includes('Blocked by:')) continue;
    const paragraph = [];
    for (let cursor = index; cursor < lines.length && lines[cursor].trim() !== ''; cursor++) {
      paragraph.push(lines[cursor]);
    }
    const text = paragraph.join(' ');
    const paragraphTargets = [];
    for (const match of text.matchAll(/\[[^\]]+\]\(([^)]+\.md(?:#[^)]+)?)\)/g))
      paragraphTargets.push(match[1]);
    for (const match of text.matchAll(/`(docs\/tickets\/[^`]+\.md)`/g)) paragraphTargets.push(match[1]);
    for (const match of text.matchAll(/(?<![`(])\b(docs\/tickets\/[A-Za-z0-9_./-]+\.md)\b/g)) {
      paragraphTargets.push(match[1]);
    }
    if (paragraphTargets.length === 0) failures.push(`${displayPath(path)}: 'Blocked by' has no ticket path`);
    targets.push(...paragraphTargets);
  }
  return [...new Set(targets)];
}

async function checkTicket(path, markdown) {
  const content = withoutFencedCode(markdown);
  const header = content.split('\n').slice(0, 12).join('\n');
  const firstLine = content.split('\n').find((line) => line.trim().length > 0);
  if (firstLine === undefined || !/^# [^#]/.test(firstLine)) {
    failures.push(`${displayPath(path)}: ticket must start with one H1 title`);
  }
  if (!/\*\*Area:\*\*\s*\S/.test(header)) {
    failures.push(`${displayPath(path)}: missing Area metadata`);
  }
  if (!/\*\*Priority:\*\*\s*P[123](?=\s|[·,;)]|$)/.test(header)) {
    failures.push(`${displayPath(path)}: missing or invalid Priority metadata (expected P1, P2, or P3)`);
  }

  for (const target of ticketDependencyTargets(path, markdown)) {
    const pathOnly = target.split('#', 1)[0];
    const resolved = pathOnly.startsWith('docs/tickets/')
      ? resolve(repoRoot, pathOnly)
      : resolve(dirname(path), pathOnly);
    if (!(await exists(resolved))) {
      failures.push(`${displayPath(path)}: missing dependency '${target}'`);
    }
  }
}

function checkCommands(filesAndContent, packageJson) {
  const scripts = new Set(Object.keys(packageJson.scripts ?? {}));
  for (const [path, markdown] of filesAndContent) {
    if (displayPath(path).startsWith('docs/tickets/')) continue;
    for (const match of markdown.matchAll(/\bnpm run ([A-Za-z0-9:_-]+)/g)) {
      if (!scripts.has(match[1]))
        failures.push(`${displayPath(path)}: unknown root npm script '${match[1]}'`);
    }
  }
}

const files = await markdownFiles(repoRoot);
const filesAndContent = await Promise.all(files.map(async (path) => [path, await readFile(path, 'utf8')]));
for (const [path, markdown] of filesAndContent) {
  await checkLinks(path, markdown);
  if (displayPath(path).startsWith('docs/tickets/') && displayPath(path) !== 'docs/tickets/README.md') {
    await checkTicket(path, markdown);
  }
}

const packageJson = JSON.parse(await readFile(resolve(repoRoot, 'package.json'), 'utf8'));
checkCommands(filesAndContent, packageJson);

if (failures.length > 0) {
  console.error(`Documentation check failed with ${failures.length} problem(s):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`Documentation check passed (${files.length} Markdown files).`);
}
