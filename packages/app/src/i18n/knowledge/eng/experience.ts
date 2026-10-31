import type { ArticleGroup } from '../../../hud/knowledge/articles.js';

export const EXPERIENCE: ArticleGroup = {
  group: 'Experience',
  items: [
    {
      id: 'exp-work',
      name: 'Work Experience',
      lead: 'Each track counts experience for one good: 100% on wood does nothing for quarrystone.',
      blocks: [
        {
          h: 'What experience gives you',
        },
        {
          figure: {
            id: 'exp-curve',
            caption: 'The first pieces count the most',
          },
        },
        {
          data: 'experience',
        },
        {
          p: 'Fractions of a point do nothing. In [[article:gathering|gathering]], experience cuts strokes. In workshops and at slaughter, it adds pieces. Tool tables: [[article:tools|Tools]]. Build points: [[article:construction|Building, Upgrades and Repairs]].',
        },
        {
          h: 'How much work it takes',
        },
        {
          table: {
            head: ['Work', 'Counted per', 'Points per piece', 'Pieces to 51%', 'Pieces to 100%'],
            rows: [
              [
                'Wood',
                'tree felled',
                '{{exp.wood.points}}',
                '{{exp.wood.repeatsQuoted}}',
                '{{exp.wood.repeatsFull}}',
              ],
              [
                'Hunting',
                'piece taken from a carcass',
                '{{exp.hunt.points}}',
                '{{exp.hunt.repeatsQuoted}}',
                '{{exp.hunt.repeatsFull}}',
              ],
              [
                'Fishing',
                'fish',
                '{{exp.fish.points}}',
                '{{exp.fish.repeatsQuoted}}',
                '{{exp.fish.repeatsFull}}',
              ],
              [
                'Clay, quarrystone, iron, gold, mushrooms, wheat, slaughter, workshop',
                'piece; animal at slaughter; batch in a workshop',
                '{{exp.craft.points}}',
                '{{exp.craft.repeatsQuoted}}',
                '{{exp.craft.repeatsFull}}',
              ],
              [
                'Building, repairs',
                'stroke that added something',
                '{{exp.build.points}}',
                '{{exp.build.repeatsQuoted}}',
                '{{exp.build.repeatsFull}}',
              ],
            ],
            num: [2, 3, 4],
            foot: 'The last two columns count trees, pieces, batches or strokes. A track is named after the work and the good, e.g. Extraction - Iron, Baking - Bread. Tracks are the same for every tribe.',
          },
        },
        {
          p: "Each tree, piece and batch also adds a point to the profession's general track, e.g. Extraction. The general track opens further [[article:trades|professions]] and applies to any good without its own track. Points survive a change of profession.",
        },
        {
          h: 'Who gains nothing',
        },
        {
          list: [
            '[[job:carrier|Carriers]] build up Carrying, which does not speed up work. Deliveries needed to open the [[job:trader|Merchant]]: {{exp.carrierTrader}}.',
            'Merchants build up Trade, {{exp.tradePointPerUnit}} per piece unloaded. It changes nothing else.',
            '[[job:scout|Scouts]] collect no points. [[job:woman|Women]] and children have no tracks.',
            'Planting, watering, the [[building:school|School]] and the [[building:barracks|Barracks]] give no points.',
          ],
        },
      ],
      see: ['article:tools', 'article:trades', 'article:exp-combat', 'article:construction'],
    },
    {
      id: 'exp-combat',
      name: 'Combat Experience',
      lead: 'A hundred hits with one weapon class double your melee damage.',
      blocks: [
        {
          h: 'Melee damage',
        },
        {
          table: {
            head: ['Hits', 'Multiplier', 'A {{combat.sampleBlow}} blow becomes'],
            rows: [
              [0, '×1', '{{combat.sampleBlow}}'],
              [10, '×{{fight.factor.10}}', '{{fight.blow.10}}'],
              [25, '×{{fight.factor.25}}', '{{fight.blow.25}}'],
              [50, '×{{fight.factor.50}}', '{{fight.blow.50}}'],
              [75, '×{{fight.factor.75}}', '{{fight.blow.75}}'],
              ['{{combat.fightCapHits}}', '×{{combat.fightCapFactor}}', '{{combat.fightCapBlow}}'],
            ],
            num: [0, 1, 2],
            foot: 'The multiplier stops growing past {{combat.fightCapHits}} hits.',
          },
        },
        {
          p: 'The multiplier applies to melee blows against people, animals and buildings. It does not apply to [[article:walls|stockades]], [[article:vehicles|vehicles]], arrows or the [[article:catapult|catapult]].',
        },
        {
          h: 'Accuracy',
        },
        {
          p: 'Bow and catapult: {{aim.basePct}}% of shots land at 0 hits, 100% at {{aim.sureHits}}. Table: [[article:aim|Hitting and Shooting]].',
        },
        {
          h: 'What counts as a hit',
        },
        {
          p: "A blow or shot that deals damage gives 1 point to its weapon class: Fist, Spear, Sword, Bow or Catapult. The [[job:hunter|Hunter's]] bow counts as Bow too. A shot that hits several targets counts once.",
        },
        {
          p: 'The class track is called Fighting - Class. Hits in one class do nothing for another, and they survive a change of profession.',
        },
        {
          h: 'Discovering weapons',
        },
        {
          table: {
            head: ['Weapon', 'Craftsman', 'Requirement'],
            rows: [
              ['[[good:spear_wooden|Wooden Spear]]', '[[job:armorer|Armourer]]', 'none'],
              [
                '[[good:spear_iron|Iron Spear]]',
                '[[job:smith|Blacksmith]]',
                '{{exp.ironSpearNeed}} × Forging',
              ],
              ['[[good:sword_shord|Shortsword]]', '[[job:smith|Blacksmith]]', 'none'],
              [
                '[[good:sword_long|Longsword]]',
                '[[job:smith|Blacksmith]]',
                '{{exp.longSwordNeed}} × Forging',
              ],
              ['[[good:bow_short|Short Bow]]', '[[job:armorer|Armourer]]', 'none'],
              [
                '[[good:bow_long|Longbow]]',
                '[[job:armorer|Armourer]]',
                '{{exp.longBowNeed}} × Arms Production',
              ],
            ],
            foot: 'The same for all five tribes.',
          },
        },
        {
          p: 'Hits never lock a weapon away. A soldier takes any weapon a store in reach holds, even with no hits, and becomes that weapon\'s class on the spot. The {{exp.classLowNeed}} or {{exp.classHighNeed}} hit threshold in [[article:trades|Professions and School]] only records the class as discovered for the settlement and opens it in "Change profession".',
        },
        {
          h: 'The star',
        },
        {
          p: 'A soldier wears a star from 25 hits with the weapon he fights with. It grows every 25 hits and peaks at 100.',
        },
        {
          h: 'Heroes',
        },
        {
          p: 'Heroes do not collect hits, so their damage never grows. The [[job:hero_axe|Axe Hero]] has no axe track.',
        },
      ],
      see: [
        'article:damage',
        'article:aim',
        'article:heroes',
        'article:exp-work',
        'article:trades',
        'building:barracks',
      ],
    },
    {
      id: 'trades',
      name: 'Professions and School',
      lead: 'A discovery belongs to the player and outlives the worker who made it.',
      blocks: [
        {
          p: 'The lobby setting "Profession development: All unlocked from start" removes the requirements for civilian professions and products. Soldier profession requirements and map bans stay.',
        },
        {
          h: 'What opens a profession',
        },
        {
          data: 'jobs',
        },
        {
          p: 'A requirement with two tracks counts their sum. [[job:builder|Builder]], Extractor, [[job:farmer|Farmer]], [[job:hunter|Hunter]], [[job:fisher|Fisherman]], [[job:carrier|Carrier]] and [[job:scout|Scout]] are open from the start.',
        },
        {
          p: 'Products are discovered the same way, e.g. [[good:furniture|Furniture]] at {{exp.furnitureNeed}} × Carpentry. Requirements are the same for every tribe.',
        },
        {
          h: 'How a discovery happens',
        },
        {
          steps: [
            'A settler works in the preceding profession, e.g. [[job:collector|Extractor]] on wood.',
            'Trees felled to meet the [[job:joiner|Carpenter]] requirement: {{exp.joinerNeed}}. The game then announces the discovery.',
            'The profession is now open to the whole settlement, and this settler can take it up at once.',
            'Everyone else goes to the [[building:school|School]] or earns the same requirement through work.',
          ],
        },
        {
          h: 'School and Barracks',
        },
        {
          table: {
            head: ['Trait', 'School', 'Barracks'],
            rows: [
              ['Places', '{{school.seats}}', '{{barracks.seats}}'],
              ['Teaches', 'a civilian profession or product', 'the Soldier profession'],
              ['Time', 'see table below', '{{barracks.drillSeconds}} s'],
              ['Who', 'adult man', 'adult man, profession or not'],
              ['Experience points', '0', '0'],
              [
                'After the course',
                'new profession, waits at the School for a post',
                'unarmed Soldier, old profession stays known',
              ],
            ],
            foot: 'When the places are full, pupils wait at the door in order of enrolment.',
          },
        },
        {
          list: [
            'Needs interrupt a course without losing progress. Cancelling wipes it.',
            'A pupil sent to a School under construction brings materials and waits.',
            'A finished course is permanent, even after a change of profession.',
          ],
        },
        {
          h: 'Course length',
        },
        {
          table: {
            head: ['Courses', 'Time'],
            rows: [
              [
                '[[good:armor_leather|Leather Armour]], [[good:potion_food_small|S Nourishing Potion]], [[good:potion_stamina_small|S Stamina Potion]]',
                '{{course.shortSeconds}} s',
              ],
              ['professions and most products', '{{course.commonSeconds}} s'],
              ['[[good:potion_heal_big|L Healing Potion]]', '{{course.healSeconds}} s'],
              ['[[good:handcart|Handcart]]', '{{course.handcartSeconds}} s'],
              ['[[good:oxcart|Ox Cart]]', '{{course.oxcartSeconds}} s'],
              [
                '[[good:ship_small|Ship]], [[good:ship_big|Big Ship]], [[good:catapult|Catapult]]',
                '{{course.shipSeconds}} s',
              ],
            ],
            num: [1],
          },
        },
        {
          h: 'Profession and workplace',
        },
        {
          p: 'Profession and workplace are two separate decisions. "Change profession" clears the workplace and nobody assigns a new one for you. The exception is graduates, once you switch on their toggle in the [[article:assistant|Assistant]].',
        },
        {
          table: {
            head: ['Profession', 'Building', 'Without a building'],
            rows: [
              ['[[job:builder|Builder]]', 'not needed', 'Goes to construction sites on his own.'],
              ['[[job:scout|Scout]]', 'not needed', 'Works on orders.'],
              ['[[job:trader|Merchant]]', 'not needed', 'Drives his own [[article:trade|route]].'],
              ['[[job:civilist|Civilian]]', 'not needed', 'Does not work, waits for a post.'],
              [
                '[[job:collector|Extractor]], [[job:hunter|Hunter]], [[job:fisher|Fisherman]]',
                'optional',
                'Works from a [[article:work-flag|work flag]] planted at his feet when he takes the profession.',
              ],
              ['[[job:farmer|Farmer]], [[job:herb_mush_guy|Herb Gatherer]]', 'required', 'Tends no field.'],
              ['[[job:carrier|Carrier]]', 'required', 'Carries nothing.'],
              ['Other civilian professions', 'required', 'Stands idle.'],
            ],
          },
        },
        {
          list: [
            'Right-click a building ("Work here") to change profession and assign the workplace in one order.',
            "A settler who lacks the requirement for the building's profession takes a free Carrier post there, if there is one.",
            'A soldier only takes a post in his own profession.',
            '"Remove work place" keeps the profession and whatever he is carrying. It clears the production counters and the Carrier\'s handcart.',
            'Demolishing the building keeps the profession too.',
            'Women, children and heroes never get a profession.',
          ],
        },
        {
          h: 'What changing profession costs',
        },
        {
          table: {
            head: ['Item', 'What happens'],
            rows: [
              ['Workplace', 'Lost.'],
              ['Production counters', 'Lost.'],
              ['Carried goods', 'Dropped on the ground.'],
              ['Tool', 'Kept. On joining the army a new tool drops to the ground, a used one is lost.'],
              [
                'Weapon and armour',
                'On leaving the army an unused item goes to his hands or the ground. A used one is lost.',
              ],
              [
                'Orders',
                'The current order and the queue are lost. "Eating and sleeping" returns to "Allowed".',
              ],
              ['Known professions', 'Kept, including the previous one. Experience points too.'],
            ],
            foot: 'The School and Barracks change profession the same way, but the order queue stays. A Carrier leaves his handcart behind.',
          },
        },
      ],
      see: [
        'article:exp-work',
        'article:exp-combat',
        'article:assistant',
        'article:work-flag',
        'building:school',
        'building:barracks',
      ],
    },
  ],
};
