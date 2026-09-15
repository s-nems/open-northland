import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveShellRoots } from '../src/paths.js';

// Expectations go through `join`/`resolve` too: Windows adds a drive letter and backslashes.
describe('resolveShellRoots', () => {
  const resourcesPath = resolve('/Applications/OpenNorthland.app/Contents/Resources');
  const repoRoot = resolve('/checkout');

  it('serves a packaged app from its resources, whatever the environment says', () => {
    const roots = resolveShellRoots({
      packaged: true,
      resourcesPath,
      repoRoot,
      contentDirOverride: resolve('/elsewhere'),
    });
    expect(roots).toEqual({
      appRoot: join(resourcesPath, 'app'),
      contentRoot: join(resourcesPath, 'content'),
    });
  });

  it("serves a dev run from the checkout's builds", () => {
    const roots = resolveShellRoots({
      packaged: false,
      resourcesPath: resolve('/electron/resources'),
      repoRoot,
      contentDirOverride: undefined,
    });
    expect(roots).toEqual({
      appRoot: join(repoRoot, 'packages', 'app', 'dist'),
      contentRoot: join(repoRoot, 'content'),
    });
  });

  it('takes the content override as absolute or repo-relative, like Vite', () => {
    const base = { packaged: false, resourcesPath: resolve('/electron/resources'), repoRoot };
    const absolute = resolve('/tmp/out');
    expect(resolveShellRoots({ ...base, contentDirOverride: absolute }).contentRoot).toBe(absolute);
    expect(resolveShellRoots({ ...base, contentDirOverride: 'out/fresh' }).contentRoot).toBe(
      join(repoRoot, 'out', 'fresh'),
    );
  });
});
