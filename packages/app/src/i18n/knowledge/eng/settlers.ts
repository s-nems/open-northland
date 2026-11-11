import type { ArticleGroup } from '../../../hud/knowledge/articles.js';

export const SETTLERS: ArticleGroup = {
  group: 'Settlers',
  items: [
    {
      id: 'needs',
      name: 'Needs',
      lead: 'At {{need.drivePct}}% on a bar, a settler drops his work and goes to refill it.',
      blocks: [
        {
          p: 'The lobby setting "Settler needs: Disabled" freezes the bars and removes hunger.',
        },
        {
          h: 'Bars',
        },
        {
          table: {
            head: ['Bar', 'Drains over time', 'Drains with work', 'Refilled by', 'At 0%'],
            rows: [
              [
                'Energy',
                '100% in {{need.drainMinutes}} min',
                'yes',
                '[[article:food|a meal]]',
                '[[article:health|dies after {{health.starveTime}}]]',
              ],
              [
                'Stamina',
                '100% in {{need.drainMinutes}} min',
                'yes',
                'sleep',
                'nothing more, the step already slows from {{need.drivePct}}%',
              ],
              ['Social Motivation', '100% in {{need.drainMinutes}} min', 'no', 'talking', 'no penalty'],
              [
                'Religion',
                'no',
                'weapons and armour only',
                '[[article:religion|prayer]]',
                'makes no weapons or armour',
              ],
            ],
            foot: 'At map start each bar is random, {{need.startMinPct}}-100%. Without [[good:shoes|Shoes]], {{need.barefootSampleSteps}} steps cost {{need.barefootRoadPct}}% Energy on a road, {{need.barefootLandPct}}% on land and up to {{need.barefootMaxPct}}% on the hardest ground, double that under load.',
          },
        },
        {
          h: 'Thresholds',
        },
        {
          figure: {
            id: 'need-bar',
            caption: 'What happens on a bar',
          },
        },
        {
          table: {
            head: ['Level', 'What happens'],
            rows: [
              ['{{need.criticalPct}}%', 'Notice for Energy, Stamina or Religion.'],
              [
                '{{need.drivePct}}%',
                'Finishes his task and drops work. On Stamina, each step takes {{step.tiredExtra}} s longer.',
              ],
              ['{{need.satedPct}}%', 'At home he tops up Stamina, then Energy, to this level and leaves.'],
              [
                '{{need.overfillPct}}%',
                'The most a bar holds. A meal at home or sleep at home with Furniture stores a reserve above 100%.',
              ],
            ],
          },
        },
        {
          h: 'Sleep',
        },
        {
          table: {
            head: [
              'Who',
              'Sleep time',
              'Stamina per sleep: away from home',
              'at home',
              'at home with Furniture',
            ],
            rows: [
              [
                'Man',
                '{{sleep.manSeconds}} s',
                '+{{sleep.manAwayPct}}%',
                '+{{sleep.manHomePct}}%',
                '+{{sleep.manFurnishedPct}}%',
              ],
              [
                '[[job:woman|Woman]]',
                '{{sleep.womanSeconds}} s',
                '+{{sleep.womanAwayPct}}%',
                '+{{sleep.womanHomePct}}%',
                '+{{sleep.womanFurnishedPct}}%',
              ],
              [
                'Merchant, Scout (always as at home)',
                '{{sleep.manSeconds}} s',
                '+{{sleep.manHomePct}}%',
                '-',
                '-',
              ],
              [
                'Soldier (wherever he sleeps)',
                '{{sleep.soldierSeconds}} s',
                '+{{sleep.soldierPct}}%',
                '-',
                '-',
              ],
            ],
            num: [1, 2, 3, 4],
          },
        },
        {
          h: 'Exceptions',
        },
        {
          table: {
            head: ['Who', 'Bars'],
            rows: [
              ['Baby, child', 'None. An adult starts at 100% on every bar.'],
              ['[[article:heroes|Hero]]', 'None.'],
              ['Monsters, animals', 'None.'],
              ['Soldier', 'No Social Motivation.'],
              ['Cart passenger', 'Bars do not drain, health does not change.'],
              [
                'Ship passenger',
                'Eats from the hold, sleeps as away from home, talks. Prays only once ashore.',
              ],
            ],
          },
        },
        {
          h: 'Religion and Social Motivation',
        },
        {
          p: 'A settler prays until Religion reaches 100% or Energy or Stamina drops to {{need.drivePct}}%. Who prays, where, and what it gives: [[article:religion|Religion and the Temple]].',
        },
        {
          table: {
            head: ['Activity', 'Time', 'Gives'],
            rows: [
              [
                'Talking',
                '{{talk.shortSeconds}}-{{talk.longSeconds}} s',
                'Up to +{{talk.pct}}% Social Motivation.',
              ],
              ['Staying at home, when the settler has a spouse', '-', 'Social Motivation 100%.'],
            ],
            num: [1],
          },
        },
      ],
      see: [
        'article:food',
        'article:health',
        'article:draughts',
        'article:religion',
        'article:walking',
        'article:stances',
      ],
    },
    {
      id: 'food',
      name: 'Food',
      lead: 'Food means Bread, Meat and Fish. A meal eaten at home gives {{home.factor}} times the Energy.',
      blocks: [
        {
          h: 'What a meal gives',
        },
        {
          table: {
            head: ['Meal', 'Energy away from home', 'Energy at home', 'Social Motivation'],
            rows: [
              ['[[good:bread|Food]]', '+{{meal.plainPct}}%', '+{{meal.plainHomePct}}%', '-'],
              [
                '[[good:candy|Cake]]',
                '+{{meal.candyPct}}%',
                '+{{meal.candyHomePct}}%',
                '+{{meal.candyCompanyPct}}%',
              ],
              ['Ripe bush', '+{{meal.plainPct}}%', '-', '-'],
            ],
            num: [1, 2, 3],
            foot: "A meal takes {{meal.seconds}} s and uses 1 piece. Soldiers don't eat at home, and Cake gives them the same as Food: +{{meal.plainPct}}%.",
          },
        },
        {
          p: "A settler also eats from a workshop's stock. In a store he takes Food first, then Cake.",
        },
        {
          h: 'Where a settler eats',
        },
        {
          steps: [
            "His own larder, if the dwelling's door is at most {{reach.walk}} hexes away.",
            'The nearest store, workshop or ground pile within {{reach.goods}} hexes, or a ripe bush closer than {{reach.bushAtHand}} hexes.',
            'The nearest ripe bush within {{reach.goods}} hexes.',
            'The nearest food anywhere he can walk to, even his own dwelling if it is further away.',
          ],
        },
        {
          p: "Other families' larders and other players' stocks are closed. A bush belongs to nobody. [[article:roads|Signposts]] extend these reaches. Nobody eats or takes home stock below the [[article:hauling|storage minimum]].",
        },
        {
          h: 'Larder delivery',
        },
        {
          steps: [
            'A [[job:woman|Woman]] with a finished dwelling looks for the nearest food outside dwellings.',
            'She carries {{haul.carry}} piece home.',
            'With [[good:crockery|Crockery]] in the dwelling, each delivery puts {{haul.crockeryDelivery}} pieces in the larder.',
          ],
        },
        {
          p: 'A Woman brings food until the larder is full. Limits: [[article:family|Family and Home]].',
        },
      ],
      see: ['article:needs', 'article:family', 'article:gathering', 'good:bread', 'good:candy'],
    },
    {
      id: 'health',
      name: 'Health and Healing',
      lead: 'A person has {{health.human}} health, and full health comes back on its own in {{health.regenMinutes}} minutes.',
      blocks: [
        {
          h: 'What changes health',
        },
        {
          table: {
            head: ['Source', 'Change', 'Condition', 'Time for {{health.human}} health'],
            rows: [
              [
                'Regeneration',
                '+{{health.regenPerSecond}}/s',
                'Energy above 0%, in combat too',
                '{{health.regenTime}}',
              ],
              [
                '[[article:religion|Temple aura]]',
                '+{{aura.perSecond}}/s',
                '{{aura.range}} hexes from a [[building:work_temple|Temple]]',
                '{{aura.time}}',
              ],
              ['Hunger', '-{{health.starvePerSecond}}/s', 'Energy 0%', '{{health.starveTime}}'],
            ],
            num: [1, 3],
            foot: 'Regeneration and aura add up to {{aura.totalPerSecond}} per second. Regeneration stops at {{health.human}}, but the aura heals past normal, up to {{aura.ceiling}}.',
          },
        },
        {
          p: 'At {{health.nearDeath}} health the game shows a notice that the settler is dying.',
        },
        {
          h: 'Healing Potions',
        },
        {
          list: [
            '[[good:potion_heal_small|Small Healing Potion]] has {{draught.smallUses}} sips, {{draught.healSmallTotal}} health in total. [[good:potion_heal_big|Large Healing Potion]] has {{draught.bigUses}} sips, {{draught.healBigTotal}} health in total.',
            'When a blow would take his health below {{draught.healBelow}}, a settler drinks sip after sip at once, until he has at least {{draught.healBelow}} again or the potion runs out.',
            "Even a killing blow doesn't kill, if the sips cover the wound.",
            'A settler also drinks when hunger takes his health below {{draught.healBelow}}.',
          ],
        },
      ],
      see: ['article:draughts', 'article:needs', 'article:religion', 'good:potion_heal_small'],
    },
    {
      id: 'family',
      name: 'Family and Home',
      lead: 'A child needs {{family.childFood}} pieces of food to be born.',
      blocks: [
        {
          h: 'Assigning a dwelling',
        },
        {
          list: [
            'Only the "Assign home" order gives a dwelling. Nobody moves in on their own, and a wedding moves only the spouse.',
            'A dwelling holds as many families as the Families column of the level table says. The order fails on a full one.',
            'Reassigning moves the whole family: settler, spouse and growing child.',
          ],
        },
        {
          h: 'Marriage',
        },
        {
          list: [
            'A wedding takes the "Marry" order.',
            'The order pairs the settler with the nearest adult of the opposite sex, same tribe, same player.',
            'The candidate must be within the settler\'s [[article:roads|signpost]] reach. With no candidate the order is lost and the game shows "No match".',
            'Soldiers, heroes, Scouts and anyone sent to the [[building:barracks|Barracks]] or [[building:school|School]] do not marry.',
            "A couple lives in the wife's dwelling, or the husband's if she has none.",
          ],
        },
        {
          h: 'Growing Up',
        },
        {
          table: {
            head: ['Stage', 'Age', 'Since birth'],
            rows: [
              ['Baby', 'under {{age.childYears}} years', '0-{{age.childTime}}'],
              ['Child', '{{age.childYears}}-{{age.adultYears}} years', '{{age.childTime}}-{{age.adultTime}}'],
              ['Adult', 'from {{age.adultYears}} years', 'from {{age.adultTime}}'],
            ],
            foot: 'A year of life lasts {{age.yearSeconds}} s, and the settler panel shows age in whole years. A child walks around the dwelling. Once grown, a boy becomes a [[job:civilist|Civilian]] and a girl a [[job:woman|Woman]]. Nobody dies of old age.',
          },
        },
        {
          h: 'Dwelling levels',
        },
        {
          figure: {
            id: 'home-levels',
            caption: 'Dwelling levels',
          },
        },
        {
          data: 'homes',
        },
        {
          p: 'The larder has separate limits for Food and Cake: Dwelling 1 holds {{home.larder}} + {{home.candyLarder}} pieces. A settler can live in a dwelling of another tribe of the same player.',
        },
        {
          h: 'Dwelling furnishings',
        },
        {
          table: {
            head: ['Good', 'From', 'Gives', '1 piece lasts for', 'Woman restocks below'],
            rows: [
              [
                '[[good:crockery|Crockery]]',
                'Dwelling 1',
                'A food delivery gives {{haul.crockeryDelivery}} pieces',
                '{{home.crockeryDeliveries}} deliveries',
                '{{home.crockeryFetchBelow}}',
              ],
              [
                '[[good:furniture|Furniture]]',
                'Dwelling 1',
                'Sleep ×{{home.factor}}',
                '{{home.furnitureManSleeps}} sleeps for a man, {{home.furnitureWomanSleeps}} for a woman',
                '{{home.furnitureFetchBelow}}',
              ],
              [
                '[[good:holy_oil|Oil]]',
                'Dwelling 3',
                '[[article:religion|Holy fire]]: prayer outside the dwelling',
                '{{oil.burnTime}}',
                '{{home.oilFetchBelow}}',
              ],
            ],
            num: [4],
            foot: 'A dwelling holds up to {{home.wareUnits}} pieces of each of these goods. Oil burns nonstop, even when nobody is praying.',
          },
        },
        {
          p: 'In the dwelling panel the player can turn off Crockery and Furniture use and Oil deliveries for the whole settlement. Oil already stored keeps burning.',
        },
        {
          h: 'Who loses a dwelling',
        },
        {
          table: {
            head: ['Who', 'What happens'],
            rows: [
              ['Widower', 'Loses it once the child has grown up or died.'],
              ['Widow', 'Stays in the dwelling.'],
              ['Grown child', 'Loses it on reaching adulthood.'],
              [
                'Merchant, Scout, soldier',
                'The family keeps the dwelling, but he neither eats nor sleeps there.',
              ],
            ],
          },
        },
      ],
      see: [
        'article:food',
        'article:religion',
        'article:assistant',
        'building:home_level_00',
        'good:crockery',
        'good:furniture',
      ],
    },
    {
      id: 'assistant',
      name: 'Assistant',
      lead: 'With counters you order how many more children should be born and how many recruits trained. A counter goes down as the order is filled. Switches hand out equipment from the stores.',
      blocks: [
        {
          h: 'Counters',
        },
        {
          table: {
            head: ['Counter', 'Gives', 'Who does it', 'Counts down', 'Can be set to ∞'],
            rows: [
              ['Daughters', 'a girl', 'married woman with a dwelling', 'at birth', 'no'],
              ['Sons', 'a boy', 'married woman with a dwelling', 'at birth', 'yes'],
              ['Soldiers without weapons', 'a recruit', '[[job:civilist|Civilian]]', 'after drill', 'yes'],
              [
                'Sword fighters, Spearmen, Archers',
                'arms, then a recruit',
                'unarmed soldier, then a Civilian',
                'when he takes a weapon',
                'yes',
              ],
            ],
            foot: 'A counter goes from 0 to {{assistant.counterMax}}. An order given to one person beats the Assistant. Weapon and armour order: [[article:equip|Equipping Soldiers]].',
          },
        },
        {
          h: 'Switches',
        },
        {
          table: {
            head: ['Switch', 'At start', 'Who gets it'],
            rows: [
              ['[[good:shoes|Shoes]]', 'off', 'adult man'],
              [
                'Iron tools, Wooden tools',
                'off',
                'anyone with a job except soldiers, [[job:scout|Scouts]] and Civilians',
              ],
              [
                'Iron tools: Replace wooden ones',
                'on',
                'a worker with a Wooden Tool, while Iron tools is on',
              ],
              ['[[good:mead|Mead]]', 'off', 'Civilians, Soldiers'],
              ['Nourishing potions, Stamina potions, Healing potions', 'off', 'Civilians, Soldiers'],
              [
                'Amulet: Nourishing, Stamina, Strength, Defence, Precision, Wind',
                'off',
                'Civilians, Soldiers',
              ],
              [
                'School graduates assigned to workshops automatically',
                'off',
                '[[building:school|School]] graduate',
              ],
              ['Extractors move their flag automatically', 'off', '[[job:collector|Extractor]] with a flag'],
            ],
            foot: 'For potions and amulets, the "Civilians" and "Soldiers" buttons choose who receives them. Both start on. Switching one off takes nothing back. A notice reminds you of a switch that is off once its good lies in store and someone lacks it, and of the flag switch once an Extractor runs out by his flag.',
          },
        },
        {
          h: 'Births',
        },
        {
          list: [
            'Daughters are born first, then sons. That is why the daughters counter has no ∞, or sons would never be born.',
            'At a counter of 3, at most 3 couples wait for a child at once.',
          ],
        },
        {
          h: 'The Barracks draft',
        },
        {
          list: [
            'Only an adult Civilian with no job and nothing to do goes to the Barracks, unmarried men first. The Assistant never pulls anyone off work.',
            'The Sword fighters, Spearmen or Archers counter first arms an unarmed soldier, if a weapon is in his reach.',
          ],
        },
        {
          table: {
            head: ['What stops the draft', 'What to do'],
            rows: [
              ['No finished [[building:barracks|Barracks]]', 'Finish the Barracks.'],
              ['No free Civilian', 'Send someone to the Barracks by hand.'],
              [
                'An unarmed soldier is waiting for a weapon of this kind',
                "Deliver the weapon. Until then he holds the new recruit's place.",
              ],
            ],
            foot: 'A recruit on his way to the Barracks already counts toward the counter.',
          },
        },
        {
          h: 'Handing out',
        },
        {
          list: [
            "The Assistant doesn't equip women, children, [[article:heroes|heroes]] or tower crews.",
            "The Assistant doesn't hand out stock below the [[article:hauling|storage minimum]].",
            'It fills empty slots, and Iron tools come before wooden ones. With "Replace wooden ones" it also sends a worker holding a Wooden Tool for an Iron one: [[article:tools|Tools]]. It swaps nothing else for something better.',
            'A settler has {{amulet.slots}} slots for potions and amulets: [[article:draughts|Potions and Amulets]].',
          ],
        },
        {
          h: 'Graduates',
        },
        {
          list: [
            'A graduate goes to the nearest free post in his profession, even a workshop still being built. A workshop making the product he studied comes first, even if it is further away.',
            "With no free post he waits at the School. The Assistant doesn't place [[job:collector|Extractors]], [[job:hunter|Hunters]], [[job:fisher|Fishermen]] or soldiers.",
          ],
        },
        {
          p: 'How Extractors move their own flag: [[article:work-flag|Work flag]].',
        },
        {
          p: 'The "Subjects" window shows how many settlers lack a dwelling, a job, tools, shoes, a partner, children, weapons or mead.',
        },
      ],
      see: [
        'article:family',
        'article:equip',
        'article:draughts',
        'article:tools',
        'article:work-flag',
        'building:barracks',
      ],
    },
    {
      id: 'draughts',
      name: 'Potions and Amulets',
      lead: "A settler drinks on the spot without stopping what he's doing. Amulets never wear out.",
      blocks: [
        {
          h: 'Potions',
        },
        {
          table: {
            head: ['Potion', 'Sips', 'Per sip', 'Drinks when'],
            rows: [
              [
                '[[good:mead|Mead]]',
                '{{draught.meadUses}}',
                '+{{draught.meadPct}}% Energy and +{{draught.meadPct}}% Stamina',
                'Energy or Stamina drops to {{need.drivePct}}%',
              ],
              [
                '[[good:potion_food_small|Small]] / [[good:potion_food_big|Large Nourishing Potion]]',
                '{{draught.smallUses}} / {{draught.bigUses}}',
                '+{{draught.potionPct}}% Energy',
                'Energy drops to {{need.drivePct}}%',
              ],
              [
                '[[good:potion_stamina_small|Small]] / [[good:potion_stamina_big|Large Stamina Potion]]',
                '{{draught.smallUses}} / {{draught.bigUses}}',
                '+{{draught.potionPct}}% Stamina',
                'Stamina drops to {{need.drivePct}}%',
              ],
            ],
            num: [1],
            foot: 'Healing Potions: [[article:health|Health and Healing]].',
          },
        },
        {
          h: 'Amulets',
        },
        {
          table: {
            head: ['Amulet', 'Effect', 'When'],
            rows: [
              [
                '[[good:amulet_food|Nourishing Amulet]]',
                '+{{amulet.needPct}}% Energy',
                'each time Energy drops to {{need.drivePct}}%',
              ],
              [
                '[[good:amulet_stamina|Amulet of Stamina]]',
                '+{{amulet.needPct}}% Stamina',
                'each time Stamina drops to {{need.drivePct}}%',
              ],
              [
                '[[good:amulet_strength|Amulet of Strength]]',
                'damage dealt ×{{amulet.strengthFactor}}',
                'every blow',
              ],
              [
                '[[good:amulet_crithit|Amulet of Precision]]',
                '{{amulet.critChancePct}}% chance of damage ×{{amulet.critFactor}}',
                'every blow',
              ],
              [
                '[[good:amulet_defense|Amulet of Defence]]',
                'damage taken ×{{amulet.defenseFactor}}',
                'every blow taken',
              ],
              ['[[good:amulet_speed|Wind Amulet]]', 'step shorter by {{step.amuletSaved}} s', 'every step'],
            ],
          },
        },
        {
          h: 'Several at once',
        },
        {
          list: [
            'A second copy of the same amulet does nothing.',
            'Different amulets work together: Strength and Precision give ×{{amulet.comboFactor}} on a lucky roll.',
            'With a Nourishing Amulet a settler never goes to eat, and with an Amulet of Stamina he never goes to sleep.',
          ],
        },
        {
          h: 'Who wears what',
        },
        {
          table: {
            head: ['Who', 'What he carries'],
            rows: [
              ['Adult man', '{{amulet.slots}} slots for potions and amulets, in any profession.'],
              ['Woman, child', 'Nothing.'],
            ],
            foot: 'What a hero carries: [[article:heroes|Heroes]].',
          },
        },
      ],
      see: ['article:needs', 'article:health', 'article:heroes', 'article:damage', 'article:walking'],
    },
  ],
};
