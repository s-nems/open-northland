/**
 * The pinned Firefox Translate models this app translates map texts with: the same Bergamot
 * student models Mozilla ships to Firefox Translations, pinned by uncompressed SHA-256 so a
 * download is verified before it is used. Snapshotted from Mozilla's translations model registry
 * (db/models.json in the moz-fx-translations-data bucket) by `scripts/gen-translate-models.py`;
 * regenerate that file to move to a retrained model.
 */

/** One downloaded model file, described exactly. */
export interface ModelFile {
  /** The file name the engine knows it by (`model.ende.intgemm.alphas.bin`). */
  readonly name: string;
  /** The absolute URL the file downloads from. */
  readonly url: string;
  /** The uncompressed size in bytes, to reserve and to sanity-check. */
  readonly bytes: number;
  /** The SHA-256 of the uncompressed content, in hex. */
  readonly sha256: string;
}

/** The three (or four) files one Bergamot model loads from. */
export interface BergamotModel {
  /** The registry's own pair id, such as `en-de`. */
  readonly id: string;
  /** The files: the network weights, the lexical shortlist and one or two SentencePiece vocabularies. */
  readonly model: ModelFile;
  readonly shortlist: ModelFile;
  readonly vocabs: readonly ModelFile[];
}

/** `de` → `en`. */
export const MODEL_DE_EN: BergamotModel = {
  id: 'de-en',
  model: {
    bytes: 31561787,
    name: 'model.deen.intgemm.alphas.bin',
    sha256: '3e6f7c2c2425d10824797270b382bee718ff34af2cab9308841c82ca46dc6f20',
    url: 'https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/de-en/retrain_hr2_WZOW24i4QJmIib61LeHfwg/exported/model.deen.intgemm.alphas.bin.gz',
  },
  shortlist: {
    bytes: 4945796,
    name: 'lex.50.50.deen.s2t.bin',
    sha256: '113b98460468360cca68c042e1cddf49c4e1931cbb975ed04349c9a3bd607010',
    url: 'https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/de-en/retrain_hr2_WZOW24i4QJmIib61LeHfwg/exported/lex.50.50.deen.s2t.bin.gz',
  },
  vocabs: [
    {
      bytes: 810073,
      name: 'vocab.deen.spm',
      sha256: '69f730becafa48e3bb2c244eab66456877c08959a02f2bd5519b5a3088b62f9c',
      url: 'https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/de-en/retrain_hr2_WZOW24i4QJmIib61LeHfwg/exported/vocab.deen.spm.gz',
    },
  ],
};

/** `en` → `de`. */
export const MODEL_EN_DE: BergamotModel = {
  id: 'en-de',
  model: {
    bytes: 31561787,
    name: 'model.ende.intgemm.alphas.bin',
    sha256: '8df29d9494d19f47fd5d97c6a73474c6f657e9f81c1a607c431d02befdf3810f',
    url: 'https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-de/retrain_hr_fix_names_SCgGhxUPQ2WAECHLRtzrMg/exported/model.ende.intgemm.alphas.bin.gz',
  },
  shortlist: {
    bytes: 4347672,
    name: 'lex.50.50.ende.s2t.bin',
    sha256: '7ed39f1cffbd68a27ddf05bbfe068de2060f1d7e69f1a20e27ae923551dd7393',
    url: 'https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-de/retrain_hr_fix_names_SCgGhxUPQ2WAECHLRtzrMg/exported/lex.50.50.ende.s2t.bin.gz',
  },
  vocabs: [
    {
      bytes: 810073,
      name: 'vocab.ende.spm',
      sha256: '69f730becafa48e3bb2c244eab66456877c08959a02f2bd5519b5a3088b62f9c',
      url: 'https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-de/retrain_hr_fix_names_SCgGhxUPQ2WAECHLRtzrMg/exported/vocab.ende.spm.gz',
    },
  ],
};

