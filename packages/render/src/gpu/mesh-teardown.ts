import { type Container, Mesh } from 'pixi.js';

/**
 * Release the GPU resources a custom-shader {@link Mesh} leaks on a plain `.destroy()`. Pixi's `Mesh` does
 * not own its {@link import('pixi.js').MeshGeometry} or its custom shader, so destroying the mesh (or its
 * container with `{ children: true }`) leaves the vertex/uv/index buffers and the shader's uniform state
 * allocated. Walk a container's direct children and free both on every `Mesh`, to be called before the
 * caller destroys the container itself. Shared texture sources and the process-wide compiled GL program are
 * deliberately left alone — they outlive any one layer. The terrain chunks and the map-object decor batches
 * both build custom-shader meshes and share this teardown.
 */
export function destroyMeshChildren(container: Container): void {
  for (const child of container.children) {
    if (child instanceof Mesh) {
      child.geometry.destroy();
      child.shader?.destroy();
    }
  }
}
