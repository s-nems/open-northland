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
            head: ['Bar', 'Drains on its own', 'Drains with work', 'Refilled by', 'At 0%'],
            rows: [
              [
                'Energy',
                '100% in {{need.drainMinutes}} min',
                'yes',
                '[[article:food|a meal]]',
                '[[article:health|dies in {{need.starveMinutes}} min]]',
              ],
              ['Stamina', '100% in {{need.drainMinutes}} min', 'yes', 'sleep', 'only a slower step'],
              ['Social Motivation', '100% in {{need.drainMinutes}} min', 'no', 'talking', 'no penalty'],
              [
                'Religion',
                'no',
                'weapons and armour only',
                '[[article:religion|prayer]]',
                "won't start weapons or armour",
              ],
            ],
            foot: 'At map start each bar is random, {{need.startMinPct}}-100%. Without [[good:shoes|Shoes]] each step costs {{need.barefootStepMinPct}}-{{need.barefootStepMaxPct}}% Energy depending on the ground, double that under load.',
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
                'The most a bar holds. A meal at home or sleep on Furniture stores a reserve above 100%.',
              ],
            ],
            foot: '[[job:armorer|Armourers]], [[job:smith|Blacksmiths]] and [[job:sewer|Tailors]] go to pray on their own.',
          },
        },
        {
          h: 'What a settler does first',
        },
        {
          steps: [
            'Alarm: shelter.',
            '[[article:draughts|Potions and amulets]], on the spot.',
            'Energy: eat.',
            'Stamina: sleep.',
            'Religion: pray.',
            'Player orders: Barracks, equipment, tower.',
            'Social Motivation: talk.',
            'Work.',
          ],
        },
        {
          p: 'With nothing to eat and nowhere to pray, a settler returns to work and the bar keeps falling. With no dwelling within {{reach.walk}} hexes he sleeps in the open.',
        },
        {
          p: "A soldier in combat eats only what he carries or from the tower's stock. An eat order breaks off the fight.",
        },
        {
          h: 'Sleep',
        },
        {
          table: {
            head: ['Who', 'Sleep time', 'Away from home', 'At home', 'At home with Furniture'],
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
              ['Merchant, Scout', '{{sleep.manSeconds}} s', '+{{sleep.manHomePct}}%', '-', '-'],
              ['Soldier', '{{sleep.soldierSeconds}} s', '+{{sleep.soldierPct}}%', '-', '-'],
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
              ['Cart passenger', 'Bars and health stand still.'],
              [
                'Ship passenger',
                'Eats from the hold, sleeps as away from home, talks. Religion waits for land.',
              ],
            ],
          },
        },
        {
          h: 'Eat, Sleep, Talk and Pray orders',
        },
        {
          list: [
            'The order works at any bar level. It interrupts marching, attacks and fights.',
            'With no food or place to pray, the order waits. If more orders are queued behind it, it is lost.',
            'Heroes do not take them. "Pray" works only in a profession that can pray.',
          ],
        },
        {
          h: 'Hunger and long orders',
        },
        {
          list: [
            'At {{need.criticalPct}}% Energy a settler breaks off marching, scouting or an order queue. Status: "Hungry, going to eat".',
            'He eats to {{need.satedPct}}%, then starts the order again.',
            'If he finds nothing, he returns to the order and looks again after {{meal.breakRetrySeconds}} s.',
            "A new order takes priority: hunger won't break it off for {{meal.breakRetrySeconds}} s.",
            "Tiredness doesn't break off orders.",
          ],
        },
        {
          p: 'The "Eating and sleeping" switch and the "Standing to" state apply only to soldiers: [[article:stances|Stances]].',
        },
        {
          h: 'Religion and Social Motivation',
        },
        {
          table: {
            head: ['Activity', 'Time', 'Gives'],
            rows: [
              [
                'Prayer',
                '{{pray.seconds}} s',
                '+{{pray.pct}}% Religion. Repeats to 100% unless Energy or Stamina drops to {{need.drivePct}}%.',
              ],
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
      lead: 'Food means Bread, Meat and Fish. The same meal at home gives twice the Energy.',
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
          p: "A settler also eats from a workshop's stock. In a store he takes Food first, Cake only when there's no Food. He eats a ripe bush where it stands, leaving it bare.",
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
            'She carries 1 piece home.',
            'With [[good:crockery|Crockery]] in the dwelling, 1 piece delivered becomes 2 in the larder.',
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
            head: ['Source', 'Change', 'Condition', 'Full health in'],
            rows: [
              [
                'Regeneration',
                '+{{health.regenPerSecond}}/s',
                'Energy above 0%, in combat too',
                '{{health.regenWholeMin}} min {{health.regenRestSec}} s',
              ],
              [
                '[[article:religion|Temple aura]]',
                '+{{aura.perSecond}}/s',
                '{{aura.range}} hexes from a [[building:work_temple|Temple]]',
                '{{aura.wholeMin}} min {{aura.restSec}} s',
              ],
              [
                'Healing Potion',
                '+{{draught.healSip}} per sip',
                'a wound would drop him below {{draught.healBelow}}',
                '-',
              ],
              [
                'Hunger',
                '-{{health.starvePerSecond}}/s',
                'Energy 0%',
                '{{health.starveWholeMin}} min {{health.starveRestSec}} s',
              ],
            ],
            num: [1, 3],
            foot: 'Regeneration and aura add up to {{aura.totalPerSecond}} per second. Regeneration stops at {{health.human}}, the aura heals past normal, up to {{aura.ceiling}}. Children and heroes also have {{health.human}} and regenerate.',
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
            '[[good:potion_heal_small|S Healing Potion]] has {{draught.smallUses}} sips, {{draught.healSmallTotal}} total. [[good:potion_heal_big|L Healing Potion]] has {{draught.bigUses}} sips, {{draught.healBigTotal}} total.',
            'A settler drinks sip after sip until the wound leaves him at least {{draught.healBelow}} health.',
            "Even a killing blow doesn't kill, if the sips cover the wound.",
            'A settler also drinks when hunger takes his health below {{draught.healBelow}}.',
            'An opened bottle goes first, then a small one, then a large one.',
          ],
        },
      ],
      see: ['article:draughts', 'article:needs', 'article:religion', 'good:potion_heal_small'],
    },
    {
      id: 'life',
      name: 'Life and Death',
      lead: 'A child grows up {{age.adultMinutes}} minutes after birth. Nobody dies of old age.',
      blocks: [
        {
          h: 'Life stages',
        },
        {
          table: {
            head: ['Stage', 'Age', 'Since birth', 'Notes'],
            rows: [
              [
                'Baby',
                '0-{{age.babyLastYear}} years',
                '0-{{age.childWholeMin}} min {{age.childRestSec}} s',
                'Steps take twice as long.',
              ],
              [
                'Child',
                '{{age.childYears}}-{{age.childLastYear}} years',
                '{{age.childWholeMin}} min {{age.childRestSec}} s-{{age.adultMinutes}} min',
                'Steps take {{step.childExtra}} s longer. Walks around the dwelling.',
              ],
              [
                'Adult',
                'from {{age.adultYears}} years',
                'from {{age.adultMinutes}} min',
                'A boy becomes a [[job:civilist|Civilian]], a girl a [[job:woman|Woman]].',
              ],
            ],
            foot: 'A year of life lasts {{age.yearSeconds}} s.',
          },
        },
        {
          h: 'What stays after death',
        },
        {
          table: {
            head: ['Item', 'What happens'],
            rows: [
              ['Carried goods', 'Dropped on the ground in full.'],
              [
                '[[good:shoes|Shoes]], tool',
                'Dropped as new if worn at most {{death.newWearPct}}%. Otherwise lost.',
              ],
              ['Weapon', 'Dropped only by a soldier.'],
              ['Armour', 'Always dropped.'],
              ['Potions, amulets', 'Amulets and unopened bottles drop.'],
              ["Carrier's handcart", 'Stays in place with its load.'],
            ],
          },
        },
        {
          p: 'Effects on the spouse: [[article:family|Family and Home]].',
        },
      ],
      see: ['article:family', 'article:health', 'article:trades'],
    },
    {
      id: 'family',
      name: 'Family and Home',
      lead: 'A child costs {{family.childFood}} pieces of food from the larder, and a couple has one child at a time.',
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
            'A wedding takes the Marry order.',
            'The order pairs the settler with the nearest adult of the opposite sex, same tribe, same player.',
            'The candidate must be within the settler\'s [[article:roads|signpost]] reach. With no candidate the order is lost and the game shows "No match".',
            'Soldiers, heroes, Scouts and anyone sent to the [[building:barracks|Barracks]] or [[building:school|School]] do not marry.',
            "A couple lives in the wife's dwelling, or the husband's if she has none.",
          ],
        },
        {
          h: 'Child',
        },
        {
          steps: [
            'The player chooses: Have a Boy or Have a Girl.',
            'The wife brings food while the larder holds under {{family.childFood}} pieces.',
            'Both go into the dwelling.',
            'The larder loses {{family.childFood}} pieces.',
            'The child is born after {{family.birthVikingSeconds}} s for Vikings, {{family.birthOtherSeconds}} s for other tribes.',
          ],
        },
        {
          p: 'A couple has no child when the wife has no dwelling, the dwelling is under construction, the husband is a soldier, [[job:trader|Merchant]] or [[job:scout|Scout]], the spouses live apart, or there is no food in reach.',
        },
        {
          p: 'A couple can have the next child once the last one grows up, after {{age.adultMinutes}} minutes. A child takes no family place in the dwelling.',
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
                'A food delivery gives 2 pieces',
                '{{home.crockeryDeliveries}} deliveries',
                '{{home.crockeryFetchBelow}}',
              ],
              [
                '[[good:furniture|Furniture]]',
                'Dwelling 1',
                'Sleep ×2',
                '{{home.furnitureManSleeps}} sleeps for a man, {{home.furnitureWomanSleeps}} for a woman',
                '{{home.furnitureFetchBelow}}',
              ],
              [
                '[[good:holy_oil|Oil]]',
                'Dwelling 3',
                '[[article:religion|Holy fire]]: prayer outside the dwelling',
                '{{oil.wholeMin}} min {{oil.restSec}} s',
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
        'article:life',
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
      lead: 'Counters order children and recruits, switches hand out equipment from the stores.',
      blocks: [
        {
          h: 'Counters',
        },
        {
          table: {
            head: ['Counter', 'Orders', 'Who does it', 'Counts down', 'No limit'],
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
            foot: 'Range 0-{{assistant.counterMax}}, starting at 0. An order given to one person beats the Assistant. Weapon and armour order: [[article:equip|Equipping Soldiers]].',
          },
        },
        {
          h: 'Switches',
        },
        {
          table: {
            head: ['Switch', 'At start', 'Who gets it'],
            rows: [
              ['[[good:shoes|Shoes]]', 'on', 'adult man'],
              [
                'Iron tools, Wooden tools',
                'on',
                'anyone working a profession, except soldiers, [[job:scout|Scouts]] and Civilians',
              ],
              ['[[good:mead|Mead]]', 'on', 'Civilians, Soldiers'],
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
              ['Extractors move their flag automatically', 'on', '[[job:collector|Extractor]] with a flag'],
            ],
            foot: 'For potions and amulets, the "Civilians" and "Soldiers" buttons choose who receives them. Both start on. Switching one off takes nothing back.',
          },
        },
        {
          h: 'Births',
        },
        {
          list: [
            'Daughters first, then sons. Daughters have no ∞ setting, or sons would never get a turn.',
            'At a counter of 3, at most 3 couples have a child at once.',
            'A couple takes one order at a time. The same things block it as a direct order: [[article:family|Family and Home]].',
            'Lowering the counter does not cancel an order a couple already has.',
          ],
        },
        {
          h: 'The Barracks draft',
        },
        {
          list: [
            'Only an adult Civilian with no workplace and no errand goes. Unmarried men first. Nobody is pulled off work.',
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
            foot: 'At most {{assistant.draftsPerSecond}} people per second. Recruits on the way count toward the counter, and a lost recruit goes back in the queue.',
          },
        },
        {
          h: 'Handing out',
        },
        {
          list: [
            "The Assistant doesn't equip women, children, [[article:heroes|heroes]] or tower crews.",
            'A settler goes to the store once and takes everything in one trip.',
            'Only one settler sets out for each piece in the store. Stock below the [[article:hauling|storage minimum]] stays put.',
            'Fills empty slots only, never swaps for better. Iron tools go before wooden, a large bottle before a small one.',
            "A settler with a small potion doesn't fetch a large one. There are {{amulet.slots}} slots for potions and amulets: [[article:draughts|Potions and Amulets]].",
          ],
        },
        {
          h: 'Graduates',
        },
        {
          list: [
            "A graduate goes once, to the nearest free post in his profession, even a workshop construction site. A workshop making the course's product beats a closer one.",
            'With no free post he waits at the School. Skips [[job:collector|Extractors]], [[job:hunter|Hunters]], [[job:fisher|Fishermen]] and soldiers.',
          ],
        },
        {
          p: 'The flag moves with the resource, staying {{assistant.flagMin}}-{{assistant.flagMax}} hexes from it: [[article:work-flag|Work flag]].',
        },
        {
          p: 'The "Subjects" window counts shortages: dwellings, workplaces, tools, shoes, partners, children, weapons, mead.',
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
                '[[good:potion_food_small|S]] / [[good:potion_food_big|L Nourishing Potion]]',
                '{{draught.smallUses}} / {{draught.bigUses}}',
                '+{{draught.potionPct}}% Energy',
                'Energy drops to {{need.drivePct}}%',
              ],
              [
                '[[good:potion_stamina_small|S]] / [[good:potion_stamina_big|L Stamina Potion]]',
                '{{draught.smallUses}} / {{draught.bigUses}}',
                '+{{draught.potionPct}}% Stamina',
                'Stamina drops to {{need.drivePct}}%',
              ],
              [
                '[[good:potion_heal_small|S]] / [[good:potion_heal_big|L Healing Potion]]',
                '{{draught.smallUses}} / {{draught.bigUses}}',
                '+{{draught.healSip}} health',
                'a wound would drop him below {{draught.healBelow}} health',
              ],
            ],
            num: [1],
            foot: 'An Eat, Sleep, Talk or Pray order holds off drinking.',
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
            'For hunger and tiredness a settler reaches in turn for an opened bottle, an amulet, then a full bottle with fewer sips.',
            "With a Nourishing Amulet a settler doesn't look for food, with an Amulet of Stamina he doesn't go to sleep.",
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
              [
                '[[article:heroes|Hero]]',
                'Healing Potions and the Amulets of Strength, Precision, Defence and Wind.',
              ],
              ['Woman, child', 'Nothing.'],
            ],
          },
        },
      ],
      see: ['article:needs', 'article:health', 'article:damage', 'article:walking'],
    },
  ],
};
