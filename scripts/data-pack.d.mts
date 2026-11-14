export const DATA_PACK_VERSION: 5;
export const DATA_PACK_FORMAT: 'open-northland-data';
export interface DataManifest {
  readonly format: typeof DATA_PACK_FORMAT;
  readonly version: typeof DATA_PACK_VERSION;
  readonly base: 'base';
  readonly components: readonly {
    readonly id: string;
    readonly kind: 'base' | 'animation';
    readonly sha256: string;
  }[];
  readonly campaigns: readonly string[];
  readonly files: readonly { readonly path: string; readonly size: number; readonly sha256: string }[];
}
export function dataPath(value: unknown): string;
export function parseDataManifest(value: unknown): DataManifest;
export function sha256File(path: string): Promise<string>;
export function readDataPack(root: string): Promise<DataManifest>;
export type DataLanguage = 'pol' | 'eng' | 'ger' | 'rus' | 'ita';
export interface CampaignRouteSource {
  readonly file: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}
export interface CampaignFilmSource {
  readonly video: string;
  readonly audio: string;
  readonly width: number;
  readonly height: number;
}
/** A campaign map: shared world and mission files plus each language's `text/` and `sfx/` layer. Values are
 *  paths under `campaigns/<campaign>/maps/<id>/`, keys the logical paths the map importer reads. */
export interface CampaignMapSource {
  readonly id: string;
  readonly shared: Readonly<Record<string, string>>;
  readonly locales: Readonly<Partial<Record<DataLanguage, Readonly<Record<string, string>>>>>;
}
/** One validated `campaigns/<id>/campaign.json`; file values are paths under `campaigns/<id>/`. */
export interface CampaignSource {
  readonly id: string;
  readonly campaignId: number;
  readonly order: number;
  readonly title: Readonly<Partial<Record<DataLanguage, string>>>;
  /** The languages every map carries, in the first map's order. */
  readonly languages: readonly DataLanguage[];
  readonly background: string;
  readonly logo?: Readonly<Partial<Record<DataLanguage, string>>>;
  readonly stages: readonly {
    readonly missionId: number;
    readonly x: number;
    readonly y: number;
    readonly route?: CampaignRouteSource;
  }[];
  readonly movies: Readonly<
    Partial<
      Record<
        DataLanguage,
        {
          readonly intro?: CampaignFilmSource;
          readonly videos: readonly (CampaignFilmSource & { readonly sequence: number })[];
        }
      >
    >
  >;
  readonly maps: readonly CampaignMapSource[];
}
export function readCampaigns(root: string, manifest: DataManifest): Promise<CampaignSource[]>;
