// Authored examples of the live diplomacy row's fields; these are not a saved game.
export function nations() {
  return [
    {
      player: 1,
      name: 'Mieszkańcy Lasu',
      colour: '#769b57',
      towardYou: 'neutral',
      yourStance: 'friend',
      locked: false,
      tradeOffers: ['Oddajesz 2 deski, dostajesz 1 kamień'],
      tributes: [
        {
          slot: 1,
          text: 'Zapasy na nadchodzącą zimę',
          description:
            'Przekaż naszemu plemieniu drewno i żywność. Zima jest blisko, a nasze zapasy są na wyczerpaniu.',
          demands: [
            { good: 'wood', label: 'Drewno', amount: 20 },
            { good: 'food_simple', label: 'Prosta żywność', amount: 15 },
          ],
        },
        {
          slot: 2,
          text: 'Materiały dla osady',
          description: 'Potrzebujemy kamienia do rozbudowy naszej osady.',
          demands: [{ good: 'stone', label: 'Kamień', amount: 10 }],
        },
      ],
    },
    {
      player: 2,
      name: 'Strażnicy Przełęczy',
      colour: '#b56450',
      towardYou: 'enemy',
      yourStance: 'neutral',
      locked: false,
      tradeOffers: [],
      tributes: [],
    },
    {
      player: 3,
      name: 'Kupcy z Południa',
      colour: '#c8a655',
      towardYou: 'friend',
      yourStance: 'friend',
      locked: false,
      goodsTraded: 48,
      tradeOffers: ['Oddajesz 1 mebel, dostajesz 2 monety', 'Oddajesz 3 skóry, dostajesz 1 żelazo'],
      tributes: [],
    },
    {
      player: 4,
      name: 'Ludzie Jarla',
      colour: '#829fc1',
      towardYou: 'friend',
      yourStance: 'friend',
      locked: true,
      goodsTraded: 0,
      tradeOffers: [],
      tributes: [],
    },
  ];
}

export const initialStock = { wood: 34, food_simple: 8, stone: 26 };
export const stances = {
  friend: { label: 'Przyjazne', icon: 'shield' },
  neutral: { label: 'Neutralne', icon: 'banner' },
  enemy: { label: 'Wrogie', icon: 'swords' },
};
