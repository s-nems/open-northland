import { createHash } from 'node:crypto';
import { readdir, readFile, realpath } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { normalizePath, type Plugin, transformWithOxc } from 'vite';

const alias = '@own-art-preview';
const sha256 = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');

async function filesIn(root: string, prefix = ''): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  for (const entry of await readdir(resolve(root, prefix), { withFileTypes: true })) {
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) throw new Error(`Preview symlink is not allowed: ${name}`);
    if (entry.isDirectory()) Object.assign(files, await filesIn(root, name));
    else if (entry.isFile() && /\.(png|json)$/.test(name))
      files[name] = sha256(await readFile(resolve(root, name)));
    else throw new Error(`Unexpected preview file: ${name}`);
  }
  return files;
}

function fingerprint(files: Record<string, unknown>): string {
  return sha256(JSON.stringify(Object.entries(files).sort(([a], [b]) => a.localeCompare(b))));
}

export async function artPreviewPlugin(repoRoot: string, configuredPath: string): Promise<Plugin> {
  const root = await realpath(repoRoot);
  const preview = resolve(root, configuredPath);
  const local = normalizePath(relative(root, preview));
  const match = /^\.art-build\/([a-z0-9][a-z0-9-]*(?:\/[a-z0-9][a-z0-9-]*)*)\/preview\/own$/.exec(local);
  if (!match || normalizePath(await realpath(preview)) !== normalizePath(preview))
    throw new Error('ART_CANDIDATE must point to .art-build/<id>/preview/own; run art preview first');
  const report: unknown = JSON.parse(await readFile(resolve(preview, '../report.json'), 'utf8'));
  if (
    typeof report !== 'object' ||
    report === null ||
    !('version' in report) ||
    report.version !== 1 ||
    !('id' in report) ||
    report.id !== match[1] ||
    !('files' in report) ||
    typeof report.files !== 'object' ||
    report.files === null ||
    !('digest' in report) ||
    typeof report.digest !== 'string' ||
    fingerprint(report.files as Record<string, unknown>) !== report.digest ||
    fingerprint(await filesIn(preview)) !== report.digest
  )
    throw new Error('Preview bytes or report changed; run art preview again');
  const ownRoot = normalizePath(resolve(root, 'packages/app/src/assets/own'));
  const sourceRoot = `${normalizePath(resolve(root, 'packages/app/src'))}/`;
  return {
    name: 'opennorthland-art-preview',
    apply: 'serve',
    enforce: 'pre',
    config: () => ({ resolve: { alias: { [alias]: normalizePath(preview) } } }),
    configureServer(server) {
      server.config.logger.info(`Art candidate: ${match[1]} (${report.digest}); restart after art preview`);
    },
    async transform(code, id) {
      id = normalizePath(id);
      if (!id.startsWith(sourceRoot) || !/\.ts$/.test(id) || !code.includes('assets/own')) return;
      code = (await transformWithOxc(code, id)).code;
      const source = this.parse(code);
      const edits: { start: number; end: number; value: string }[] = [];
      function visit(node: unknown): void {
        if (typeof node !== 'object' || node === null) return;
        if (
          'type' in node &&
          node.type === 'Literal' &&
          'value' in node &&
          typeof node.value === 'string' &&
          node.value.startsWith('.') &&
          'start' in node &&
          typeof node.start === 'number' &&
          'end' in node &&
          typeof node.end === 'number'
        ) {
          const path = normalizePath(resolve(dirname(id), node.value));
          if (path.startsWith(`${ownRoot}/`)) {
            const target = `${alias}/${normalizePath(relative(ownRoot, path))}`;
            edits.push({ start: node.start, end: node.end, value: JSON.stringify(target) });
          }
        }
        for (const value of Object.values(node)) visit(value);
      }
      visit(source);
      for (const edit of edits.sort((a, b) => b.start - a.start))
        code = code.slice(0, edit.start) + edit.value + code.slice(edit.end);
      return edits.length ? { code, map: null } : undefined;
    },
  };
}
