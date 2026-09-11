import { type Application, Text } from 'pixi.js';

export function mountOwnAssetsLegend(app: Application): void {
  const label = new Text({
    text: 'Własne assety · szachownica: brak terenu · róż: brak przejścia · kropki i bryły: brak obiektów',
    style: { fontFamily: 'system-ui', fontSize: 12, fill: 0xffffff, stroke: { color: 0x20242b, width: 3 } },
  });
  label.position.set(90, 80);
  app.stage.addChild(label);
}
