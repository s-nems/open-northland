import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ignoredDirectories = new Set(['.git', 'content', 'coverage', 'dist', 'node_modules']);
const ticketReferenceFile = /\.(?:[cm]?[jt]sx?|json|ya?ml)$/;
const ticketAreas = new Set([
  'app',
  'audio',
  'content-resolver',
  'data',
  'desktop',
  'pipeline',
  'render',
  'sim',
  'tooling',
]);
const failures = [];

async function markdownFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await markdownFiles(path)));
    else if (entry.isFile() && entry.name.endsWith('.md') && !entry.name.endsWith('.local.md'))
      files.push(path);
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
  const [withQuery, anchor] = trimmed.split('#', 2);
  const pathOnly = withQuery.split('?', 1)[0];
  if (pathOnly.length === 0 || pathOnly.includes('<')) return null;
  return { path: decodeURIComponent(pathOnly), anchor };
}

function headingAnchor(heading) {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[`*_~]/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-');
}

function markdownAnchors(markdown) {
  const anchors = new Set();
  const counts = new Map();
  for (const heading of markdown.matchAll(/^#{1,6}\s+(.+)$/gm)) {
    const base = headingAnchor(heading[1]);
    const count = counts.get(base) ?? 0;
    anchors.add(count === 0 ? base : `${base}-${count}`);
    counts.set(base, count + 1);
  }
  return anchors;
}

async function checkLinks(path, markdown) {
  const content = withoutFencedCode(markdown);
  const links = content.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g);
  for (const match of links) {
    const target = localTarget(match[1]);
    if (target === null) continue;
    const resolved = target.path.startsWith('/')
      ? resolve(repoRoot, `.${target.path}`)
      : resolve(dirname(path), target.path);
    if (!(await exists(resolved))) {
      failures.push(`${displayPath(path)}: broken local link '${match[1]}'`);
      continue;
    }
    if (target.anchor !== undefined && resolved.endsWith('.md')) {
      const targetMarkdown = withoutFencedCode(await readFile(resolved, 'utf8'));
      const anchors = markdownAnchors(targetMarkdown);
      if (!anchors.has(target.anchor)) {
        failures.push(`${displayPath(path)}: missing anchor '#${target.anchor}' in '${match[1]}'`);
      }
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
  const h1Count = [...content.matchAll(/^# [^#].*$/gm)].length;
  if (firstLine === undefined || !/^# [^#]/.test(firstLine) || h1Count !== 1) {
    failures.push(`${displayPath(path)}: ticket must start with one H1 title`);
  }
  const areaText = /\*\*Area:\*\*\s*([^·\n]+)/.exec(header)?.[1].trim();
  if (areaText === undefined) {
    failures.push(`${displayPath(path)}: missing Area metadata`);
  } else {
    const areas = areaText.split(',').map((area) => area.trim());
    for (const area of areas) {
      if (!ticketAreas.has(area)) failures.push(`${displayPath(path)}: unknown Area '${area}'`);
    }
  }
  if (!/\*\*Priority:\*\*\s*P[123](?=\s|[·,;)]|$)/.test(header)) {
    failures.push(`${displayPath(path)}: missing or invalid Priority metadata (expected P1, P2, or P3)`);
  }
  if (!/^## Scope\s*$/m.test(content)) failures.push(`${displayPath(path)}: missing '## Scope' section`);
  if (!/^## Verify\s*$/m.test(content)) failures.push(`${displayPath(path)}: missing '## Verify' section`);

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

function checkTicketCycles(ticketDependencies) {
  const visiting = new Set();
  const visited = new Set();

  function visit(path, chain) {
    if (visiting.has(path)) {
      failures.push(`ticket dependency cycle: ${[...chain, path].map(displayPath).join(' -> ')}`);
      return;
    }
    if (visited.has(path)) return;
    visiting.add(path);
    for (const dependency of ticketDependencies.get(path) ?? []) visit(dependency, [...chain, path]);
    visiting.delete(path);
    visited.add(path);
  }

  for (const path of ticketDependencies.keys()) visit(path, []);
}

async function checkTicketReferences(filesAndContent) {
  for (const [path, content] of filesAndContent) {
    for (const match of content.matchAll(/\b(docs\/tickets\/[A-Za-z0-9_./-]+\.md)\b/g)) {
      const target = resolve(repoRoot, match[1]);
      if (!(await exists(target))) failures.push(`${displayPath(path)}: missing ticket '${match[1]}'`);
    }
  }
}

function checkCommands(filesAndContent, packageJson) {
  const scripts = new Set(Object.keys(packageJson.scripts ?? {}));
  for (const [path, markdown] of filesAndContent) {
    const checkedContent = displayPath(path).startsWith('docs/tickets/')
      ? (markdown.split(/^## Verify\s*$/m)[1] ?? '')
      : markdown;
    for (const match of checkedContent.matchAll(/\bnpm run ([A-Za-z0-9:_-]+)/g)) {
      if (!scripts.has(match[1]))
        failures.push(`${displayPath(path)}: unknown root npm script '${match[1]}'`);
    }
  }
}

const files = await markdownFiles(repoRoot);
const filesAndContent = await Promise.all(files.map(async (path) => [path, await readFile(path, 'utf8')]));
const ticketDependencies = new Map();
for (const [path, markdown] of filesAndContent) {
  await checkLinks(path, markdown);
  if (displayPath(path).startsWith('docs/tickets/') && displayPath(path) !== 'docs/tickets/README.md') {
    await checkTicket(path, markdown);
    const dependencies = ticketDependencyTargets(path, markdown).map((target) => {
      const pathOnly = target.split('#', 1)[0];
      return pathOnly.startsWith('docs/tickets/')
        ? resolve(repoRoot, pathOnly)
        : resolve(dirname(path), pathOnly);
    });
    ticketDependencies.set(path, dependencies);
  }
}
checkTicketCycles(ticketDependencies);

const referenceFiles = [];
const stack = [repoRoot];
while (stack.length > 0) {
  const current = stack.pop();
  for (const entry of await readdir(current, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const path = resolve(current, entry.name);
    if (entry.isDirectory()) stack.push(path);
    else if (entry.isFile() && ticketReferenceFile.test(entry.name)) {
      referenceFiles.push([path, await readFile(path, 'utf8')]);
    }
  }
}
await checkTicketReferences([...filesAndContent, ...referenceFiles]);

const packageJson = JSON.parse(await readFile(resolve(repoRoot, 'package.json'), 'utf8'));
checkCommands(filesAndContent, packageJson);

if (failures.length > 0) {
  console.error(`Documentation check failed with ${failures.length} problem(s):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`Documentation check passed (${files.length} Markdown files).`);
}
