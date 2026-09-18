export const enContent = {
  profession: {
    idle: 'Civilian',
    carrier: 'Carrier',
    builder: 'Builder',
    joiner: 'Joiner',
    armorer: 'Armorer',
    potter: 'Potter',
    mason: 'Mason',
    smith: 'Smith',
    coin_maker: 'Coin maker',
    hunter: 'Hunter',
    breeder: 'Breeder',
    tailor: 'Tailor',
    farmer: 'Farmer',
    miller: 'Miller',
    baker: 'Baker',
    brewer: 'Brewer',
    fisher: 'Fisher',
    herbalist: 'Herbalist',
    druid: 'Druid',
    scout: 'Scout',
    trader: 'Trader',
    soldier: 'Soldier',
    collector: 'Gatherer',
    archer_short: 'Archer',
    archer_long: 'Longbow archer',
    worker: 'Worker',
  },
  category: {
    gathering: 'Gathering',
    transport: 'Transport',
    production: 'Crafting',
    special: 'Special',
    military: 'Military',
  },
  building: {
    headquarters: 'Headquarters',
    home_level_00: 'Home (level 1)',
    home_level_01: 'Home (level 2)',
    home_level_02: 'Home (level 3)',
    home_level_03: 'Home (level 4)',
    home_level_04: 'Home (level 5)',
    stock_00: 'Warehouse (level 1)',
    stock_01: 'Warehouse (level 2)',
    stock_02: 'Warehouse (level 3)',
    work_well_00: 'Well',
    work_hive_00: 'Apiary',
    work_farm_00: 'Farm',
    work_mill_00: 'Mill',
    work_bakery_00: 'Bakery (level 1)',
    work_bakery_01: 'Bakery (level 2)',
    work_brewery: 'Brewery',
    work_animal_farm: 'Animal farm',
    work_sewery_00: 'Tailor (level 1)',
    work_sewery_01: 'Tailor (level 2)',
    work_pottery_00: 'Pottery (level 1)',
    work_pottery_01: 'Pottery (level 2)',
    work_pottery_02: 'Defence wall',
    work_joinery_00: 'Joinery (level 1)',
    work_joinery_01: 'Joinery (level 2)',
    work_joinery_02: 'Joinery (level 3)',
    work_joinery_03: 'Joinery (level 4)',
    work_armory_00: 'Armory (level 1)',
    work_armory_01: 'Armory (level 2)',
    work_mason_hut_00: 'Mason hut (level 1)',
    work_mason_hut_01: 'Mason hut (level 2)',
    work_smithy_00: 'Smithy (level 1)',
    work_smithy_01: 'Smithy (level 2)',
    work_coin_mint: 'Coin mint',
    work_herb_hut: 'Herb hut',
    work_druid_00: 'Druid hut (level 1)',
    work_druid_01: 'Druid hut (level 2)',
    work_temple: 'Temple',
    school: 'School',
    barracks: 'Barracks',
    tower_00: 'Watchtower (level 1)',
    tower_01: 'Watchtower (level 2)',
    // The hidden yard houses a joinery raises beside itself; a site is named after the vehicle it becomes.
    handcart: 'Handcart',
    oxcart: 'Ox cart',
    ship_small: 'Small ship',
    ship_big: 'Large ship',
    catapult: 'Catapult',
  },
  goods: {
    wood: 'Wood',
    plank: 'Log',
    coin: 'Coin',
    stone: 'Stone',
    mud: 'Clay',
    iron: 'Iron',
    gold: 'Gold',
    mushroom: 'Mushrooms',
    water: 'Water',
    wheat: 'Wheat',
    leather: 'Leather',
    wool: 'Wool',
    flour: 'Flour',
    honey: 'Honey',
    herb: 'Herb',
    holy_oil: 'Holy oil',
    food_simple: 'Simple food',
    food_extra: 'Fine food',
    bread: 'Bread',
    candy: 'Candy',
    meat: 'Meat',
    brick: 'Brick',
    tile: 'Roof tile',
    pillar: 'Pillar',
    ornament: 'Ornament',
    crockery: 'Crockery',
    furniture: 'Furniture',
    shoes: 'Shoes',
    tool_wooden: 'Wooden tool',
    tool_iron: 'Iron tool',
    armor_wool: 'Cloth armor',
    armor_leather: 'Leather armor',
    armor_chain: 'Chain armor',
    armor_plate: 'Plate armor',
    bow_short: 'Short bow',
    bow_long: 'Long bow',
    spear_wooden: 'Wooden spear',
    spear_iron: 'Iron spear',
    sword_shord: 'Short sword',
    sword_long: 'Long sword',
    mead: 'Mead',
    potion_food_small: 'Small food potion',
    potion_food_big: 'Large food potion',
    potion_stamina_small: 'Small stamina potion',
    potion_stamina_big: 'Large stamina potion',
    potion_heal_small: 'Small healing potion',
    potion_heal_big: 'Large healing potion',
    amulet_food: 'Amulet of plenty',
    amulet_stamina: 'Amulet of stamina',
    amulet_strength: 'Amulet of strength',
    amulet_defense: 'Amulet of defense',
    amulet_crithit: 'Amulet of the critical blow',
    amulet_speed: 'Amulet of speed',
    prey: 'Game',
    sheep: 'Sheep',
    cattle: 'Cattle',
    handcart: 'Handcart',
    oxcart: 'Ox cart',
    ship_small: 'Small ship',
    ship_big: 'Large ship',
    catapult: 'Catapult',
    /** The vehicle type without a good of its own: the ox cart before its ox arrives. */
    cart_no_ox: 'Ox cart without ox',
    chest: 'Chest',
    anything: 'Anything',
  },
  missionTrace: {
    title: 'Mission execution log',
    atTick: 'Mission log · tick {tick}',
    note: 'Latest 100 executed missions. Execution does not guarantee every result succeeded. First/last ticks and counts survive saving.',
    empty: 'No missions executed yet.',
    row: '#{index}: ticks {first} / {last}, executed {count} times',
  },
  scene: {
    'mission-map': {
      title: 'Story map script acceptance',
      summary:
        'The owned Wielkie Sprzatanie map with its complete script, fog and a saved mission execution log. Requires locally decoded content. Campaign and original-game fidelity acceptance remain pending.',
    },
    sandbox: {
      title: 'Open sandbox',
      summary:
        'A compact production village: every building at every level with full crews, pre-stocked warehouses, and gathering camps beside the village.',
    },
    collision: {
      title: 'Unit collision',
      summary: 'Pathfinding, formations and civilian movement through a crowded battlefield.',
    },
    battle: {
      title: 'Mass battle',
      summary: 'Two armies clash at scale with four weapon classes.',
    },
    'bow-flight': {
      title: 'Bow flight',
      summary:
        'Four archers keep natural-scale arrows visible along horizontal, vertical and diagonal lanes.',
    },
    'battle-weary': {
      title: 'Weary warband',
      summary:
        'Tired, hungry soldiers fight on: the reserve stands to beside the front, a sleeping sentry gets up for a raider, and they rest only once the fight is won.',
    },
    siege: {
      title: 'Siege',
      summary: 'A warband razes an enemy base, smashing the HQ and towers before the plain homes.',
    },
    repair: {
      title: 'Repair',
      summary:
        'Builders mend a quiet damaged home first and pass over a nearer one while a fight is on beside it.',
    },
    palisade: {
      title: 'Palisades and gates',
      summary:
        'Builders raise a connected wooden stockade, a gate opens a route through it, and an enemy soldier breaks a segment to make a second breach.',
    },
    'tower-defence': {
      title: 'Tower defence',
      summary:
        'The alarm goes up: civilians hide in the watchtowers, and each tower shoots at the raiders faster the more are inside.',
    },
    'attack-move': {
      title: 'Attack-move',
      summary:
        'A warband ordered across the map cuts down the picket blocking its path, then walks on to the ordered spot.',
    },
    diplomacy: {
      title: 'Diplomacy',
      summary:
        'First contact under fog: the ally beside you is known at once, a one-way aggressor reveals itself by its blow and turns you hostile, and a tribe never seen stays off the diplomacy window.',
    },
    'team-vision': {
      title: 'Team vision',
      summary:
        "One fog mask for a lobby team: your teammate's soldier far to the east keeps its clearing in your sight and its neighbour on your diplomacy window, while a hermit beyond every eye stays unknown.",
    },
    trade: {
      title: 'Trade route',
      summary:
        'A neutral warehouse offers four iron for a coin; the trader carts coins over from the home warehouse, brings the iron back, and the goods traded turn the nation friendly. Select the trader for its Handel section, and the far warehouse for its agreements.',
    },
    tribute: {
      title: 'Tributes',
      summary:
        'The map script demands three tributes for the neighbour: the timber is payable out of one warehouse and paying it turns the neighbour friendly, the purse of coins is short, and the stone lies split between two stores that pay it together.',
      strings: {
        '1': 'The neighbours ask for timber and stone for their new hall.',
        '2': 'The neighbours ask for a purse of coins.',
        '3': 'The neighbours ask for stone to pave the road between us.',
      },
    },
    vehicles: {
      title: 'Vehicles',
      summary:
        'Every cart, ship and catapult of two civilizations standing on a shore at a few headings: an ox cart loaded with wood, a catapult mid-attack, a trader pulling its handcart away, the debris of a cart wrecked on the first tick, and a crewed ox cart and catapult driving east along the bottom rows, the catapult at half the pace.',
    },
    'vehicle-ships': {
      title: 'A ship across the strait',
      summary:
        'A small ship lies moored at the west shore. Three soldiers attach to it and are ordered to dock at the east shore: the ship waits until everyone is aboard, casts off, sails the strait, moors on the far side and unloads the party on the clicked point.',
    },
    'vehicle-yard': {
      title: 'Vehicle yard',
      summary:
        'A level-3 joinery whose two joiners are set to make handcarts: each opens a hidden cart yard beside the shop, carries the wood in from the warehouse, hammers on the site, and the finished yard becomes a handcart standing where it stood.',
    },
    'vehicle-ox': {
      title: 'Ox cart without ox',
      summary:
        "A bare ox cart beside the player's four cows. Its goto is refused for want of an animal; then the cart recruits the nearest cow past the herd's breeding pair, the cow walks over and is consumed, and the cart becomes an ox cart in place, which the carrier standing by may now attach to.",
    },
    'vehicle-cargo': {
      title: 'Vehicle cargo',
      summary:
        'Two carts and their carriers: a handcart whose player asked for wood, which its carrier fetches unit by unit from the piles beside it, and an ox cart that starts loaded with stone nobody asked for, so its carrier carries it out to the warehouse. The handcart turns loaded after the first unit, the ox cart empty after the last.',
    },
    'vehicle-catapult': {
      title: 'Catapult',
      summary:
        'A swordsman boards a catapult and is ordered to batter an enemy hut: the shot clip loops with its smoke, the stones burst on the roof until the hut falls, and the catapult, left in its attack stance, turns on the archer still shooting at its hull.',
    },
    school: {
      title: 'Learning a profession',
      summary:
        'One collector goes to school to learn carpentry, a trade already known to the settlement. Select the other collector and right-click the school to choose a course yourself.',
    },
    technology: {
      title: 'Mission technologies',
      summary:
        'Open the building menu: housing starts forbidden. The script first grants permission, then your own collector unlocks it. The rival collector cannot unlock your technologies.',
    },
    'terrain-edits': {
      title: 'Scripted terrain edits',
      summary:
        'The script colors two areas of grass brown and green and forbids building in the western area. Both colors survive saving and loading.',
    },
    presentation: {
      title: 'Script presentation',
      summary:
        'What a map script shows rather than changes: the briefing page it opens, two info lines in the top-right corner (one with a live head-count), the hero it names and selects, the camera it moves, the marker it plants, the rain it starts and the ground it shakes. A few seconds on, a second page joins the first, which the window walks with its prev and next buttons, a magic ring surrounds the ford and the first info line clears.',
      strings: {
        '1': 'Read the briefing the elders sent.',
        '2': 'Hold the ford until the thaw.',
        '3': 'Raise the great hall.',
        '10': 'The elders are watching.',
        '11': 'Settlers at the ford: %d of %d',
        '20': 'Hallvard the Steadfast',
      },
      pages: {
        '500':
          'The elders send word: hold the ford until the thaw, and raise the great hall before the next winter. Hallvard will lead the guard.',
        '501':
          'A rider from the elders: the ford is marked out for the palisade. Keep the guard inside the ring.',
      },
    },
    victory: {
      title: 'Victory and defeat',
      summary:
        'A skirmish to the last man: your warband cuts down the rival settlement, the simulation declares it dead at the next check and hands you the win, with the verdict window and jingle.',
    },
    'goods-catalog': {
      title: 'Goods catalog',
      summary: 'Every storable good and its warehouse slot in one compact reference scene.',
    },
    berries: {
      title: 'Wild berries',
      summary: 'Foragers eat from wild bushes and the harvested plants regrow.',
    },
    chests: {
      title: 'Chests and papers',
      summary:
        'Three wooden chests are opened for food, three civilists and a well paper, a magical one refuses a plain trade, and a held paper stands a well up finished.',
    },
    chain: {
      title: 'Production chain',
      summary: 'Farm, mill, bakery and well in one loop: wheat → flour → bread, fed by water.',
    },
    alchemy: {
      title: "Alchemist's huts",
      summary:
        'A druid brews holy oil from mushrooms in the small hut; two druids brew potions from water, mushroom, herb and coin in the large one.',
    },
    'household-goods': {
      title: 'Household goods',
      summary:
        'Potters, joiners and druids supply a mature home with crockery, furniture and holy oil for better meals, rest and prayer.',
    },
    warehouse: {
      title: 'Warehouse logistics',
      summary: 'Carriers collect loose goods until each warehouse capacity is reached.',
    },
    construction: {
      title: 'Raising buildings',
      summary:
        'Carriers and future staff haul materials while builders hammer; the animal farm shows a breeder helping before taking up the finished workplace.',
    },
    'farm-construction': {
      title: 'Farm construction',
      summary:
        'Builders raise a farm beside a finished drying barn, from its timber frame to walls and roofing.',
    },
    upgrade: {
      title: 'Building upgrades',
      summary:
        'A home re-opens as a construction site and rises a level for the difference cost; a second home awaits your Upgrade button.',
    },
    signposts: {
      title: 'Signposts',
      summary: 'A scout erects a signpost; settlers work only within the connected guidepost network.',
    },
    family: {
      title: 'Marriage and children',
      summary: 'A couple weds with a kiss; a married wife stocks the home with food and bears a child.',
    },
    children: {
      title: 'Children feed themselves',
      summary: 'Hungry children walk to wild bushes and eat; the cared-for baby never self-feeds.',
    },
    gossip: {
      title: 'Gossip and need bubbles',
      summary:
        'Idle settlers pair up and chat to refill their company need (soldiers never join) while hungry and sleepy settlers show thought bubbles.',
    },
    wildlife: {
      title: 'Wildlife herds',
      summary:
        'Bears, stags and wolves spawn as herds on open grass, drawn with their species bodies and shadows.',
    },
    'movement-continuity': {
      title: 'Movement continuity',
      summary:
        'Two walkers, barefoot and shod, cross a faster middle lane. A third walks diagonally across rough ground: select and redirect that walker repeatedly while it is moving. Stags wander nearby.',
    },
    hunting: {
      title: 'Hunter at work',
      summary:
        'A flag-bound hunter stalks the hares near its flag - shots can miss, every hit scatters the herd within its range, each kill is picked clean and carried home before the next, and sheep kept for husbandry fall only as a last resort.',
    },
    livestock: {
      title: 'Animal husbandry',
      summary:
        'A scout claims sheep and cattle (a faction-coloured heart appears), the herd marches to the animal farm, and the breeders turn water, wheat and a little animal life into wool, leather and meat.',
    },
    equipment: {
      title: 'Equipment window',
      summary:
        'Three settlers for the equip window: a civilian with worn boots, tool and consumables, a soldier with sword and chain armour, and a bare settler. Spare gear lies by the HQ for the per-slot equip, swap and take-off orders.',
    },
    'equipment-effects': {
      title: 'Equipment effects',
      summary:
        'Two collectors trek to a forest - the booted one visibly faster, its boots wearing down on the road; an iron-tooled miller grinds 5 wheat with a production bonus, and settlers drink their mead and potions by themselves when hunger or fatigue presses.',
    },
    amulets: {
      title: 'Amulets',
      summary:
        'Three amulet trials: a walker with the speed amulet pulls ahead of a bare one, a swordsman with the strength, critical-hit and defense amulets beats an equal rival, and a hungry, tired collector tops up both needs from the food and stamina amulets, which never wear out.',
    },
    barracks: {
      title: 'Barracks training',
      summary:
        'A colonist sent to the barracks drills inside for 15 seconds and walks out an unarmed soldier; beside him a serving soldier who only drills, and a colonist for whom the soldier trade stays shut.',
    },
    armor: {
      title: 'Armor parade',
      summary:
        'A parade grid of sword soldiers: one column per armor state (bare, wool, leather, chain, plate) and one row per player colour, every unit standing down so rival owners never fight. For judging the per-armor recolours across team colours.',
    },
    'ai-defence': {
      title: 'AI defence',
      summary:
        'The red seat is handed to the strategic AI with only its military plan running. It rings its own alarm over the headquarters as the blue warband closes, walls three of its four archers into the watchtower - the fourth is left to the field army - and throws everyone still free at the raiders. Both warbands are over-tough, so the scene settles into a standing fight instead of a body count.',
    },
    'tower-garrison': {
      title: 'Tower garrison',
      summary:
        'Six archers - three short bows, three long - fill a watchtower, vanish inside it, and shoot from up there at their own bow plus the tower bonus. Instead of a sign per man the roof flies the garrison flag, five stars for the six of them. The enemy party takes arrows on the march, and once it reaches the wall it can only batter the tower: the men inside are out of reach.',
    },
    'death-loot': {
      title: 'Fallen soldiers',
      summary:
        'Two files of sword soldiers cut each other down in the open. Every man is dressed alike - short sword, chain armor, a full mead and half-walked shoes - and his gear lies beside his bones: the sword, the armor and the untouched mead drop, the part-used shoes go down with him.',
    },
  },
} as const;
