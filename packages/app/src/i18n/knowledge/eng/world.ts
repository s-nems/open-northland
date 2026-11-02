import type { ArticleGroup } from '../../../hud/knowledge/articles.js';

export const WORLD: ArticleGroup = {
  group: 'World',
  items: [
    {
      id: 'goals',
      name: 'Mission Goals and Game End',
      lead: "A player loses when he has no adult man left. A hero counts. Women, Cyra and children don't.",
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
            'The game checks for men first, then the rest of the map goals in turn. It starts counting men only after {{match.graceSeconds}} s of play.',
            "The first condition met settles a player's fate for good.",
            "One player's victory doesn't end the game for the others, and a winner who then loses his people has still won.",
            'A map can exempt a given player from the adult man rule.',
          ],
        },
        {
          h: "What's left of a defeated player",
        },
        {
          steps: [
            'No adult man: vehicles vanish at once.',
            'Defeat comes at the next goal check, every {{match.checkSeconds}} s.',
            'At the check after that, buildings, vehicles and signposts vanish, and a wild chicken appears in place of each person standing on land.',
            "The player's animals go wild where they stand.",
          ],
        },
        {
          p: 'That goes for multiplayer maps. In story missions and on maps with no mission only vehicles vanish, and the computer stops playing.',
        },
      ],
      see: ['article:diplomacy', 'article:family', 'article:heroes'],
    },
    {
      id: 'vehicles',
      name: 'Vehicles and Ships',
      lead: 'A vehicle with no commander stands still. A Ship carries more people, a Big Ship more goods.',
      blocks: [
        {
          data: 'vehicles',
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
            'The "Passengers" column does not count the commander. The first one assigned becomes commander, and if he leaves the next passenger takes over.',
            'Whoever boards loses his workplace. The exception is a Carrier with a workplace and a Merchant, who pull the cart themselves and keep their work.',
            'The commander and any adult man aboard handle the hold. Soldiers, heroes, [[job:scout|Scouts]] and [[job:druid|Druids]] load only as commanders. With nobody to do it you get "No carrier".',
          ],
        },
        {
          h: 'Speed with a load',
        },
        {
          table: {
            head: ['Vehicle', 'Loss, full', 'Road: empty', 'Road: full', 'Land: empty', 'Land: full'],
            rows: [
              [
                '[[good:handcart|Handcart]]',
                '{{vehicle.handcartLossPct}}%',
                '{{pace.cartRoad}}',
                '{{pace.handcartRoadFull}}',
                '{{pace.cartLand}}',
                '{{pace.handcartLandFull}}',
              ],
              [
                '[[good:oxcart|Ox Cart]]',
                '{{vehicle.oxcartLossPct}}%',
                '{{pace.cartRoad}}',
                '{{pace.oxcartRoadFull}}',
                '{{pace.cartLand}}',
                '{{pace.oxcartLandFull}}',
              ],
              ['[[good:catapult|Catapult]]', '-', '{{pace.catapultRoad}}', '-', '{{pace.catapultLand}}', '-'],
            ],
            num: [1, 2, 3, 4, 5],
            foot: 'Hexes per second. Full means {{haul.handcart}} pieces on the Handcart and {{haul.oxcart}} on the Ox Cart. The loss grows with the load: half a cart is half the loss. Picking a cart for a route: [[article:trade|Trade]].',
          },
        },
        {
          list: [
            "That's how a cart with a commander moves, shoes change nothing here.",
            'A Carrier or Merchant pulling a cart himself goes at his own step. In shoes he moves faster and loses the same percentage.',
            "A Ship doesn't slow under load and sails about {{pace.ship}} hexes/s.",
          ],
        },
        {
          h: 'Construction',
        },
        {
          table: {
            head: ['Vehicle', 'Workshop', 'Cost'],
            rows: [
              [
                '[[good:handcart|Handcart]]',
                "[[building:work_joinery_02|Carpenter's Shop 3]] and [[building:work_joinery_03|4]]",
                '{{cost.handcartWood}} [[good:wood|Wood]]',
              ],
              [
                '[[good:oxcart|Ox Cart]]',
                "[[building:work_joinery_02|Carpenter's Shop 3]] and [[building:work_joinery_03|4]]",
                '{{cost.oxcartWood}} [[good:wood|Wood]]',
              ],
              [
                '[[good:ship_small|Ship]]',
                "[[building:work_joinery_03|Carpenter's Shop 4]]",
                '{{cost.shipWood}} [[good:wood|Wood]], {{cost.shipLeather}} [[good:leather|Leather]]',
              ],
              [
                '[[good:ship_big|Big Ship]]',
                "[[building:work_joinery_03|Carpenter's Shop 4]]",
                '{{cost.bigShipWood}} [[good:wood|Wood]], {{cost.bigShipLeather}} [[good:leather|Leather]]',
              ],
              [
                '[[good:catapult|Catapult]]',
                "[[building:work_joinery_03|Carpenter's Shop 4]]",
                '{{catapult.wood}} [[good:wood|Wood]], {{catapult.iron}} [[good:iron|Iron]]',
              ],
            ],
            foot: 'The [[job:joiner|Carpenter]] puts a vehicle up on a site next to the workshop, a ship on the water by the shore.',
          },
        },
        {
          h: 'An Ox for the Ox Cart',
        },
        {
          steps: [
            'A finished Ox Cart shows status "Waiting for its draught animal".',
            "It takes the nearest adult [[good:cattle|Ox]] from the same landmass. An Ox inside a Cattle Farm doesn't count.",
            'Every Cattle Farm keeps {{livestock.pair}} adult Oxen. The same number stays from a herd with no farm.',
            'The Ox walks to the cart and vanishes, and only then does the Ox Cart move.',
          ],
        },
        {
          h: 'Ships',
        },
        {
          list: [
            'All goods share the capacity of the hold.',
            "A Ship carries 1 vehicle: a Handcart, Ox Cart or Catapult. The vehicle's crew must fit aboard. A Big Ship carries no vehicles.",
            '"Moor": pick a shore and the ship stops {{vehicle.mooringDistance}} hexes from it. No harbour needed.',
            'Nobody boards or leaves at sea.',
            'Ctrl/Cmd + right-click moors and lands the crew.',
          ],
        },
        {
          h: 'Hold',
        },
        {
          list: [
            '"target": how many pieces should be in the hold. Targets can\'t sum past capacity.',
            '"by the carrier": a Carrier pulls the cart and decides on each trip what to load. You can\'t set targets.',
            'Whoever loads gets off when the cart stops or the ship moors.',
            'He carries 1 piece at a time. He looks for piles within {{vehicle.cargoSearch}} hexes of the cart first, then buildings in the same reach, and last anywhere the signposts reach.',
            'The good must lie on the same landmass as the cart or ship. Nobody takes food from dwellings.',
            'When you lower a target, the surplus goes to the nearest Warehouse or Headquarters with room, within {{vehicle.cargoSearch}} hexes of the cart. With none, it lands on the ground.',
            "When a commander who is a soldier or hero loads alone and there's nowhere to get the good, the target drops by itself. The same goes for a [[job:scout|Scout]] and a [[job:druid|Druid]].",
            'A move order calls the crew aboard before leaving.',
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
            foot: "The crew in a vehicle can't be hit while the vehicle holds. Anyone standing beside it simply stops being part of the crew.",
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
              ['Another player hits you', 'Your attitude to him turns hostile by itself'],
              ['You set hostile toward a neutral computer', 'The computer turns hostile too'],
              ['Neutral computer on an island map', 'Turns hostile to players by itself'],
              [
                'You lower your attitude to a friendly computer',
                'The computer lowers its own too, to your level',
              ],
              ['Computer hostile', 'Never goes back to peace on its own'],
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
            "You can't send people or build within {{peace.keepOut}} hexes of a partner's building, unless the spot lies closer to your own building.",
            'Warnings come {{peace.noticeFirstMinutes}} min and {{peace.noticeLastMinutes}} min before the end.',
          ],
        },
        {
          h: 'First contact',
        },
        {
          p: 'Under fog, a tribe enters the Diplomacy window when you see one of its people, buildings, vehicles or stockades, or when it attacks you. It stays there for good.',
        },
        {
          h: 'Tributes',
        },
        {
          p: 'Only a mission demands a tribute. "Pay" in the Diplomacy window takes the goods at once, nobody carries them. The game takes them from:',
        },
        {
          steps: [
            'The first [[building:headquarters|Headquarters]].',
            'Other Headquarters and Warehouses.',
            'Workshops, their own products only, no inputs.',
          ],
        },
        {
          list: [
            "Dwellings, towers, the [[building:barracks|Barracks]], the [[building:school|School]] and ground piles don't pay.",
            'When a mission demands food, you can pay with any dish of the same class.',
            '"Storage minimum" doesn\'t protect goods from tribute.',
          ],
        },
      ],
      see: ['article:trade', 'article:fog', 'article:walls'],
    },
    {
      id: 'fog',
      name: 'Fog and Vision',
      lead: 'The Scout and Headquarters see furthest, {{vision.scout}} hexes. A construction site sees nothing.',
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
          p: "Grey terrain shows buildings, stockades, vehicles, chests, resources, logs and goods piles as last seen. People and animals don't show.",
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
              ['[[job:scout|Scout]], [[building:headquarters|Headquarters]]', '{{vision.scout}}'],
              ['Hero, [[good:ship_small|Ship]], [[good:ship_big|Big Ship]]', '{{vision.hero}}'],
              ['Soldier, building, including towers and dwellings', '{{vision.soldier}}'],
              [
                '[[good:handcart|Handcart]], [[good:oxcart|Ox Cart]], [[good:catapult|Catapult]]',
                '{{vision.cart}}',
              ],
              ['Other adults, own animal', '{{vision.adult}}'],
              ['Child', '{{vision.child}}'],
              ['Construction site', '0'],
            ],
            num: [1],
            foot: "Stockades, roads and signposts don't see. Soldiers and [[job:hunter|Hunters]] find targets in fog too. A [[good:catapult|Catapult]] picks on its own only a target it can see.",
          },
        },
      ],
      see: ['article:scout', 'article:stances', 'article:catapult', 'article:diplomacy', 'job:scout'],
    },
    {
      id: 'scout',
      name: 'Scout',
      lead: 'A Scout has no workplace. With no order he stands still.',
      blocks: [
        {
          p: "He places [[article:roads|signposts]] with no material and claims wild Oxen and Sheep by walking past them: [[article:livestock|Livestock]]. Signposts don't limit him, so he walks the whole map.",
        },
        {
          h: '"Explore"',
        },
        {
          list: [
            'You can send several at once.',
            "He uncovers land in rings around the order's spot.",
            "He won't leave his landmass. Only a [[article:vehicles|ship]] can take him to another.",
            'He skips narrow strips along shores and map edges, so small patches stay unexplored.',
            'He eats and sleeps along the way, then carries on from where he stands.',
          ],
        },
        {
          h: 'When he finishes',
        },
        {
          table: {
            head: ['Event', 'Result'],
            rows: [
              ['No land left to explore', 'Notice "Land explored", the Scout waits'],
              [
                'More than {{explore.maxFailedLegs}} failed targets in a row',
                'The rest counts as unreachable, "Land explored"',
              ],
              ['Map mode "Revealed"', '"Land explored" at once'],
              ['New order, change of profession', 'Exploring is lost'],
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
          data: 'animals',
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
                'Attack when struck',
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
          p: 'Only about 1 herd in {{wild.breedingShare}} grows at all. Such a herd gains 1 adult every {{wild.growthMinutes}} min, if it has at least 2 animals and fewer than the "Herd" column says. A lone animal doesn\'t breed.',
        },
        {
          h: 'What a Hunter hunts',
        },
        {
          list: [
            'The hunting ground is {{flag.hunter}} hexes from the work flag or workplace. A chase runs {{wild.huntChase}} hexes past it.',
            'He picks the animal with the lowest sum of health and distance. Health runs in hundreds and thousands, so the weakest wins, even far away.',
            'He hunts 1 animal at a time and takes a new one only after collecting the kill.',
            "The Hunter's shot takes {{wild.hunterShot}} health from an animal, range {{hunterBow.min}}-{{hunterBow.max}} hexes.",
            "He won't go for an adult Ibex on his own, but its young are game.",
            'He skips owned animals and those on another landmass.',
            'The "Auto-hunted" column: "on his own" is game he goes for himself, "on orders" he attacks only when you order it.',
          ],
        },
        {
          h: 'Kill',
        },
        {
          table: {
            head: ['Animal', "Hunter's kill", 'Killed by anyone else'],
            rows: [
              ['Adult', '2 [[good:leather|Leather]], 2 [[good:meat|Meat]]', '1 [[good:meat|Meat]]'],
              ['Young', '1 [[good:leather|Leather]], 1 [[good:meat|Meat]]', 'nothing'],
              ['Adult Horse', '1 [[good:leather|Leather]], 1 [[good:meat|Meat]]', '1 [[good:meat|Meat]]'],
              ['Young Horse', '1 [[good:leather|Leather]]', 'nothing'],
            ],
          },
        },
      ],
      see: ['article:damage', 'article:gathering', 'article:livestock', 'job:hunter'],
    },
    {
      id: 'livestock',
      name: 'Livestock',
      lead: 'The Stock Farmer breeds only at exactly {{livestock.pair}} adults of a species. A third one he slaughters first.',
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
                'With each step he claims wild Oxen and Sheep and the animals of a hostile player. Those further from him scatter',
                'claim {{livestock.captureRange}}, scatter {{livestock.scatterRange}}',
              ],
              [
                '[[job:breeder|Stock Farmer]]',
                'Brings the nearest animal of yours with no farm to the Cattle Farm. Below a pair he also takes one from another of your farms that has more than a pair',
                'same landmass',
              ],
            ],
            foot: 'A Scout standing still claims nothing.',
          },
        },
        {
          h: 'Young and slaughter',
        },
        {
          table: {
            head: ['Animal', 'Young costs', 'Slaughter gives'],
            rows: [
              [
                '[[good:sheep|Sheep]]',
                '{{livestock.calfWater}} [[good:water|Water]], {{livestock.calfWheat}} [[good:wheat|Wheat]]',
                '{{livestock.sheepWool}} [[good:wool|Wool]], {{livestock.sheepMeat}} [[good:meat|Meat]]',
              ],
              [
                '[[good:cattle|Ox]]',
                '{{livestock.calfWater}} [[good:water|Water]], {{livestock.calfWheat}} [[good:wheat|Wheat]]',
                '{{livestock.cattleLeather}} [[good:leather|Leather]], {{livestock.cattleMeat}} [[good:meat|Meat]]',
              ],
            ],
            foot: "Young and slaughter take about {{livestock.cycleSeconds}} s. You pick the species in the Stock Farmer's production. A Cattle Farm holds {{livestock.farmShelf}} pieces each of Meat, Wool and Leather.",
          },
        },
        {
          list: [
            'A [[building:work_animal_farm|Cattle Farm]] holds {{livestock.farmHerd}} animals in total, both species and young on the way.',
            "Young take {{livestock.growMinutes}} min to grow and don't count toward the pair until then.",
            'If the parent is more than {{livestock.birthRange}} hexes from the farm at birth, the inputs are lost and no young arrive.',
          ],
        },
        {
          h: 'Cattle Farm status',
        },
        {
          table: {
            head: ['Message', 'Meaning'],
            rows: [
              ['"No animals"', 'No animals of the species, you need a Scout'],
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
      lead: "The Religion bar drains only when making weapons and armour. At 0% a craftsman won't start a production cycle that costs Religion.",
      blocks: [
        {
          h: 'Cost of a production cycle',
        },
        {
          table: {
            head: ['Profession', '{{piety.lowPct}}%', '{{piety.highPct}}%'],
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
            foot: 'The same in every tribe. Other goods of these professions use no Religion.',
          },
        },
        {
          list: [
            'Below {{need.drivePct}}% the [[job:joiner|Carpenter]], Armourer, Blacksmith and Tailor go to pray on their own. With nowhere to pray you get "Wants to pray" at {{need.criticalPct}}%.',
            'They finish a cycle already started, even at 0%.',
          ],
        },
        {
          h: 'Where to pray',
        },
        {
          table: {
            head: ['Place', 'Condition'],
            rows: [
              ['Dwelling', 'When a holy fire burns in it. A settler goes there first'],
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
          p: 'You can light it from Dwelling 3. 1 [[good:holy_oil|Oil]] burns {{oil.burnMinutes}} min, a full stock in the dwelling {{oil.fullBurnMinutes}} min. It burns even when nobody is praying.',
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
              ['Who', "All the Temple owner's people. Children get health"],
              ['Condition', 'Temple finished and undamaged'],
              ['Several Temples', "One aura applies, values don't stack"],
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
          p: 'Any adult can open a Chest, but only a [[job:druid|Druid]] or hero a Magic Chest. The order is "Open chest". The settler must be able to reach it within his walking reach.',
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
            foot: 'A paper disappears once used. If the spot doesn\'t fit, you keep it. Your papers are in the build window under "Papers".',
          },
        },
        {
          p: 'Buildings on papers: [[building:home_level_01|Dwelling 2]], [[building:home_level_04|Dwelling 5]], [[building:stock_02|Warehouse 3]], [[building:headquarters|Headquarters]], [[building:work_well_00|Well]], [[building:work_farm_00|Farm]], [[building:work_mill_00|Mill]], [[building:work_bakery_00|Bakery 1]], [[building:work_temple|Temple]], [[building:school|School]], [[building:barracks|Barracks]], [[building:tower_01|Defence Tower 2]].',
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
            foot: 'Such a chest also gives a settler in that profession and access to the profession.',
          },
        },
      ],
      see: ['article:construction', 'article:trades', 'article:draughts'],
    },
  ],
};
