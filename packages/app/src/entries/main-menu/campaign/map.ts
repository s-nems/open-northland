import type { Campaign, CampaignRoute, MapTextLanguage } from '@open-northland/data';
import { localizedText } from '../../../campaign/locale.js';
import { node } from '../dom.js';
import type { UnlockedStage } from './model.js';

const PERCENT = 100;

/** A fraction of the background as a CSS percentage. */
const percent = (fraction: number): string => `${fraction * PERCENT}%`;

function routeImage(route: CampaignRoute): HTMLImageElement {
  const image = node('img', 'campaign-map__route');
  image.src = route.url;
  image.alt = '';
  image.style.left = percent(route.x);
  image.style.top = percent(route.y);
  image.style.width = percent(route.width);
  image.style.height = percent(route.height);
  return image;
}

/**
 * The campaign's own map with the unlocked stages as numbered markers over the routes into them.
 * `reveal` names the stage whose route draws itself in, growing out of the previous stage's marker.
 */
export function campaignMap(
  campaign: Campaign,
  stages: readonly UnlockedStage[],
  language: MapTextLanguage,
  reveal: string | undefined,
  select: (mapId: string) => void,
) {
  const root = node('div', 'campaign-map');
  const background = node('img', 'campaign-map__background');
  background.alt = '';
  background.src = campaign.background;
  // The map keeps the picture's own proportions, so stage fractions land on the picture.
  const fit = (): void => {
    if (background.naturalWidth > 0 && background.naturalHeight > 0)
      root.style.setProperty('--map-aspect', String(background.naturalWidth / background.naturalHeight));
  };
  background.addEventListener('load', fit);
  fit();
  root.append(background);

  for (const { stage, number } of stages) {
    if (stage.route === undefined) continue;
    const image = routeImage(stage.route);
    const previous = campaign.stages[number - 2];
    if (stage.mapId === reveal && previous !== undefined) {
      image.classList.add('is-revealing');
      image.style.setProperty('--from-x', percent((previous.x - stage.route.x) / stage.route.width));
      image.style.setProperty('--from-y', percent((previous.y - stage.route.y) / stage.route.height));
    }
    root.append(image);
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
