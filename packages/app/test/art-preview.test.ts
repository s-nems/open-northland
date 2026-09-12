import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, createServer, normalizePath } from 'vite';
import { afterEach, describe, expect, it } from 'vitest';
import { artPreviewPlugin } from '../vite/art-preview.js';

const roots: string[] = [];
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==',
  'base64',
);
const hash = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex');
async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'own-art-preview-')));
  roots.push(root);
  const app = join(root, 'packages/app');
  const own = join(app, 'src/assets/own');
  const preview = join(root, '.art-build/terrain/sample/preview/own');
  async function put(path: string, data: string | Uint8Array) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, data);
  }
  await put(join(own, 'props/old/runtime.json'), JSON.stringify({ marker: 'committed-original' }));
  await put(join(own, 'props/old/image.png'), png);
  const files: Record<string, string> = {};
  for (const [name, content] of [
    ['props/old/runtime.json', JSON.stringify({ marker: 'candidate-overlay' })],
    ['props/old/image.png', png],
    ['props/new/image.png', png],
    ['terrain/new-mud.png', png],
    [
      'terrain/mud.json',
      JSON.stringify({
        sourceBasis: 'Synthetic fixture',
        materials: [
          {
            id: 'mud',
            image: 'new-mud.png',
            tint: [1, 1, 1],
            wear: 0,
            pages: [],
            names: [],
            transitions: [],
          },
        ],
      }),
    ],
    ['terrain/map-bindings.json', JSON.stringify({ sourceBasis: 'Synthetic legacy fixture', pages: [] })],
  ] as const) {
    await put(join(preview, name), content);
    files[name] = hash(content);
  }
  await put(
    join(preview, '../report.json'),
    JSON.stringify({
      version: 1,
      id: 'terrain/sample',
      files,
      digest: hash(JSON.stringify(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)))),
    }),
  );
  await put(
    join(app, 'src/main.ts'),
    `
import manifest from './assets/own/props/old/runtime.json';
const images = import.meta.glob('./assets/own/props/*/*.png', { eager: true, query: '?url', import: 'default' });
const url = new URL('./assets/own/props/old/image.png', import.meta.url).href;
globalThis.result = { manifest, images, url };`,
  );
  return { root, app, preview, own };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('candidate asset preview', () => {
  it('resolves static JSON, newly added glob entries and new URL from the overlay', async () => {
    const { root, app, preview } = await fixture();
    const plugin = await artPreviewPlugin(root, preview);
    const previewPath = normalizePath(preview);
    const previewUrl = `/@fs/${previewPath.replace(/^\//, '')}`;
    const server = await createServer({
      configFile: false,
      root: app,
      plugins: [plugin],
      logLevel: 'silent',
      server: { fs: { allow: [root] } },
      optimizeDeps: { noDiscovery: true },
    });
    try {
      const result = await server.transformRequest('/src/main.ts');
      expect(result?.code).toContain(`${previewPath}/props/new/image.png`);
      expect(result?.code).toContain(`${previewPath}/props/old/runtime.json`);
      expect(result?.code).toContain(`new URL("${previewUrl}/props/old/image.png"`);
      const manifest = await server.transformRequest(`${previewUrl}/props/old/runtime.json`);
      expect(manifest?.code).toContain('candidate-overlay');
    } finally {
      await server.close();
    }
  });

  it('loads a candidate-only terrain manifest and image through the actual material loader', async () => {
    const { root, app, preview } = await fixture();
    const folder = join(app, 'src/content/own-assets');
    await mkdir(folder, { recursive: true });
    await writeFile(
      join(folder, 'materials.ts'),
      await readFile(new URL('../src/content/own-assets/materials.ts', import.meta.url)),
    );
    const server = await createServer({
      configFile: false,
      root: app,
      plugins: [await artPreviewPlugin(root, preview)],
      resolve: {
        alias: {
          '@open-northland/art-contracts': fileURLToPath(
            import.meta.resolve('@open-northland/art-contracts'),
          ),
        },
      },
      logLevel: 'silent',
      server: { fs: { allow: [root] } },
      optimizeDeps: { noDiscovery: true },
    });
    try {
      const loaded = await server.ssrLoadModule('/src/content/own-assets/materials.ts');
      expect(loaded.ownTerrainMaterials).toEqual([
        {
          id: 'mud',
          image: 'new-mud.png',
          tint: [1, 1, 1],
          wear: 0,
          pages: [],
          names: [],
          transitions: [],
        },
      ]);
      expect(loaded.ownMaterialUrls.get('new-mud.png')).toContain('/terrain/new-mud.png');
    } finally {
      await server.close();
    }
  });

  it('serves candidate identity under the configured app base', async () => {
    const { root, app, preview } = await fixture();
    const server = await createServer({
      configFile: false,
      root: app,
      base: '/review/',
      plugins: [await artPreviewPlugin(root, preview)],
      logLevel: 'silent',
      server: { port: 0, host: '127.0.0.1' },
      optimizeDeps: { noDiscovery: true },
    });
    try {
      await server.listen();
      const address = server.httpServer?.address();
      if (!address || typeof address === 'string') throw new Error('Missing test server address');
      const response = await fetch(`http://127.0.0.1:${address.port}/review/__art-preview.json`);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ id: 'terrain/sample', digest: expect.any(String) });
    } finally {
      await server.close();
    }
  });

  it('leaves production bundles on the committed assets', async () => {
    const { root, app, preview, own } = await fixture();
    const result = await build({
      configFile: false,
      root: app,
      plugins: [await artPreviewPlugin(root, preview)],
      logLevel: 'silent',
      build: { write: false, minify: false, rollupOptions: { input: join(app, 'src/main.ts') } },
    });
    if (!('output' in result)) throw new Error('Expected a single output');
    const code = result.output.flatMap((item) => (item.type === 'chunk' ? [item.code] : [])).join('\n');
    expect(code).toContain('committed-original');
    expect(code).not.toContain('candidate-overlay');
    expect(code).not.toContain('props/new');
    expect(await readFile(join(own, 'props/old/runtime.json'), 'utf8')).toContain('committed-original');
  });

  it('rejects an edited preview and paths outside the prepared candidate tree', async () => {
    const { root, preview, own } = await fixture();
    await expect(artPreviewPlugin(root, own)).rejects.toThrow('ART_CANDIDATE');
    await writeFile(join(preview, 'props/old/image.png'), 'changed');
    await expect(artPreviewPlugin(root, preview)).rejects.toThrow('Preview bytes or report changed');
  });
});
