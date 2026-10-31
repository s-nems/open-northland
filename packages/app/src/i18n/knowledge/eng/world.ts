import type { ArticleGroup } from '../../../hud/knowledge/articles.js';

export const WORLD: ArticleGroup = {
  group: 'World',
  items: [
    {
      id: 'goals',
      name: 'Mission Goals and Game End',
      lead: "A player is out when he has no living adult man left. Adult men and Heroes count. Women, Cyra and children don't.",
      blocks: [
        {
          h: 'Who decides',
        },
        {
          table: {
            head: ['Map', 'Victory', 'Defeat'],
            rows: [
              [
                'Multiplayer map, solo play included',
                "A goal on the map's list",
                'No adult man, a defeat goal from the script',
              ],
              ['Story mission', 'Map script', 'Map script, no adult man'],
              ['Map with no script', 'Last one standing', 'No adult man'],
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
                "Stock on building shelves. Ground piles, ship holds and goods in hand don't count",
                'Victory once every amount is met',
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
              ['Scripted victory', 'A mission event names the player', 'Victory'],
              ['Scripted defeat', 'A mission event names the player', 'Defeat'],
              [
                'Last one standing',
                'At least one rival is out and the rest are all friends with each other: [[article:diplomacy|Diplomacy]]',
                'Victory for everyone left',
              ],
            ],
            foot: 'The game shows progress on goods, "Inhabitants" and "Soldiers" as current/required. Last one standing applies when the map has no goods, people or scripted goal.',
          },
        },
        {
          list: [
            'The game checks for adult men first, then the list in map order.',
            "The first condition met settles a player's fate for good. A winner who then loses his people is still a winner.",
            "One player's victory doesn't end the game for the others.",
            'A map can exempt a given player from the adult man rule.',
          ],
        },
        {
          h: "What's left of a defeated player",
        },
        {
          steps: [
            'No adult man: vehicles vanish at once.',
            'Defeat comes at the next goal check.',
            'At the check after that, buildings, people, vehicles and signposts vanish.',
            "The player's animals go wild where they stand.",
          ],
        },
        {
          p: "That's for multiplayer maps. In story missions and on maps with no script only vehicles vanish, and the computer stops playing. Buildings and people stay.",
        },
      ],
      see: ['article:diplomacy', 'article:family', 'article:heroes'],
    },
    {
      id: 'vehicles',
      name: 'Vehicles and Ships',
      lead: 'A vehicle with no commander stands still. A Ship carries {{vehicle.shipSeats}} people, a Big Ship {{vehicle.bigShipSeats}}, commander included.',
      blocks: [
        {
          data: 'vehicles',
        },
        {
          table: {
            head: ['Vehicle', 'Who boards', 'Seats with commander'],
            rows: [
              [
                '[[good:handcart|Handcart]], [[good:oxcart|Ox Cart]]',
                '[[job:carrier|Carrier]], [[job:trader|Merchant]]',
                '1',
              ],
              ['[[good:ship_small|Ship]]', 'any adult', '{{vehicle.shipSeats}}'],
              ['[[good:ship_big|Big Ship]]', 'any adult', '{{vehicle.bigShipSeats}}'],
              ['[[good:catapult|Catapult]]', 'soldier, hero', '1'],
            ],
            num: [2],
          },
        },
        {
          list: [
            'The first one assigned becomes commander. If he leaves, the next passenger takes over.',
            'Whoever boards loses his workplace. A Carrier with a workplace and a Merchant take a free cart as a tool and keep their workplace.',
            'The commander or a Carrier aboard handles the hold. Without them you get "No carrier".',
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
            foot: "Steps per second. Full means {{haul.handcart}} of {{haul.handcart}} on the Handcart and {{haul.oxcart}} of {{haul.oxcart}} on the Ox Cart. Figures are for a barefoot driver, shoes are faster. A Ship doesn't slow under load and sails about {{pace.ship}} steps/s. A Carrier pulling a cart loses the same percentage of his walk. Picking a cart for a route: [[article:trade|Trade]].",
          },
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
                "[[building:work_joinery_02|Carpenter's Shop 3]], 4",
                '{{cost.handcartWood}} [[good:wood|Wood]]',
              ],
              [
                '[[good:oxcart|Ox Cart]]',
                "[[building:work_joinery_02|Carpenter's Shop 3]], 4",
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
            'It takes the nearest adult [[good:cattle|Ox]] you own on the same landmass, free and not inside a Cattle Farm.',
            'Every Cattle Farm keeps its first {{livestock.pair}} adults. Oxen with no farm also keep {{livestock.pair}}.',
            'The Ox walks to the cart and vanishes, and only then does the Ox Cart move.',
          ],
        },
        {
          h: 'Ships',
        },
        {
          list: [
            'The hold is shared by all goods.',
            "A Ship carries 1 vehicle: a Handcart, Ox Cart or Catapult. The vehicle's crew must fit aboard. A Big Ship carries no vehicles.",
            '"Moor" asks you to pick a shore. The ship stops {{vehicle.mooringDistance}} steps from the spot, with no harbour building needed.',
            'Nobody boards or leaves at sea.',
            'Ctrl/Cmd + click moors and lands the crew.',
          ],
        },
        {
          h: 'Hold',
        },
        {
          list: [
            '"target": how many pieces should be in the hold. Targets can\'t sum past capacity.',
            '"by the carrier": a Carrier with a workplace pulls the cart and takes what he picks up on each trip. Targets are locked.',
            'The commander or Carrier gets off when the cart stops or the ship moors. Nobody works at sea.',
            'He takes 1 piece at a time: pile, building within {{vehicle.cargoSearch}} steps, then further.',
            'The source must be on the same landmass as the door. He takes no food from dwellings.',
            'Target 0 or below the contents: the surplus goes to the nearest Warehouse or Headquarters with room, within {{vehicle.cargoSearch}} steps of the door. With none, it lands on the ground.',
            "A commander with no Carrier aboard lowers the target when there's nowhere to get the good. With a Carrier the target stays.",
            'A move order calls the crew aboard before leaving.',
          ],
        },
        {
          h: 'Losing a vehicle',
        },
        {
          table: {
            head: ['State', 'Crew aboard', 'Carried vehicle', 'Cargo'],
            rows: [
              [
                'Cart, [[good:catapult|Catapult]]',
                'Gets off at the door',
                '-',
                'Scattered within {{vehicle.spill}} steps',
              ],
              ['Ship moored', 'Gets off on the shore', 'Stops at the door', 'Lost'],
              ['Ship at sea', 'Sinks', 'Sinks with its crew', 'Lost'],
            ],
            foot: "The crew aboard can't be hit while the hull holds. Anyone off the deck only loses the assignment.",
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
              ['Shared last-standing victory', 'no', 'no', 'yes, both sides'],
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
              ['Map start', 'The map sets attitudes, a pair with no entry starts neutral'],
              ['A blow from outsiders', "The victim's attitude to the attacker turns hostile"],
              ['Computer neutral, you hostile to it', 'The computer turns hostile'],
              ['You lower your attitude to a friendly computer', 'The computer lowers its own to your level'],
              ['Computer hostile', 'Never goes back to peace on its own'],
              ['A tribute paid, a mission event', 'Can change their attitude'],
              ['"Attitude set by the scenario"', "You can't change it in the Diplomacy window"],
            ],
          },
        },
        {
          h: 'Peace time',
        },
        {
          list: [
            'Fighting between players under peace is blocked.',
            "You can't enter or build within {{peace.keepOut}} steps of a partner's building, unless you're closer to your own.",
            'Warnings come {{peace.noticeFirstMinutes}} min and {{peace.noticeLastMinutes}} min before the end.',
          ],
        },
        {
          h: 'First contact',
        },
        {
          p: 'Under fog, a tribe enters the Diplomacy window when you see one of its people, buildings, vehicles or stockades, or when it hits you. Contact never expires.',
        },
        {
          h: 'Tributes',
        },
        {
          p: 'Only a map script opens a tribute. "Pay" in the Diplomacy window takes the goods at once, nobody carries them. Sources, in order:',
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
            'A food demand takes any dish of the same class.',
            '"Storage minimum" doesn\'t protect goods from tribute.',
          ],
        },
      ],
      see: ['article:trade', 'article:fog', 'article:walls'],
    },
    {
      id: 'fog',
      name: 'Fog and Vision',
      lead: "You see only what's in reach of your people and buildings.",
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
              ['Classic + Fog of war', 'black map', 'grey terrain, no units'],
              ['Recon', 'grey terrain, no units', 'once revealed, stays visible'],
              ['Recon + Fog of war', 'grey terrain, no units', 'grey terrain, no units'],
            ],
          },
        },
        {
          p: "Grey terrain shows buildings, stockades, vehicles, chests, resources, logs and goods piles as last seen. People and animals don't show. This memory is also on the minimap and in saved games.",
        },
        {
          h: 'Vision range',
        },
        {
          figure: {
            id: 'vision',
            caption: 'Who sees what',
          },
        },
        {
          table: {
            head: ['Who', 'Range, steps'],
            rows: [
              ['[[job:scout|Scout]], [[building:headquarters|Headquarters]]', '{{vision.scout}}'],
              ['Hero, [[good:ship_small|Ship]], [[good:ship_big|Big Ship]]', '{{vision.hero}}'],
              ['Soldier, building, including towers and dwellings', '{{vision.soldier}}'],
              [
                '[[good:handcart|Handcart]], [[good:oxcart|Ox Cart]], [[good:catapult|Catapult]]',
                '{{vision.cart}}',
              ],
              ['Adult civilian, Woman, own animal', '{{vision.adult}}'],
              ['Child', '{{vision.child}}'],
              ['Construction site', '0'],
            ],
            num: [1],
            foot: "Steps counted across. Stockades, roads and signposts don't see.",
          },
        },
        {
          h: 'Fighting in fog',
        },
        {
          p: "Soldiers attack in fog too, a [[good:catapult|Catapult]] won't on its own. [[job:hunter|Hunters]] hunt regardless of fog.",
        },
      ],
      see: ['article:scout', 'article:stances', 'article:catapult', 'article:diplomacy', 'job:scout'],
    },
    {
      id: 'scout',
      name: 'Scout',
      lead: 'A Scout has no workplace. With no order he stands and waits.',
      blocks: [
        {
          h: 'What he does',
        },
        {
          table: {
            head: ['Task', 'How', 'More'],
            rows: [
              ['Signposts', '"Place signpost" order, no material', '[[article:roads|Roads and Signposts]]'],
              ['Exploring land', '"Explore" order', 'Below'],
              [
                'Animals',
                'Claims wild Oxen and Sheep by walking past them',
                '[[article:livestock|Livestock]]',
              ],
              ['Vision', '{{vision.scout}} steps, the most of any person', '[[article:fog|Fog and Vision]]'],
            ],
            foot: "Signpost reach doesn't apply to him, so he walks the whole map.",
          },
        },
        {
          h: '"Explore"',
        },
        {
          list: [
            'The order works only on Scouts, including several selected at once.',
            "He walks in rings from the order's spot, always to the nearest unexplored land.",
            'He stays on one landmass. Only a [[article:vehicles|ship]] takes him to another.',
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
              ['New order', 'Exploring is lost'],
              ['Shift order', 'Waits until exploring ends'],
              ['Change of profession', 'Exploring is lost'],
            ],
          },
        },
      ],
      see: ['article:roads', 'article:livestock', 'article:fog', 'job:scout'],
    },
    {
      id: 'wildlife',
      name: 'Wild Animals and Hunting',
      lead: 'An aggressive herd rushes people within {{wild.aggro}} steps of its home and turns back past {{wild.giveUp}} steps.',
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
                'Enraged when struck',
                'Bear, Elephant',
                'Anger lasts {{wild.angrySeconds}} s from the last blow, an attack in progress lasts until the target dies or takes shelter',
              ],
              ['Skittish', 'The rest', 'A struck leader flees up to {{wild.flight}} steps, the herd follows'],
            ],
            foot: 'The Ibex neither attacks nor flees.',
          },
        },
        {
          list: [
            'A blow alerts animals of the species within {{wild.kinAlarm}} steps of the one struck.',
            "Animals don't attack buildings or vehicles.",
          ],
        },
        {
          h: 'Herd growth',
        },
        {
          p: 'A wild herd larger than 1 and below the "Herd" column gains 1 adult every {{wild.growthMinutes}} min, but only about 1 herd in 5 grows.',
        },
        {
          h: 'What a Hunter hunts',
        },
        {
          list: [
            'The hunting ground is {{flag.hunter}} steps from the work flag or workplace. A chase runs {{wild.huntChase}} steps past it.',
            'He picks a close, weak animal.',
            'He hunts 1 quarry at a time and takes a new one only after collecting the kill.',
            "The Hunter's bow takes {{wild.hunterShot}} per shot, range {{hunterBow.min}}-{{hunterBow.max}} steps.",
            "He won't go for an adult Ibex on his own, but its young are game.",
            'He skips owned animals, enraged ones and those on another landmass.',
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
      lead: 'The Stock Farmer breeds only at exactly {{livestock.pair}} adults of a species. A third adult goes to slaughter.',
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
            head: ['Who', 'What he does', 'Range, steps'],
            rows: [
              [
                '[[job:scout|Scout]]',
                'Each step he takes claims wild Oxen and Sheep and the herd of any player you hold as hostile. The rest of a hostile herd nearby scatters',
                '{{livestock.captureRange}}, scatter {{livestock.scatterRange}}',
              ],
              [
                '[[job:breeder|Stock Farmer]]',
                'Brings the nearest animal of yours with no farm to the Cattle Farm',
                'same landmass',
              ],
              [
                '[[job:breeder|Stock Farmer]]',
                'Below a pair he takes one from another of your farms that has more than a pair',
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
            foot: "Young and slaughter take 8 s each. The Stock Farmer's production choice sets which species he tends. A Cattle Farm holds {{livestock.farmShelf}} pieces each of Meat, Wool and Leather.",
          },
        },
        {
          list: [
            'A [[building:work_animal_farm|Cattle Farm]] holds {{livestock.farmHerd}} animals in total, both species and young on the way.',
            "Young take {{livestock.growSeconds}} s ({{livestock.growMinutes}} min) to grow and don't count toward the pair.",
            "A parent must be within {{livestock.birthRange}} steps of the farm's door at birth. Further away, the input is lost and no young arrive.",
            "A Cattle Farm's crew is {{livestock.breeders}} [[job:breeder|Stock Farmers]] and {{livestock.carriers}} [[job:carrier|Carrier]].",
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
      lead: "The Religion bar drains only when making weapons and armour. At 0% a craftsman won't start a batch that costs Religion.",
      blocks: [
        {
          h: 'Run cost',
        },
        {
          table: {
            head: ['Profession', '15%', '30%'],
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
            'Below {{need.drivePct}}% Armourers and Blacksmiths go to pray, and with nowhere to pray you get "Wants to pray" at {{need.criticalPct}}%.',
            'Tailors don\'t go on their own, so order them to "Pray".',
            'At 0% a craftsman finishes a batch already paid for.',
          ],
        },
        {
          h: 'Where to pray',
        },
        {
          table: {
            head: ['Place', 'Condition'],
            rows: [
              ['Dwelling', 'A holy fire burns in it, always the first choice'],
              ['[[building:work_temple|Temple]]', 'Finished, yours'],
              ['[[building:headquarters|Headquarters]]', 'Finished, yours'],
            ],
            foot: "A prayer takes {{pray.seconds}} s and gives +{{pray.pct}}% Religion. Dwellings with no fire and foreign buildings don't work.",
          },
        },
        {
          h: 'Holy fire',
        },
        {
          p: 'Works from Dwelling 3. 1 [[good:holy_oil|Oil]] burns {{oil.burnMinutes}} min, a full fire {{oil.fullBurnMinutes}} min.',
        },
        {
          h: 'Temple aura',
        },
        {
          table: {
            head: ['Effect', 'Value'],
            rows: [
              ['Range', '{{aura.range}} steps'],
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
      lead: 'Papers from chests put up a building at once, with no construction, materials or discoveries.',
      blocks: [
        {
          h: 'Who opens',
        },
        {
          table: {
            head: ['Chest', 'Who'],
            rows: [
              ['Chest', 'any adult'],
              ['Magic Chest', '[[job:druid|Druid]], hero'],
            ],
            foot: 'The "Open chest" order. A settler is limited to his walking reach. Goods drop next to the chest.',
          },
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
                '{{chest.settlers}} Civilians, {{chest.settlers}} Women, {{chest.settlers}} Longsword Fighters or {{chest.settlers}} Longbow Archers',
                '{{chest.settlers}}',
                '{{chest.settlers}}',
              ],
              [
                '{{chest.wolves}} Wolves or {{chest.lions}} Lions, a wild pack',
                '{{chest.wolves}} or {{chest.lions}}',
                '{{chest.wolves}} or {{chest.lions}}',
              ],
            ],
            num: [1, 2],
            foot: "The map picks each chest's contents.",
          },
        },
        {
          h: 'Papers',
        },
        {
          table: {
            head: ['Paper', 'Effect'],
            rows: [
              ['Place a building of your choice', 'Any building in the catalogue, up at once'],
              ["Place 'name'", 'The named building, up at once'],
              ["Place 'name' and fill its store", 'The named building with its store full to the brim'],
            ],
            foot: 'A paper disappears once used. A refused spot doesn\'t use it. You\'ll find the list in the build window under "Papers".',
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
            foot: 'Such a chest gives a paper, a settler in that profession and access to the profession.',
          },
        },
      ],
      see: ['article:construction', 'article:trades', 'article:draughts'],
    },
  ],
};
