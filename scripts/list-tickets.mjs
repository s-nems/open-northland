import { execFileSync } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const ticketsRoot = join(repoRoot, 'docs', 'tickets');
const priorityRank = { P1: 1, P2: 2, P3: 3 };
const stateRank = { ready: 1, blocked: 2, 'needs-user': 3 };

const tickets = [];
for (const area of await readdir(ticketsRoot, { withFileTypes: true })) {
  if (!area.isDirectory()) continue;
  for (const name of await readdir(join(ticketsRoot, area.name))) {
    if (!name.endsWith('.md')) continue;
    const path = join(ticketsRoot, area.name, name);
    const markdown = await readFile(path, 'utf8');
    const title = /^# (.+)$/m.exec(markdown)?.[1] ?? name;
    const priority = /\*\*Priority:\*\*\s*(P[123])/.exec(markdown)?.[1] ?? 'P3';
    const owner = /\*\*Area:\*\*\s*([^·\n]+)/.exec(markdown)?.[1].trim() ?? area.name;
    const state = markdown.includes('**Needs user:**')
      ? 'needs-user'
      : markdown.includes('**Blocked by:**')
        ? 'blocked'
        : 'ready';
    tickets.push({ title, priority, owner, state, path: relative(repoRoot, path) });
  }
}

tickets.sort(
  (a, b) =>
    priorityRank[a.priority] - priorityRank[b.priority] ||
    stateRank[a.state] - stateRank[b.state] ||
    a.owner.localeCompare(b.owner) ||
    a.title.localeCompare(b.title),
);

for (const ticket of tickets) {
  console.log(`${ticket.priority}\t${ticket.state.padEnd(10)}\t${ticket.owner.padEnd(24)}\t${ticket.path}`);
  console.log(`  ${ticket.title}`);
}

const counts = new Map();
for (const ticket of tickets) counts.set(ticket.priority, (counts.get(ticket.priority) ?? 0) + 1);
console.log(
  `\n${tickets.length} tickets: P1 ${counts.get('P1') ?? 0}, P2 ${counts.get('P2') ?? 0}, P3 ${counts.get('P3') ?? 0}`,
);

try {
  const worktrees = execFileSync('git', ['worktree', 'list', '--porcelain'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  const current = execFileSync('git', ['branch', '--show-current'], {
    cwd: repoRoot,
    encoding: 'utf8',
  }).trim();
  const branches = [...worktrees.matchAll(/^branch refs\/heads\/(.+)$/gm)]
    .map((match) => match[1])
    .filter((branch) => branch !== 'main' && branch !== current);
  if (branches.length > 0) console.log(`Other worktree branches: ${branches.join(', ')}`);
} catch {
  // The ticket list remains useful outside a Git checkout.
}
