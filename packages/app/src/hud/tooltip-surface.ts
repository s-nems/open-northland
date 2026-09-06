/** The cursor chip a HUD surface shows text in, injected structurally so `hud/` never imports the
 *  view-layer element. */
export interface TooltipSurface {
  show(clientX: number, clientY: number, text: string): void;
  hide(): void;
}