/** `en` → `it`. */
export const MODEL_EN_IT: BergamotModel = {
  id: 'en-it',
  model: {
    bytes: 31561787,
    name: 'model.enit.intgemm.alphas.bin',
    sha256: '248f47568788ecc351da7e5e07064d4153b4f71e011364ae2c931ffeec4d1cc2',
    url: 'https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-it/retrain_hr_fix_names_GPSr_u8PSmC9fOx1ZDCHoA/exported/model.enit.intgemm.alphas.bin.gz',
  },
  shortlist: {
    bytes: 4133192,
    name: 'lex.50.50.enit.s2t.bin',
    sha256: '8b21914804625b2777dae7fdb636eb78f02a3eb8b7bceaa50f29ac740961da93',
    url: 'https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-it/retrain_hr_fix_names_GPSr_u8PSmC9fOx1ZDCHoA/exported/lex.50.50.enit.s2t.bin.gz',
  },
  vocabs: [
    {
      bytes: 812724,
      name: 'vocab.enit.spm',
      sha256: '3ef0211d4ae6db21440892f180f2019fe2bfc110a330ffa9d2eca9665e4f2bc5',
      url: 'https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-it/retrain_hr_fix_names_GPSr_u8PSmC9fOx1ZDCHoA/exported/vocab.enit.spm.gz',
    },
  ],
};

/** `en` → `pl`. */
export const MODEL_EN_PL: BergamotModel = {
  id: 'en-pl',
  model: {
    bytes: 31561787,
    name: 'model.enpl.intgemm.alphas.bin',
    sha256: 'b0b59716bcc8f46b8dc6ab5c32a2732acaad42a5a6d9ae9b472526a1bb0d71d4',
    url: 'https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-pl/retrain_hr_fix_names_YmTlfuUsSKCbUp75UXaUuw/exported/model.enpl.intgemm.alphas.bin.gz',
  },
  shortlist: {
    bytes: 3540052,
    name: 'lex.50.50.enpl.s2t.bin',
    sha256: 'd7d7b364673f633763c9f8f2e8ee9c7a184e92f4086e8b84abe870a2a8dbe5d5',
    url: 'https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-pl/retrain_hr_fix_names_YmTlfuUsSKCbUp75UXaUuw/exported/lex.50.50.enpl.s2t.bin.gz',
  },
  vocabs: [
    {
      bytes: 821612,
      name: 'vocab.enpl.spm',
      sha256: '2000f182efa8ce5f69bc3f9e574666b5bc2c0af684eedd32f69d15aa9021ea85',
      url: 'https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-pl/retrain_hr_fix_names_YmTlfuUsSKCbUp75UXaUuw/exported/vocab.enpl.spm.gz',
    },
  ],
};

/** `en` → `ru`. */
export const MODEL_EN_RU: BergamotModel = {
  id: 'en-ru',
  model: {
    bytes: 42992955,
    name: 'model.enru.intgemm.alphas.bin',
    sha256: '0ef9a209c5edc46692750e7505b3695655b1c7c3ec73058b641201ef18c481ce',
    url: 'https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-ru/student_base_AYqN3ysXRp2EGkEqeaA5Rg/exported/model.enru.intgemm.alphas.bin.gz',
  },
  shortlist: {
    bytes: 2768468,
    name: 'lex.50.50.enru.s2t.bin',
    sha256: '3587f93c10c1d457f874c2ba7ff4d5e2686fdaf7f3fd179cfefeacab3c6990b9',
    url: 'https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-ru/student_base_AYqN3ysXRp2EGkEqeaA5Rg/exported/lex.50.50.enru.s2t.bin.gz',
  },
  vocabs: [
    {
      bytes: 904455,
      name: 'vocab.enru.spm',
      sha256: '56ee63e14e8cb926c394242adc3ed7cc602644c3d33058cff2ce2959d52a6258',
      url: 'https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-ru/student_base_AYqN3ysXRp2EGkEqeaA5Rg/exported/vocab.enru.spm.gz',
    },
  ],
};

