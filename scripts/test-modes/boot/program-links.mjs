// Which GL programs the game canvas links in which boot step. The game links its catalogue programs in
// the renderer during the `shaders` step; one linked again once the world draws stalls a frame for the
// whole compile on a browser without a program cache, seconds per program on Direct3D.

/** Records each link on a canvas in the document (the warm-up's canvases never join it) with the boot
 *  step then running, read from the app's `[boot] phase` console line. */
export function watchProgramLinks(context) {
  return context.addInitScript(() => {
    const links = [];
    let phase = null;
    Object.defineProperty(window, '__programLinks', { value: links });
    const info = console.info.bind(console);
    console.info = (...args) => {
      if (args[0] === '[boot] phase' && typeof args[1]?.phase === 'string') phase = args[1].phase;
      info(...args);
    };
    const link = WebGL2RenderingContext.prototype.linkProgram;
    WebGL2RenderingContext.prototype.linkProgram = function (program) {
      if (this.canvas instanceof HTMLCanvasElement && this.canvas.isConnected) {
        const fragment = this.getAttachedShaders(program)
          ?.map((shader) => this.getShaderSource(shader) ?? '')
          .find((source) => source.includes('-fragment'));
        const name = /#define SHADER_NAME (\S+?)-fragment/.exec(fragment ?? '')?.[1] ?? null;
        links.push({ name, phase });
      }
      return link.call(this, program);
    };
  });
}

/** The program families the renderer linked behind the loading card, and the links of those families
 *  once the world drew (`hud` is the last step). A family is a name's first path part, so a batch
 *  variant other than the one linked ahead counts too. */
export async function readProgramLinks(page) {
  const links = await page.evaluate(() => window.__programLinks ?? []);
  const familyOf = (name) => name.split('/')[0];
  const ahead = links.filter((entry) => entry.phase === 'shaders' && entry.name !== null);
  const families = new Set(ahead.map((entry) => familyOf(entry.name)));
  const late = links
    .filter((entry) => entry.phase === 'hud' && entry.name !== null && families.has(familyOf(entry.name)))
    .map((entry) => entry.name);
  return { ahead: ahead.length, late };
}
