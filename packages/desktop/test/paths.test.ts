import { describe, expect, it } from 'vitest';
import { resolveShellRoots } from '../src/paths.js';

describe('resolveShellRoots', () => {
  it('serves a packaged app from its resources, whatever the environment says', () => {
    const roots = resolveShellRoots({
      packaged: true,
      resourcesPath: '/Applications/OpenNorthland.app/Contents/Resources',
      repoRoot: '/checkout',
      contentDirOverride: '/elsewhere',
    });
    expect(roots).toEqual({
      appRoot: '/Applications/OpenNorthland.app/Contents/Resources/app',
      contentRoot: '/Applications/OpenNorthland.app/Contents/Resources/content',
    });
  });

  it("serves a dev run from the checkout's builds", () => {
    const roots = resolveShellRoots({
      packaged: false,
      resourcesPath: '/electron/resources',
      repoRoot: '/checkout',
      contentDirOverride: undefined,
    });
    expect(roots).toEqual({ appRoot: '/checkout/packages/app/dist', contentRoot: '/checkout/content' });
  });

  it('takes the content override as absolute or repo-relative, like Vite', () => {
    const base = { packaged: false, resourcesPath: '/electron/resources', repoRoot: '/checkout' };
    expect(resolveShellRoots({ ...base, contentDirOverride: '/tmp/out' }).contentRoot).toBe('/tmp/out');
    expect(resolveShellRoots({ ...base, contentDirOverride: 'out/fresh' }).contentRoot).toBe(
      '/checkout/out/fresh',
    );
  });
});