/** `en` → `zh`. */
export const MODEL_EN_ZH: BergamotModel = {
  id: 'en-zh',
  model: {
    bytes: 43849787,
    name: 'model.enzh.intgemm.alphas.bin',
    sha256: '4e5accc141373565ddc8fa1565bceaa8d0c3482a82cab8131c719ebcc6c2157c',
    url: 'https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-zh/llmaat_finetune10M_qe8_f2_ByQcSxGXQRqGi-UTxYE43g/exported/model.enzh.intgemm.alphas.bin.gz',
  },
  shortlist: {
    bytes: 4485184,
    name: 'lex.50.50.enzh.s2t.bin',
    sha256: '8575d8daa10e2dbff316dcdf8e1ce475357bcc2c92bdc63b736a2d5add22f681',
    url: 'https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-zh/llmaat_finetune10M_qe8_f2_ByQcSxGXQRqGi-UTxYE43g/exported/lex.50.50.enzh.s2t.bin.gz',
  },
  vocabs: [
    {
      bytes: 806952,
      name: 'srcvocab.enzh.spm',
      sha256: 'bd9b65504acc6d9726dd281f7defc2adb7c2c22d0688fe2f84697de25197c8c5',
      url: 'https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-zh/llmaat_finetune10M_qe8_f2_ByQcSxGXQRqGi-UTxYE43g/exported/srcvocab.enzh.spm.gz',
    },
    {
      bytes: 772004,
      name: 'trgvocab.enzh.spm',
      sha256: 'aded6993c36e440284d11cec3f6b8aef9c0e43188a772d80be342a713adf223d',
      url: 'https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-zh/llmaat_finetune10M_qe8_f2_ByQcSxGXQRqGi-UTxYE43g/exported/trgvocab.enzh.spm.gz',
    },
  ],
};

/** `en` → `zh_hant`. */
export const MODEL_EN_ZH_HANT: BergamotModel = {
  id: 'en-zh_hant',
  model: {
    bytes: 43849787,
    name: 'model.enzh_hant.intgemm.alphas.bin',
    sha256: '559ab90d723a58c1f1e2ab7cc12137bc667af5ba3e325e3eb30b5cdc930db520',
    url: 'https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-zh_hant/zh_hant_llmaat_finetune10M_qe8_f2_aQ8azdOMQOSBVjBDOVDIZQ/exported/model.enzh_hant.intgemm.alphas.bin.gz',
  },
  shortlist: {
    bytes: 4057188,
    name: 'lex.50.50.enzh_hant.s2t.bin',
    sha256: 'd891404d1436a7334df12539fe30a26f9e9f2b80bd42fdb8b5f8849e8a1e942b',
    url: 'https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-zh_hant/zh_hant_llmaat_finetune10M_qe8_f2_aQ8azdOMQOSBVjBDOVDIZQ/exported/lex.50.50.enzh_hant.s2t.bin.gz',
  },
  vocabs: [
    {
      bytes: 803694,
      name: 'srcvocab.enzh_hant.spm',
      sha256: '2266df70492162a249ab1c0154f929bd6098b246544c666c1a0d5a24dde7d2ea',
      url: 'https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-zh_hant/zh_hant_llmaat_finetune10M_qe8_f2_aQ8azdOMQOSBVjBDOVDIZQ/exported/srcvocab.enzh_hant.spm.gz',
    },
    {
      bytes: 751671,
      name: 'trgvocab.enzh_hant.spm',
      sha256: '22b91a4436d70b91ab8777c677252ab5fae2bc284d71f977df5206c110e3444c',
      url: 'https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/en-zh_hant/zh_hant_llmaat_finetune10M_qe8_f2_aQ8azdOMQOSBVjBDOVDIZQ/exported/trgvocab.enzh_hant.spm.gz',
    },
  ],
};

