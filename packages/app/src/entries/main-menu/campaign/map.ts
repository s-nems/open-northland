import type { Campaign, CampaignRoute, MapTextLanguage } from '@open-northland/data';
import { localizedText } from '../../../campaign/locale.js';
import { node } from '../dom.js';
import type { UnlockedStage } from './model.js';
import { NOT_ON_ROUTE, routeOrder } from './route-order.js';

const PERCENT = 100;
/** The route starts drawing after the screen settles and ends as the new marker lands (screen.css). */
const REVEAL_DELAY_MS = 300;
const REVEAL_MS = 1300;
/** How far behind the drawing front a dot is still fading in, as a share of the route. */
const REVEAL_FADE = 0.08;
const CHANNELS = 4;
const ALPHA = 3;

/** A fraction of the background as a CSS percentage. */
const percent = (fraction: number): string => `${fraction * PERCENT}%`;

function placeOnMap(element: HTMLElement, route: CampaignRoute): void {
  element.style.left = percent(route.x);
  element.style.top = percent(route.y);
  element.style.width = percent(route.width);
  element.style.height = percent(route.height);
}

function routeImage(route: CampaignRoute): HTMLImageElement {
  const image = node('img', 'campaign-map__route');
  image.src = route.url;
  image.alt = '';
  placeOnMap(image, route);
  return image;
}

const easeInOut = (t: number): number => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);

/**
 * The route into a newly unlocked stage, drawn dot by dot from the previous stage's marker. Timed
 * from creation, so a slow decode only joins the drawing later; a picture the canvas cannot read
 * shows whole.
 */
function revealingRoute(route: CampaignRoute, from: { readonly x: number; readonly y: number }): HTMLElement {
  const canvas = node('canvas', 'campaign-map__route');
  placeOnMap(canvas, route);
  const born = performance.now();
  const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const source = new Image();
  source.src = route.url;
  void source
    .decode()
    .then(() => {
      const { naturalWidth: width, naturalHeight: height } = source;
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      if (context === null) throw new Error('no 2d canvas');
      context.drawImage(source, 0, 0);
      const pixels = context.getImageData(0, 0, width, height).data;
      const order = routeOrder(
        { width, height, rgba: pixels },
        { x: ((from.x - route.x) / route.width) * width, y: ((from.y - route.y) / route.height) * height },
      );
      const frame = context.createImageData(width, height);
      frame.data.set(pixels);
      const draw = (now: number): void => {
        if (!canvas.isConnected) return;
        const linear = still ? 1 : Math.min(1, Math.max(0, (now - born - REVEAL_DELAY_MS) / REVEAL_MS));
        const front = easeInOut(linear) * (1 + REVEAL_FADE);
        for (const [index, place] of order.entries()) {
          if (place === NOT_ON_ROUTE) continue;
          const shown = Math.min(1, Math.max(0, (front - place) / REVEAL_FADE));
          frame.data[index * CHANNELS + ALPHA] = (pixels[index * CHANNELS + ALPHA] ?? 0) * shown;
        }
        context.putImageData(frame, 0, 0);
        if (linear < 1) requestAnimationFrame(draw);
      };
      draw(performance.now());
    })
    .catch(() => canvas.replaceWith(routeImage(route)));
  return canvas;
}

/**
 * The campaign's own map with the unlocked stages as numbered markers over the routes into them.
 * `reveal` names the stage whose route draws itself in from the previous stage's marker. `layout`
 * receives the picture's proportions as `--map-aspect`, so the map and the panel beside it size
 * together (screen.css).
 */
export function campaignMap(
  campaign: Campaign,
  stages: readonly UnlockedStage[],
  language: MapTextLanguage,
  reveal: string | undefined,
  layout: HTMLElement,
  select: (mapId: string) => void,
) {
  const root = node('div', 'campaign-map');
  const background = node('img', 'campaign-map__background');
  background.alt = '';
  background.src = campaign.background;
  // The map keeps the picture's own proportions, so stage fractions land on the picture.
  const fit = (): void => {
    if (background.naturalWidth > 0 && background.naturalHeight > 0)
      layout.style.setProperty('--map-aspect', String(background.naturalWidth / background.naturalHeight));
  };
  background.addEventListener('load', fit);
  fit();
  root.append(background);

  for (const { stage, number } of stages) {
    if (stage.route === undefined) continue;
    const previous = campaign.stages[number - 2];
    root.append(
      stage.mapId === reveal && previous !== undefined
        ? revealingRoute(stage.route, previous)
        : routeImage(stage.route),
    );
  }

  const points = stages.map(({ stage, number }) => {
    const title = localizedText(stage.title, language);
    const point = node('button', 'campaign-map__point');
    point.type = 'button';
    point.style.left = percent(stage.x);
    point.style.top = percent(stage.y);
    point.setAttribute('aria-label', `${number}. ${title}`);
    if (stage.mapId === reveal) point.classList.add('is-arriving');
    const label = node('span', 'campaign-map__label', title);
    label.setAttribute('aria-hidden', 'true');
    point.append(node('span', 'campaign-map__number', String(number)), label);
    point.addEventListener('click', () => select(stage.mapId));
    root.append(point);
    return { mapId: stage.mapId, point };
  });

  return {
    root,
    select(mapId: string | undefined): void {
      for (const { mapId: id, point } of points) point.setAttribute('aria-pressed', String(id === mapId));
    },
  };
}
