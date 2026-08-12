import { describe, expect, it, vi } from 'vitest';
import { createSettingsDisplayMode } from '../src/view/settings-display-mode.js';

describe('createSettingsDisplayMode', () => {
  it('applies the latest request after an older fullscreen request finishes', async () => {
    let finishEnter = (): void => undefined;
    const entered = new Promise<void>((resolve) => {
      finishEnter = resolve;
    });
    let fullscreen = false;
    const commit = vi.fn(async () => true);
    const settled = vi.fn();
    const display = createSettingsDisplayMode({
      current: () => (fullscreen ? 'fullscreen' : 'window'),
      enter: async () => {
        await entered;
        fullscreen = true;
      },
      leave: async () => {
        fullscreen = false;
      },
      commit,
      onSettled: settled,
    });

    display.request('fullscreen');
    display.request('window');
    finishEnter();
    await vi.waitFor(() => expect(settled).toHaveBeenCalledOnce());

    expect(fullscreen).toBe(false);
    expect(commit).toHaveBeenCalledOnce();
    expect(commit).toHaveBeenCalledWith('window');
  });

  it('lets a later restore-to-window supersede a pending fullscreen request', async () => {
    let finishEnter = (): void => undefined;
    const entered = new Promise<void>((resolve) => {
      finishEnter = resolve;
    });
    let fullscreen = false;
    const commit = vi.fn(async () => true);
    const settled = vi.fn();
    const display = createSettingsDisplayMode({
      current: () => (fullscreen ? 'fullscreen' : 'window'),
      enter: async () => {
        await entered;
        fullscreen = true;
      },
      leave: async () => {
        fullscreen = false;
      },
      commit,
      onSettled: settled,
    });

    display.request('fullscreen');
    await Promise.resolve();
    display.request('window');
    finishEnter();
    await vi.waitFor(() => expect(settled).toHaveBeenCalledOnce());

    expect(fullscreen).toBe(false);
    expect(commit).toHaveBeenLastCalledWith('window');
  });

  it('does not persist a fullscreen request the browser denied', async () => {
    const commit = vi.fn(async () => true);
    const settled = vi.fn();
    const display = createSettingsDisplayMode({
      current: () => 'window',
      enter: async () => undefined,
      leave: async () => undefined,
      commit,
      onSettled: settled,
    });

    display.request('fullscreen');
    await vi.waitFor(() => expect(settled).toHaveBeenCalledOnce());

    expect(commit).not.toHaveBeenCalled();
  });

  it('can reserve a later intent without applying it until its transaction succeeds', async () => {
    let finishEnter = (): void => undefined;
    const entered = new Promise<void>((resolve) => {
      finishEnter = resolve;
    });
    let fullscreen = false;
    const commit = vi.fn(async () => true);
    const settled = vi.fn();
    const display = createSettingsDisplayMode({
      current: () => (fullscreen ? 'fullscreen' : 'window'),
      enter: async () => {
        await entered;
        fullscreen = true;
      },
      leave: async () => {
        fullscreen = false;
      },
      commit,
      onSettled: settled,
    });

    display.request('fullscreen');
    const restore = display.reserve('window');
    finishEnter();
    await vi.waitFor(() => expect(fullscreen).toBe(true));
    expect(fullscreen).toBe(true);
    expect(commit).not.toHaveBeenCalled();
    restore.apply();
    await vi.waitFor(() => expect(settled).toHaveBeenCalledOnce());

    expect(fullscreen).toBe(false);
    expect(commit).toHaveBeenLastCalledWith('window');
  });

  it('cancels a reserved intent when its transaction fails', async () => {
    let finishEnter = (): void => undefined;
    const entered = new Promise<void>((resolve) => {
      finishEnter = resolve;
    });
    let fullscreen = false;
    const leave = vi.fn(async () => {
      fullscreen = false;
    });
    const commit = vi.fn(async () => true);
    const settled = vi.fn();
    const display = createSettingsDisplayMode({
      current: () => (fullscreen ? 'fullscreen' : 'window'),
      enter: async () => {
        await entered;
        fullscreen = true;
      },
      leave,
      commit,
      onSettled: settled,
    });

    display.request('fullscreen');
    const restore = display.reserve('window');
    finishEnter();
    await vi.waitFor(() => expect(fullscreen).toBe(true));
    expect(leave).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
    restore.cancel();
    await vi.waitFor(() => expect(settled).toHaveBeenCalledOnce());

    expect(fullscreen).toBe(true);
    expect(leave).not.toHaveBeenCalled();
    expect(commit).toHaveBeenCalledWith('fullscreen');
  });

  it('does not apply a reservation superseded by a later explicit request', async () => {
    let fullscreen = false;
    const commit = vi.fn(async () => true);
    const settled = vi.fn();
    const display = createSettingsDisplayMode({
      current: () => (fullscreen ? 'fullscreen' : 'window'),
      enter: async () => {
        fullscreen = true;
      },
      leave: async () => {
        fullscreen = false;
      },
      commit,
      onSettled: settled,
    });

    const restore = display.reserve('window');
    display.request('fullscreen');
    restore.apply();
    await vi.waitFor(() => expect(settled).toHaveBeenCalledOnce());

    expect(fullscreen).toBe(true);
    expect(commit).toHaveBeenLastCalledWith('fullscreen');
  });

  it('does not persist window when a reserved exit from fullscreen was denied', async () => {
    const commit = vi.fn(async () => true);
    const settled = vi.fn();
    const display = createSettingsDisplayMode({
      current: () => 'fullscreen',
      enter: async () => undefined,
      leave: async () => undefined,
      commit,
      onSettled: settled,
    });

    const restore = display.reserve('window');
    restore.apply();
    await vi.waitFor(() => expect(settled).toHaveBeenCalledOnce());

    expect(commit).not.toHaveBeenCalled();
  });
});