/** `it` → `en`. */
export const MODEL_IT_EN: BergamotModel = {
  id: 'it-en',
  model: {
    bytes: 31561787,
    name: 'model.iten.intgemm.alphas.bin',
    sha256: '21b70978ce2f3b4da7a06b5de86a09abe3acd30b9eee1b2ebb3582b9bad790bf',
    url: 'https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/it-en/retrain_hr_d1nPDwVeSD6t-HdtWA4xNg/exported/model.iten.intgemm.alphas.bin.gz',
  },
  shortlist: {
    bytes: 4713616,
    name: 'lex.50.50.iten.s2t.bin',
    sha256: '0700d6d70b30490e68ff9deca0b45b80310745b491855bde3a13e1692d0cbce1',
    url: 'https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/it-en/retrain_hr_d1nPDwVeSD6t-HdtWA4xNg/exported/lex.50.50.iten.s2t.bin.gz',
  },
  vocabs: [
    {
      bytes: 812724,
      name: 'vocab.iten.spm',
      sha256: '3ef0211d4ae6db21440892f180f2019fe2bfc110a330ffa9d2eca9665e4f2bc5',
      url: 'https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/it-en/retrain_hr_d1nPDwVeSD6t-HdtWA4xNg/exported/vocab.iten.spm.gz',
    },
  ],
};

/** `pl` → `en`. */
export const MODEL_PL_EN: BergamotModel = {
  id: 'pl-en',
  model: {
    bytes: 31561787,
    name: 'model.plen.intgemm.alphas.bin',
    sha256: '06dbab3baa3bbceab746bc6a3bba807878f38536382c03acddf59d3edf3b5d94',
    url: 'https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/pl-en/retrain_hr_HLLa6ZwsSomB0kyBr7Iz6w/exported/model.plen.intgemm.alphas.bin.gz',
  },
  shortlist: {
    bytes: 4964208,
    name: 'lex.50.50.plen.s2t.bin',
    sha256: 'b295dfefa7022a62e105276e8c39fdfd67bffe588f4fd78583edd4e04ee0cb3b',
    url: 'https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/pl-en/retrain_hr_HLLa6ZwsSomB0kyBr7Iz6w/exported/lex.50.50.plen.s2t.bin.gz',
  },
  vocabs: [
    {
      bytes: 821612,
      name: 'vocab.plen.spm',
      sha256: '2000f182efa8ce5f69bc3f9e574666b5bc2c0af684eedd32f69d15aa9021ea85',
      url: 'https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/pl-en/retrain_hr_HLLa6ZwsSomB0kyBr7Iz6w/exported/vocab.plen.spm.gz',
    },
  ],
};

/** `ru` → `en`. */
export const MODEL_RU_EN: BergamotModel = {
  id: 'ru-en',
  model: {
    bytes: 31561787,
    name: 'model.ruen.intgemm.alphas.bin',
    sha256: 'aa0efa194b3dbd2da129ba0b8db8ef139126cb0914e57072f62061294746f1e2',
    url: 'https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/ru-en/next26_RSpwfHrcSUC_rKTnhOEXzw/exported/model.ruen.intgemm.alphas.bin.gz',
  },
  shortlist: {
    bytes: 4397908,
    name: 'lex.50.50.ruen.s2t.bin',
    sha256: 'c944e753f298bbdf6506388de7257fb48cbd12c83e2807e2c284fc323771895b',
    url: 'https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/ru-en/next26_RSpwfHrcSUC_rKTnhOEXzw/exported/lex.50.50.ruen.s2t.bin.gz',
  },
  vocabs: [
    {
      bytes: 952371,
      name: 'vocab.ruen.spm',
      sha256: 'de8af5f87e231ee4016cec4bb482e6b584cb1ca34dcb624fc7b8398f25bb35df',
      url: 'https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/ru-en/next26_RSpwfHrcSUC_rKTnhOEXzw/exported/vocab.ruen.spm.gz',
    },
  ],
};

