export interface GalleryMapDestination {
  readonly label: string;
  readonly href: string;
  readonly note: string;
  readonly exact: boolean;
}

interface ReviewLocation {
  readonly map: string;
  readonly center: string;
  readonly label: string;
  readonly fog?: 'off';
}

const clearing: ReviewLocation = { map: 'magiczny_las', center: '48,39', label: 'Meadow clearing' };
const settlement: ReviewLocation = {
  map: 'magiczny_las',
  center: '40,40',
  label: 'Magiczny Las settlement',
  fog: 'off',
};
const flowers: ReviewLocation = {
  map: 'magiczny_las',
  center: '36,60',
  label: 'Grass, flowers and mushrooms',
};
const growth: ReviewLocation = {
  map: 'magiczny_las',
  center: '47,27',
  label: 'Pine growth and resource rocks',
};

const reviewLocations: Readonly<Record<string, ReviewLocation>> = {
  'buildings/headquarters': { ...settlement, label: 'Headquarters' },
  'buildings/house-1': { map: 'wilczy_lad', center: '94,131', label: 'Basic home' },
  'buildings/house-2': { map: 'tutorial_004', center: '61,58', label: 'Upgraded home' },
  'buildings/house-3': { map: 'tutorial_004', center: '69,57', label: 'Home — level 3', fog: 'off' },
  'buildings/house-4': { map: 'wybrzeze_czarow', center: '90,111', label: 'Home — level 4', fog: 'off' },
  'buildings/house-5': { map: 'tutorial_006', center: '20,15', label: 'Home — level 5', fog: 'off' },
  'buildings/farm': { map: 'straznicypolnocy', center: '26,162', label: 'Farm', fog: 'off' },
  'terrain/meadow': clearing,
  'terrain/sand': { map: 'gringo', center: '97,101', label: 'Sand boundary' },
};

const propLocations: readonly (ReviewLocation & { readonly prefixes: readonly string[] })[] = [
  { ...growth, prefixes: ['pine-', 'rock-'] },
  { ...flowers, prefixes: ['grass-', 'flower-', 'mushroom-'] },
  { map: 'magiczny_las', center: '35,18', label: 'Bush states', prefixes: ['bush-'] },
  { map: 'magiczny_las', center: '188,28', label: 'Ferns', prefixes: ['fern-'] },
  {
    map: 'magiczny_las',
    center: '12,137',
    label: 'Mixed woodland',
    prefixes: ['beech-', 'birch-', 'oak-', 'fir-'],
  },
];

export function galleryMapDestination(
  asset: { readonly id: string; readonly kind: 'character' | 'building' | 'material' | 'prop' | 'good' },
  appearanceId?: string,
): GalleryMapDestination {
  const matched = reviewLocations[asset.id];
  const family =
    asset.kind === 'prop'
      ? propLocations.find((entry) => entry.prefixes.some((prefix) => asset.id.startsWith(`props/${prefix}`)))
      : undefined;
  const location = matched ?? family ?? settlement;
  const params = new URLSearchParams({
    map: location.map,
    assets: 'own',
    intro: 'off',
    zoom: '2',
    center: location.center,
  });
  if (location.fog !== undefined) params.set('fog', location.fog);
  if (asset.kind === 'character' && appearanceId !== undefined) params.set('ownHead', appearanceId);
  const note =
    asset.kind === 'character'
      ? 'Inspect civilian motion in the settlement; place a building to check construction work.'
      : matched !== undefined
        ? 'Known review area; inspect nearby variants and states while playing.'
        : family !== undefined
          ? 'Known area for this prop family; the selected variant or resource state may need to be found.'
          : asset.id === 'buildings/stonemason'
            ? 'Build a basic stonemason in this settlement to inspect the workshop.'
            : 'General map context; no verified placement is recorded for this asset.';
  return { label: location.label, href: `?${params}`, note, exact: matched !== undefined };
}
