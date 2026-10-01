import { createMinimapRasterizer, type MinimapBakeReply, type MinimapBakeRequest } from './bake.js';

const scope = globalThis as unknown as Pick<Worker, 'addEventListener' | 'postMessage'>;

let rasterize: ReturnType<typeof createMinimapRasterizer> | undefined;

scope.addEventListener('message', (event: MessageEvent<MinimapBakeRequest>) => {
  const request = event.data;
  if (request.kind === 'scene') {
    rasterize = createMinimapRasterizer(request.scene);
    return;
  }
  // The client posts the scene before its first bake, and a worker reads its messages in order.
  if (rasterize === undefined) return;
  const rgba = rasterize(request.width, request.height, request.objects);
  const reply: MinimapBakeReply = { id: request.id, rgba };
  scope.postMessage(reply, [rgba.buffer]);
});