/** `zh` → `en`. */
export const MODEL_ZH_EN: BergamotModel = {
  id: 'zh-en',
  model: {
    bytes: 59504955,
    name: 'model.zhen.intgemm.alphas.bin',
    sha256: '3535442962ec8f4a553cc19b206befcac689ee9cddaea44fa91e21527fc30ac2',
    url: 'https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/zh-en/cjk_icu_base_LQeOIbF7Sbq3XA8lsRPotw/exported/model.zhen.intgemm.alphas.bin.gz',
  },
  shortlist: {
    bytes: 9220016,
    name: 'lex.50.50.zhen.s2t.bin',
    sha256: 'cdcad3592dc2bc4676c34c4d37203f7649ee989195cf083cbb60f1ea011f976b',
    url: 'https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/zh-en/cjk_icu_base_LQeOIbF7Sbq3XA8lsRPotw/exported/lex.50.50.zhen.s2t.bin.gz',
  },
  vocabs: [
    {
      bytes: 1359697,
      name: 'vocab.zhen.spm',
      sha256: 'dff594318ab7d8b7b60b844ab98ebe6b932ae8045fab15235404c787715965b3',
      url: 'https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/zh-en/cjk_icu_base_LQeOIbF7Sbq3XA8lsRPotw/exported/vocab.zhen.spm.gz',
    },
  ],
};

/** `zh_hant` → `en`. */
export const MODEL_ZH_HANT_EN: BergamotModel = {
  id: 'zh_hant-en',
  model: {
    bytes: 43849787,
    name: 'model.zh_hanten.intgemm.alphas.bin',
    sha256: '0aee91790894458f5d367551f6edcd4c9cb97852c34f221bcbf9f4701ebcf0cd',
    url: 'https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/zh_hant-en/zh_hant_openlid_zh_tw_lr0002_WJi5Ozi7SZWC6hgfD5GhTA/exported/model.zh_hanten.intgemm.alphas.bin.gz',
  },
  shortlist: {
    bytes: 6385944,
    name: 'lex.50.50.zh_hanten.s2t.bin',
    sha256: 'aa7daf6cfc85c0cd2c10e2944d66f6da55497c9c6408789f3adfded4074c2fb1',
    url: 'https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/zh_hant-en/zh_hant_openlid_zh_tw_lr0002_WJi5Ozi7SZWC6hgfD5GhTA/exported/lex.50.50.zh_hanten.s2t.bin.gz',
  },
  vocabs: [
    {
      bytes: 769669,
      name: 'srcvocab.zh_hanten.spm',
      sha256: '5cc6a76611dbf86219f109141533606b15ecb34eee83673bb86b2c16b14734db',
      url: 'https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/zh_hant-en/zh_hant_openlid_zh_tw_lr0002_WJi5Ozi7SZWC6hgfD5GhTA/exported/srcvocab.zh_hanten.spm.gz',
    },
    {
      bytes: 812572,
      name: 'trgvocab.zh_hanten.spm',
      sha256: '7bf002db37c10d3b114cc5588d7fdcb16c57d0fd1e2c34354c22cc9f0b6c3c29',
      url: 'https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/models/zh_hant-en/zh_hant_openlid_zh_tw_lr0002_WJi5Ozi7SZWC6hgfD5GhTA/exported/trgvocab.zh_hanten.spm.gz',
    },
  ],
};

/** Every pinned model, by its registry pair id. */
export const TRANSLATE_MODELS: Readonly<Record<string, BergamotModel>> = {
  'de-en': MODEL_DE_EN,
  'en-de': MODEL_EN_DE,
  'en-it': MODEL_EN_IT,
  'en-pl': MODEL_EN_PL,
  'en-ru': MODEL_EN_RU,
  'en-zh': MODEL_EN_ZH,
  'en-zh_hant': MODEL_EN_ZH_HANT,
  'it-en': MODEL_IT_EN,
  'pl-en': MODEL_PL_EN,
  'ru-en': MODEL_RU_EN,
  'zh-en': MODEL_ZH_EN,
  'zh_hant-en': MODEL_ZH_HANT_EN,
};
