import type { Container } from 'pixi.js';
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
}

export interface PreviewPanel {
  readonly container: Container;
  readonly width: number;
  readonly height: number;
  update(state: GalleryPreviewState, seconds: number): void;
  destroy(): void;
}
