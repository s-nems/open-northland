import { TerrainEdges } from './edges.js';
import type { LandscapeProps } from './landscape-props.js';
import type { NodeId } from './node-id.js';
import { StepBuffer } from './step-buffer.js';

/**
 * The terrain half-cell adjacency graph, the sim's navigation model (docs/ECS.md), distinct from the
 * triangle render tessellation: the node lattice and its 8-direction edge set, plus each node's static
 * connectivity label. Construct via {@link buildTerrainGraph}.
 */
export class TerrainGraph extends TerrainEdges {
  /** Static-connectivity label per node (-1 = unwalkable). See {@link componentOf}. */
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
   * unwalkable nodes are -1. The dynamic walk-block overlay only ever removes edges, so two nodes with
   * different labels are provably unreachable under any overlay - the pathfinder uses this to answer
   * "no route" without flooding the component. Labels are assigned by ascending seed id at build time,
   * so they are a pure function of the terrain (lockstep-safe).
   */
  componentOf(node: NodeId): number {
    return this.checkedSlot(this.components, node);
  }

  /** Flood-fill the static components over the pathfinder's own edge set ({@link stepsInto} with no
   *  overlay), so the diagonal flank-seam rule has exactly one owner. Edges are symmetric within
   *  the walkable set (destination-walkability + the shared flank pair), so a BFS labelling is
   *  well-defined. One-time O(nodes) build cost, run from the constructor, so an override of
   *  {@link stepsInto} would see a subclass's own fields still uninitialised. */
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
