import { Container } from 'pixi.js';

const ordinaryDepthChanged = Container.prototype.depthOfChildModified;

/** Numeric depth changes invalidate instructions only when the stable painter order changes. */
export class DepthSortedLayer extends Container {
  private readonly scratch: (Container | undefined)[] = [];
  // Capture each mutable depth once; merge comparisons use the retained numeric keys.
  private depths = new Float64Array(0);
  private scratchDepths = new Float64Array(0);
  private readonly hooks = new WeakMap<Container, Container['depthOfChildModified']>();

  constructor() {
    super();
    this.sortableChildren = true;
    this.on('childAdded', (child) => {
      // Custom notifications keep their side effects and ordinary Pixi invalidation.
      if (child.depthOfChildModified !== ordinaryDepthChanged) return;
      const original = child.depthOfChildModified;
      const layer = this;
      const hook: Container['depthOfChildModified'] = function (this: Container) {
        if (this.parent !== layer) {
          original.call(this);
          return;
        }
        layer.sortDirty = true;
      };
      this.hooks.set(child, hook);
      child.depthOfChildModified = hook;
    });
    this.on('childRemoved', (child) => {
      if (child.depthOfChildModified === this.hooks.get(child)) {
        child.depthOfChildModified = ordinaryDepthChanged;
      }
      this.hooks.delete(child);
    });
  }

  override sortChildren = (): void => {
    if (!this.sortDirty) return;
    this.sortDirty = false;
    const children = this.children;
    if (children.length > this.depths.length) {
      const capacity = Math.max(children.length, this.depths.length * 2);
      this.depths = new Float64Array(capacity);
      this.scratchDepths = new Float64Array(capacity);
    }
    let finite = true;
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      if (child === undefined) continue;
      const depth = child.zIndex;
      this.depths[i] = depth;
      finite &&= Number.isFinite(depth);
    }
    if (!finite) {
      for (let i = 0; i < children.length; i++) this.scratch[i] = children[i];
      children.sort((a, b) => a.zIndex - b.zIndex);
      let changed = false;
      for (let i = 0; i < children.length; i++) changed ||= children[i] !== this.scratch[i];
      this.clearScratch(children.length);
      if (changed) this.invalidateInstructions();
      return;
    }
    let changed = false;
    for (let i = 1; i < children.length; i++) {
      const a = children[i - 1],
        b = children[i];
      if (a !== undefined && b !== undefined && (this.depths[i - 1] ?? 0) > (this.depths[i] ?? 0)) {
        changed = true;
        break;
      }
    }
    if (!changed) return;
    // Stable merge preserves insertion order at identical depths, as Pixi's stable sort does.
    for (let width = 1; width < children.length; width *= 2) {
      for (let start = 0; start < children.length; start += width * 2) {
        const mid = Math.min(children.length, start + width),
          end = Math.min(children.length, mid + width);
        let left = start,
          right = mid;
        for (let i = start; i < end; i++) {
          const a = left < mid ? children[left] : undefined;
          const b = right < end ? children[right] : undefined;
          if (a !== undefined && (b === undefined || (this.depths[left] ?? 0) <= (this.depths[right] ?? 0))) {
            this.scratch[i] = a;
            this.scratchDepths[i] = this.depths[left] ?? 0;
            left++;
          } else if (b !== undefined) {
            this.scratch[i] = b;
            this.scratchDepths[i] = this.depths[right] ?? 0;
            right++;
          }
        }
      }
      for (let i = 0; i < children.length; i++) {
        const child = this.scratch[i];
        if (child !== undefined) children[i] = child;
        this.depths[i] = this.scratchDepths[i] ?? 0;
      }
    }
    this.clearScratch(children.length);
    this.invalidateInstructions();
  };

  private clearScratch(n: number): void {
    this.scratch.length = n;
    for (let i = 0; i < n; i++) this.scratch[i] = undefined;
  }

  private invalidateInstructions(): void {
    const group = this.renderGroup ?? this.parentRenderGroup;
    if (group !== null && group !== undefined) group.structureDidChange = true;
  }
}
