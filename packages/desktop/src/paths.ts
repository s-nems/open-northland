import { join, resolve } from 'node:path';

/** The `to:` names of the two `extraResources` entries in `electron-builder.yml`. */
const APP_RESOURCE_DIR = 'app';
const CONTENT_RESOURCE_DIR = 'content';

/** The env override Vite honours too: an absolute path or one relative to the repo root. */
export const CONTENT_DIR_ENV = 'ON_CONTENT_DIR';

export interface ShellRootInputs {
  readonly packaged: boolean;
  /** Electron's `process.resourcesPath`. */
  readonly resourcesPath: string;
  readonly repoRoot: string;
  readonly contentDirOverride: string | undefined;
}

export interface ShellRoots {
  /** The built web app (`packages/app/dist`). */
  readonly appRoot: string;
  /** The converted content tree the content routes serve from. */
  readonly contentRoot: string;
}

/** A packaged app carries both trees as resources; a dev run serves the checkout's own builds. */
export function resolveShellRoots(inputs: ShellRootInputs): ShellRoots {
  if (inputs.packaged) {
    return {
      appRoot: join(inputs.resourcesPath, APP_RESOURCE_DIR),
      contentRoot: join(inputs.resourcesPath, CONTENT_RESOURCE_DIR),
    };
  }
  return {
    appRoot: resolve(inputs.repoRoot, 'packages/app/dist'),
    contentRoot: resolve(inputs.repoRoot, inputs.contentDirOverride ?? 'content'),
  };
}
