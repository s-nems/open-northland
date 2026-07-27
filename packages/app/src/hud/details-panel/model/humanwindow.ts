/**
 * The `humanwindow` string ids the settler panel resolves at draw time — the decoded original section
 * titles and equipment-slot labels (`content/gui/strings/<lang>.json`, decoded from the original
 * `ingamegui` tables). Fidelity: everything the original does provide is looked up; the pinned Polish
 * fallbacks the model rows carry only cover a checkout without `content/`. One deliberate exception:
 * the Ogólne stat bars pin their own labels instead of the decoded 11–15 strings — see
 * `satisfactionBars`. Named per the no-magic-numbers rule so a slot/label id reads by meaning, not a
 * bare number.
 */
export const HUMANWINDOW = {
  general: 1, // 'Ogólne'
  work: 3, // 'Praca'
  equip: 4, // 'Ekwipunek'
  experience: 5, // 'Doświadczenie'
  assignHome: 28, // 'Przydziel Dom'
  assignWork: 31, // 'Przydziel Miejsce Pracy'
  weapon: 60, // 'Broń'
  armor: 63, // 'Zbroja'
  boots: 66, // 'Buty'
  tools: 69, // 'Narzędzia'
  misc: 72, // 'Ekwipunek'
} as const;
