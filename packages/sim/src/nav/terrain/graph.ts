import { TerrainEdges } from './edges.js';
import type { LandscapeProps } from './landscape-props.js';
import type { NodeId } from './node-id.js';
import { StepBuffer } from './step-buffer.js';

/**
 * The sim's navigation model: the half-cell node lattice with its 8-direction edge set and each node's
 * static connectivity label. Distinct from the render's triangle tessellation. Construct through
 * {@link buildTerrainGraph}.
 */
export class TerrainGraph extends TerrainEdges {
  private readonly components: Int32Array;

  constructor(
    width: number,
    height: number,
    typeIds: Int32Array,
    props: ReadonlyMap<number, LandscapeProps>,
  ) {
    super(width, height, typeIds, props);
    this.components = this.computeComponents();
  }

  /**
   * The static-connectivity label of a node: nodes reachable over static terrain share a label,
   * unwalkable nodes are -1. A walk-block overlay only removes edges, so two differently labelled nodes
   * are provably unreachable under any overlay. Labels are assigned by ascending seed id at build time,
   * making them a pure function of the terrain.
   */
  componentOf(node: NodeId): number {
    return this.checkedSlot(this.components, node);
  }

  /** Flood-fill the static components over the pathfinder's own edge set, so the diagonal flank-seam
   *  rule has one owner. Edges are symmetric within the walkable set, so the BFS labelling is
   *  well-defined. Runs from the constructor, so an override of {@link stepsInto} would see a
   *  subclass's own fields still uninitialised. */
  private computeComponents(): Int32Array {
    const components = new Int32Array(this.nodeCount).fill(-1);
    const queue: NodeId[] = [];
    const edges = new StepBuffer();
    let nextLabel = 0;
    for (let seed = 0; seed < this.nodeCount; seed++) {
      if (components[seed] !== -1 || !this.isWalkable(seed as NodeId)) continue;
      const label = nextLabel;
      nextLabel += 1;
      components[seed] = label;
      queue.length = 0;
      queue.push(seed as NodeId);
      // The array iterator re-reads `length` each step, so `queue` is a live BFS queue: nodes pushed
      // while walking it are visited in turn.
      for (const cur of queue) {
        this.stepsInto(cur, undefined, edges);
        for (let i = 0; i < edges.length; i++) {
          const { node } = edges.at(i);
          if (components[node] === -1) {
            components[node] = label;
            queue.push(node);
          }
        }
      }
    }
    return components;
  }
}
