import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS, SEND_ONLY_CHANNELS } from '../src/ipc.js';
import { type IpcDeps, wireIpc } from '../src/ipc-handlers.js';

/**
 * Every invoke channel must refuse a sender outside the shell's own `app://` pages. The channels
 * come from `IPC_CHANNELS`, so one added without the guard fails here rather than in a packaged
 * build.
 */

const { registered } = vi.hoisted(() => ({
  registered: new Map<string, (event: unknown, ...args: unknown[]) => unknown>(),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown) {
      registered.set(channel, listener);
    },
  },
  dialog: {},
  Menu: {},
  shell: {},
  net: {},
  protocol: {},
  BrowserWindow: class {},
}));

const sendOnly = new Set<string>(SEND_ONLY_CHANNELS);
const invokeChannels = Object.values(IPC_CHANNELS).filter((c) => !sendOnly.has(c));

const DESKTOP_STATE = { dataRoot: '/data', portable: false, locale: 'eng', contentStatus: 'ready' };

const APP_FRAME = { senderFrame: { url: 'app://setup/setup.html' } };
const FOREIGN_FRAME = { senderFrame: { url: 'https://example.com/page' } };

/** The handler-side effects an off-origin call must never reach. */
let effects: { desktopState: ReturnType<typeof vi.fn>; pipelineStop: ReturnType<typeof vi.fn> };

beforeEach(() => {
  registered.clear();
  effects = { desktopState: vi.fn(() => DESKTOP_STATE), pipelineStop: vi.fn() };
  wireIpc({
    win: { isDestroyed: () => false, webContents: { send: () => {} }, loadURL: async () => {} },
    paths: {
      configFile: '/data/config.json',
      contentDir: '/data/content',
      modsDir: '/data/mods',
      // A never-created path, so the listSaves handler exercises its empty-folder branch for real.
      savesDir: join(tmpdir(), `on-ipc-test-saves-${process.pid}`),
      dataRoot: { path: '/data' },
    },
    state: {
      desktopState: effects.desktopState,
      availableModRoot: async () => undefined,
      contentStatus: async () => 'ready',
    },
    pipeline: { start: () => {}, stop: effects.pipelineStop },
  } as unknown as IpcDeps);
});

describe('wireIpc sender guard', () => {
  it('registers a handler for every invoke channel', () => {
    expect([...registered.keys()].sort()).toEqual([...invokeChannels].sort());
  });

  it.each(invokeChannels)('rejects an off-origin sender on %s', (channel) => {
    const handler = registered.get(channel);
    expect(handler).toBeDefined();
    expect(() => handler?.(FOREIGN_FRAME)).toThrow('IPC from an untrusted frame');
  });

  it.each(invokeChannels)('rejects a sender that reports no URL on %s', (channel) => {
    expect(() => registered.get(channel)?.({ senderFrame: undefined })).toThrow(
      'IPC from an untrusted frame',
    );
  });

  it('refuses an off-origin call without running the handler body', () => {
    expect(() => registered.get(IPC_CHANNELS.getState)?.(FOREIGN_FRAME)).toThrow();
    expect(() => registered.get(IPC_CHANNELS.stopPipeline)?.(FOREIGN_FRAME)).toThrow();
    expect(effects.desktopState).not.toHaveBeenCalled();
    expect(effects.pipelineStop).not.toHaveBeenCalled();
  });

  it('serves a shell page and passes the call through to the handler', () => {
    expect(registered.get(IPC_CHANNELS.getState)?.(APP_FRAME)).toEqual(DESKTOP_STATE);
    expect(effects.desktopState).toHaveBeenCalledOnce();
  });

  it("delivers the first invoke argument as the handler's first parameter", async () => {
    // The guard consumes the event; one left in front would fail the string check instead of
    // reaching the path probe.
    const probed = registered.get(IPC_CHANNELS.probeGamePath)?.(APP_FRAME, '/no/such/game/folder');
    await expect(probed).resolves.toMatchObject({ path: '/no/such/game/folder' });
  });

  it('still validates arguments behind the guard', async () => {
    expect(() => registered.get(IPC_CHANNELS.probeGamePath)?.(APP_FRAME, 42)).toThrow(
      'expected a string argument',
    );
    expect(() => registered.get(IPC_CHANNELS.setLocale)?.(APP_FRAME, 'klingon')).toThrow(
      'expected a supported locale',
    );
    await expect(registered.get(IPC_CHANNELS.saveGameFile)?.(APP_FRAME, 42, 'bytes')).rejects.toThrow(
      'expected a string argument',
    );
    await expect(
      registered.get(IPC_CHANNELS.saveGameFile)?.(APP_FRAME, 'a.json.gz', '{"header":{}}'),
    ).rejects.toThrow('expected save bytes');
  });

  it('refuses save names that could escape or litter the saves folder', async () => {
    const cases: Array<[string, unknown[]]> = [
      [IPC_CHANNELS.writeSave, ['sub/dir', new Uint8Array()]],
      [IPC_CHANNELS.writeSave, ['..\\up', new Uint8Array()]],
      [IPC_CHANNELS.writeSave, ['', new Uint8Array()]],
      [IPC_CHANNELS.readSave, ['../escape.json.gz']],
      [IPC_CHANNELS.deleteSave, ['a:b.json.gz']],
    ];
    for (const [channel, args] of cases) {
      await expect(registered.get(channel)?.(APP_FRAME, ...args)).rejects.toThrow(
        'expected a plain save name',
      );
    }
    // A clean name that is still not a file the listing could have produced.
    await expect(registered.get(IPC_CHANNELS.readSave)?.(APP_FRAME, 'notes.txt')).rejects.toThrow(
      'expected a save file name',
    );
    await expect(registered.get(IPC_CHANNELS.writeSave)?.(APP_FRAME, 'ok', '{}')).rejects.toThrow(
      'expected save bytes',
    );
  });

  it('lists no saves when the folder does not exist', async () => {
    await expect(registered.get(IPC_CHANNELS.listSaves)?.(APP_FRAME)).resolves.toEqual([]);
  });
});
