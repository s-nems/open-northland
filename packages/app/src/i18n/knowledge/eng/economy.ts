import type { ArticleGroup } from '../../../hud/knowledge/articles.js';

export const ECONOMY: ArticleGroup = {
  group: 'Economy',
  items: [
    {
      id: 'construction',
      name: 'Building, Upgrades and Repairs',
      lead: 'One Builder puts up Dwelling 1 in {{build.noviceSeconds}} s, or {{build.noviceIronSeconds}} s with an Iron Tool. Hauling the material comes on top of that.',
      blocks: [
        {
          h: 'Where you can build',
        },
        {
          table: {
            head: ['What', 'Rule'],
            rows: [
              [
                'Terrain',
                "You can build on land, sand, beach and stony desert. Mountains, snow, water and swamp won't do.",
              ],
              [
                '[[building:work_well_00|Well]], [[building:work_hive_00|Beehive]]',
                'At least the edge of the building has to stand on grass.',
              ],
              [
                'Space',
                'A building takes the room its top level will need right away, plus a narrow margin around it. The margins of two buildings cannot overlap.',
              ],
              [
                'Tree, rock, deposit, stockade',
                "They must stand outside the room for the building's top level.",
              ],
              [
                'Enemy soldier',
                "You can't build within {{contest.radius}} hexes of him, about {{contest.diagonal}} on the slant. Only soldiers you can see count, and a tower's crew doesn't.",
              ],
              [
                'Building of a player you are at peace with',
                "You can't build within {{peace.keepOut}} hexes of his building or site, unless your own building stands closer to the spot than his.",
              ],
              ['Ground under fog', "You can't build there. The spot must be visible right now."],
              [
                'Signpost reach',
                "Doesn't matter. You can place a site outside the network, but the Builder only arrives once the network gets there.",
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
            foot: 'Strokes per 1 piece of material. A [[job:builder|Builder]] reaches 100% after {{exp.build.repeatsFull}} strokes, but only strokes that moved the work on count.',
          },
        },
        {
          p: 'Builders and workers assigned to the site carry the material to it, 1 piece at a time.',
        },
        {
          h: 'What a Builder does first',
        },
        {
          p: 'A Builder repairs first, then puts up buildings, and leaves stockades and roads for last. If you assign him to a site, he stays there even when there is work elsewhere.',
        },
        {
          h: 'Upgrades',
        },
        {
          list: [
            'Costs the materials of the levels gained. You can skip several levels at once if they are all unlocked.',
            'Goods the upgrade needs that the building already has in stock go straight into the work.',
            'Workers and residents move out during the upgrade and return to their places afterwards.',
            'On completion the building has the full health of the new level.',
            'If you cancel the upgrade, the building gets its stock back, but delivered material is lost.',
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
          p: "A Builder won't repair on his own for {{repair.calmSeconds}} s after the last hit, or while a fight is on within {{alert.standTo}} hexes. On your order he goes right away.",
        },
        {
          h: 'What is lost and what comes back',
        },
        {
          table: {
            head: ['Situation', 'What is left'],
            rows: [
              ['Demolishing a site', 'Delivered material stays on the ground'],
              ['Demolishing or destroying a building', 'Contents plus half the cost, rounded up'],
            ],
            foot: "Goods land on the ground up to {{reach.spill}} hexes from the building. What doesn't fit is lost.",
          },
        },
      ],
      see: ['article:tools', 'article:walls', 'article:roads', 'article:exp-work', 'job:builder'],
    },
    {
      id: 'workshops',
      name: 'Workshops and Product Choice',
      lead: 'The counter next to a product says how many cycles the worker will run: 0 is stop, ∞ is no limit. A cycle is one run of the recipe.',
      blocks: [
        {
          h: 'Counter values',
        },
        {
          table: {
            head: ['Counter', 'Workshop', 'Extractor'],
            rows: [
              ['0', "Doesn't make this product", "Doesn't gather this good"],
              [
                '1-{{workshop.counterMax}}',
                'That many cycles, the counter drops by 1 as each starts',
                'That many pieces, the counter drops by 1 for each one gathered',
              ],
              ['∞', 'No limit, the counter never drops', 'No limit, the counter never drops'],
            ],
            foot: 'Experience and tools give more pieces per cycle: [[article:tools|Tools]].',
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
                'Switches this good between 0 and ∞, rest unchanged',
              ],
              ['Less', '-1. From 0 jumps to ∞, from ∞ to {{workshop.counterMax}}', '-10', 'To 0'],
              ['More', '+1. From {{workshop.counterMax}} jumps to ∞, from ∞ to 0', '+10', 'To ∞'],
            ],
          },
        },
        {
          h: 'What happens to counters',
        },
        {
          p: 'Each worker has his own counters, so 2 men in one workshop can make 2 different products. The counters are gone when a worker changes workplace or profession, including when the building is demolished. An upgrade leaves them alone, and products from the new level start at 0.',
        },
        {
          h: 'Several products at once',
        },
        {
          p: 'A worker takes turns on all products with a counter above 0, 1 cycle each, in panel order.',
        },
        {
          table: {
            head: ['When', 'What the worker does'],
            rows: [
              ['Product stock is full', 'Moves on to the next product'],
              ['An ingredient is missing', 'Moves on to the next product'],
              [
                'Only part of the ingredients is there',
                "Waits for the rest. When there's nowhere to get it, moves on to the next product.",
              ],
              [
                'Not enough experience for a product',
                'The panel shows "locked" instead of a counter, and the worker skips that product',
              ],
              [
                'All products with a counter are locked',
                'Makes what he already knows, even products with a counter of 0',
              ],
            ],
          },
        },
        {
          h: 'Vehicles',
        },
        {
          p: "A vehicle isn't made inside the workshop. The craftsman places a site next to it, hauls the material there himself and builds. With no room for a site next to the workshop, he moves on to the next product.",
        },
        {
          h: 'Extractors',
        },
        {
          table: {
            head: ['Situation', 'Result'],
            rows: [
              ['"Only this good"', 'This good ∞, rest 0'],
              [
                'Right-click a resource',
                'The "Gather" order: this good ∞, rest 0. The work flag stays where it is.',
              ],
              ['Ctrl + right-click a resource', 'The same, but the flag moves to the resource'],
              ['All counters at 0', 'The Extractor shows "All set to 0" and gathers nothing'],
              [
                'Goods already lie on the ground',
                'The counter covers extraction only. The Extractor keeps hauling logs and piles, even at 0.',
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
      lead: 'A tree gives {{gather.treeYield}} pieces of Wood after {{gather.strokes}} strokes. Rock takes that many strokes for every piece, so Wood comes about {{gather.treeYield}} times faster than Quarrystone.',
      blocks: [
        {
          h: 'What a resource gives',
        },
        {
          table: {
            head: ['Resource', 'Who', 'Gives', 'Strokes with no experience', 'Time', 'Tool helps'],
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
            foot: 'Working time only, with no experience and no tool, not counting the walk.',
          },
        },
        {
          p: 'A felled tree stays as a log with {{gather.treeYield}} pieces, and the Extractor carries them off 1 at a time. Every piece from a rock or deposit drops on the ground beside it.',
        },
        {
          h: 'Iron and Gold',
        },
        {
          p: 'To mine [[good:iron|Iron]] or [[good:gold|Gold]], an Extractor first has to gather {{gather.oreNeed}} pieces of [[good:mud|Clay]] and [[good:stone|Quarrystone]] combined himself, separately for each of the two. The first one to manage it discovers the good for the whole settlement, and after that it can also be taught at the [[building:school|School]]. Until then the panel shows "locked".',
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
          p: "A field only grows when someone waters it, it won't grow by itself over time. Each watering raises that field and 6 neighbouring ones by 1 stage, so one field needs at most {{field.waterings}} waterings. After the harvest 1 piece of crop is left, and the spot can be sown again.",
        },
        {
          p: 'Sowing and watering cost nothing, not even Water.',
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
            foot: 'On the slant the radius is about {{field.diagonal}} hexes. The field limit is per building, not per worker, so more people means faster harvests but not more fields.',
          },
        },
        {
          p: "You can't sow a field on sand or on a road. Wild fields from the map within the building's radius count toward its limit. A field nobody can reach from the building's door for {{field.reclaimSeconds}} s disappears and frees a place in the limit.",
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
      lead: 'A tool cuts strokes, gives more pieces in a workshop and lasts {{tool.uses}} uses.',
      blocks: [
        {
          h: 'Where a settler gets a tool',
        },
        {
          p: "Tools are handed out by the [[article:assistant|Assistant]], which is on from the start of the game, or by your own order. A settler with no tool goes to a store for one by himself and takes an Iron one, or a Wooden one if there is no Iron. He won't swap a Wooden one for a better one on his own.",
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
            foot: 'At a tree, rock, deposit or herb field.',
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
          p: 'A [[good:wheat|Wheat]] field takes {{gather.wheatStrokes}} strokes with no tool, and with a tool or from 20% experience 1 is enough.',
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
            foot: 'For a recipe that makes 1 piece, a 2-piece recipe gets double the bonus. Ingredients and working time stay the same. Experience also works at slaughter.',
          },
        },
        {
          p: 'Fractions of a piece add up. Once a whole piece is there, it goes into stock, even over capacity.',
        },
        {
          h: 'Wear',
        },
        {
          p: 'Every stroke, rod cast, watering and finished workshop cycle uses the tool once, failed ones too. Sowing and picking mushrooms use nothing. After {{tool.uses}} uses the tool is gone and the settler works bare-handed until he gets a new one. An Iron Tool lasts a settler with no experience {{tool.ironTrees}} trees.',
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
          p: "You set priority in a warehouse, Headquarters, Barracks or tower. That building's Carriers then bring the good in from other warehouses, workshops and piles as long as there is room for it.",
        },
        {
          h: 'Storage minimum',
        },
        {
          p: 'The minimum, up to {{haul.minimumMax}} pieces of a good, counts all warehouses and Headquarters together. While the total is lower, Carriers bring the good in from workshops, Wells, Beehives and piles, and nobody takes it from a store.',
        },
        {
          p: 'That goes for food too: if all your food fits inside the minimum, nobody eats it from the store. A priority store gets only what is above the minimum from another store.',
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
            foot: "The smaller the load, the less a cart slows him. A [[job:trader|Merchant's]] carts work the same way.",
          },
        },
        {
          list: [
            'Only a Carrier who has a workplace and a [[job:trader|Merchant]] take a cart.',
            'The cart must be yours, free and on the same landmass.',
            'If there is room left on the cart, a warehouse Carrier picks up the same good from piles and workshops within {{haul.cartTopUp}} hexes before he heads back.',
          ],
        },
        {
          h: 'Piles on the ground',
        },
        {
          p: 'A pile on the ground belongs to nobody, and anyone can take it. A Carrier picks up piles within {{flag.radius}} hexes of his building, or within {{flag.radius}} hexes of his work flag if he has one.',
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
      lead: 'The work flag (just "flag" on the buttons) marks where a worker works. It stores nothing, so an Extractor with no workplace leaves goods on the ground.',
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
                'Only from the "Plant a flag" order',
              ],
              ['Where he works', 'Around the flag', 'Around the flag, and without one as in the table below'],
              ['Which goods', 'Everything his profession gathers', 'Only those the building stores'],
              ['Where the load goes', 'Onto a pile by the flag', 'To his building'],
              ['Taking the flag away', "Can't be done, it can only be moved", '"Take the flag away"'],
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
              ['Warehouse Carrier', 'Piles within {{flag.radius}} hexes of the building'],
              ['Hunter', 'Around the workplace'],
              ['Fisherman', 'Fishes from where he stands'],
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
            foot: 'In hexes. Anyone who needs signposts works only within their reach.',
          },
        },
        {
          p: "You can't plant a work flag for Carriers at a Farm, Herb Hut, Well, Beehive, tower or Barracks.",
        },
        {
          h: 'The pile by the flag',
        },
        {
          list: [
            'Only a Carrier who has a workplace takes a pile from under a flag.',
            "When the Extractor's flag is more than {{flag.radius}} hexes from a warehouse, plant a flag for the warehouse Carrier next to it.",
            'When you move the flag, the piles stay where they were.',
          ],
        },
        {
          h: 'Planting a flag',
        },
        {
          p: '"Plant a flag" places the flag on the spot you pick or moves it there, just like Ctrl + right-click. If the spot is taken, the flag goes to a free one within {{flag.snap}} hexes, and if there is none, the order is lost.',
        },
        {
          p: "In the [[article:assistant|Assistant]] you can let Extractors move their flags themselves. An Extractor then plants it {{assistant.flagMin}}-{{assistant.flagMax}} hexes from the resource, and once everything nearby runs out, he moves to the resource nearest his building. Hunters and Fishermen don't do this.",
        },
        {
          p: 'You can plant a flag outside the network, but the worker will stand still until the network gets there: [[article:roads|Roads and Signposts]].',
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
          p: 'Signposts are placed by a [[job:scout|Scout]] and cost no material.',
        },
        {
          figure: {
            id: 'reach',
            caption: 'Network reach',
          },
        },
        {
          p: 'Without signposts a settler reaches a target at most {{reach.walk}} hexes away, a [[job:carrier|Carrier]] {{reach.carrier}}. Further out signposts lead the way: if one stands within that reach, the settler can use its whole linked network, and the target must lie within the same reach of one of its signposts.',
        },
        {
          list: [
            'Two signposts link when they stand closer than {{reach.link}} hexes and the route between them is at most {{reach.linkRoute}} hexes.',
            'Your new signpost has to stand at least {{reach.spacing}} hexes from another one.',
            'A settler looks for goods closer than {{reach.goods}} hexes from himself or from signposts within that reach.',
            "A building placed on a signpost moves it up to {{reach.displace}} hexes aside, and if that isn't possible, the signpost is gone.",
          ],
        },
        {
          table: {
            head: ['Terrain', 'Goods search range, hexes'],
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
          p: 'Scouts, soldiers, heroes, [[job:hunter|Hunters]] and [[job:druid|Druids]] go anywhere, signposts or not.',
        },
        {
          p: 'A worker whose workplace or flag ends up out of reach gets status "Lost" and waits until the network gets there. He still delivers what he\'s carrying.',
        },
        {
          h: 'Signpost panel',
        },
        {
          table: {
            head: ['In the panel', 'Meaning'],
            rows: [
              [
                '"Network goods"',
                'All goods within reach of the linked network: in buildings, on piles, carts and in hands.',
              ],
              [
                '"Demolish"',
                'The signpost vanishes at once, with no question asked. If it joined two parts of the network, the network splits.',
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
            'One Quarrystone also paves up to 6 neighbouring segments, as long as no Builder has taken them yet and no Quarrystone lies on them.',
            'Settlers take the road on their own when it gets them there faster.',
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
            foot: 'With a load in hand, shoes wear {{shoes.carryWear}} times faster. How much energy walking barefoot costs: [[article:needs|Needs]].',
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
            foot: 'A step never takes less than {{step.shortest}} s. The smaller the load, the less a cart slows him. Weight does not slow heroes.',
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
            foot: 'The same for all tribes. Add the weapon weight to the armour weight from the table below.',
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
      lead: 'A Merchant runs between {{trade.stops}} buildings, and with no cart he takes {{haul.carry}} piece at a time.',
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
          p: 'With the cart full one way and empty on the way back, both carts move the same amount on a route of about {{trade.cartParLand}} hexes over land or {{trade.cartParRoad}} hexes by road. On a shorter route the Handcart is better, on a longer one the Ox Cart.',
        },
        {
          h: 'Route',
        },
        {
          list: [
            'A route links {{trade.stops}} finished buildings with stock. At most 1 of them can belong to someone else.',
            'While a building is being upgraded, the [[job:trader|Merchant]] waits until it is done.',
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
              ['Good marked in building B', 'Takes it from A and brings it to B'],
              ['Good marked in both buildings', 'Evens out stock between them'],
              ['Nothing marked in either building', 'The Merchant carries nothing'],
              ['up to N', 'Stops delivering once the destination will hold N pieces, load included'],
              ['keep N', 'N pieces stay in the source building'],
              [
                'settlement',
                'Takes goods from the whole settlement: this warehouse first, then other warehouses and workshops within its signpost network',
              ],
            ],
            foot: "You can turn on the settlement option only in a warehouse or Headquarters, and only in one of the two route buildings. The Merchant won't take goods below the storage minimum.",
          },
        },
        {
          h: 'Trading with the computer',
        },
        {
          list: [
            'You can trade only with a finished building of a computer player that has an offer set by the map.',
            "To add the building to a route, both sides must be friendly to each other. After that it's enough that the Merchant's tribe is friendly: [[article:diplomacy|Diplomacy]].",
            'An offer is N pieces of one good for M of another, with the numbers set by the map. A route works one offer at a time.',
            "Every {{trade.refillSeconds}} s the computer tops up the offer's good in its store to {{trade.refillLevel}} pieces.",
            "When the computer's building has no payment, the Merchant waits and hands nothing over.",
            '"keep N" leaves N pieces of the sale good in your building. Return limit N ends the trade once your building holds N pieces of payment.',
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
