import type { TextureSource } from 'pixi.js';

/**
 * Ground pages one mesh samples, so a chunk draws its pages in one call rather than one per page: each
 * vertex names its page in `aPage`, the fragment shader picks that page's sampler once (GLSL ES 3.00
 * indexes samplers by constants only) and hands it down as a parameter. Beside a mesh's own other
 * textures this stays under WebGL 2's guaranteed sixteen fragment texture units.
 */
export const PAGE_SAMPLER_SLOTS = 8;

export function pageSamplerDeclarations(): string {
  return Array.from({ length: PAGE_SAMPLER_SLOTS }, (_, i) => `  uniform sampler2D uPage${i};`).join('\n');
}

/** `statement` run with the fragment's page sampler in place of `$`, through one if-chain on `vPage`. */
export function pageChain(statement: string): string {
  return Array.from({ length: PAGE_SAMPLER_SLOTS }, (_, i) => {
    const guard = i < PAGE_SAMPLER_SLOTS - 1 ? `if (vPage < ${i}.5) ` : '';
    return `    ${i > 0 ? 'else ' : ''}${guard}{ ${statement.replace('$', String(i))} }`;
  }).join('\n');
}

/** The `uPage<i>` shader resources for `pages`; an unused slot binds the first page, so every declared
 *  sampler has a texture. */
export function pageSamplerResources(pages: readonly TextureSource[]): Record<string, TextureSource> {
  const [first] = pages;
  if (first === undefined || pages.length > PAGE_SAMPLER_SLOTS)
    throw new Error(`a paged mesh samples 1 to ${PAGE_SAMPLER_SLOTS} pages, not ${pages.length}`);
  const resources: Record<string, TextureSource> = {};
  for (let i = 0; i < PAGE_SAMPLER_SLOTS; i++) resources[`uPage${i}`] = pages[i] ?? first;
  return resources;
}
