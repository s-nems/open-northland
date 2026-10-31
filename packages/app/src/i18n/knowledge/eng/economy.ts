import type { ArticleGroup } from '../../../hud/knowledge/articles.js';

export const ECONOMY: ArticleGroup = {
  group: 'Economy',
  items: [
    {
      id: 'construction',
      name: 'Building, Upgrades and Repairs',
      lead: 'One Builder puts up Dwelling 1 in {{build.noviceSeconds}} s, or {{build.noviceIronSeconds}} s with an Iron Tool.',
      blocks: [
        {
          h: 'Where you can build',
        },
        {
          table: {
            head: ['Blocked by', 'Rule'],
            rows: [
              ['Terrain', 'Land, sand, beach, stony desert. Mountains, snow, water and swamp are out.'],
              [
                '[[building:work_well_00|Well]], [[building:work_hive_00|Beehive]]',
                'At least 1 point under the building on grass',
              ],
              [
                'Space',
                "A building takes the footprint of its top level plus a margin from the start. Two buildings' margins cannot overlap.",
              ],
              ['Tree, rock, deposit, stockade', 'Must stand outside the footprint'],
              [
                'Enemy soldier',
                "Refused within {{contest.radius}} steps, about {{contest.diagonal}} on the slant. Only a visible one counts, and not a tower's garrison at its post.",
              ],
              [
                'Building of a player you are at peace with',
                'Refused within {{peace.keepOut}} steps of it or its site, unless your building stands closer.',
              ],
              [
                'Upgrade ground',
                "The footprint of a standing building's higher levels is reserved. Nothing else can go there.",
              ],
              ['Ground under fog', 'The spot must be visible right now'],
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
          table: {
            head: ['Gives way', 'Rule'],
            rows: [
              ['Settler, vehicle, work flag, signpost, pile, carcass', 'Pushed aside'],
              ['Bush, field, stump, open chest', 'Destroyed when the site is placed'],
              ['Road site', 'Cancelled, delivered Quarrystone lands next to it'],
              [
                'Road or stockade on upgrade ground',
                'They route around it. A key held while drawing the line switches on "over upgrade ground" and lays them across it, and the upgrade then demolishes them with no refund.',
              ],
            ],
          },
        },
        {
          table: {
            head: ['Not in the way', 'Rule'],
            rows: [
              ['Enemy civilians, animals', 'The site goes up beside them'],
              ['Finished road', 'Stays under the building'],
              [
                'Signpost reach',
                'Does not apply. A site can go outside the network, and the Builder arrives once the network gets there.',
              ],
            ],
          },
        },
        {
          h: 'How long building takes',
        },
        {
          table: {
            head: [
              '[[building:home_level_00|Dwelling 1]], 1 Builder',
              'Points per stroke',
              'Strokes',
              'Time',
            ],
            rows: [
              [
                'Novice, no tool',
                '{{build.novicePoints}}',
                '{{build.noviceSwings}}',
                '{{build.noviceSeconds}} s',
              ],
              [
                'Novice, [[good:tool_iron|Iron Tool]]',
                '{{build.noviceIronPoints}}',
                '{{build.noviceIronSwings}}',
                '{{build.noviceIronSeconds}} s',
              ],
              [
                'Master, [[good:tool_iron|Iron Tool]]',
                '{{build.masterIronPoints}}',
                '{{build.masterIronSwings}}',
                '{{build.masterIronSeconds}} s',
              ],
            ],
            num: [1, 2, 3],
            foot: 'One piece of material is {{build.pointsPerUnit}} build points. Dwelling 1 is {{build.homeUnits}} pieces, {{build.homePoints}} points. Times cover strokes only, not hauling material. 1 stroke takes {{build.swingSeconds}} s.',
          },
        },
        {
          table: {
            head: ['Experience', 'No tool', 'Wooden', 'Iron'],
            rows: [
              ['0-9%', 1, 1, 2],
              ['10-21%', 1, 2, 2],
              ['22-49%', 1, 2, 3],
              ['50-78%', 2, 2, 3],
              ['79-89%', 2, 2, 4],
              ['90-100%', 2, 3, 4],
            ],
            num: [1, 2, 3],
            foot: 'Build points for 1 stroke. A [[job:builder|Builder]] reaches 100% after {{exp.build.repeatsFull}} strokes that added something.',
          },
        },
        {
          list: [
            'A building with no cost takes 1 stroke.',
            'A stockade or road segment takes 1 stroke after its material arrives, 1 Builder.',
            'The Builder and workers assigned to the site carry material, 1 piece at a time.',
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
            'Health stands still meanwhile and is full for the new level on completion.',
            'Starting an upgrade switches defence mode off.',
            'Stockades and roads under the new building vanish, nothing comes back.',
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
              ['Stockade segment', 5, '{{repair.wallCrew}}'],
              ['Gate', 5, '{{repair.wallCrew}}'],
            ],
            num: [1, 2],
            foot: 'Repairs cost no material. A building gets {{repair.perPoint}} health per build point. For stockades and gates, experience and tools change nothing.',
          },
        },
        {
          list: [
            'After an enemy blow, repairs wait {{repair.calmSeconds}} s, and nobody may be fighting within {{alert.standTo}} steps. A player order skips both conditions.',
            'Sites and stockade segments under construction get no repairs. Their health grows with the building.',
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
              ['Demolishing or destroying a building', 'Contents plus half the cost, each item rounded up'],
              [
                'Demolishing a building mid-upgrade',
                'The same for the current level, plus set-aside stock and upgrade material',
              ],
            ],
            foot: "Goods spread out on the ground up to {{reach.spill}} steps away, on the same landmass. What doesn't fit is lost.",
          },
        },
      ],
      see: ['article:tools', 'article:walls', 'article:roads', 'article:exp-work', 'job:builder'],
    },
    {
      id: 'workshops',
      name: 'Workshops and Product Choice',
      lead: 'The counter says how many batches a worker should make: 0 stop, ∞ no limit. A batch is one run of a recipe.',
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
                'That many batches, -1 at each batch start',
                'That many pieces, -1 per piece gathered',
              ],
              ['∞', 'No limit, the counter never drops', 'No limit, the counter never drops'],
            ],
            foot: 'A workshop counts batches, not pieces. A batch yields more pieces with experience and tools: [[article:tools|Tools]].',
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
                'Graduate of a profession with several courses, assigned by the Assistant',
                'Products learned at School ∞, rest 0',
              ],
              ['Workshop with 1 product', 'That product ∞'],
              ['[[job:collector|Extractor]]', 'Every good ∞'],
            ],
          },
        },
        {
          h: 'What happens to counters',
        },
        {
          p: 'They are lost on any change of workplace or profession, including when the building is demolished. An upgrade keeps them, and products added by the new level start at 0. Each worker has his own counters: 2 men in one workshop can make 2 different products.',
        },
        {
          h: 'Several products at once',
        },
        {
          p: 'Products with a counter above 0 take turns, 1 batch each, in panel order.',
        },
        {
          table: {
            head: ['Situation', 'Result'],
            rows: [
              ['Product shelf full', 'The turn moves on. Batches in progress count as taken space.'],
              ['No ingredient in the building', 'The turn moves on'],
              [
                'Not enough of an ingredient in the building',
                "Waits for the rest. Gives up the turn when there's nowhere to get it.",
              ],
              ['All counters at 0', 'The worker starts nothing'],
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
            'A vehicle is not a batch. The craftsman places a site next to the workshop, hauls the material himself and builds.',
            "A vehicle's counter drops when the vehicle is finished, not at the start.",
            'With no room for a site next to the workshop, the turn passes to the next product.',
          ],
        },
        {
          h: 'Extractors',
        },
        {
          p: 'The Extractor uses the same panel. Here the good button is called "Only this good".',
        },
        {
          table: {
            head: ['Action', 'Result'],
            rows: [
              ['"Only this good"', 'This good ∞, rest 0'],
              ['Right-click a resource', '"Gather": this good ∞, rest 0, the work flag stays where it was'],
              ['Ctrl + right-click a resource', 'The same, and the flag goes to the resource'],
              ['All counters at 0', 'Status "All set to 0"'],
              ['Extractor with a workplace', 'Choice limited to the goods the building stores'],
              [
                'Counter at 0, good on the ground',
                'The counter covers extraction. The Extractor keeps hauling logs and piles.',
              ],
            ],
            foot: '[[job:hunter|Hunters]], [[job:scout|Scouts]] and soldiers have no counters.',
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
      lead: 'A tree gives {{gather.treeYield}} pieces of Wood after {{gather.strokes}} novice strokes.',
      blocks: [
        {
          h: 'What a resource gives',
        },
        {
          table: {
            head: ['Resource', 'Who', 'Gives', 'Novice strokes', 'Tool'],
            rows: [
              [
                'Tree',
                '[[job:collector|Extractor]]',
                '{{gather.treeYield}} [[good:wood|Wood]]',
                '{{gather.strokes}} per tree',
                'yes',
              ],
              [
                'Rock',
                '[[job:collector|Extractor]]',
                '4-5 [[good:stone|Quarrystone]]',
                '{{gather.strokes}} per piece',
                'yes',
              ],
              [
                'Deposit',
                '[[job:collector|Extractor]]',
                '5 [[good:mud|Clay]], [[good:iron|Iron]] or [[good:gold|Gold]]',
                '{{gather.strokes}} per piece',
                'yes',
              ],
              ['Mushroom', '[[job:collector|Extractor]]', '1 [[good:mushroom|Mushroom]]', '1 pickup', 'no'],
              [
                'Wheat field',
                '[[job:farmer|Farmer]]',
                '1 [[good:wheat|Wheat]]',
                '{{gather.wheatStrokes}} per field',
                'yes',
              ],
              [
                'Herb field',
                '[[job:herb_mush_guy|Herb Gatherer]]',
                '1 [[good:herb|Herb]]',
                '{{gather.herbStrokes}} per field',
                'yes',
              ],
              ['Shoal', '[[job:fisher|Fisherman]]', '1 [[good:fish|Fish]]', '{{gather.casts}} casts', 'yes'],
              ['Fruit bush', 'Hungry settler', '1 meal on the spot', '1 eating', 'no'],
            ],
          },
        },
        {
          list: [
            'A tree falls whole. The {{gather.treeYield}} pieces lie as a log and the Extractor carries them off 1 piece at a time.',
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
            foot: 'The condition applies separately to [[good:iron|Iron]] and [[good:gold|Gold]] and to each settler. Until then the good shows as "locked" in the panel.',
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
          table: {
            head: ['Stage', 'What happens'],
            rows: [
              ['1', 'Sown'],
              [
                '2-{{field.lastSeedStage}}',
                'Each watering adds 1 stage to the field and 6 neighbouring fields',
              ],
              ['{{field.ripeStage}}', 'Ripe, waiting for the harvest'],
              ['After the harvest', '1 piece lies on the ground and the spot is free to sow'],
            ],
            foot: 'A field grows only from watering. Time alone does nothing.',
          },
        },
        {
          table: {
            head: ['Building', 'Fields', 'Radius', 'Crew', 'Stock'],
            rows: [
              [
                '[[building:work_farm_00|Farm]]',
                '{{field.max}}',
                '{{field.radius}} steps',
                '{{farm.farmers}} Farmers, {{farm.carriers}} Carrier',
                '{{farm.stock}}',
              ],
              [
                '[[building:work_herb_hut|Herb Hut]]',
                '{{field.max}}',
                '{{field.radius}} steps',
                '{{herbHut.herbalists}} Herb Gatherers, {{herbHut.carriers}} Carrier',
                '{{herbHut.stock}}',
              ],
            ],
            num: [1, 4],
            foot: 'On the slant the radius is about {{field.diagonal}} steps. The field limit applies to the building, more people just cycle the fields faster.',
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
          p: "A field needs tillable ground: sand and roads are out. Wild fields on the map within the building's radius count toward its limit.",
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
          h: 'Who benefits',
        },
        {
          table: {
            head: ['Who', 'What he gains'],
            rows: [
              ['Workshop craftsman', 'More pieces per batch'],
              ['[[job:collector|Extractor]]', 'Fewer strokes, except mushrooms'],
              ['[[job:farmer|Farmer]], [[job:herb_mush_guy|Herb Gatherer]]', 'Fewer harvest strokes'],
              ['[[job:fisher|Fisherman]]', 'Fewer casts'],
              ['[[job:builder|Builder]]', 'More build points per stroke'],
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
            foot: '{{gather.strokes}}-stroke resources: tree, rock, deposit, herb field.',
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
            foot: 'Fishing, {{gather.casts}} casts per fish.',
          },
        },
        {
          p: '[[good:wheat|Wheat]] costs {{gather.wheatStrokes}} strokes per field with no tool, and 1 stroke with a tool or from 20% experience.',
        },
        {
          h: 'Pieces per workshop batch',
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
            foot: 'For a recipe that yields 1 piece. A 2-piece recipe gets a ×2 bonus. Ingredients and batch time stay the same. Experience also applies to slaughter goods.',
          },
        },
        {
          p: 'Fractions build up in the workshop. A whole piece goes on the shelf, even over capacity.',
        },
        {
          h: 'Wear',
        },
        {
          table: {
            head: ['Work', 'Tool use'],
            rows: [
              ['Workshop batch', '1 per finished batch'],
              ['Gathering stroke', '1 per stroke, even one that ends no piece'],
              ['Rod cast', '1 per cast, even a failed one'],
              ["Builder's stroke", '1 per stroke, also on repairs and strokes that added nothing'],
              ['Watering', '1 per watering'],
              ['Sowing, picking mushrooms', '0'],
            ],
            foot: 'After {{tool.uses}} uses the tool is gone and the settler works bare-handed until he gets a new one.',
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
      lead: 'A Carrier with no cart hauls {{haul.carry}} at a time, and one spot on the ground holds up to {{haul.groundStack}} pieces of a good.',
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
          h: 'Priority and minimum',
        },
        {
          table: {
            head: ['Trait', 'Priority', 'Storage minimum'],
            rows: [
              [
                'Applies to',
                'One building: warehouse, Headquarters, Barracks, tower',
                "All the player's warehouses and Headquarters together",
              ],
              [
                'Who brings it in',
                "This building's Carriers",
                'Carriers of warehouses, Headquarters, Wells and Beehives',
              ],
              [
                'From where',
                'Other warehouses, workshop products, piles',
                'Workshop products, Wells, Beehives, piles',
              ],
              ['Until', 'The building has no room left', 'The total reaches the minimum'],
              ['Limit', 'Building capacity', '{{haul.minimumMax}} pieces of a good'],
              ['Lock', 'None', 'Nobody takes a good from a store below the minimum'],
            ],
            foot: 'A store gives goods to a priority store only above the minimum.',
          },
        },
        {
          p: 'The minimum applies to food too. If all your food fits inside the minimum, nobody eats from the store.',
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
            head: ['Carrier', 'Pieces per trip', 'Speed lost, full'],
            rows: [
              ['No cart', '{{haul.carry}}', '-'],
              ['With [[good:handcart|Handcart]]', '{{haul.handcart}}', '{{haul.handcartLossPct}}%'],
              ['With [[good:oxcart|Ox Cart]]', '{{haul.oxcart}}', '{{haul.oxcartLossPct}}%'],
            ],
            num: [1, 2],
            foot: "Speed loss grows with the load. A [[job:trader|Merchant's]] carts have the same numbers.",
          },
        },
        {
          list: [
            'Only a Carrier with a workplace and a [[job:trader|Merchant]] take a cart. The Carrier keeps his workplace and treats the cart as a tool.',
            'The cart must be yours and free: no crew, no other driver, same landmass.',
            'A warehouse Carrier with room on his cart picks up the same good from piles and finished products within {{haul.cartTopUp}} steps of himself, then returns.',
            'If he loses his workplace, the cart stays where it is.',
          ],
        },
        {
          h: 'Piles on the ground',
        },
        {
          list: [
            'One spot holds 1 good, up to {{haul.groundStack}} pieces.',
            'A pile has no owner. Anyone can take it.',
            'A Carrier with no work flag picks up within {{flag.radius}} steps of the building, with a flag within {{flag.radius}} steps of the flag.',
          ],
        },
        {
          h: 'Work reach',
        },
        {
          table: {
            head: ['Who', 'Measured from', 'Straight', 'On the slant'],
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
            foot: 'In steps. The work area ends at signpost reach where the profession is subject to it.',
          },
        },
        {
          p: 'Carriers at a Farm, Herb Hut, Well, Beehive, tower or Barracks take no work flag.',
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
      lead: 'The flag marks the work area and stores nothing. An Extractor with no workplace leaves goods on the ground.',
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
              ['Carrier', 'Warehouse: piles within {{flag.radius}} steps of the building'],
              ['Hunter', 'Around the workplace'],
              ['Fisherman', 'Looks for a shore from where he stands'],
            ],
            foot: 'Area with a flag: the "Work reach" table in [[article:hauling|Carriers and Warehouses]].',
          },
        },
        {
          h: 'The pile by the flag',
        },
        {
          list: [
            "Goods from a flag won't reach a store by themselves. You need a Carrier with a workplace.",
            "A warehouse Carrier reaches {{flag.radius}} steps from the building. Further out, give him his own flag next to the Extractor's.",
            'A Carrier with a flag takes piles and finished products around it and brings them to his building.',
            'Moving the flag leaves the piles where they are.',
          ],
        },
        {
          h: 'Buttons',
        },
        {
          table: {
            head: ['Button', 'Result'],
            rows: [
              [
                '"Plant a flag"',
                'Places the flag on the chosen spot or moves it there. On an occupied spot it looks within {{flag.snap}} steps, past that the order is lost.',
              ],
              ['"Take the flag away"', 'Only with a workplace, removes the flag'],
              ['"Show Work Area"', 'Shows the area circle. Works while a flag stands.'],
              ['"Show the flag"', 'Centres the view on the flag'],
            ],
            foot: "Ctrl + right-click also moves the selected worker's flag.",
          },
        },
        {
          p: 'An Extractor moves his own flag when the [[article:assistant|Assistant]] switch is on: {{assistant.flagMin}}-{{assistant.flagMax}} steps from the resource, and once the area runs out, to the resource nearest his building. Hunter and Fisherman flags stay put.',
        },
        {
          h: 'A flag outside signpost reach',
        },
        {
          p: 'You can plant a flag out of reach. The worker immediately gets status "Lost" and stands until the network gets there. Hunters are exempt: [[article:roads|Roads and Signposts]].',
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
          p: 'A [[job:scout|Scout]] places signposts, no material needed. A signpost network belongs to one player.',
        },
        {
          figure: {
            id: 'reach',
            caption: 'Network reach',
          },
        },
        {
          table: {
            head: ['Reach, steps', 'Settler', '[[job:carrier|Carrier]]', 'Notes'],
            rows: [
              ['Walking', '{{reach.walk}}', '{{reach.carrier}}', 'From where he stands'],
              [
                'Settler to signpost',
                'under {{reach.walk}}',
                'under {{reach.carrier}}',
                'Opens the whole linked network',
              ],
              [
                'Signpost to target',
                'under {{reach.walk}}',
                'under {{reach.carrier}}',
                'From every signpost in the network',
              ],
              [
                'Link between two signposts',
                'under {{reach.link}}',
                'under {{reach.link}}',
                'Route between them up to {{reach.linkRoute}} steps',
              ],
              [
                'Gap from your own signpost',
                'at least {{reach.spacing}}',
                'at least {{reach.spacing}}',
                'Refused any closer',
              ],
              [
                'Searching for goods',
                'under {{reach.goods}}',
                'under {{reach.goods}}',
                'Also from signposts in this reach',
              ],
              [
                'Building on a signpost',
                '{{reach.displace}}',
                '{{reach.displace}}',
                'The signpost shifts aside, failing that it is lost',
              ],
            ],
            num: [1, 2],
          },
        },
        {
          table: {
            head: ['Terrain', 'Searching for goods, steps'],
            rows: [
              ['Road, land', 'under {{reach.goods}}'],
              ['Sand', 'about {{reach.goodsSand}}'],
              ['Mountains', 'about {{reach.goodsMountain}}'],
              ['Snow', 'about {{reach.goodsSnow}}'],
            ],
            num: [1],
          },
        },
        {
          p: 'Reach does not apply to Scouts, soldiers, heroes, [[job:hunter|Hunters]] or [[job:druid|Druids]].',
        },
        {
          p: "A worker with a workplace or work flag out of reach stands idle until the network gets there. He still delivers what he's carrying.",
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
              ['"Signposts: N"', 'Number of linked signposts, this one included'],
              ['"Demolish"', 'The signpost vanishes at once, no confirmation, no Scout needed'],
              ['Neighbouring signposts', 'Lose their link to the demolished one'],
              ['Network', 'Splits apart if the demolished signpost was the only link'],
              ['Workers outside the new reach', 'Status "Lost", they stand until the network returns'],
            ],
            foot: 'The "Signposts" map overlay shows networks.',
          },
        },
        {
          h: 'Route',
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
            'A segment costs 1 [[good:stone|Quarrystone]] and 1 [[job:builder|Builder]] stroke, after buildings and stockades.',
            'Quarrystone is also laid on up to 6 neighbouring segments that nobody is walking to and that have no stone yet.',
            'Cancelling a segment: the delivered Quarrystone lands next to it.',
            'Upgrading a building over a road: the road vanishes, the Quarrystone is not refunded.',
            'Settlers take the road on their own when it comes out cheaper.',
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
              ['Weapon and armour weight 2-3, not heroes', '+{{step.weightLowExtra}} s'],
              ['Weapon and armour weight 4-5, not heroes', '+{{step.weightHighExtra}} s'],
              ['[[good:amulet_speed|Wind Amulet]]', '-{{step.amuletSaved}} s'],
              ['Egyptian', '-{{step.egyptSaved}} s'],
              ['Full [[good:handcart|Handcart]]', '{{haul.handcartLossPct}}% slower'],
              ['Full [[good:oxcart|Ox Cart]]', '{{haul.oxcartLossPct}}% slower'],
            ],
            foot: 'The fastest step takes {{step.shortest}} s. The slowdown on carts grows with the load.',
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
              ['Carrier, in shoes, with goods', 'Route', '{{step.carrierOnRoad}} s'],
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
      lead: 'A Merchant runs between {{trade.stops}} buildings and with no cart takes {{haul.carry}} per trip.',
      blocks: [
        {
          h: 'Carried by',
        },
        {
          table: {
            head: ['Hold', 'Piece pickup'],
            rows: [
              ['Hands', '{{trade.handsSeconds}} s'],
              ['[[good:handcart|Handcart]]', '{{trade.handcartSeconds}} s'],
              ['[[good:oxcart|Ox Cart]]', '{{trade.oxcartSeconds}} s'],
            ],
            num: [1],
            foot: 'Pickup time also applies to unloading. Capacity and speed loss: [[article:hauling|Carriers and Warehouses]].',
          },
        },
        {
          p: 'At 20-30 steps one way, both carts move the same goods per minute. Shorter favours the Handcart, longer the Ox Cart.',
        },
        {
          h: 'Route',
        },
        {
          list: [
            'A route has {{trade.stops}} finished buildings. Any building of yours with stock will do, foreign ones at most 1.',
            'While a building is being upgraded, the [[job:trader|Merchant]] waits for it to finish.',
            'A Merchant takes no food from a Dwelling.',
          ],
        },
        {
          h: 'Your own buildings',
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
                'Loads from the whole settlement: warehouse, then warehouses and workshops within its signpost network',
              ],
            ],
            foot: 'A and B are the two route buildings. The settlement option works only for a warehouse or Headquarters, on one route stop. The storage minimum also limits loading.',
          },
        },
        {
          h: 'Trading with the computer',
        },
        {
          list: [
            'The foreign building belongs to a computer player, is finished and has an offer set by the map.',
            "Adding it to a route needs a friendly attitude on both sides, each trip only on the side of the Merchant's tribe: [[article:diplomacy|Diplomacy]].",
            "An offer is N pieces of one good for M of another, with the numbers set by the map. A route trades one offer at a time. The computer's store refills to {{trade.refillLevel}} pieces of the offer's good every {{trade.refillSeconds}} s.",
            'The Merchant takes as many full batches as his hold fits with room for the return good. In a small hold, a batch splits over several trips.',
            'He hands over a batch, takes payment and repeats while he has goods. With no payment in the building he waits and hands nothing over. "keep N" leaves N pieces of the sale good in the building. Return limit N: stop once the building holds N pieces of payment.',
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
