import type { WorldSnapshot } from '@open-northland/sim';
import type { GhostSource } from '../../data/fog/index.js';
import type { Viewport } from '../../data/projection/index.js';
import type { SpriteScene } from '../../data/scene/index.js';
import type { ElevationField } from '../../data/terrain/index.js';

/** The frame fields the scene build is a pure function of; alpha, camera and highlight act after the
 *  build, so they are not key material. */
export interface SceneFrameKey {
  readonly snapshot: WorldSnapshot;
  readonly viewport: Viewport;
  readonly elevation: ElevationField;
  readonly staticRefs?: ReadonlySet<number> | undefined;
  readonly withheldRefs?: ReadonlySet<number> | undefined;
  readonly fogVisible?: ((tileX: number, tileY: number) => boolean) | undefined;
  readonly fogEpoch?: number | undefined;
  readonly ghosts?: GhostSource | undefined;
  readonly portraitRef?: number | undefined;
  readonly portraitHouse?: number | undefined;
  readonly insetRefs?: readonly number[] | undefined;
}

/** {@link SceneFrameKey} flattened to identity/value comparisons. `staticCount` trips on in-place
 *  mutation of the live static-refs set, whose seam contract is shrink-only; `ghostsVersion` on the
 *  ghost source's in-place updates. */
interface StoredInputs {
  readonly snapshot: WorldSnapshot;
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
  readonly elevation: ElevationField;
  readonly staticRefs: ReadonlySet<number> | undefined;
  readonly staticCount: number;
  /** Keyed by identity: its owner hands a new set on every change. */
  readonly withheldRefs: ReadonlySet<number> | undefined;
  readonly fogVisible: SceneFrameKey['fogVisible'];
  readonly fogEpoch: number | undefined;
  readonly ghosts: GhostSource | undefined;
  readonly ghostsVersion: number | undefined;
  readonly portraitRef: number | undefined;
  readonly portraitHouse: number | undefined;
  /** Copied: the caller hands a new list every frame, so it keys by value. */
  readonly insetRefs: readonly number[];
}

/** Two ref lists hold the same refs in the same order. */
function sameRefs(a: readonly number[], b: readonly number[] | undefined): boolean {
  const other = b ?? [];
  return a.length === other.length && a.every((ref, index) => ref === other[index]);
}

/** A fog cull without an epoch has no change signal, so such a frame never keys the cache. */
function fogKeyed(frame: SceneFrameKey): boolean {
  return frame.fogVisible === undefined || frame.fogEpoch !== undefined;
}

/** One remembered scene build with the inputs it was built from. */
export class SpriteSceneCache {
  private inputs: StoredInputs | null = null;
  private scene: SpriteScene | null = null;

  /** The remembered scene while every key field is unchanged, else null. */
  lookup(frame: SceneFrameKey): SpriteScene | null {
    const c = this.inputs;
    const vp = frame.viewport;
    if (
      fogKeyed(frame) &&
      this.scene !== null &&
      c !== null &&
      c.snapshot === frame.snapshot &&
      c.minX === vp.minX &&
      c.minY === vp.minY &&
      c.maxX === vp.maxX &&
      c.maxY === vp.maxY &&
      c.elevation === frame.elevation &&
      c.staticRefs === frame.staticRefs &&
      c.staticCount === (frame.staticRefs?.size ?? 0) &&
      c.withheldRefs === frame.withheldRefs &&
      c.fogVisible === frame.fogVisible &&
      c.fogEpoch === frame.fogEpoch &&
      c.ghosts === frame.ghosts &&
      c.ghostsVersion === frame.ghosts?.version &&
      c.portraitRef === frame.portraitRef &&
      c.portraitHouse === frame.portraitHouse &&
      sameRefs(c.insetRefs, frame.insetRefs)
    ) {
      return this.scene;
    }
    return null;
  }

  /** Remember `scene` as `frame`'s build; an un-keyable frame clears the cache instead. */
  store(frame: SceneFrameKey, scene: SpriteScene): void {
    if (!fogKeyed(frame)) {
      this.clear();
      return;
    }
    const vp = frame.viewport;
    this.inputs = {
      snapshot: frame.snapshot,
      minX: vp.minX,
      minY: vp.minY,
      maxX: vp.maxX,
      maxY: vp.maxY,
      elevation: frame.elevation,
      staticRefs: frame.staticRefs,
      staticCount: frame.staticRefs?.size ?? 0,
      withheldRefs: frame.withheldRefs,
      fogVisible: frame.fogVisible,
      fogEpoch: frame.fogEpoch,
      ghosts: frame.ghosts,
      ghostsVersion: frame.ghosts?.version,
      portraitRef: frame.portraitRef,
      portraitHouse: frame.portraitHouse,
      insetRefs: [...(frame.insetRefs ?? [])],
    };
    this.scene = scene;
  }

  clear(): void {
    this.inputs = null;
    this.scene = null;
  }
}
