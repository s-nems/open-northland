import type { ArticleGroup } from '../../../hud/knowledge/articles.js';

export const PROBLEMS: ArticleGroup = {
  group: 'Problems',
  items: [
    {
      id: 'why',
      name: "Why Isn't It Working?",
      lead: 'Select the building or settler and read its status bar.',
      blocks: [
        {
          h: 'Messages',
        },
        {
          table: {
            filter: 'Search messages',
            head: ['Message', 'Level', 'Cause', 'What to do'],
            rows: [
              [
                '"Village attacked"',
                'Important',
                'An attack on a building or stockade, or a fight within {{notice.settlementReach}} hexes of one. Attacks within {{notice.fightRadius}} hexes of each other share one notice, which clears after {{notice.fightQuietSeconds}} s of calm',
                'Send soldiers',
              ],
              [
                '"Under attack"',
                'Notable',
                'An attack more than {{notice.settlementReach}} hexes from the settlement',
                'Send soldiers or pull your people out',
              ],
              [
                '"No way through"',
                'Notable',
                'The resource is in the area, but no path reaches it',
                'Open a path or move the flag',
              ],
              [
                '"No commander"',
                'Notable',
                'A vehicle with no commander was ordered to move',
                'Assign a commander',
              ],
              [
                '"No trade"',
                'Notable',
                "The Merchant's destination needs both sides friendly",
                'Check [[article:diplomacy|Diplomacy]]',
              ],
              [
                '"No storage", "No store"',
                'Regular, workshop: Notable',
                'No store will take the good',
                'Build a store or free up space in one',
              ],
              [
                '"No free post"',
                'Notable',
                'The building has no free workplaces',
                'Free a post or build a second one of these',
              ],
              [
                '"No match"',
                'Regular',
                'After "Marry", nobody free was in reach. The order is lost',
                'Give the order again when someone is free',
              ],
              [
                '"Need a pair: [good]"',
                'Notable',
                'The [[article:livestock|Cattle Farm]] has only one animal',
                'Send a Scout for a second one',
              ],
              [
                '"No yard space", "Yard blocked"',
                'Notable',
                'No free ground next to the workshop for the vehicle, or another vehicle stands there',
                'Clear some space. The next try comes after {{notice.yardRetrySeconds}} s',
              ],
              [
                '"No fish"',
                'Notable',
                'No fish left within reach of the shore',
                'Put the flag on water with fish',
              ],
              [
                '"No carrier"',
                'Notable',
                'Nobody aboard can handle cargo',
                'Put a Carrier or another civilian aboard',
              ],
              [
                '"No route"',
                'Important',
                "The vehicle has no way to its destination. A ship's destination is not on this water",
                'Pick another destination',
              ],
              [
                '"Nothing in area"',
                'Notable',
                'The work area has none of this resource',
                'Move the work flag or extend your signposts',
              ],
              [
                '"No garrison"',
                '-',
                'The tower has no crew',
                'Assign archers: [[article:defence|Towers and Alarm]]',
              ],
              [
                '"No resources"',
                'Notable',
                'Nothing left to gather on the whole map',
                'Change his profession',
              ],
              [
                '"No animals: [good]"',
                'Notable',
                'The [[article:livestock|Cattle Farm]] has none of this species',
                'Send a Scout to wild animals',
              ],
              [
                '"No animal"',
                'Notable',
                'The Ox Cart has no Ox',
                'Keep {{livestock.pairPlusOne}} adults: [[article:vehicles|Vehicles and Ships]]',
              ],
              [
                '"No prey"',
                'Notable',
                'No free game in the hunting ground',
                'Move the flag to where game grazes',
              ],
              [
                '"No [good]"',
                'Regular, workshop: Notable',
                'Builder sites are waiting for a good the nearby stores do not hold, or a workshop lacks an input nobody makes',
                'Make it, import it or staff the workshop',
              ],
              [
                '"Site needs [good]"',
                'Important',
                "No store within the site's signpost reach holds the good",
                'Make it, import it or link a store with signposts',
              ],
              [
                '"Wants to pray"',
                'Notable',
                'Religion has dropped to {{need.criticalPct}}% and there is nowhere to pray',
                'Build a [[building:work_temple|Temple]] or light a holy fire',
              ],
              [
                '"Starving"',
                'Important',
                'The settler is losing health from hunger',
                'Get food to a store in his reach, fast',
              ],
              [
                '"Hungry"',
                'Regular',
                'Energy has dropped to {{need.criticalPct}}%',
                'Get food to a store in his reach',
              ],
              [
                '"Land explored"',
                'Notable',
                'The Scout has uncovered all the land he can reach and is waiting',
                'Give him a new order: [[article:scout|Scout]]',
              ],
              [
                '"Store far away", "Store too far"',
                'Regular, workshop: Notable',
                'The stores that would take it are out of signpost reach',
                'Link them with signposts or build a store closer',
              ],
              [
                '"Nothing to build"',
                'Regular',
                'The Builder has no site',
                'Place a building or change his profession',
              ],
              [
                '"Nothing to do"',
                'Regular',
                'A settler with a workplace has stood for {{notice.idleSeconds}} s for no clear reason',
                'Check the building or change his profession',
              ],
              [
                '"Flag is empty"',
                'Regular',
                'The Carrier has nothing to pick up at his flag',
                'Move the flag or take it away',
              ],
              [
                '"No way to ship"',
                'Notable',
                "The ship's door is on another landmass",
                'Moor at a shore he can reach',
              ],
              [
                '"Wrong trade"',
                'Notable',
                "The settler doesn't have the profession the building needs",
                'Change his profession',
              ],
              [
                '"Peace: no entry", "Peace: no site"',
                'Notable',
                "Peace is on and the order reaches into a partner's settlement",
                'Pick a spot further off: [[article:diplomacy|Diplomacy]]',
              ],
              [
                '"Cannot board", "Stuck aboard"',
                'Notable',
                'The ship is at sea, or the profession does not suit the vehicle',
                'Moor at the shore or pick another vehicle',
              ],
              [
                '"Nobody gathers [good]", "Nobody hunts for [good]", "Nobody catches [good]"',
                'Notable',
                'The workshop has stood {{notice.noGathererSeconds}} s with no input and nobody is getting it',
                'Assign a settler or switch this good on for those you have',
              ],
              [
                '"Ship refused"',
                'Notable',
                'The ship cannot carry this vehicle, or its place is taken',
                'Use a Ship or free the place: [[article:vehicles|Vehicles and Ships]]',
              ],
              [
                '"Stores full: [good]"',
                'Regular',
                "The maker's stock and every store holding this good have been full for {{notice.storageFullSeconds}} s",
                'Build a store or use up the stock',
              ],
              ['"No room aboard"', 'Notable', 'All places are taken', 'Free a place or use another vehicle'],
              [
                '"Work locked"',
                'Notable',
                'The profession or building is not yet open to your tribe, or the mission bans it',
                'Make the discovery or change profession: [[article:exp-work|Work Experience]]',
              ],
              [
                '"Standing to"',
                '-',
                'A soldier on Attack or Defence does not rest with a fight within {{alert.restClearance}} hexes or a visible enemy soldier within {{alert.standTo}} hexes. A wild animal only counts once fighting',
                'An "Eat" or "Sleep" order releases him',
              ],
              [
                '"Input too far"',
                'Notable',
                'Only buildings out of signpost reach hold the input',
                'Link them with signposts or build a store closer',
              ],
              [
                '"All set to 0"',
                'Regular',
                'All his counters are at 0',
                'Choose in the panel what he should do',
              ],
              [
                '"Dying"',
                'Important',
                'Health has dropped below {{health.nearDeath}}, from wounds or hunger',
                'Get him out of the fight or give him food',
              ],
              [
                '"No workplace"',
                'Notable',
                'The building is gone or the settler was released, and he has stood {{notice.idleSeconds}} s with no flag. The profession stays',
                'Assign a workplace or change his profession',
              ],
              [
                '"Needs a restart"',
                'Important',
                'The changed setting only applies from a fresh start',
                '"Restart mission" in the Esc menu',
              ],
              [
                '"Product locked"',
                'Notable',
                'The chosen product is not available yet',
                'Choose another product',
              ],
              [
                '"Lacks experience"',
                'Notable',
                'Too little experience for this profession',
                'Send someone more experienced: [[article:exp-work|Work Experience]]',
              ],
              [
                '"Lost"',
                'Important',
                'No path to the destination, or the workplace, work flag or site is out of signpost reach. Stands there until you change something',
                '"Show the goal" points to the place. Place a [[article:roads|signpost]] or give another order',
              ],
              [
                '"Exhausted"',
                'Regular',
                'Stamina has dropped to {{need.criticalPct}}%',
                "Don't give him orders now, he will go to sleep on his own",
              ],
              [
                '"Prey cut off"',
                'Notable',
                'The game is behind water or a wall',
                'Open a path or move the flag',
              ],
            ],
            foot: 'The "Notable and important" filter hides Regular, "Important only" hides Notable too. Level "-" is a line on the panel with no notice.',
          },
        },
        {
          h: 'Work and Production',
        },
        {
          faq: [
            [
              'The workshop stands empty',
              'Status "No workers": nobody works there. Assign a settler with the right profession. A refusal comes with a message: "Wrong trade", "No free post" or "Lacks experience". Status "Idle" names the missing input. The worker fetches it himself if it lies within {{reach.goods}} hexes of a signpost.',
            ],
            [
              "The Armourer, Blacksmith or Tailor won't work",
              'Religion under "Wellbeing" is at 0%. A cycle of weapons or armour costs {{piety.lowPct}}% or {{piety.highPct}}%, a prayer gives {{pray.pct}}%. "Wants to pray" means there is nowhere to pray: you need a [[building:work_temple|Temple]], [[building:headquarters|Headquarters]] or a holy fire in the dwelling. More: [[article:religion|Religion and the Temple]].',
            ],
            [
              "Carriers aren't carrying",
              'A Carrier only carries with a workplace in a building. "Nothing to carry in reach": no goods within {{flag.radius}} hexes of the building or work flag. "No destination accepts this good": the stores are full.',
            ],
            [
              'Breeding has stopped',
              'The Stock Farmer breeds only at exactly {{livestock.pair}} adults. What the Cattle Farm status means: [[article:livestock|Livestock]].',
            ],
            [
              'The Hunter brings nothing back',
              'Status "No free prey in the hunting ground": nothing to hunt within {{flag.hunter}} hexes of the flag or workplace. He doesn\'t go for every animal on his own, see the "Auto-hunted" column: [[article:wildlife|Wild Animals and Hunting]]. Move the work flag to where game grazes.',
            ],
          ],
        },
        {
          h: 'People',
        },
        {
          faq: [
            [
              'No children are being born',
              'A couple needs a shared dwelling and {{family.childFood}} pieces of food in the larder. A message says what is missing: "No dwelling", "Dwelling unbuilt", "Living apart", "No food stock". "Husband away" means the husband is a Merchant, Scout, soldier or hero and does not come home. The "Births" counter in the Assistant also orders children. More: [[article:family|Family and Home]].',
            ],
            [
              'Hungry with a full store',
              'Check "Storage minimum": nobody takes a good below that total, not even for a meal. Lower it on food. The store may also be too far: it must lie within {{reach.walk}} hexes of the settler or in the signpost network.',
            ],
            [
              'A profession is missing from the School list',
              'The list shows only courses that are discovered and allowed in this mission. A row you can\'t pick gives the reason: "Already learned" or "These settlers cannot train at this school". [[article:exp-work|Work Experience]] discovers courses.',
            ],
          ],
        },
        {
          h: 'Building and Fields',
        },
        {
          faq: [
            [
              'A building is locked',
              'It sits in the "Locked" section of the build window. The "Required discoveries:" tooltip says which professions and goods you need and how much experience you lack. "Unavailable in this mission": you can\'t build it on this map. A paper from a chest places the building even undiscovered: [[article:chests|Chests and Papers]].',
            ],
            [
              'Construction has stopped',
              'The site status says what\'s missing: "materials missing", "delivery on the way" or "no builder". The message "Site needs [good]" means no store within the site\'s signpost reach holds it, {{reach.goods}} hexes from a signpost. Builders carry their own materials.',
            ],
            [
              "A field isn't growing",
              'It grows only when watered by a [[job:farmer|Farmer]] with a workplace at a [[building:work_farm_00|Farm]]. The Farmer sows first and waters only at {{field.max}} fields or when there is nowhere left to sow. A field ripens after {{field.waterings}} waterings, and one watering also covers 6 neighbouring fields. He sows only on grass, off roads, within {{field.radius}} hexes of the Farm.',
            ],
            [
              'Do rain, snow or night change anything?',
              'No. Weather, the "Winter" setting and time of day are picture and sound only. Walking is slower only on sand, in mountains and on snow that lies on the map from the start.',
            ],
          ],
        },
        {
          h: 'Army and Vehicles',
        },
        {
          faq: [
            [
              "A soldier won't attack",
              'Check his stance: [[article:stances|Stances]]. On Ignorant he doesn\'t close in and strikes only what is within weapon range. He attacks only a tribe you hold as "Hostile", and only outside "Peace time".',
            ],
            [
              "A ship won't sail",
              'Status "Waiting for a commander": assign one, any adult will do. "Waiting for its crew": someone in the crew is still walking to the ship. A settler from another landmass drops out of the crew. "No route": the destination is not on this water. Nobody boards at sea, so "Moor" first.',
            ],
            [
              "An Ox Cart won't move",
              'Status "Waiting for its draught animal": it takes an [[good:cattle|Ox]] only from outside the pair, so you need {{livestock.pairPlusOne}} adults at one Cattle Farm or {{livestock.pairPlusOne}} outside a farm: [[article:vehicles|Vehicles and Ships]].',
            ],
          ],
        },
      ],
      see: ['article:walking', 'article:hauling', 'article:stances', 'article:religion', 'article:livestock'],
    },
  ],
};
