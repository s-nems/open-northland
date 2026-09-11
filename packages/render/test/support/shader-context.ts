import { DOMAdapter } from 'pixi.js';
import { afterAll, beforeAll, vi } from 'vitest';

/** Mesh structure tests compile shader metadata without creating a GPU context. */
export function useHeadlessShaderContext(): void {
  const adapter = DOMAdapter.get();
  let restore: (() => void) | undefined;
  beforeAll(() => {
    const spy = vi
      .spyOn(adapter, 'createCanvas')
      .mockReturnValue({ getContext: () => null } as unknown as HTMLCanvasElement);
    restore = () => spy.mockRestore();
  });
  afterAll(() => restore?.());
}
