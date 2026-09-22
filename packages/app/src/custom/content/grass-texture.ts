import { Container, Mesh, MeshGeometry, type Renderer, RenderTexture, type Texture } from 'pixi.js';

export function mapGrassTexture(renderer: Renderer, grass: Texture): Texture {
  const target = RenderTexture.create({ width: 512, height: 512, resolution: 1 });
  target.source.scaleMode = 'linear';
  target.source.autoGenerateMipmaps = true;
  const geometry = new MeshGeometry({
    positions: new Float32Array([0, 0, 512, 0, 512, 512, 0, 512]),
    uvs: new Float32Array([0, 0, 8, 0, 8, 8, 0, 8]),
    indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
  });
  const container = new Container();
  const mesh = new Mesh({ geometry, texture: grass });
  // Every legacy 64px sample gets a complete mirrored repeat, keeping arbitrary pattern joins compatible.
  const addressMode = grass.source.style.addressMode;
  grass.source.style.addressMode = 'mirror-repeat';
  container.addChild(mesh);
  renderer.render({ container, target, clear: true });
  grass.source.style.addressMode = addressMode;
  target.source.updateMipmaps();
  container.destroy({ children: true });
  geometry.destroy();
  return target;
}
