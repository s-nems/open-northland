import { type Container, Mesh } from 'pixi.js';

/**
 * Free the geometry and custom shader of every direct-child `Mesh`, which Pixi's `Mesh` does not own and
 * therefore leaks on `.destroy()` (even with `{ children: true }`). Call before destroying the container.
 * Shared texture sources and the process-wide compiled GL program are left alive.
 */
export function destroyMeshChildren(container: Container): void {
  for (const child of container.children) {
    if (child instanceof Mesh) {
      child.geometry.destroy();
      child.shader?.destroy();
    }
  }
}
