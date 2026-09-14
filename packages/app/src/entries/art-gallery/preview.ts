import { windowResolutionFor } from '@open-northland/render';
import { Application, Container, Text } from 'pixi.js';
import { VIKING_TRIBE } from '../../content/building-gfx/index.js';
import { loadBuildingSignGfx } from '../../content/building-signs.js';
import { loadIr } from '../../content/ir/load.js';
import { loadRuntimeRealContent } from '../../content/real-content.js';
import type { WorldTribes } from '../../game/world-tribes.js';
import { buildingGeometryIndex } from './building-geometry.js';
import type { GalleryCharacter, GalleryEntry } from './catalog.js';
import { loadOriginalBuildings } from './original-buildings.js';
import { type BuildingPreviewContext, buildingPreview } from './preview-building.js';
import { characterPreview } from './preview-character.js';
import { propPreview } from './preview-prop.js';
import type { GalleryPreviewState, PreviewPanel } from './preview-state.js';
import { terrainPreview } from './preview-terrain.js';
import { createPreviewViewport } from './preview-viewport.js';
import { GALLERY_COMPARISON_LIMIT } from './state.js';

export type { GalleryPreviewState } from './preview-state.js';

export interface GalleryPreviewOptions {
  readonly soilImage: string;
  readonly reference?: GalleryCharacter | undefined;
  /** The tribes the own building packages skin, so the anchors and original bodies resolve for those. */
  readonly buildingTribes?: WorldTribes | undefined;
}

/** A content load memoized on success only, so a transient fetch failure is retried by the next view. */
function once<T>(load: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | undefined;
  return () => {
    pending ??= load().catch((error: unknown) => {
      pending = undefined;
      throw error;
    });
    return pending;
  };
}

export async function createGalleryPreview(canvas: HTMLCanvasElement, options: GalleryPreviewOptions) {
  const app = new Application();
  await app.init({
    canvas,
    width: 640,
    height: 320,
    backgroundAlpha: 0,
    preference: 'webgl',
    antialias: false,
    resolution: windowResolutionFor(window.devicePixelRatio || 1, 1),
    autoStart: false,
  });
  const world = new Container();
  app.stage.addChild(world);
  const viewport = createPreviewViewport(canvas, app, world);
  let state: GalleryPreviewState = {
    zoom: 2,
    direction: 5,
    clip: 'idle',
    playing: true,
    speed: 1,
    progress: 100,
    terrainView: 'atlas',
    geometry: false,
    assets: 'own',
  };
  // Content-backed building context, loaded the first time a building view asks for it; the original
  // bodies separately, since they cost a civilization's building pages.
  const tribes = options.buildingTribes ?? [VIKING_TRIBE];
  const buildingContext = once(async (): Promise<Omit<BuildingPreviewContext, 'original'>> => {
    const [realContent, ir, signs] = await Promise.all([
      loadRuntimeRealContent(),
      loadIr(),
      loadBuildingSignGfx(),
    ]);
    return {
      geometryOf: buildingGeometryIndex(realContent?.content.buildings ?? [], ir, tribes),
      signs: signs?.byPlayer[0],
    };
  });
  const originalBodies = once(async () => loadOriginalBuildings(await loadIr(), tribes));
  let seconds = 0;
  let revision = 0;
  let destroyed = false;
  let panels: PreviewPanel[] = [];
  let labels: Text[] = [];
  let width = 640;
  let height = 320;
  function resize() {
    world.scale.set(state.zoom);
    const w = Math.ceil(width * state.zoom);
    const h = Math.ceil(height * state.zoom);
    viewport.resize(w, h);
  }
  function clear() {
    for (const panel of panels) panel.destroy();
    for (const label of labels) label.destroy();
    panels = [];
    labels = [];
  }
  app.ticker.add((ticker) => {
    if (state.playing) seconds += (Math.min(ticker.deltaMS, 100) / 1000) * state.speed;
    for (const panel of panels) panel.update(state, seconds);
  });
  app.start();
  return {
    /** Build the panels for `entries`; resolves to the panels' degradation notes for the status line. */
    async show(entries: readonly GalleryEntry[]): Promise<readonly string[]> {
      const current = ++revision;
      clear();
      const prepared: PreviewPanel[] = [];
      const notes: string[] = [];
      try {
        const wantsOriginal =
          state.assets === 'original' && entries.some((entry) => entry.kind === 'building');
        const original = wantsOriginal ? await originalBodies() : null;
        if (destroyed || revision !== current) return [];
        if (wantsOriginal && original === null) notes.push('Original bodies need local decoded content.');
        for (const entry of entries.slice(0, GALLERY_COMPARISON_LIMIT + 1)) {
          const panel =
            entry.kind === 'character'
              ? await characterPreview(entry)
              : entry.kind === 'building'
                ? await buildingPreview(entry, options.reference, { ...(await buildingContext()), original })
                : entry.kind === 'prop' || entry.kind === 'good'
                  ? await propPreview(entry)
                  : await terrainPreview(entry, app.renderer, options.soilImage);
          prepared.push(panel);
          if (destroyed || revision !== current) {
            for (const pending of prepared) pending.destroy();
            return [];
          }
        }
      } catch (error) {
        for (const panel of prepared) panel.destroy();
        throw error;
      }
      clear();
      panels = prepared;
      for (const panel of panels) notes.push(...(panel.notes ?? []));
      seconds = state.time ?? 0;
      const vertical = entries.some((entry) => entry.kind === 'material');
      width = 0;
      height = 0;
      const tallest = Math.max(0, ...panels.map((panel) => panel.height));
      for (const [i, panel] of panels.entries()) {
        const x = vertical ? 15 : width + 15;
        const y = vertical ? height + 35 : tallest - panel.height + 35;
        const label = new Text({
          text: entries[i]?.name ?? '',
          style: { fontSize: 13, fill: '#e8ddc4', stroke: { color: '#171c1b', width: 2 } },
        });
        label.position.set(x, y - 23);
        panel.container.position.set(x, y);
        world.addChild(panel.container, label);
        labels.push(label);
        width = vertical ? Math.max(width, panel.width + 30) : width + panel.width + 30;
        height = vertical ? height + panel.height + 60 : Math.max(height, panel.height + 60);
        panel.update(state, seconds);
      }
      width = Math.max(320, width);
      height = Math.max(160, height);
      resize();
      return notes;
    },
    time(): number {
      return seconds;
    },
    update(next: GalleryPreviewState): void {
      const zoomChanged = state.zoom !== next.zoom;
      if (state.clip !== next.clip || state.time !== next.time) seconds = next.time ?? 0;
      state = { ...next };
      for (const panel of panels) panel.update(state, seconds);
      if (zoomChanged) resize();
    },
    destroy(): void {
      destroyed = true;
      revision++;
      viewport.destroy();
      clear();
      app.destroy(false, { children: true });
    },
  };
}
