/**
 * `humanwindow` string ids resolved at draw time from `content/gui/strings/<lang>.json`, decoded from
 * the original `ingamegui` tables. The Ogólne stat bars are the one exception: they pin their own
 * labels instead of ids 11-15.
 */
export const HUMANWINDOW = {
  general: 1, // 'Ogólne'
  work: 3, // 'Praca'
  equip: 4, // 'Ekwipunek'
  experience: 5, // 'Doświadczenie'
  assignHome: 28, // 'Przydziel Dom'
  removeHome: 29, // 'Usuń Dom'
  assignWork: 31, // 'Przydziel Miejsce Pracy'
  removeWork: 32, // 'Usuń Miejsce Pracy'
  weapon: 60, // 'Broń'
  armor: 63, // 'Zbroja'
  boots: 66, // 'Buty'
  tools: 69, // 'Narzędzia'
  misc: 72, // 'Ekwipunek'
} as const;
