// The window as it ships today, for comparison: a capture of the running game.
export default {
  id: '0',
  name: 'Obecne okno',
  blurb: 'Zrzut z gry na dzisiejszym main: papirus z oryginału, stare zakładki, strzałki przewijania.',
  views: ['arrival', 'task'],
  background: (map) => `/mission-review/current-${map}.png`,
  render: () => '',
};
