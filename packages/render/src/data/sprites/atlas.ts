export interface AtlasFrame {
  /** Pixel rect of the frame inside the atlas sheet (top-left origin). */
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** Source draw offset, added to the sprite's feet-anchor screen position. */
  readonly offsetX: number;
  readonly offsetY: number;
}

export interface SpriteAtlas {
  readonly width: number;
  readonly height: number;
  readonly frames: ReadonlyMap<number, AtlasFrame>;
}

/** A missing frame and a 0x0 frame (an empty bob) are both absent. */
export function lookupFrame(atlas: SpriteAtlas, id: number): AtlasFrame | null {
  const frame = atlas.frames.get(id);
  return frame === undefined || frame.width === 0 || frame.height === 0 ? null : frame;
}

export function indexAtlasFrames(
  width: number,
  height: number,
  manifestFrames: readonly {
    readonly bobId: number;
    readonly rect: {
      readonly x: number;
      readonly y: number;
      readonly width: number;
      readonly height: number;
    };
    readonly offsetX: number;
    readonly offsetY: number;
  }[],
): SpriteAtlas {
  const frames = new Map<number, AtlasFrame>();
  for (const f of manifestFrames) {
    frames.set(f.bobId, {
      x: f.rect.x,
      y: f.rect.y,
      width: f.rect.width,
      height: f.rect.height,
      offsetX: f.offsetX,
      offsetY: f.offsetY,
    });
  }
  return { width, height, frames };
}

/**
 * A manifest frame narrowed to its placement; the manifest's `type`/`opaque` describe the source bob,
 * not where it draws.
 */
export interface AtlasManifestFrame {
  readonly bobId: number;
  readonly rect: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
  readonly offsetX: number;
  readonly offsetY: number;
}

/**
 * The on-disk `<name>.atlas.json` a `.bmd` atlas build writes beside its PNG, re-declared structurally
 * so `render` never imports the build tool.
 */
export interface AtlasManifest {
  readonly width: number;
  readonly height: number;
  readonly frames: readonly AtlasManifestFrame[];
  /** `true` when the build emitted a sibling `<stem>.build.png` time sheet (the `'build-time'` bake). */
  readonly build?: boolean;
}

/**
 * CPU-side copy of a `<stem>.build.png` time sheet: row-major 0-255 per-pixel thresholds at atlas
 * coordinates, where a pixel appears once construction progress reaches its threshold. Values at
 * transparent atlas pixels are meaningless.
 */
export interface BuildTimeSheet {
  readonly width: number;
  readonly height: number;
  /** The sheet's R channel, `width * height` bytes. */
  readonly values: Uint8Array;
}

export function atlasFromManifest(manifest: AtlasManifest): SpriteAtlas {
  return indexAtlasFrames(manifest.width, manifest.height, manifest.frames);
}
