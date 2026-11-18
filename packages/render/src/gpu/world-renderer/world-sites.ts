import { type ConstructionPlot, positionOfNode } from '@open-northland/sim';
import type { FogGhost, LiveSites, RememberedSites, Sight, SiteSignPlace } from '../../data/fog/index.js';
import { ONE } from '../../data/projection/index.js';
import type { ConstructionSign } from '../overlays/index.js';
import type { ConstructionPlotFrame } from '../placement/construction-plot.js';

const NO_PLOTS: readonly ConstructionPlot[] = [];
const NO_SIGNS: readonly ConstructionSign[] = [];

/** The drawn view as the sites read it; absent while the fog is off. */
export interface SiteFog {
  readonly sight: Sight;
  /** Whether the viewer watches a tile; answers change with `sight.revision`. */
  readonly seesTile: (tileX: number, tileY: number) => boolean;
  /** The drawn seat's memory; null while it has none. */
  readonly memory: RememberedSites | null;
}

/** What a memory-derived list was made from. */
interface MemoryKey {
  readonly memory: RememberedSites;
  readonly version: number;
}

function holds(key: MemoryKey | null, memory: RememberedSites): boolean {
  return key !== null && key.memory === memory && key.version === memory.version;
}

/** Whether the viewer watches a site's building, at the tile the building's own sprite is culled by. */
function seesBuilding(fog: SiteFog, anchor: ConstructionPlot['anchor']): boolean {
  const { x, y } = positionOfNode(anchor.col, anchor.row);
  return fog.seesTile(x / ONE, y / ONE);
}

/**
 * The construction sites' foundations and signs as the viewer sees and remembers them. Each follows its
 * building whole, as the building's sprite does: live while the viewer watches the building, then as
 * the fog memory froze it with the remembered site, so a vision edge crossing a site never cuts it.
 * The live foundation layer draws above the fog wash and the remembered one under it, which greys it
 * like the ground. Each list comes back as the same array until its sites, the sight or the memory
 * change.
 */
export class WorldSites implements LiveSites {
  private plots: readonly ConstructionPlot[] = NO_PLOTS;
  private signs: readonly ConstructionSign[] = NO_SIGNS;
  private plotByRef: Map<number, ConstructionPlot> | null = null;
  private signById: Map<number, ConstructionSign> | null = null;

  private seenPlotsOf: readonly ConstructionPlot[] | null = null;
  private seenPlotsRevision = 0;
  private seenPlots: readonly ConstructionPlot[] = NO_PLOTS;
  private seenSignsOf: { signs: readonly ConstructionSign[]; plots: readonly ConstructionPlot[] } | null =
    null;
  private seenSignsRevision = 0;
  private seenSigns: readonly ConstructionSign[] = NO_SIGNS;
  private memoryPlotsKey: MemoryKey | null = null;
  private memoryPlots: readonly ConstructionPlotFrame[] = [];
  private memorySignsKey: MemoryKey | null = null;
  private memorySigns: readonly ConstructionSign[] = NO_SIGNS;
  private drawn: { seen: readonly ConstructionSign[]; remembered: readonly ConstructionSign[] } | null = null;
  private drawnSigns: readonly ConstructionSign[] = NO_SIGNS;
  private readonly siteScratch: FogGhost[] = [];

  /** The live sites' foundations, every one, wherever it lies. */
  setPlots(plots: readonly ConstructionPlot[]): void {
    if (plots === this.plots) return;
    this.plots = plots;
    this.plotByRef = null;
  }

  /** The live sites' signs, every one, wherever it stands. */
  setSigns(signs: readonly ConstructionSign[]): void {
    if (signs === this.signs) return;
    this.signs = signs;
    this.signById = null;
  }

  plotOf(ref: number): ConstructionPlot | undefined {
    this.plotByRef ??= new Map(this.plots.map((plot) => [plot.ref, plot]));
    return this.plotByRef.get(ref);
  }

  signOf(ref: number): SiteSignPlace | undefined {
    this.signById ??= new Map(this.signs.map((sign) => [sign.id, sign]));
    return this.signById.get(ref);
  }

  /** The live foundations of the buildings in sight. */
  livePlots(fog: SiteFog | undefined): readonly ConstructionPlot[] {
    if (fog === undefined) return this.plots;
    if (this.seenPlotsOf !== this.plots || this.seenPlotsRevision !== fog.sight.revision) {
      this.seenPlotsOf = this.plots;
      this.seenPlotsRevision = fog.sight.revision;
      this.seenPlots = this.plots.filter((plot) => seesBuilding(fog, plot.anchor));
    }
    return this.seenPlots;
  }

  /** The remembered foundations of the sites drawn from memory. */
  rememberedPlots(fog: SiteFog | undefined): readonly ConstructionPlotFrame[] {
    if (fog === undefined || fog.memory === null) return NO_PLOTS;
    const { memory } = fog;
    if (!holds(this.memoryPlotsKey, memory)) {
      this.memoryPlotsKey = { memory, version: memory.version };
      const plots: ConstructionPlotFrame[] = [];
      for (const site of memory.sites(this.siteScratch)) {
        if (site.plot !== undefined) plots.push({ ref: site.ref, foundation: true, cells: site.plot });
      }
      this.siteScratch.length = 0;
      this.memoryPlots = plots;
    }
    return this.memoryPlots;
  }

  /** The live signs of the buildings in sight, then the remembered ones. */
  signsDrawn(fog: SiteFog | undefined): readonly ConstructionSign[] {
    if (fog === undefined) return this.signs;
    const { sight, memory } = fog;
    const seenOf = this.seenSignsOf;
    if (
      seenOf?.signs !== this.signs ||
      seenOf.plots !== this.plots ||
      this.seenSignsRevision !== sight.revision
    ) {
      this.seenSignsOf = { signs: this.signs, plots: this.plots };
      this.seenSignsRevision = sight.revision;
      this.seenSigns = this.signs.filter((sign) => {
        const plot = this.plotOf(sign.id);
        return plot === undefined ? fog.seesTile(sign.x / ONE, sign.y / ONE) : seesBuilding(fog, plot.anchor);
      });
    }
    const seen = this.seenSigns;
    if (memory === null) return seen;
    if (!holds(this.memorySignsKey, memory)) {
      this.memorySignsKey = { memory, version: memory.version };
      const signs: ConstructionSign[] = [];
      for (const site of memory.sites(this.siteScratch)) {
        if (site.sign === undefined) continue;
        const player = site.owner === undefined ? {} : { player: site.owner };
        signs.push({ ...site.sign, id: site.ref, ...player, remembered: true });
      }
      this.siteScratch.length = 0;
      this.memorySigns = signs;
    }
    const remembered = this.memorySigns;
    if (remembered.length === 0) return seen;
    if (this.drawn?.seen !== seen || this.drawn.remembered !== remembered) {
      this.drawn = { seen, remembered };
      this.drawnSigns = [...seen, ...remembered];
    }
    return this.drawnSigns;
  }
}
