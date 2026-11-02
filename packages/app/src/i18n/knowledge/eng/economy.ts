import type { ArticleGroup } from '../../../hud/knowledge/articles.js';

export const ECONOMY: ArticleGroup = {
  group: 'Economy',
  items: [
    {
      id: 'construction',
      name: 'Building, Upgrades and Repairs',
      lead: 'The strokes alone on Dwelling 1 take one Builder {{build.noviceSeconds}} s, or {{build.noviceIronSeconds}} s with an Iron Tool. Hauling the material comes on top of that.',
      blocks: [
        {
          h: 'Where you can build',
        },
        {
          table: {
            head: ['What', 'What happens'],
            rows: [
              [
                'Terrain',
                'You can build on land, sand, beach and stony desert. Mountains, snow, water and swamp are out.',
              ],
              [
                '[[building:work_well_00|Well]], [[building:work_hive_00|Beehive]]',
                'At least the edge of the building has to stand on grass.',
              ],
              [
                'Space',
                'A building reserves room for its top level from the start, plus a narrow margin around it. The margins of two buildings cannot overlap.',
              ],
              [
                'Tree, rock, deposit, stockade',
                'They block. They must stand outside the room for the top level.',
              ],
              [
                'Enemy soldier',
                "You can't build within {{contest.radius}} hexes of him, about {{contest.diagonal}} on the slant. Only a soldier you can see counts. A tower's crew at its post doesn't.",
              ],
              [
                'Building of a player you are at peace with',
                "You can't build within {{peace.keepOut}} hexes of his building or site, unless your own building stands closer to the spot than his.",
              ],
              ['Ground under fog', 'Blocks. The spot must be visible right now.'],
              ['Settler, vehicle, work flag, signpost, pile, carcass', 'Moved aside.'],
              ['Bush, field, stump, open chest', 'They vanish when the site goes up.'],
              ['Road site', 'Cancelled, delivered Quarrystone lands next to it.'],
              [
                'Road or stockade on room for upgrades',
                'A line you draw goes around that room. By default the G key lets you lay it there, but the upgrade removes it with no refund.',
              ],
              ['Enemy civilians, animals', "They don't get in the way. The site goes up beside them."],
              ['Finished road', 'Stays under the building.'],
              [
                'Signpost reach',
                'Does not apply. A site can go outside the network too, and the Builder arrives once the network gets there.',
              ],
            ],
          },
        },
        {
          figure: {
            id: 'step-diamond',
            caption: 'Why less on the slant',
          },
        },
        {
          h: 'How long building takes',
        },
        {
          table: {
            head: ['[[building:home_level_00|Dwelling 1]], 1 Builder', 'Strokes', 'Time'],
            rows: [
              ['No experience, no tool', '{{build.noviceSwings}}', '{{build.noviceSeconds}} s'],
              [
                'No experience, [[good:tool_iron|Iron Tool]]',
                '{{build.noviceIronSwings}}',
                '{{build.noviceIronSeconds}} s',
              ],
              [
                'Master, [[good:tool_iron|Iron Tool]]',
                '{{build.masterIronSwings}}',
                '{{build.masterIronSeconds}} s',
              ],
            ],
            num: [1, 2],
            foot: 'Dwelling 1 costs {{build.homeUnits}} pieces of material. Times cover the strokes alone, and 1 stroke takes {{build.swingSeconds}} s.',
          },
        },
        {
          table: {
            head: ['Experience', 'No tool', 'Wooden', 'Iron'],
            rows: [
              ['0-9%', '{{build.perUnit.0.bare}}', '{{build.perUnit.0.wooden}}', '{{build.perUnit.0.iron}}'],
              [
                '10-21%',
                '{{build.perUnit.10.bare}}',
                '{{build.perUnit.10.wooden}}',
                '{{build.perUnit.10.iron}}',
              ],
              [
                '22-49%',
                '{{build.perUnit.22.bare}}',
                '{{build.perUnit.22.wooden}}',
                '{{build.perUnit.22.iron}}',
              ],
              [
                '50-78%',
                '{{build.perUnit.50.bare}}',
                '{{build.perUnit.50.wooden}}',
                '{{build.perUnit.50.iron}}',
              ],
              [
                '79-89%',
                '{{build.perUnit.79.bare}}',
                '{{build.perUnit.79.wooden}}',
                '{{build.perUnit.79.iron}}',
              ],
              [
                '90-100%',
                '{{build.perUnit.90.bare}}',
                '{{build.perUnit.90.wooden}}',
                '{{build.perUnit.90.iron}}',
              ],
            ],
            num: [1, 2, 3],
            foot: 'Strokes per 1 piece of material. A [[job:builder|Builder]] reaches 100% after {{exp.build.repeatsFull}} strokes. Only strokes that added something count.',
          },
        },
        {
          list: [
            'A building with no cost takes 1 stroke.',
            'A stockade or road segment takes 1 Builder and 1 stroke once the material is there.',
            'The Builder and workers assigned to the site carry the material, 1 piece at a time.',
          ],
        },
        {
          h: "Builder's work order",
        },
        {
          steps: [
            'A road or stockade the player has just given this Builder.',
            'Repairs: gates, then buildings, then stockades.',
            'Building sites, supplied and nearly finished ones first.',
            'New stockade segments.',
            'Roads.',
          ],
        },
        {
          p: 'A Builder the player assigned to a site stays there, even if there is work elsewhere.',
        },
        {
          h: 'Upgrades',
        },
        {
          list: [
            'Costs the materials of the levels gained. You can skip several levels at once if each is unlocked.',
            'Goods in the cost that the building has in stock go straight to the site. The rest of its stock comes back on completion.',
            'Workers and residents move out, keep their places and return on completion.',
            'Health stands still during an upgrade. On completion the building has the full health of the new level.',
            'Starting an upgrade switches defence mode off.',
            'Cancelling returns the stock and the goods taken from it. Delivered material is lost.',
          ],
        },
        {
          h: 'Repairs',
        },
        {
          table: {
            head: ['Target', 'Health per stroke', 'Builders at once'],
            rows: [
              ['Building', '{{repair.minPerSwing}}-{{repair.maxPerSwing}}', '{{repair.crew}}'],
              ['Stockade segment', '{{wall.segmentRepair}}', '{{repair.wallCrew}}'],
              ['Gate', '{{wall.gateRepair}}', '{{repair.wallCrew}}'],
            ],
            num: [1, 2],
            foot: 'Repairs cost no material. For stockades and gates, experience and tools change nothing.',
          },
        },
        {
          list: [
            "A Builder won't go to repair on his own for {{repair.calmSeconds}} s after the last hit, or while a fight is on within {{alert.standTo}} hexes. Your order skips both conditions.",
            "Sites and stockades under construction can't be repaired. Their health grows as they are built.",
            'Damaged building being upgraded: repair first, then upgrade.',
          ],
        },
        {
          h: 'What is lost and what comes back',
        },
        {
          table: {
            head: ['Situation', 'Result'],
            rows: [
              ['Demolishing a site', 'Delivered material lands on the ground'],
              ['Demolishing or destroying a building', 'Contents plus half the cost, each good rounded up'],
              [
                'Demolishing a building mid-upgrade',
                'The same for the current level, plus set-aside stock and upgrade material',
              ],
            ],
            foot: "Goods spread out on the ground up to {{reach.spill}} hexes away, on the same landmass. What doesn't fit is lost.",
          },
        },
      ],
      see: ['article:tools', 'article:walls', 'article:roads', 'article:exp-work', 'job:builder'],
    },
    {
      id: 'workshops',
      name: 'Workshops and Product Choice',
      lead: 'The counter next to a product says how many cycles the worker should run: 0 is stop, ∞ is no limit. A cycle is one run of the recipe.',
      blocks: [
        {
          h: 'Counter values',
        },
        {
          table: {
            head: ['Counter', 'Workshop', 'Extractor'],
            rows: [
              ['0', 'Product stopped', 'Good skipped'],
              [
                '1-{{workshop.counterMax}}',
                'That many cycles, -1 at each cycle start',
                'That many pieces, -1 per piece gathered',
              ],
              ['∞', 'No limit, the counter never drops', 'No limit, the counter never drops'],
            ],
            foot: 'A workshop counts cycles, an Extractor counts pieces. Experience and tools add pieces per cycle: [[article:tools|Tools]].',
          },
        },
        {
          h: 'Buttons',
        },
        {
          table: {
            head: ['Button', 'Click', 'Shift', 'Ctrl'],
            rows: [
              [
                'Good icon, "Only this product"',
                'This good ∞, rest 0',
                '-',
                'This good: from 0 to ∞, from any other value to 0. Rest unchanged.',
              ],
              ['Less', '-1. From 0 jumps to ∞, from ∞ to {{workshop.counterMax}}', '-10', 'To 0'],
              ['More', '+1. From {{workshop.counterMax}} jumps to ∞, from ∞ to 0', '+10', 'To ∞'],
            ],
          },
        },
        {
          h: "A new worker's start",
        },
        {
          table: {
            head: ['Who', 'Starting counters'],
            rows: [
              ['Craftsman', "The workshop's first product ∞, rest 0"],
              [
                '[[job:breeder|Stock Farmer]] at a [[building:work_animal_farm|Cattle Farm]]',
                'Ox ∞, Sheep 0',
              ],
              [
                'Graduate assigned by the Assistant, when the School teaches this profession several products',
                'Products learned at School ∞, rest 0',
              ],
              ['[[job:collector|Extractor]]', 'Every good ∞'],
            ],
          },
        },
        {
          h: 'What happens to counters',
        },
        {
          p: 'They are lost when a worker changes workplace or profession, including when the building is demolished. An upgrade leaves them alone, and new products from the higher level start at 0. Each worker has his own counters: 2 men in one workshop can make 2 different products.',
        },
        {
          h: 'Several products at once',
        },
        {
          p: 'A worker takes turns on the products with a counter above 0, 1 cycle each, in panel order.',
        },
        {
          table: {
            head: ['Situation', 'Result'],
            rows: [
              [
                'Product stock full',
                'The worker moves on to the next product. Cycles in progress count as taken space.',
              ],
              ['No ingredient in the building', 'The worker moves on to the next product'],
              [
                'Part of an ingredient in the building',
                "He waits for the rest. When there's nowhere to get it, he moves on to the next product.",
              ],
              [
                'Product without the required experience',
                'Shows "locked" instead of a counter and is skipped',
              ],
              [
                'All products with a counter are locked',
                'The worker makes what he already knows, even products at 0',
              ],
            ],
          },
        },
        {
          h: 'Vehicles',
        },
        {
          list: [
            'A vehicle is built outside the workshop: the craftsman places a site next to it, hauls the material himself and builds.',
            "A vehicle's counter drops when the vehicle is finished, not at the start.",
            'With no room for a site next to the workshop, the worker moves on to the next product.',
          ],
        },
        {
          h: 'Extractors',
        },
        {
          table: {
            head: ['Action', 'Result'],
            rows: [
              ['"Only this good"', 'This good ∞, rest 0'],
              ['Right-click a resource', '"Gather": this good ∞, rest 0, the work flag stays where it was'],
              ['Ctrl + right-click a resource', 'The same, and the flag goes to the resource'],
              ['All counters at 0', 'Status "All set to 0"'],
              [
                'Counter at 0, good on the ground',
                'The counter covers extraction only. The Extractor keeps hauling logs and piles.',
              ],
            ],
          },
        },
      ],
      see: [
        'article:work-flag',
        'article:tools',
        'article:gathering',
        'article:exp-work',
        'article:vehicles',
      ],
    },
    {
      id: 'gathering',
      name: 'Gathering and Farming',
      lead: 'A tree gives {{gather.treeYield}} pieces of Wood after {{gather.strokes}} strokes. Rock takes that many strokes for 1 piece, so Wood comes about {{gather.treeYield}} times faster.',
      blocks: [
        {
          h: 'What a resource gives',
        },
        {
          table: {
            head: ['Resource', 'Who', 'Gives', 'Strokes with no experience', 'Time', 'Tool'],
            rows: [
              [
                'Tree',
                '[[job:collector|Extractor]]',
                '{{gather.treeYield}} [[good:wood|Wood]]',
                '{{gather.strokes}} per tree',
                '{{gather.treeSeconds}} s',
                'yes',
              ],
              [
                'Rock',
                '[[job:collector|Extractor]]',
                '4-5 [[good:stone|Quarrystone]]',
                '{{gather.strokes}} per piece',
                '{{gather.stoneSeconds}} s',
                'yes',
              ],
              [
                'Deposit',
                '[[job:collector|Extractor]]',
                '5 [[good:mud|Clay]], [[good:iron|Iron]] or [[good:gold|Gold]]',
                '{{gather.strokes}} per piece',
                '{{gather.oreSeconds}} s',
                'yes',
              ],
              [
                'Mushroom',
                '[[job:collector|Extractor]]',
                '1 [[good:mushroom|Mushroom]]',
                '1 pickup',
                '{{gather.mushroomSeconds}} s',
                'no',
              ],
              [
                'Wheat field',
                '[[job:farmer|Farmer]]',
                '1 [[good:wheat|Wheat]]',
                '{{gather.wheatStrokes}} per field',
                '{{gather.wheatSeconds}} s',
                'yes',
              ],
              [
                'Herb field',
                '[[job:herb_mush_guy|Herb Gatherer]]',
                '1 [[good:herb|Herb]]',
                '{{gather.herbStrokes}} per field',
                '{{gather.herbSeconds}} s',
                'yes',
              ],
              [
                'Shoal',
                '[[job:fisher|Fisherman]]',
                '1 [[good:fish|Fish]]',
                '{{gather.casts}} casts',
                '{{gather.fishSeconds}} s',
                'yes',
              ],
            ],
            foot: 'Working time only, with no experience, no tool and no walking.',
          },
        },
        {
          list: [
            'A felled tree lies as a log with {{gather.treeYield}} pieces. The Extractor carries them off 1 piece at a time.',
            'A piece from a rock or deposit drops on the ground beside it.',
          ],
        },
        {
          h: 'Iron and Gold',
        },
        {
          table: {
            head: ['Route', 'Condition', 'Who it applies to'],
            rows: [
              [
                'Work',
                '{{gather.oreNeed}} pieces of [[good:mud|Clay]] and [[good:stone|Quarrystone]] combined',
                'That settler. The first one discovers the good for the settlement.',
              ],
              ['[[building:school|School]]', 'A course, once the good is discovered', 'The graduate'],
            ],
            foot: 'Each settler has to meet the condition himself, separately for [[good:iron|Iron]] and [[good:gold|Gold]]. Until then the panel shows "locked".',
          },
        },
        {
          h: 'Field',
        },
        {
          figure: {
            id: 'field-stages',
            caption: 'From sowing to harvest',
          },
        },
        {
          p: 'A field grows only from watering, time has no effect. Each watering adds 1 stage to the field and 6 neighbouring ones, so a field needs at most {{field.waterings}} waterings. After the harvest 1 piece lies there and the spot is free to sow again.',
        },
        {
          p: 'Sowing and watering cost nothing, and no Water is needed.',
        },
        {
          table: {
            head: ['Building', 'Fields', 'Radius', 'Crew', 'Stock'],
            rows: [
              [
                '[[building:work_farm_00|Farm]]',
                '{{field.max}}',
                '{{field.radius}} hexes',
                '{{farm.farmers}} Farmers, {{farm.carriers}} Carrier',
                '{{farm.stock}}',
              ],
              [
                '[[building:work_herb_hut|Herb Hut]]',
                '{{field.max}}',
                '{{field.radius}} hexes',
                '{{herbHut.herbalists}} Herb Gatherers, {{herbHut.carriers}} Carrier',
                '{{herbHut.stock}}',
              ],
            ],
            num: [1, 4],
            foot: 'On the slant the radius is about {{field.diagonal}} hexes. The field limit is per building, not per worker. More people means faster harvests.',
          },
        },
        {
          h: 'Farmer and Herb Gatherer work order',
        },
        {
          steps: [
            'Takes the harvested piece to the building.',
            'Sows if the building has under {{field.max}} fields.',
            'Harvests the nearest ripe field.',
            'Waters the field at the lowest stage.',
            'Waits in the building.',
          ],
        },
        {
          p: "You can't sow a field on sand or on a road. Wild fields from the map within the building's radius count toward its limit.",
        },
        {
          p: "A field cut off from the building's door for {{field.reclaimSeconds}} s disappears and frees a place in the limit.",
        },
        {
          h: 'What grows back',
        },
        {
          table: {
            head: ['Source', 'Rate', 'Limit'],
            rows: [
              [
                '[[building:work_well_00|Well]]',
                '+1 [[good:water|Water]] per second, no worker',
                '{{well.stock}} in the building',
              ],
              [
                '[[building:work_hive_00|Beehive]]',
                '+1 [[good:honey|Honey]] per second, no worker',
                '{{hive.stock}} in the building',
              ],
              [
                'Fruit bush',
                '{{bush.regrowSeconds}} s: {{bush.stageSeconds}} s to bloom, {{bush.stageSeconds}} s to fruit',
                '1 meal',
              ],
              ['Shoal', '+1 fish every {{fish.regrowSeconds}} s', '{{fish.swarmMax}} fish'],
              ['Tree, rock, deposit, mushroom', 'Never grow back', '-'],
            ],
          },
        },
      ],
      see: [
        'article:tools',
        'article:hauling',
        'article:workshops',
        'article:work-flag',
        'article:exp-work',
        'job:collector',
        'job:farmer',
        'job:fisher',
      ],
    },
    {
      id: 'tools',
      name: 'Tools',
      lead: 'A tool cuts strokes and adds workshop pieces, and it lasts {{tool.uses}} uses.',
      blocks: [
        {
          h: 'Where a settler gets a tool',
        },
        {
          p: "Tools are handed out by the [[article:assistant|Assistant]], which is on from the start, or by your order. A settler goes to a store for one only with an empty tool slot, Iron before Wooden. He won't fetch a better one on his own.",
        },
        {
          h: 'Who benefits',
        },
        {
          table: {
            head: ['Who', 'What he gains'],
            rows: [
              ['Workshop craftsman', 'More pieces per cycle'],
              ['[[job:collector|Extractor]]', 'Fewer strokes, except mushrooms'],
              ['[[job:farmer|Farmer]], [[job:herb_mush_guy|Herb Gatherer]]', 'Fewer harvest strokes'],
              ['[[job:fisher|Fisherman]]', 'Fewer casts'],
              ['[[job:builder|Builder]]', 'Fewer strokes per piece of material'],
              ['[[job:hunter|Hunter]], [[job:carrier|Carrier]]', 'Nothing'],
              ['Soldiers, heroes', 'Carry no tools'],
            ],
          },
        },
        {
          h: 'Gathering strokes',
        },
        {
          table: {
            head: ['Experience', 'No tool', 'Wooden', 'Iron'],
            rows: [
              ['0%', '{{tool.strokes.0.bare}}', '{{tool.strokes.0.wooden}}', '{{tool.strokes.0.iron}}'],
              ['20%', '{{tool.strokes.20.bare}}', '{{tool.strokes.20.wooden}}', '{{tool.strokes.20.iron}}'],
              ['40%', '{{tool.strokes.40.bare}}', '{{tool.strokes.40.wooden}}', '{{tool.strokes.40.iron}}'],
              ['60%', '{{tool.strokes.60.bare}}', '{{tool.strokes.60.wooden}}', '{{tool.strokes.60.iron}}'],
              ['80%', '{{tool.strokes.80.bare}}', '{{tool.strokes.80.wooden}}', '{{tool.strokes.80.iron}}'],
              [
                '100%',
                '{{tool.strokes.100.bare}}',
                '{{tool.strokes.100.wooden}}',
                '{{tool.strokes.100.iron}}',
              ],
            ],
            num: [1, 2, 3],
            foot: 'Tree, rock, deposit, herb field.',
          },
        },
        {
          table: {
            head: ['Experience', 'No tool', 'Wooden', 'Iron'],
            rows: [
              ['0%', '{{tool.casts.0.bare}}', '{{tool.casts.0.wooden}}', '{{tool.casts.0.iron}}'],
              ['20%', '{{tool.casts.20.bare}}', '{{tool.casts.20.wooden}}', '{{tool.casts.20.iron}}'],
              ['40%', '{{tool.casts.40.bare}}', '{{tool.casts.40.wooden}}', '{{tool.casts.40.iron}}'],
              ['60%', '{{tool.casts.60.bare}}', '{{tool.casts.60.wooden}}', '{{tool.casts.60.iron}}'],
              ['80-100%', '{{tool.casts.80.bare}}', '{{tool.casts.80.wooden}}', '{{tool.casts.80.iron}}'],
            ],
            num: [1, 2, 3],
            foot: 'Casts per 1 fish.',
          },
        },
        {
          p: 'Harvesting a [[good:wheat|Wheat]] field takes {{gather.wheatStrokes}} strokes with no tool, and 1 with a tool or from 20% experience.',
        },
        {
          h: 'Pieces per workshop cycle',
        },
        {
          table: {
            head: ['Experience', 'No tool', 'Wooden', 'Iron'],
            rows: [
              ['0%', '{{tool.output.0.bare}}', '{{tool.output.0.wooden}}', '{{tool.output.0.iron}}'],
              ['20%', '{{tool.output.20.bare}}', '{{tool.output.20.wooden}}', '{{tool.output.20.iron}}'],
              ['40%', '{{tool.output.40.bare}}', '{{tool.output.40.wooden}}', '{{tool.output.40.iron}}'],
              ['60%', '{{tool.output.60.bare}}', '{{tool.output.60.wooden}}', '{{tool.output.60.iron}}'],
              ['80%', '{{tool.output.80.bare}}', '{{tool.output.80.wooden}}', '{{tool.output.80.iron}}'],
              ['100%', '{{tool.output.100.bare}}', '{{tool.output.100.wooden}}', '{{tool.output.100.iron}}'],
            ],
            num: [1, 2, 3],
            foot: 'For a recipe that makes 1 piece. A 2-piece recipe gets double the bonus. Ingredients and time stay the same. Experience also works at slaughter.',
          },
        },
        {
          p: 'Fractions build up in the workshop. A whole piece goes into stock, even over capacity.',
        },
        {
          h: 'Wear',
        },
        {
          table: {
            head: ['Work', 'Tool use'],
            rows: [
              ['Workshop cycle', '1 per finished cycle'],
              ['Gathering stroke', '1 per stroke, even one with no effect'],
              ['Rod cast', '1 per cast, even a failed one'],
              ["Builder's stroke", '1 per stroke, also on repairs and strokes that added nothing'],
              ['Watering', '1 per watering'],
              ['Sowing, picking mushrooms', '0'],
            ],
            foot: 'After {{tool.uses}} uses the tool is gone and the settler works bare-handed until he gets a new one. An Iron Tool lasts a settler with no experience {{tool.ironTrees}} trees.',
          },
        },
      ],
      see: [
        'good:tool_wooden',
        'good:tool_iron',
        'article:exp-work',
        'article:construction',
        'article:gathering',
      ],
    },
    {
      id: 'hauling',
      name: 'Carriers and Warehouses',
      lead: 'A Carrier with no cart hauls {{haul.carry}} piece at a time. One spot on the ground holds up to {{haul.groundStack}} pieces of a good.',
      blocks: [
        {
          h: 'Capacity',
        },
        {
          table: {
            head: ['Building', 'Pieces of one good'],
            rows: [
              ['[[building:stock_00|Warehouse 1]]', '{{haul.store1}}'],
              ['[[building:stock_01|Warehouse 2]]', '{{haul.store2}}'],
              ['[[building:stock_02|Warehouse 3]]', '{{haul.store3}}'],
              ['[[building:headquarters|Headquarters]]', '{{haul.hq}}'],
            ],
            num: [1],
            foot: 'Each of these buildings takes {{haul.storeSeats}} each of [[job:carrier|Carriers]], Extractors, Fishermen and Hunters.',
          },
        },
        {
          h: 'Priority',
        },
        {
          p: 'You set priority on one building: a warehouse, Headquarters, Barracks or tower. Its Carriers bring goods in from other warehouses, workshops and piles as long as there is room.',
        },
        {
          h: 'Storage minimum',
        },
        {
          p: 'The minimum counts all warehouses and Headquarters together, up to {{haul.minimumMax}} pieces of a good. While the total is lower, Carriers of warehouses, Headquarters, Wells and Beehives bring the good in from workshops, Wells, Beehives and piles, and nobody takes it from a store.',
        },
        {
          p: 'That goes for food too: if all your food fits inside the minimum, nobody eats from the store. A store gives goods to a priority store only above the minimum.',
        },
        {
          h: "Warehouse Carrier's work order",
        },
        {
          steps: [
            'Delivers what he has in hand.',
            'Brings in goods marked priority in his building.',
            'At warehouses and Headquarters, brings in goods below the minimum.',
            'Picks up the nearest pile with goods for his building.',
            'Takes finished products from workshops to his building.',
          ],
        },
        {
          table: {
            head: ['Carrier works at', 'What he does'],
            rows: [
              [
                '[[building:work_farm_00|Farm]], [[building:work_herb_hut|Herb Hut]]',
                'Takes the harvest to a store first, then piles',
              ],
              ['Workshop', 'Brings in ingredients first, then takes out products'],
              ['[[building:work_well_00|Well]], [[building:work_hive_00|Beehive]]', 'Takes out the contents'],
            ],
          },
        },
        {
          h: 'Cart',
        },
        {
          table: {
            head: ['Carrier', 'Pieces per trip', 'Slower when full'],
            rows: [
              ['No cart', '{{haul.carry}}', '-'],
              ['With [[good:handcart|Handcart]]', '{{haul.handcart}}', '{{haul.handcartLossPct}}%'],
              ['With [[good:oxcart|Ox Cart]]', '{{haul.oxcart}}', '{{haul.oxcartLossPct}}%'],
            ],
            num: [1, 2],
            foot: "The smaller the load, the less it slows him. A [[job:trader|Merchant's]] carts have the same numbers.",
          },
        },
        {
          list: [
            'Only a Carrier with a workplace and a [[job:trader|Merchant]] take a cart. The Carrier keeps his workplace.',
            'The cart must be yours and free: no crew, no other commander, same landmass.',
            'A warehouse Carrier with room left on his cart picks up the same good from piles and workshops within {{haul.cartTopUp}} hexes of himself, then returns.',
            'If he loses his workplace, the cart stays where it is.',
          ],
        },
        {
          h: 'Piles on the ground',
        },
        {
          list: [
            'A pile has no owner. Anyone can take it.',
            'A Carrier with no work flag picks up within {{flag.radius}} hexes of the building, with a flag within {{flag.radius}} hexes of the flag.',
          ],
        },
      ],
      see: [
        'article:work-flag',
        'article:roads',
        'article:vehicles',
        'article:construction',
        'job:carrier',
        'building:stock_00',
      ],
    },
    {
      id: 'work-flag',
      name: 'Work flag',
      lead: 'The work flag (just "flag" on the buttons) marks the work area and stores nothing. An Extractor with no workplace leaves goods on the ground.',
      blocks: [
        {
          figure: {
            id: 'flag-flow',
            caption: 'Where goods from a flag go',
          },
        },
        {
          h: 'With and without a workplace',
        },
        {
          table: {
            head: ['Trait', 'No workplace', 'With a workplace'],
            rows: [
              [
                'Who',
                '[[job:collector|Extractor]], [[job:fisher|Fisherman]], [[job:hunter|Hunter]]',
                'The same, plus a [[job:carrier|Carrier]] from a warehouse, Headquarters or workshop',
              ],
              [
                'Where the flag comes from',
                'Appears at his feet when he takes the profession',
                'Only from "Plant a flag"',
              ],
              ['Where he works', 'Around the flag', 'Around the flag, with no flag per the table below'],
              ['Which goods', 'Any the profession gathers', 'Only those the building stores'],
              ['Where the load goes', 'A pile on the ground by the flag', "To the worker's building"],
              ['Taking the flag away', 'Not possible, only moving it', '"Take the flag away"'],
              [
                'Losing the workplace',
                '-',
                'Extractors, Fishermen and Hunters keep working from their flag. With no flag they get a new one at their feet. A Carrier loses his flag.',
              ],
            ],
          },
        },
        {
          h: 'After the flag is taken away',
        },
        {
          table: {
            head: ['Who', 'No flag'],
            rows: [
              ['Extractor', 'Full signpost reach'],
              ['Carrier', 'Warehouse: piles within {{flag.radius}} hexes of the building'],
              ['Hunter', 'Around the workplace'],
              ['Fisherman', 'Looks for a shore from where he stands'],
            ],
          },
        },
        {
          h: 'Work area',
        },
        {
          table: {
            head: ['Who', 'Measured from', 'Across, up and down', 'On the slant'],
            rows: [
              ['[[job:collector|Extractor]]', 'Work flag', '{{flag.radius}}', 'about {{flag.diagonal}}'],
              ['Carrier', 'Work flag or building', '{{flag.radius}}', 'about {{flag.diagonal}}'],
              ['[[job:hunter|Hunter]]', 'Work flag', '{{flag.hunter}}', '{{flag.hunter}}'],
              ['[[job:fisher|Fisherman]]', 'Work flag', '{{flag.fisher}}', 'about {{flag.fisherDiagonal}}'],
              [
                '[[job:farmer|Farmer]], [[job:herb_mush_guy|Herb Gatherer]]',
                'Building',
                '{{field.radius}}',
                'about {{field.diagonal}}',
              ],
            ],
            num: [2, 3],
            foot: 'In hexes. A profession that depends on signposts works only within their reach.',
          },
        },
        {
          p: 'Carriers at a Farm, Herb Hut, Well, Beehive, tower or Barracks take no work flag.',
        },
        {
          h: 'The pile by the flag',
        },
        {
          list: [
            'Only a Carrier with a workplace takes a pile from under a flag.',
            "More than {{flag.radius}} hexes from a warehouse, give the Carrier his own flag next to the Extractor's.",
            'A Carrier with a flag takes piles and finished products around it and brings them to his building.',
            'Moving the flag leaves the piles where they are.',
          ],
        },
        {
          h: 'Planting a flag',
        },
        {
          p: '"Plant a flag" places the flag on the spot you pick or moves it there. On an occupied spot it looks for a free one within {{flag.snap}} hexes, and past that the order is lost. Ctrl + right-click does the same.',
        },
        {
          p: "A switch in the [[article:assistant|Assistant]] lets an Extractor move his flag himself: he plants it {{assistant.flagMin}}-{{assistant.flagMax}} hexes from the resource. Once the area runs out, he goes to the resource nearest his building. This doesn't apply to Hunters or Fishermen.",
        },
        {
          p: 'You can plant a flag out of reach, but the worker stands until the network gets there: [[article:roads|Roads and Signposts]].',
        },
      ],
      see: ['article:hauling', 'article:workshops', 'article:roads', 'article:assistant', 'job:collector'],
    },
    {
      id: 'roads',
      name: 'Roads and Signposts',
      lead: 'A road costs 1 Quarrystone and cuts a shod step on land from {{step.landBrief}} s to {{step.road}} s.',
      blocks: [
        {
          h: 'Signpost',
        },
        {
          p: 'A [[job:scout|Scout]] places signposts, no material needed.',
        },
        {
          figure: {
            id: 'reach',
            caption: 'Network reach',
          },
        },
        {
          p: 'A settler gets to a target on his own within {{reach.walk}} hexes, a [[job:carrier|Carrier]] within {{reach.carrier}}. Further out a signpost leads the way: if one stands closer than that reach, it opens the whole linked network, and the target must lie within the same reach of some signpost in that network.',
        },
        {
          list: [
            'Two signposts link when they stand closer than {{reach.link}} hexes, with a route between them of up to {{reach.linkRoute}} hexes.',
            'Your own signpost goes at least {{reach.spacing}} hexes from another one.',
            'A settler looks for goods closer than {{reach.goods}} hexes, also from signposts within that reach.',
            'A building placed on a signpost pushes it up to {{reach.displace}} hexes aside. Past that the signpost is lost.',
          ],
        },
        {
          table: {
            head: ['Terrain', 'Searching for goods, hexes'],
            rows: [
              ['Road, land', 'under {{reach.goods}}'],
              ['Sand', 'about {{reach.goodsSand}}'],
              ['Mountains', 'about {{reach.goodsMountain}}'],
              ['Snow', 'about {{reach.goodsSnow}}'],
            ],
            num: [1],
            foot: 'The worse the terrain, the closer a settler looks for goods.',
          },
        },
        {
          p: 'Reach does not apply to Scouts, soldiers, heroes, [[job:hunter|Hunters]] or [[job:druid|Druids]].',
        },
        {
          p: 'A worker whose workplace or flag ends up out of reach gets status "Lost" and stands until the network gets there. He still delivers what he\'s carrying.',
        },
        {
          h: 'Signpost panel',
        },
        {
          table: {
            head: ['Item', 'Meaning'],
            rows: [
              [
                '"Network goods"',
                'Goods within reach of the whole linked network: buildings, piles, carts, hands. Each piece counts once.',
              ],
              [
                '"Demolish"',
                'The signpost vanishes at once, no confirmation, no Scout needed. If it was the only link, the network splits apart.',
              ],
            ],
            foot: 'The "Signposts" map overlay shows networks.',
          },
        },
        {
          h: 'Road',
        },
        {
          table: {
            head: ['Terrain under the road', 'Step, no road', 'Step on road', 'Saved'],
            rows: [
              ['Land', '{{step.land}} s', '{{step.road}} s', '{{step.roadSavedOnLandPct}}%'],
              ['Sand', '{{step.sand}} s', '{{step.road}} s', '{{step.roadSavedOnSandPct}}%'],
              ['Mountains', '{{step.mountain}} s', '{{step.road}} s', '{{step.roadSavedOnMountainPct}}%'],
              ['Snow', '{{step.snow}} s', '{{step.road}} s', '{{step.roadSavedOnSnowPct}}%'],
            ],
            num: [1, 2, 3],
            foot: 'A shod settler with no load. Shoes wear {{shoes.roadWear}} times slower on road than on land.',
          },
        },
        {
          list: [
            'A segment costs 1 [[good:stone|Quarrystone]] and 1 [[job:builder|Builder]] stroke.',
            'The same Quarrystone also paves up to 6 neighbouring segments, if no Builder has taken them and no Quarrystone lies on them.',
            'Cancelling a segment: the delivered Quarrystone lands next to it.',
            'A settler takes the road on his own when that gets him there faster.',
          ],
        },
      ],
      see: [
        'article:walking',
        'article:hauling',
        'article:work-flag',
        'article:construction',
        'job:scout',
        'good:stone',
      ],
    },
    {
      id: 'walking',
      name: 'Walking Speed',
      lead: 'A step on land takes {{step.landBrief}} s in shoes and {{step.landBare}} s barefoot.',
      blocks: [
        {
          h: 'Step by terrain',
        },
        {
          table: {
            head: ['Terrain', 'In shoes', 'Barefoot', 'Steps per pair of shoes'],
            rows: [
              ['Road, paving', '{{step.road}} s', '{{step.roadBare}} s', '{{shoes.road}}'],
              ['Land', '{{step.land}} s', '{{step.landBare}} s', '{{shoes.land}}'],
              ['Sand, beach, stony desert', '{{step.sand}} s', '{{step.sandBare}} s', '{{shoes.sand}}'],
              ['Mountains', '{{step.mountain}} s', '{{step.mountainBare}} s', '{{shoes.mountain}}'],
              ['Snow', '{{step.snow}} s', '{{step.snowBare}} s', '{{shoes.snow}}'],
            ],
            num: [1, 2, 3],
            foot: 'With a load in hand, shoes wear {{shoes.carryWear}} times faster. Energy cost of a barefoot step: [[article:needs|Needs]].',
          },
        },
        {
          h: 'What changes a step',
        },
        {
          table: {
            head: ['State', 'Change'],
            rows: [
              ['Load in hand', '+{{step.carryExtra}} s'],
              ['Stamina at {{need.drivePct}}% or less', '+{{step.tiredExtra}} s'],
              ['Child', '+{{step.childExtra}} s'],
              ['Baby', 'step × 2'],
              ['Weapon and armour weigh 2-3 together', '+{{step.weightLowExtra}} s'],
              ['Weapon and armour weigh 4-5 together', '+{{step.weightHighExtra}} s'],
              ['[[good:amulet_speed|Wind Amulet]]', '-{{step.amuletSaved}} s'],
              ['Full [[good:handcart|Handcart]]', '{{haul.handcartLossPct}}% slower'],
              ['Full [[good:oxcart|Ox Cart]]', '{{haul.oxcartLossPct}}% slower'],
            ],
            foot: 'The fastest step takes {{step.shortest}} s. The smaller the load, the less a cart slows him. Weight does not slow heroes.',
          },
        },
        {
          h: 'Weapon and armour weight',
        },
        {
          table: {
            head: ['Weapon', 'Weight'],
            rows: [
              ['[[good:sword_shord|Shortsword]], [[good:bow_short|Short Bow]]', '{{weight.shortSword}}'],
              ['[[good:spear_wooden|Wooden Spear]], [[good:bow_long|Longbow]]', '{{weight.woodenSpear}}'],
              ['[[good:spear_iron|Iron Spear]], [[good:sword_long|Longsword]]', '{{weight.ironSpear}}'],
            ],
            num: [1],
            foot: 'The same for all tribes. Add weapon weight to armour weight from the table below.',
          },
        },
        {
          data: 'armour',
        },
        {
          h: 'Examples',
        },
        {
          table: {
            head: ['Who', 'Terrain', 'Step'],
            rows: [
              ['Carrier, in shoes, with goods', 'Road', '{{step.carrierOnRoad}} s'],
              ['Soldier, Longsword, Plate Armour, in shoes', 'Land', '{{step.plateSoldierOnLand}} s'],
              ['Merchant, in shoes, full Handcart', 'Land', '{{step.traderFullCart}} s'],
            ],
            num: [2],
          },
        },
      ],
      see: ['good:shoes', 'good:amulet_speed', 'article:roads', 'article:needs', 'article:vehicles'],
    },
    {
      id: 'trade',
      name: 'Trade',
      lead: 'A Merchant runs between {{trade.stops}} buildings and with no cart takes {{haul.carry}} piece per trip.',
      blocks: [
        {
          h: 'Carried by',
        },
        {
          table: {
            head: ['Carried by', 'Loading or unloading a piece'],
            rows: [
              ['Hands', '{{trade.handsSeconds}} s'],
              ['[[good:handcart|Handcart]]', '{{trade.handcartSeconds}} s'],
              ['[[good:oxcart|Ox Cart]]', '{{trade.oxcartSeconds}} s'],
            ],
            num: [1],
            foot: 'Capacity and speed loss: [[article:hauling|Carriers and Warehouses]].',
          },
        },
        {
          p: 'In shoes, with the cart full one way and empty on the way back, both carts move the same amount on a route of about {{trade.cartParLand}} hexes over land or {{trade.cartParRoad}} hexes by road. On a shorter route the Handcart wins, on a longer one the Ox Cart.',
        },
        {
          h: 'Route',
        },
        {
          list: [
            'A route links {{trade.stops}} finished buildings with stock. At most 1 can be foreign.',
            'While a building is being upgraded, the [[job:trader|Merchant]] waits for it to finish.',
            'A Merchant takes no food from a Dwelling.',
          ],
        },
        {
          h: 'Your own buildings',
        },
        {
          p: 'A and B are the two route buildings.',
        },
        {
          table: {
            head: ['Setting', 'Result'],
            rows: [
              ['Good marked in building B', 'Loads at A, unloads at B'],
              ['Good marked in both buildings', 'Evens out stock between them'],
              ['Neither building marks anything', 'The Merchant stands still'],
              ['up to N', 'Stops delivering when the destination holds N, load included'],
              ['keep N', 'N pieces stay in the source building'],
              [
                'settlement',
                'Loads from the whole settlement: this warehouse first, then warehouses and workshops within its signpost network',
              ],
            ],
            foot: 'The settlement option works only for a warehouse or Headquarters, on one of the two route buildings. The storage minimum also limits loading.',
          },
        },
        {
          h: 'Trading with the computer',
        },
        {
          list: [
            'You can trade only with a finished building of a computer player that has an offer from the map.',
            "To add the building to a route, both sides must be friendly. After that it's enough that the Merchant's tribe is friendly: [[article:diplomacy|Diplomacy]].",
            'An offer is N pieces of one good for M of another, with the numbers set by the map. A route trades one offer at a time.',
            "Every {{trade.refillSeconds}} s the computer's store goes back to {{trade.refillLevel}} pieces of the offer's good.",
            'The Merchant loads as many full exchanges as the cart holds with room for the payment. On a small cart one exchange splits over several trips.',
            'He hands over the goods, takes the payment and repeats while he has goods. With no payment in the building he waits and hands nothing over.',
            '"keep N" leaves N pieces of the sale good in the building. Return limit N: the Merchant stops once the building holds N pieces of payment.',
          ],
        },
      ],
      see: [
        'article:diplomacy',
        'article:vehicles',
        'article:hauling',
        'article:roads',
        'job:trader',
        'good:handcart',
      ],
    },
  ],
};
