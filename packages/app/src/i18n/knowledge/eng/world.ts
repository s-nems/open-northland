import type { ArticleGroup } from '../../../hud/knowledge/articles.js';

export const WORLD: ArticleGroup = {
  group: 'World',
  items: [
    {
      id: 'goals',
      name: 'Mission Goals and Game End',
      lead: "You lose when you have no adult man left. A hero counts, women, Cyra and children don't.",
      blocks: [
        {
          h: 'How a map ends',
        },
        {
          table: {
            head: ['Map', 'Victory', 'Defeat'],
            rows: [
              [
                'Multiplayer map, solo play included',
                'Map goals, see the table below',
                'No adult man, or a defeat announced by the mission',
              ],
              ['Story mission', 'Announced by the mission', 'Announced by the mission, or no adult man'],
              ['Map with no mission', 'Last one standing', 'No adult man'],
            ],
          },
        },
        {
          h: 'Multiplayer map goals',
        },
        {
          table: {
            head: ['Goal', 'What counts', 'Result'],
            rows: [
              [
                'Goods',
                "Stock in buildings. Ground piles, ship holds and goods in hand don't count",
                'Victory once you have every required amount',
              ],
              [
                '"Inhabitants"',
                "All the player's people, children included",
                'Victory at the required number',
              ],
              [
                '"Soldiers"',
                'Adult men in a soldier profession, no heroes',
                'Victory at the required number',
              ],
              [
                'Mission announcement',
                "The mission announces the player's victory or defeat",
                'Victory or defeat',
              ],
              [
                'Last one standing',
                'At least one player is out and all the others are friendly to each other: [[article:diplomacy|Diplomacy]]',
                'Victory for everyone left',
              ],
            ],
            foot: 'The game shows progress on goods, "Inhabitants" and "Soldiers" as current/required. Last one standing applies only when the map has no goods or people goals and the mission announces no result.',
          },
        },
        {
          list: [
            'For the first {{match.graceSeconds}} s of play, having no men does not mean defeat.',
            'The result is settled once and for good. A winner stays a winner even if he loses his people later.',
            "One player's victory doesn't end the game for the others.",
          ],
        },
        {
          h: "What's left of a defeated player",
        },
        {
          p: "On a multiplayer map the defeated player's buildings, vehicles and signposts vanish, his people on land turn into wild chickens and his animals go wild. In story missions and on maps with no mission only vehicles vanish, and the computer stops playing.",
        },
      ],
      see: ['article:diplomacy', 'article:family', 'article:heroes'],
    },
    {
      id: 'vehicles',
      name: 'Vehicles and Ships',
      lead: 'A vehicle with no commander goes nowhere. A Ship carries more people, a Big Ship more goods.',
      blocks: [
        {
          p: "Each vehicle's card gives its hold, passenger places, health and cost: [[vehicle:handcart|Handcart]], [[vehicle:oxcart|Ox Cart]], [[vehicle:ship_small|Ship]], [[vehicle:ship_big|Big Ship]], [[vehicle:catapult|Catapult]]. Which workshop makes what is on the cards of [[building:work_joinery_02|Carpenter's Shop 3]] and [[building:work_joinery_03|4]].",
        },
        {
          table: {
            head: ['Vehicle', 'Who boards'],
            rows: [
              [
                '[[good:handcart|Handcart]], [[good:oxcart|Ox Cart]]',
                '[[job:carrier|Carrier]], [[job:trader|Merchant]]',
              ],
              ['[[good:ship_small|Ship]], [[good:ship_big|Big Ship]]', 'any adult'],
              ['[[good:catapult|Catapult]]', 'soldier, hero'],
            ],
          },
        },
        {
          list: [
            'The passenger count on the card does not include the commander. The first one assigned becomes commander, and when he leaves the next passenger takes over.',
            'The [[job:joiner|Carpenter]] puts a vehicle up on a site next to the workshop, and a ship on water within the workshop\'s reach. With no such water, the build window warns "No ship water in reach".',
            'Whoever boards loses his workplace. Only a Carrier with a workplace and a Merchant pull the cart themselves and keep their work.',
            'The commander and any adult man aboard load the goods, but soldiers, heroes, [[job:scout|Scouts]] and [[job:druid|Druids]] only when they are in command. With nobody to load you get "No carrier".',
          ],
        },
        {
          h: 'Which cart to choose',
        },
        {
          list: [
            'The [[good:handcart|Handcart]] suits short routes, the [[good:oxcart|Ox Cart]] long ones: it carries {{haul.oxcart}} pieces and hardly slows down when loaded.',
            'Give [[job:carrier|Carriers]] Handcarts: on short runs between buildings they move more goods in the same time.',
            'Give [[job:trader|Merchants]] Ox Carts: on long trade routes they carry more. Where the line lies: [[article:trade|Trade]].',
          ],
        },
        {
          h: 'Speed with a load',
        },
        {
          table: {
            head: ['Vehicle', 'Road: empty', 'Road: full'],
            rows: [
              ['[[good:handcart|Handcart]]', '{{pace.cartRoad}}', '{{pace.handcartRoadFull}}'],
              ['[[good:oxcart|Ox Cart]]', '{{pace.cartRoad}}', '{{pace.oxcartRoadFull}}'],
              ['[[good:catapult|Catapult]]', '{{pace.catapultRoad}}', '-'],
            ],
            num: [1, 2],
            foot: 'Hexes per second. Full means {{haul.handcart}} pieces on the Handcart and {{haul.oxcart}} on the Ox Cart. Over land: the table below. Picking a cart for a route: [[article:trade|Trade]].',
          },
        },
        {
          h: 'How much a load slows a cart',
        },
        {
          table: {
            head: [
              'Load',
              'Handcart: speed loss',
              'Handcart: hexes/s on land',
              'Ox Cart: speed loss',
              'Ox Cart: hexes/s on land',
            ],
            rows: [
              [
                '{{vehicle.fill.0}}%',
                '{{vehicle.handcartLoss.0}}%',
                '{{pace.handcartLand.0}}',
                '{{vehicle.oxcartLoss.0}}%',
                '{{pace.oxcartLand.0}}',
              ],
              [
                '{{vehicle.fill.25}}%',
                '{{vehicle.handcartLoss.25}}%',
                '{{pace.handcartLand.25}}',
                '{{vehicle.oxcartLoss.25}}%',
                '{{pace.oxcartLand.25}}',
              ],
              [
                '{{vehicle.fill.50}}%',
                '{{vehicle.handcartLoss.50}}%',
                '{{pace.handcartLand.50}}',
                '{{vehicle.oxcartLoss.50}}%',
                '{{pace.oxcartLand.50}}',
              ],
              [
                '{{vehicle.fill.75}}%',
                '{{vehicle.handcartLoss.75}}%',
                '{{pace.handcartLand.75}}',
                '{{vehicle.oxcartLoss.75}}%',
                '{{pace.oxcartLand.75}}',
              ],
              [
                '{{vehicle.fill.100}}%',
                '{{vehicle.handcartLoss.100}}%',
                '{{pace.handcartLand.100}}',
                '{{vehicle.oxcartLoss.100}}%',
                '{{pace.oxcartLand.100}}',
              ],
            ],
            num: [0, 1, 2, 3, 4],
            foot: "Load is the share of the cart's hold in use. The loss grows evenly with the load: a full Handcart goes {{vehicle.handcartLoss.100}}% slower, a half-full one {{vehicle.handcartLoss.50}}%. A full Ox Cart loses {{vehicle.oxcartLoss.100}}%. For comparison: a settler in shoes walks {{pace.walkerLand}} hexes/s on land (a step every {{step.landBrief}} s).",
          },
        },
        {
          list: [
            "That's how a cart with a commander moves. Shoes change nothing here.",
            'A Carrier or Merchant pulling a cart himself goes at his own pace, faster in shoes. The load slows him by the same percentage: a shod Merchant with a full Handcart takes {{step.traderFullCart}} s per step on land.',
            'A [[good:catapult|Catapult]] moves over land at {{pace.catapultLand}} hexes/s.',
            "A loaded Ship doesn't slow down and sails about {{pace.ship}} hexes/s.",
          ],
        },
        {
          h: 'An Ox for the Ox Cart',
        },
        {
          p: 'A finished Ox Cart waits for its draught animal and takes the nearest adult [[good:cattle|Ox]] from the same landmass. Every Cattle Farm keeps {{draught.kept}} adult Oxen for itself and the same number stays from a herd with no farm, so the Ox Cart only gets an Ox beyond that number.',
        },
        {
          h: 'Ships',
        },
        {
          table: {
            head: ['Ship', 'Vehicle places', 'Vehicles'],
            rows: [
              ['[[good:ship_small|Ship]]', '{{vehicle.shipSlots}}', 'Handcart, Ox Cart, Catapult'],
              ['[[good:ship_big|Big Ship]]', '{{vehicle.bigShipSlots}}', 'Handcart, Ox Cart'],
            ],
            num: [1],
          },
        },
        {
          list: [
            "A vehicle goes aboard if its crew fits on the ship. A ship pinned to a Merchant's route takes no vehicle.",
            '"Moor": pick a shore and the ship stops {{vehicle.mooringDistance}} hexes from it. No harbour needed.',
            'Nobody boards or leaves at sea.',
            'Ctrl/Cmd + right-click moors and lands everyone but the commander, so the ship can sail off at once.',
          ],
        },
        {
          h: 'Hold',
        },
        {
          list: [
            '"target" is the number of pieces you want in the hold. Targets can\'t sum past capacity.',
            '"by the carrier": a Carrier pulls the cart and picks the load himself on each trip. You can\'t set targets then.',
            'Whoever loads carries 1 piece at a time. He looks for goods within {{vehicle.cargoSearch}} hexes of the cart first, then anywhere the signposts reach.',
            'The good must lie on the same landmass as the cart or ship. Nobody takes food from dwellings.',
            'When you lower a target, the surplus goes to the nearest Warehouse or Headquarters with room, within {{vehicle.cargoSearch}} hexes of the cart. With none, it lands on the ground.',
          ],
        },
        {
          h: 'Losing a vehicle',
        },
        {
          table: {
            head: ['Vehicle', 'Crew aboard', 'Carried vehicle', 'Cargo'],
            rows: [
              [
                'Cart, [[good:catapult|Catapult]]',
                'Gets off beside it',
                '-',
                'Scattered within {{vehicle.spill}} hexes',
              ],
              ['Ship moored', 'Gets off on the shore', 'Stops on the shore', 'Lost'],
              ['Ship at sea', 'Sinks', 'Sinks with its crew', 'Lost'],
            ],
            foot: 'While the vehicle holds, nobody can hit the crew inside it.',
          },
        },
      ],
      see: ['article:hauling', 'article:trade', 'article:catapult', 'article:livestock', 'good:handcart'],
    },
    {
      id: 'diplomacy',
      name: 'Diplomacy',
      lead: 'Attitude runs one way: yours to them and theirs to you are two separate settings.',
      blocks: [
        {
          h: 'What attitude does',
        },
        {
          table: {
            head: ['Effect', 'Hostile', 'Neutral', 'Friendly'],
            rows: [
              ['You attack their people and buildings', 'yes', 'no', 'no'],
              ['[[job:scout|Scouts]] take their Oxen and Sheep', 'yes', 'no', 'no'],
              ['[[job:trader|Merchant]] trade at their buildings with offers', 'no', 'no', 'yes, both sides'],
              ['Shared map view', 'no', 'no', 'yes, both sides'],
              ['Shared "Last one standing" victory', 'no', 'no', 'yes, both sides'],
            ],
            foot: 'A shared view also needs "Shared allied map" in the match settings.',
          },
        },
        {
          h: 'What changes attitude',
        },
        {
          table: {
            head: ['Event', 'Result'],
            rows: [
              ['Map start', 'The map sets attitudes. Where it gives none, you start neutral'],
              ['Someone attacks you', 'Your attitude to him turns hostile by itself'],
              ['You set hostile toward a neutral computer', 'The computer turns hostile too'],
              ['Neutral computer on an island map', 'Turns hostile to players by itself'],
              [
                'You lower your attitude to a friendly computer',
                'The computer lowers its own too, to your level',
              ],
              ['Hostile computer', 'Never makes peace on its own'],
              ['Mission', 'Can change attitude, also after a paid tribute'],
              ['"Attitude set by the scenario"', "You can't change it in the Diplomacy window"],
            ],
          },
        },
        {
          h: 'Peace time',
        },
        {
          list: [
            'You set "Peace time" before the game. Players under it can\'t fight each other.',
            "You can't send people or build within {{peace.keepOut}} hexes of that player's building, unless the spot lies closer to your own building.",
            'Warnings come {{peace.noticeFirstMinutes}} min and {{peace.noticeLastMinutes}} min before the end.',
          ],
        },
        {
          h: 'First contact',
        },
        {
          p: 'Under fog, a tribe enters the Diplomacy window when you see one of its people, buildings, vehicles or stockades, or when it attacks you. After that it stays there for good.',
        },
        {
          h: 'Tributes',
        },
        {
          p: 'Only a mission demands a tribute. "Pay" in the Diplomacy window takes the goods at once, nobody carries them, and "Storage minimum" doesn\'t protect them.',
        },
        {
          p: "The goods come from [[building:headquarters|Headquarters]], Warehouses and workshops, from a workshop only its own products. Dwellings, towers, the [[building:barracks|Barracks]], the [[building:school|School]] and ground piles don't pay.",
        },
      ],
      see: ['article:trade', 'article:fog', 'article:walls'],
    },
    {
      id: 'fog',
      name: 'Fog and Vision',
      lead: 'The Scout sees {{vision.scout}} hexes, Headquarters {{vision.headquarters}}. A construction site sees nothing.',
      blocks: [
        {
          h: 'Map modes',
        },
        {
          table: {
            head: ['Setting', 'Start', 'Terrain out of sight'],
            rows: [
              ['Revealed', 'everything visible', 'no fog'],
              ['Classic', 'black map', 'once revealed, stays visible'],
              ['Classic + Fog of war', 'black map', 'grey terrain, no people or animals'],
              ['Recon', 'grey terrain, no people or animals', 'once revealed, stays visible'],
              [
                'Recon + Fog of war',
                'grey terrain, no people or animals',
                'grey terrain, no people or animals',
              ],
            ],
          },
        },
        {
          p: "Grey terrain shows buildings, goods, resources and vehicles as they were when you last saw them. People and animals don't show there.",
        },
        {
          h: 'Vision range',
        },
        {
          figure: {
            id: 'vision',
            caption: 'Vision range',
          },
        },
        {
          table: {
            head: ['Who', 'Range, hexes'],
            rows: [
              ['[[job:scout|Scout]]', '{{vision.scout}}'],
              ['[[building:headquarters|Headquarters]]', '{{vision.headquarters}}'],
              ['Hero', '{{vision.hero}}'],
              ['[[good:ship_small|Ship]], [[good:ship_big|Big Ship]]', '{{vision.ship}}'],
              ['Soldier', '{{vision.soldier}}'],
              ['Any other building', '{{vision.building}}'],
              ['[[good:handcart|Handcart]], [[good:oxcart|Ox Cart]]', '{{vision.cart}}'],
              ['[[good:catapult|Catapult]]', '{{vision.siege}}'],
              ['Other adults, your animals', '{{vision.adult}}'],
              ['Child', '{{vision.child}}'],
              ['Construction site', '0'],
            ],
            num: [1],
            foot: 'Stockades, roads and signposts reveal nothing. Soldiers and [[job:hunter|Hunters]] find targets in fog too, but a [[good:catapult|Catapult]] fires on its own only at what it can see.',
          },
        },
      ],
      see: ['article:scout', 'article:stances', 'article:catapult', 'article:diplomacy', 'job:scout'],
    },
    {
      id: 'scout',
      name: 'Scout',
      lead: 'A Scout has no workplace and does nothing without an order.',
      blocks: [
        {
          p: "He places [[article:roads|signposts]] with no material and claims wild Oxen and Sheep when he walks past them: [[article:livestock|Livestock]]. He can walk the whole map, signposts don't limit him.",
        },
        {
          h: '"Explore"',
        },
        {
          list: [
            'He uncovers land wider and wider around the spot you point at.',
            "He won't leave his landmass. Only a [[article:vehicles|ship]] can take him to another.",
            'He skips narrow strips along shores and map edges, so small patches may stay unexplored.',
          ],
        },
        {
          h: 'When he finishes',
        },
        {
          table: {
            head: ['Event', 'Result'],
            rows: [
              ['Nothing left to explore', 'Notice "Land explored", the Scout waits'],
              [
                'More than {{explore.maxFailedLegs}} times in a row he failed to get there',
                'The rest counts as unreachable, "Land explored"',
              ],
              ['New order or change of profession', 'Exploring stops'],
              ['Shift order', 'Carried out after exploring ends'],
            ],
          },
        },
      ],
      see: ['article:roads', 'article:livestock', 'article:fog', 'job:scout'],
    },
    {
      id: 'wildlife',
      name: 'Wild Animals and Hunting',
      lead: 'An aggressive herd rushes people within {{wild.aggro}} hexes of where it grazes. It chases at most {{wild.giveUp}} hexes, then turns back.',
      blocks: [
        {
          p: "An animal's card in the Encyclopedia gives its health, herd size and whether it can be tamed.",
        },
        {
          h: 'Aggression',
        },
        {
          table: {
            head: ['Group', 'Animals', 'Behaviour'],
            rows: [
              ['Aggressive', 'Wolf, Lion, Lioness, Polar Bear', 'Attack on their own'],
              [
                'Fight back when struck',
                'Bear, Elephant',
                'Dangerous for {{wild.angrySeconds}} s from the last blow. An attack in progress lasts until the target dies or hides',
              ],
              ['Skittish', 'The rest', 'A struck leader flees up to {{wild.flight}} hexes, the herd follows'],
            ],
            foot: 'The Ibex neither attacks nor flees.',
          },
        },
        {
          list: [
            'When you strike an animal, others of its species within {{wild.kinAlarm}} hexes react too.',
            "Animals don't attack buildings or vehicles.",
          ],
        },
        {
          h: 'Herd growth',
        },
        {
          p: 'Only about 1 herd in {{wild.breedingShare}} grows. Such a herd gains 1 adult every {{wild.growthMinutes}} min, if it has at least 2 animals and fewer than "Herd" on the animal card says.',
        },
        {
          h: 'What a Hunter hunts',
        },
        {
          list: [
            'The hunting ground reaches {{flag.hunter}} hexes from the work flag or workplace. In a chase the Hunter goes at most {{wild.huntChase}} hexes past it.',
            'He goes for the weakest animal first, even if it is far away.',
            "The Hunter's shot takes {{wild.hunterShot}} health from an animal and reaches from {{hunterBow.min}} to {{hunterBow.max}} hexes.",
            "He won't hunt an adult Ibex on his own, but he will hunt its young.",
            "He doesn't hunt animals that belong to someone, or those on another landmass.",
            'On an animal card, "Hunter: on his own" is game he hunts by himself, and "on orders" is game he attacks only when you order it.',
          ],
        },
        {
          h: 'Kill',
        },
        {
          p: 'What an adult animal leaves is on its card. A young one killed by a Hunter gives half of that, a young Horse just 1 [[good:leather|Leather]]. A young one killed by anyone else leaves nothing.',
        },
      ],
      see: ['article:damage', 'article:gathering', 'article:livestock', 'job:hunter'],
    },
    {
      id: 'livestock',
      name: 'Livestock',
      lead: 'The Stock Farmer breeds animals only when he has exactly {{livestock.pair}} adults of a species. He slaughters a third one first.',
      blocks: [
        {
          figure: {
            id: 'livestock-cycle',
            caption: 'The breeding cycle',
          },
        },
        {
          h: 'Where to get animals',
        },
        {
          table: {
            head: ['Who', 'What he does', 'Range, hexes'],
            rows: [
              [
                '[[job:scout|Scout]]',
                'Walking past, he claims wild Oxen and Sheep and the animals of an enemy. Those a little further away scatter',
                'claim {{livestock.captureRange}}, scatter {{livestock.scatterRange}}',
              ],
              [
                '[[job:breeder|Stock Farmer]]',
                'Brings your nearest animal from outside a farm to the Cattle Farm. When he lacks a pair, he also takes the surplus from another of your farms',
                'same landmass',
              ],
            ],
            foot: 'A Scout standing still claims nothing.',
          },
        },
        {
          h: 'Slaughter',
        },
        {
          table: {
            head: ['Animal', 'Slaughter gives'],
            rows: [
              [
                '[[good:sheep|Sheep]]',
                '{{livestock.sheepWool}} [[good:wool|Wool]], {{livestock.sheepMeat}} [[good:meat|Meat]]',
              ],
              [
                '[[good:cattle|Ox]]',
                '{{livestock.cattleLeather}} [[good:leather|Leather]], {{livestock.cattleMeat}} [[good:meat|Meat]]',
              ],
            ],
            foot: "You pick the species in the Stock Farmer's production. What a young animal costs and takes, and how many goods the farm holds, is on the [[building:work_animal_farm|Cattle Farm]] card.",
          },
        },
        {
          list: [
            'A [[building:work_animal_farm|Cattle Farm]] holds {{livestock.farmHerd}} animals in total, counting both species and young on the way.',
            "Young take {{livestock.growMinutes}} min to grow and don't count toward the pair until then.",
          ],
        },
        {
          h: 'Cattle Farm status',
        },
        {
          table: {
            head: ['Message', 'Meaning'],
            rows: [
              ['"No animals"', 'Not a single animal, you need a Scout'],
              ['"Only one animal"', 'You need a second one'],
              ['"Young growing up"', 'Breeding resumes once a pair is grown'],
              ['"Herd full"', 'The Stock Farmer waits for the young to grow up'],
            ],
          },
        },
      ],
      see: ['article:vehicles', 'article:wildlife', 'article:food', 'building:work_animal_farm'],
    },
    {
      id: 'religion',
      name: 'Religion and the Temple',
      lead: "Religion drops only when making weapons and armour. At 0% a craftsman doesn't make weapons or armour.",
      blocks: [
        {
          h: 'What each item costs in Religion',
        },
        {
          table: {
            head: [
              'Profession',
              'Costs {{piety.lowPct}}% Religion per piece',
              'Costs {{piety.highPct}}% Religion per piece',
            ],
            rows: [
              [
                '[[job:armorer|Armourer]]',
                '[[good:bow_short|Short Bow]], [[good:spear_wooden|Wooden Spear]]',
                '[[good:bow_long|Longbow]]',
              ],
              [
                '[[job:smith|Blacksmith]]',
                '[[good:spear_iron|Iron Spear]], [[good:sword_shord|Shortsword]]',
                '[[good:sword_long|Longsword]], [[good:armor_chain|Chain Mail]], [[good:armor_plate|Plate Armour]]',
              ],
              [
                '[[job:sewer|Tailor]]',
                '[[good:armor_wool|Tunic]], [[good:armor_leather|Leather Armour]]',
                '-',
              ],
            ],
            foot: 'The same in every tribe. Other products of these professions cost no Religion.',
          },
        },
        {
          list: [
            'Below {{need.drivePct}}% the Armourer, Blacksmith and Tailor go to pray on their own. When they have nowhere to go, you get "Wants to pray" at {{need.criticalPct}}%.',
            'They finish an item already started, even at 0%.',
          ],
        },
        {
          h: 'Where to pray',
        },
        {
          table: {
            head: ['Place', 'Condition'],
            rows: [
              ['Dwelling', 'When a holy fire burns in it. Then a settler prays at home first'],
              [
                '[[building:work_temple|Temple]], [[building:headquarters|Headquarters]]',
                'Only finished and yours',
              ],
            ],
            foot: 'A prayer takes {{pray.seconds}} s and gives +{{pray.pct}}% Religion.',
          },
        },
        {
          h: 'Holy fire',
        },
        {
          p: 'You can light it in Dwelling 3 and up. 1 [[good:holy_oil|Oil]] lasts {{oil.burnTime}}, a full stock in the dwelling {{oil.fullBurnTime}}. The fire burns even when nobody is praying.',
        },
        {
          h: 'Temple aura',
        },
        {
          table: {
            head: ['Effect', 'Value'],
            rows: [
              ['Range', '{{aura.range}} hexes'],
              ['Health', '+{{aura.perSecond}} per second, up to {{aura.ceiling}}'],
              ['Religion', '+{{aura.pietyPct}}% per second while the bar is at {{need.satedPct}}% or less'],
              ['For whom', 'All your people, children only health'],
              ['Condition', 'Temple finished and undamaged'],
              ['Several Temples', "Auras don't stack"],
            ],
            foot: 'Health above {{health.human}} stays until wounds take it.',
          },
        },
      ],
      see: ['article:needs', 'article:health', 'building:work_temple', 'good:holy_oil'],
    },
    {
      id: 'chests',
      name: 'Chests and Papers',
      lead: 'Papers from chests put up a building at once, with no construction, materials or required discoveries.',
      blocks: [
        {
          p: 'Any adult can open a Chest, but only a [[job:druid|Druid]] or hero a Magic Chest. The order is "Open chest". The settler must be able to walk to it.',
        },
        {
          h: 'Contents',
        },
        {
          table: {
            head: ['Reward', 'Chest', 'Magic'],
            rows: [
              ['Potion or amulet', '{{chest.singleWooden}}', '{{chest.singleMagical}}'],
              ['Large potions, 1 kind', '{{chest.bulkWooden}}', '{{chest.bulkMagical}}'],
              [
                '[[good:armor_chain|Chain Mail]], [[good:armor_plate|Plate Armour]] or [[good:shoes|Shoes]]',
                '{{chest.wearWooden}}',
                '{{chest.wearMagical}}',
              ],
              ['[[good:bread|Food]]', '{{chest.foodWooden}}', '{{chest.foodMagical}}'],
              ['[[good:catapult|Catapult]]', '1', '1'],
              [
                'Civilians, Women, Longsword Fighters or Longbow Archers',
                '{{chest.settlers}}',
                '{{chest.settlers}}',
              ],
              [
                'Wolves or Lions. They come out wild and attack at once',
                '{{chest.wolves}} or {{chest.lions}}',
                '{{chest.wolves}} or {{chest.lions}}',
              ],
            ],
            num: [1, 2],
            foot: "The map sets each chest's contents, not chance.",
          },
        },
        {
          h: 'Papers',
        },
        {
          table: {
            head: ['Paper', 'Effect'],
            rows: [
              ['Place a building of your choice', 'Any building in the build list, up at once'],
              ["Place 'name'", 'The named building, up at once'],
              ["Place 'name' and fill its store", 'The named building with a full stock'],
            ],
            foot: 'A paper disappears once used, unless the spot doesn\'t fit. You find your papers in the build window under "Papers".',
          },
        },
        {
          h: 'Papers with a workshop',
        },
        {
          table: {
            head: ['Stocked building', 'Settler', 'Permanently discovers'],
            rows: [
              [
                '[[building:work_smithy_01|Smithy 2]]',
                '1 [[job:smith|Blacksmith]]',
                '[[good:sword_long|Longsword]]',
              ],
              [
                "[[building:work_armory_00|Armourer's Shop 1]]",
                '1 [[job:armorer|Armourer]]',
                '[[good:bow_short|Short Bow]]',
              ],
              [
                '[[building:work_coin_mint|Coin Mint]]',
                '1 [[job:coin_maker|Mint Worker]]',
                '[[good:coin|Coin]]',
              ],
              [
                "[[building:work_druid_00|Alchemist's Hut 1]]",
                '1 [[job:druid|Druid]]',
                '[[good:holy_oil|Oil]]',
              ],
              [
                "[[building:work_druid_01|Alchemist's Hut 2]]",
                '1 [[job:druid|Druid]]',
                '[[good:holy_oil|Oil]], small potions',
              ],
            ],
            foot: 'Such a chest also gives a settler in that profession and unlocks the profession.',
          },
        },
      ],
      see: ['article:construction', 'article:trades', 'article:draughts'],
    },
  ],
};
