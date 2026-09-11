import type { Container } from 'pixi.js';

export interface GalleryPreviewState {
  readonly zoom: 1 | 2;
  readonly direction: number;
  readonly clip: string;
  readonly playing: boolean;
  readonly speed: number;
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
