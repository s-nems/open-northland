import type { ArticleGroup } from '../../../hud/knowledge/articles.js';

export const EXPERIENCE: ArticleGroup = {
  group: '經驗',
  items: [
    {
      id: 'exp-work',
      name: '工作經驗',
      lead: '每種貨物的經驗分開算：木材100%不會加快毛石。',
      blocks: [
        {
          h: '經驗的作用',
        },
        {
          figure: {
            id: 'exp-curve',
            caption: '最初幾份提升最大',
          },
        },
        {
          data: 'experience',
        },
        {
          p: '表中是一般工作。木材、狩獵、捕魚和建造的增長速度不同，見下表。[[article:gathering|採集]]時經驗減少每份的敲擊次數，工坊和屠宰時則增加額外產量。經驗與工具的配合見[[article:tools|工具]]。建造見[[article:construction|建造、升級與修理]]。',
        },
        {
          p: '選中自己的居民時會看到職業星標。他在本職業最好的技能達到{{star.step}}%時出現，每{{star.step}}%變大一級，到{{star.full}}%為止。搬運工沒有星標。',
        },
        {
          h: '需要多少工作量',
        },
        {
          table: {
            head: ['工作', '計數單位', '到一半（{{exp.quotedPct}}%）的次數', '到100%的次數'],
            rows: [
              ['木材', '砍倒的樹', '{{exp.wood.repeatsQuoted}}', '{{exp.wood.repeatsFull}}'],
              ['狩獵', '從獵物身上取的每份', '{{exp.hunt.repeatsQuoted}}', '{{exp.hunt.repeatsFull}}'],
              ['捕魚', '魚', '{{exp.fish.repeatsQuoted}}', '{{exp.fish.repeatsFull}}'],
              [
                '黏土、毛石、鐵礦、金礦、蘑菇、草藥、小麥、屠宰、工坊',
                '按份，屠宰按頭，工坊按批',
                '{{exp.craft.repeatsQuoted}}',
                '{{exp.craft.repeatsFull}}',
              ],
              ['建造、修理', '在工地上敲一錘', '{{exp.build.repeatsQuoted}}', '{{exp.build.repeatsFull}}'],
            ],
            num: [2, 3],
            foot: '後兩列數的是樹、份、批或敲擊。從{{build.bareGainPct}}%起，無工具的[[job:builder|建築工人]]每份材料的敲擊數減半。在居民面板的「經驗」頁裡，每項技能有自己的一行，例如「採集 - 鐵礦：{{exp.craft.repeatsQuoted}} 次，產量 +{{exp.quotedPct}}%」。',
          },
        },
        {
          p: '每棵樹、每份、每批也算進職業的通用技能，例如農業。新職業由這個通用技能或某項貨物的技能解鎖：農業解鎖[[job:miller|磨坊工]]，採集 - 木材解鎖[[job:joiner|木匠]]。條件見[[article:trades|職業與學校]]。沒有專屬技能的貨物按通用技能計算。換職業不丟經驗。',
        },
        {
          h: '不加快工作的經驗',
        },
        {
          list: [
            '[[job:carrier|搬運工]]累積「搬運」。它不會加快工作，但運送{{exp.carrierTrader}}次解鎖[[job:trader|商人]]。',
            '商人每卸1份累積「貿易」，但貿易沒有任何效果。',
            '[[job:scout|偵察兵]]、[[job:woman|婦女]]和兒童不累積經驗。',
            '種植、澆水、[[building:school|學校]]和[[building:barracks|兵營]]的訓練都不給經驗。用金幣操練會給戰鬥經驗：[[article:exp-combat|戰鬥經驗]]。',
          ],
        },
      ],
      see: ['article:tools', 'article:trades', 'article:exp-combat', 'article:construction'],
    },
    {
      id: 'exp-combat',
      name: '戰鬥經驗',
      lead: '每個人只有一份戰鬥經驗，從 0 到 {{combat.fightCapHits}} 點，所有武器通用。',
      blocks: [
        {
          h: '經驗的作用',
        },
        {
          p: '達到 {{combat.fightCapHits}} 點時，近戰攻擊的傷害提高 {{combat.fightDealtPct}}%，而擊中這名戰士的每次攻擊和每支箭傷害降低 {{combat.fightTakenPct}}%。兩者都隨每一點均勻增長。',
        },
        {
          table: {
            head: ['點數', '近戰造成', '{{combat.sampleBlow}} 的一擊變為', '受到'],
            rows: [
              [0, '×1', '{{combat.sampleBlow}}', '×1'],
              [10, '×{{fight.factor.10}}', '{{fight.blow.10}}', '×{{fight.taken.10}}'],
              [25, '×{{fight.factor.25}}', '{{fight.blow.25}}', '×{{fight.taken.25}}'],
              [50, '×{{fight.factor.50}}', '{{fight.blow.50}}', '×{{fight.taken.50}}'],
              [75, '×{{fight.factor.75}}', '{{fight.blow.75}}', '×{{fight.taken.75}}'],
              [
                '{{combat.fightCapHits}}',
                '×{{combat.fightCapFactor}}',
                '{{combat.fightCapBlow}}',
                '×{{combat.fightTakenFactor}}',
              ],
            ],
            num: [0, 1, 2, 3],
            foot: '超過 {{combat.fightCapHits}} 點後不再增長。',
          },
        },
        {
          p: '造成傷害的加成適用於對人、動物和建築的近戰攻擊。對[[article:walls|木柵欄]]和[[article:vehicles|載具]]無效，對箭矢和[[article:catapult|投石機]]也無效。弓手的經驗帶來準頭和更少的受到傷害，而不是更強的箭。',
        },
        {
          h: '搭配護符',
        },
        {
          p: '[[good:amulet_strength|力量護符]]的加成與經驗加成相加：經驗滿時近戰攻擊為 ×{{combat.fightStrengthFactor}}。[[good:amulet_defense|防禦護符]]與經驗相乘：經驗滿時戰士受到 ×{{combat.fightDefenseFactor}} 的傷害。護符：[[article:draughts|飲品與護符]]。',
        },
        {
          p: '沒有經驗的弓手有 {{aim.basePct}}% 的射擊命中，{{aim.noSpreadHits}} 點起每一箭都落在目標上。[[article:catapult|投石機]]單獨累計自己的命中。詳情：[[article:aim|命中與射擊]]。',
        },
        {
          h: '經驗從哪裡來',
        },
        {
          p: '點數按造成傷害的一擊所用的時間計算。近戰攻擊按揮擊的時長每秒得 {{combat.fightMeleePerSecond}} 點，射擊按拉弓的時長每秒得 {{combat.fightShotPerSecond}} 點，所以慢武器和快武器漲得一樣快，弓每秒得點較少。受到攻擊也算：被任何對手打傷的人，無論對手是人、野獸、塔樓還是投石機，都按對手一擊的時間每秒得 {{combat.fightTakenPerSecond}} 點。拳頭和任何武器都一樣，[[job:hunter|獵人]]的射擊也算。更換武器或職業後經驗保留。',
        },
        {
          p: '操練：任何士兵，無論有沒有武器，都在你存有金幣的[[building:barracks|兵營]]裡操練。每枚[[good:coin|金幣]]換來在裡面操練 {{coinDrill.termSeconds}} 秒，和新兵受訓一樣長，練完得 {{coinDrill.points}} 點。戰鬥或新命令打斷操練時，金幣退回，不得點數。達到 {{coinDrill.limit}} 點及以上的人不再操練，其餘的要在戰鬥中獲得。選中士兵後右鍵點擊自己的兵營。兵營有幾枚空閒金幣就去幾名士兵，離得最近的先去；其餘的留在原地。',
        },
        {
          p: '在居民面板中這是「戰鬥」一行：點數、近戰傷害加成，以及受到的傷害減少多少。戰鬥不會提高英雄的經驗，除非任務開啟。',
        },
        {
          p: '更好的武器靠製造解鎖，不靠戰鬥。要求寫在武器卡片上，例如[[good:sword_long|長劍]]。誰拿什麼武器：[[article:equip|士兵裝備]]。',
        },
      ],
      see: [
        'article:damage',
        'article:aim',
        'article:equip',
        'article:heroes',
        'article:exp-work',
        'article:trades',
        'building:barracks',
      ],
    },
    {
      id: 'trades',
      name: '職業與學校',
      lead: '發現的職業歸整個聚落，就算發現它的居民死了也不會失去。',
      blocks: [
        {
          p: '大廳選項「職業發展：一開始全部解鎖」取消平民職業和產品的條件。士兵職業沒有條件，地圖禁令不受影響。',
        },
        {
          h: '解鎖職業',
        },
        {
          data: 'jobs',
        },
        {
          p: '條件列出兩項技能時按總和計算。[[job:builder|建築工人]]、採集者、[[job:farmer|農夫]]、[[job:hunter|獵人]]、[[job:fisher|漁夫]]、[[job:carrier|搬運工]]和[[job:scout|偵察兵]]一開始就可用。',
        },
        {
          p: '產品也是這樣發現的，例如[[good:furniture|傢俱]]需要木工：{{exp.furnitureNeed}} 次。',
        },
        {
          p: '滿足條件的居民可以馬上擔任這個職業。其他人要去[[building:school|學校]]上課，或透過工作達到同樣的條件。',
        },
        {
          h: '學校與兵營',
        },
        {
          table: {
            head: ['項目', '學校', '兵營'],
            rows: [
              ['名額', '{{school.seats}}', '{{barracks.seats}}'],
              ['教授', '平民職業或產品', '士兵職業'],
              ['時長', '見下表', '{{barracks.drillSeconds}}秒'],
              ['對象', '成年男性', '成年男性'],
              ['結業後', '獲得新職業，在學校旁等待指派', '成為徒手士兵，原職業保留為已知'],
            ],
            foot: '名額滿了，後來的學員就在門口等。',
          },
        },
        {
          list: [
            '學員去吃飯或睡覺不會丟進度。把他從課程中撤下，進度就清零。',
            '派往在建學校的學員會運材料，然後等到學校建好。',
            '結業的課程永久有效，換職業也不丟。',
          ],
        },
        {
          h: '課程時長',
        },
        {
          table: {
            head: ['課程', '時長'],
            rows: [
              [
                '[[good:armor_leather|皮甲]]、[[good:potion_food_small|小型營養藥水]]、[[good:potion_stamina_small|小型耐力藥水]]',
                '{{course.shortSeconds}}秒',
              ],
              ['職業和大多數產品', '{{course.commonSeconds}}秒'],
              ['[[good:potion_heal_big|大型治療藥水]]', '{{course.healSeconds}}秒'],
              ['[[good:handcart|手推車]]', '{{course.handcartSeconds}}秒'],
              ['[[good:oxcart|牛車]]', '{{course.oxcartSeconds}}秒'],
              [
                '[[good:ship_small|船]]、[[good:ship_big|大船]]、[[good:catapult|投石機]]',
                '{{course.shipSeconds}}秒',
              ],
            ],
            num: [1],
          },
        },
        {
          h: '職業與工作地點',
        },
        {
          p: '「更換職業」後居民會失去工作地點，也不會自動得到新的。例外是畢業生，前提是在[[article:assistant|助手]]裡打開了他們的開關。',
        },
        {
          table: {
            head: ['職業', '建築', '沒有建築時'],
            rows: [
              ['[[job:builder|建築工人]]', '不需要', '自己去工地。'],
              ['[[job:scout|偵察兵]]', '不需要', '聽命令行動。'],
              ['[[job:trader|商人]]', '不需要', '跑自己的[[article:trade|路線]]。'],
              ['[[job:civilist|平民]]', '不需要', '不工作，等待指派。'],
              [
                '[[job:collector|採集者]]、[[job:hunter|獵人]]、[[job:fisher|漁夫]]',
                '可選',
                '圍繞[[article:work-flag|工作旗幟]]工作，轉職時旗幟插在腳下。',
              ],
              ['[[job:farmer|農夫]]、[[job:herb_mush_guy|草藥師]]', '必需', '不耕種。'],
              ['[[job:carrier|搬運工]]', '必需', '什麼也不運。'],
              ['其他平民職業', '必需', '閒著。'],
            ],
          },
        },
        {
          list: [
            '右鍵點擊建築（「在此工作」）會立即換職業並指派工作地點。',
            '不滿足該建築職業條件的居民，會佔用那裡空著的搬運工職位，如果有的話。',
            '士兵只接受本職業的職位。',
            '「移除工作地點」和拆除建築都不會讓他失去職業。',
            '婦女、兒童和英雄永遠不會獲得職業。',
          ],
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
