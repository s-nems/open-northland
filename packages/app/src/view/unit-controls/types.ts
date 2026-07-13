import type { ContentSet } from '@open-northland/data';
import type { Camera, ElevationField, EntityBounds, SpriteSheet } from '@open-northland/render';
import type { Command, WorldSnapshot } from '@open-northland/sim';
import type { Application } from 'pixi.js';
import type { PickerEntry } from '../../catalog/professions.js';
import type { PortraitBox } from '../../hud/details-panel/index.js';

export interface UnitControlsOptions {
  readonly app: Application;
  readonly canvas: HTMLCanvasElement;
  readonly uiscale?: number;
  readonly camera: () => Camera;
  readonly snapshot: () => WorldSnapshot;
  readonly mapSize: { readonly width: number; readonly height: number };
  readonly elevation?: ElevationField;
  readonly humanPlayer: number;
  readonly professions: readonly PickerEntry[];
  readonly content: ContentSet;
  readonly sheet?: SpriteSheet;
  readonly enqueue: (command: Command) => void;
  readonly boundsOf?: (ref: number) => EntityBounds | undefined;
  readonly pixelHitOf?: (ref: number, wx: number, wy: number) => boolean | undefined;
  readonly claimPointer?: (clientX: number, clientY: number) => boolean;
  readonly fogVisible?: (tileX: number, tileY: number) => boolean;
  readonly tooltip?: {
    show(clientX: number, clientY: number, text: string): void;
    hide(): void;
  };
}

export interface UnitControls {
  readonly selectedIds: () => ReadonlySet<number>;
  readonly portrait: () => PortraitBox | null;
  readonly flaggedFlagIds: () => ReadonlySet<number>;
  readonly tick: (snapshot: WorldSnapshot) => void;
  readonly claimsPointer: (clientX: number, clientY: number) => boolean;
  readonly dispose: () => void;
}
