import type { Container } from 'pixi.js';
import type { AssetSet } from '../pack.js';
import type { GalleryZoom } from './state.js';

export interface GalleryPreviewState {
  readonly zoom: GalleryZoom;
  readonly direction: number;
  readonly clip: string;
  readonly playing: boolean;
  readonly speed: number;
  readonly time?: number;
  readonly frame?: number;
  readonly progress: number;
  readonly terrainView: 'atlas' | 'repeat';
  /** Building panels: draw the lattice, footprint cells, door and sign post over the art. */
  readonly geometry: boolean;
  /** Building panels: the delivered custom package, or the decoded original body it replaces. */
  readonly assets: AssetSet;
}

export interface PreviewPanel {
  readonly container: Container;
  readonly width: number;
  readonly height: number;
  /** Degradations worth a line in the status: missing content or a body the original does not have. */
  readonly notes?: readonly string[];
  update(state: GalleryPreviewState, seconds: number): void;
  destroy(): void;
}
