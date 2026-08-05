import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createWebHost, type WebHostOptions } from '../src/host.js';

interface Fixture {
  readonly root: string;
}

let fixture: Fixture;
let server: Server | undefined;

async function makeFixture(): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), 'open-northland-web-host-'));
  await mkdir(join(root, 'assets'), { recursive: true });
  await mkdir(join(root, 'maps'), { recursive: true });
  await writeFile(join(root, 'index.html'), '<!doctype html><title>web host fixture</title>');
  await writeFile(join(root, 'assets', 'entry-abc.js'), 'export const ready = true;\n'.repeat(80));
  await writeFile(join(root, 'ir.json'), JSON.stringify({ manifest: { version: 1 } }));
  await writeFile(join(root, 'maps', 'demo.json'), JSON.stringify({ width: 1, height: 1 }));
  return { root };
}

async function listen(options: WebHostOptions): Promise<string> {
  server = createWebHost(options);
  await new Promise<void>((resolve, reject) => {
    server?.once('error', reject);
    server?.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('expected TCP listener');
  return `http://127.0.0.1:${(address as AddressInfo).port}`;
}

beforeEach(async () => {
  fixture = await makeFixture();
});

afterEach(async () => {
  if (server !== undefined) {
    await new Promise<void>((resolve, reject) => {
      server?.close((error) => (error === undefined ? resolve() : reject(error)));
    });
    server = undefined;
  }
  await rm(fixture.root, { recursive: true, force: true });
});

describe('production web host', () => {
  it('serves the app root and build assets', async () => {
    const origin = await listen({ ...fixture, basePath: '/game' });

    const page = await fetch(`${origin}/game?scene=sandbox`);
    const asset = await fetch(`${origin}/game/assets/entry-abc.js`);
    const outside = await fetch(`${origin}/assets/entry-abc.js`);

    expect(page.status).toBe(200);
    expect(page.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(await page.text()).toContain('web host fixture');
    expect(asset.status).toBe(200);
    expect(outside.status).toBe(404);
  });

  it('serves content files and computed indexes through the shared resolver', async () => {
    const origin = await listen({ ...fixture, basePath: '/game' });

    const ir = await fetch(`${origin}/game/ir.json`);
    const maps = await fetch(`${origin}/game/maps-index`);

    expect(ir.status).toBe(200);
    expect(await ir.json()).toEqual({ manifest: { version: 1 } });
    expect(await maps.json()).toEqual([{ id: 'demo', minimap: false }]);
  });

  it('answers HEAD without a body and rejects unsupported methods', async () => {
    const origin = await listen({ ...fixture, basePath: '/' });

    const head = await fetch(`${origin}/ir.json`, { method: 'HEAD' });
    const post = await fetch(`${origin}/`, { method: 'POST' });

    expect(head.status).toBe(200);
    expect(await head.text()).toBe('');
    expect(post.status).toBe(405);
    expect(post.headers.get('allow')).toBe('GET, HEAD');
  });

  it('keeps missing content routes from falling through to the app page', async () => {
    const origin = await listen({ ...fixture, basePath: '/' });

    const response = await fetch(`${origin}/maps/missing.json`);

    expect(response.status).toBe(404);
    expect(await response.text()).toBe('not found');
  });

  it('reports required content as unavailable when the mount is incomplete', async () => {
    await rm(join(fixture.root, 'ir.json'));
    const origin = await listen({ ...fixture, basePath: '/' });

    const response = await fetch(`${origin}/healthz`);

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: 'unavailable', app: 'ready', content: 'missing' });
  });
});
