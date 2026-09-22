/// <reference types="vite/client" />
import type { SettlerCharacter, SettlerCharacterSet, SpriteSheet } from '@open-northland/render';
import { Assets, type Texture } from 'pixi.js';
import type { ContentIr } from '../../content/ir/rows.js';
import type { GoodRef } from '../../content/settler-gfx/index.js';
import { diag } from '../../diag/index.js';
import { readStoredSettings } from '../../view/settings-store.js';
import {
  customCharacterAtlas,
  customCharacterBinding,
  customCharacterManifest,
  customCharacterShadowAtlas,
} from './character-manifest.js';
import { requestedCustomAppearance, selectCustomCharacters } from './character-selection.js';
import { characterContactShadow } from './character-shadow.js';

const manifests = import.meta.glob('../../assets/custom/characters/*/runtime.json', {
  eager: true,
  import: 'default',
});
const images = import.meta.glob<string>('../../assets/custom/characters/*/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
});

export async function loadCustomCharacters(
  base: SpriteSheet,
  ir: ContentIr | null,
  selected: string | null,
  goods: readonly GoodRef[],
): Promise<SettlerCharacterSet | undefined> {
  const smoothing = readStoredSettings().spriteSmoothing;
  const candidates = Object.entries(manifests)
    .map(([path, raw]) => ({ path, manifest: customCharacterManifest.parse(raw) }))
    .sort((a, b) => a.manifest.id.localeCompare(b.manifest.id));
  const requested = candidates.filter((candidate) =>
    requestedCustomAppearance(candidate.manifest.id, selected),
  );
  const looks = await Promise.all(
    requested.map(async ({ path, manifest }) => {
      try {
        const url = images[path.replace('runtime.json', 'atlas.png')];
        if (url === undefined) throw new Error('Missing character atlas');
        const texture = await Assets.load<Texture>(url);
        if (texture.width !== manifest.width || texture.height !== manifest.height)
          throw new Error('Character atlas dimensions mismatch');
        texture.source.scaleMode = smoothing ? (manifest.filtering ?? 'nearest') : 'nearest';
        const atlas = customCharacterAtlas(manifest);
        let shadow: ReturnType<typeof characterContactShadow> | undefined;
        if (manifest.shadow) {
          const shadowUrl = images[path.replace('runtime.json', manifest.shadow.sprite)];
          if (!shadowUrl) throw new Error('Missing character shadow atlas');
          const shadowTexture = await Assets.load<Texture>(shadowUrl);
          if (
            shadowTexture.width !== manifest.shadow.width ||
            shadowTexture.height !== manifest.shadow.height
          )
            throw new Error('Character shadow dimensions mismatch');
          shadowTexture.source.scaleMode = texture.source.scaleMode;
          const shadowAtlas = customCharacterShadowAtlas(manifest);
          if (!shadowAtlas) throw new Error('Missing character shadow layout');
          shadow = { source: shadowTexture.source, atlas: shadowAtlas };
        } else if (manifest.smoothMotion === true) shadow = characterContactShadow(atlas);
        return {
          id: manifest.id,
          body: {
            source: texture.source,
            atlas,
            ...(shadow ? { shadow } : {}),
          },
          binding: customCharacterBinding(manifest, goods),
          scale: manifest.scale,
          interpolateMotion: manifest.smoothMotion === true,
        };
      } catch (error) {
        diag.warn('content', `Custom character ${manifest.id}: ${String(error)}; using placeholder`);
        return null;
      }
    }),
  );
  const loaded = looks.filter((v) => v !== null);
  const binding = base.bindings.settler;
  const fallback: SettlerCharacter = {
    body: { source: base.source, atlas: base.atlas },
    binding: typeof binding === 'number' ? { idle: binding } : binding,
  };
  const selection = selectCustomCharacters(
    new Map(loaded.map((look) => [look.id, look])),
    fallback,
    selected,
  );
  if (selection === undefined) return undefined;
  const animalTribes = new Set(
    (ir?.animals ?? []).flatMap((a) => (a.tribeType === undefined ? [] : [a.tribeType])),
  );
  return {
    ...selection,
    animals: {
      tribes: animalTribes,
      byTribe: Object.fromEntries([...animalTribes].map((t) => [t, fallback])),
    },
  };
}
