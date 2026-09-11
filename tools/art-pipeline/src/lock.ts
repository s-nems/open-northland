import { mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { json, writeJson } from './files.js';
export async function lock(path: string) {
  await mkdir(dirname(path), { recursive: true });
  await mkdir(path).catch(() => {
    throw new Error(`Operation locked: ${path}`);
  });
  try {
    await writeJson(join(path, 'owner.json'), { pid: process.pid });
  } catch (error) {
    await rm(path, { recursive: true, force: true });
    throw error;
  }
  return async () => {
    await rm(path, { recursive: true, force: true });
  };
}
export async function assertStopped(path: string) {
  const owner = z.object({ pid: z.number().int().positive() }).parse(await json(join(path, 'owner.json')));
  try {
    process.kill(owner.pid, 0);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ESRCH') return;
    throw error;
  }
  throw new Error(`Process ${owner.pid} is still running; recovery cannot interrupt it`);
}
