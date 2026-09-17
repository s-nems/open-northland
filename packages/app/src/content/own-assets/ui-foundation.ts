/// <reference types="vite/client" />
import { type OwnUiManifest, ownUiManifest } from '@open-northland/art-contracts';

export type { OwnUiManifest } from '@open-northland/art-contracts';

const manifests = import.meta.glob('../../assets/own/ui/foundation/runtime.json', {
  eager: true,
  import: 'default',
});
const images = import.meta.glob<string>('../../assets/own/ui/foundation/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
});

/** The delivered HUD chrome pack with its image URLs, or null while the package is unpublished. */
export interface UiFoundationArt {
  readonly manifest: OwnUiManifest;
  readonly surfaceUrl: string;
  readonly iconsUrl: string;
}

export function uiFoundationArt(): UiFoundationArt | null {
  const entry = Object.entries(manifests)[0];
  if (entry === undefined) return null;
  const [path, raw] = entry;
  const manifest = ownUiManifest.parse(raw);
  const folder = path.slice(0, path.lastIndexOf('/') + 1);
  const surfaceUrl = images[`${folder}${manifest.surface.file}`];
  const iconsUrl = images[`${folder}${manifest.icons.file}`];
  if (surfaceUrl === undefined || iconsUrl === undefined)
    throw new Error('UI foundation manifest names an image that is not delivered');
  return { manifest, surfaceUrl, iconsUrl };
}

/** CSS background geometry that shows one named cell of the icon atlas in a box of `size` px. */
export function iconCellStyle(
  atlas: OwnUiManifest['icons'],
  name: string,
  size: number,
): { readonly backgroundSize: string; readonly backgroundPosition: string } | null {
  const index = atlas.names.indexOf(name);
  if (index < 0) return null;
  const scale = size / atlas.cell;
  const column = index % atlas.columns;
  const row = Math.floor(index / atlas.columns);
  return {
    backgroundSize: `${atlas.width * scale}px ${atlas.height * scale}px`,
    backgroundPosition: `${-column * size}px ${-row * size}px`,
  };
}
