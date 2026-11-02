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
          p: '表中是一般工作。木材、狩獵、捕魚和建造的計算不同，倍率見下表。[[article:gathering|採集]]時經驗減少每份的敲擊次數。工坊和屠宰時經驗增加額外產量。帶工具的數值見[[article:tools|工具]]。建造見[[article:construction|建造、升級與修理]]。',
        },
        {
          p: '選中自己的居民時會看到職業星標。達到該職業最高技能的{{star.step}}%時出現，每{{star.step}}%變大一級，到{{star.full}}%為止。搬運工沒有星標。',
        },
        {
          h: '需要多少工作量',
        },
        {
          table: {
            head: ['工作', '計數單位', '倍率', '到{{exp.quotedPct}}%的次數', '到100%的次數'],
            rows: [
              [
                '木材',
                '砍倒的樹',
                '×{{exp.wood.points}}',
                '{{exp.wood.repeatsQuoted}}',
                '{{exp.wood.repeatsFull}}',
              ],
              [
                '狩獵',
                '從獵物身上取的每份',
                '×{{exp.hunt.points}}',
                '{{exp.hunt.repeatsQuoted}}',
                '{{exp.hunt.repeatsFull}}',
              ],
              [
                '捕魚',
                '魚',
                '×{{exp.fish.points}}',
                '{{exp.fish.repeatsQuoted}}',
                '{{exp.fish.repeatsFull}}',
              ],
              [
                '黏土、毛石、鐵礦、金礦、蘑菇、草藥、小麥、屠宰、工坊',
                '按份，屠宰按頭，工坊按批',
                '×{{exp.craft.points}}',
                '{{exp.craft.repeatsQuoted}}',
                '{{exp.craft.repeatsFull}}',
              ],
              [
                '建造、修理',
                '有進度的一次敲擊',
                '×{{exp.build.points}}',
                '{{exp.build.repeatsQuoted}}',
                '{{exp.build.repeatsFull}}',
              ],
            ],
            num: [2, 3, 4],
            foot: '後兩列數的是樹、份、批或敲擊。從{{exp.quotedPct}}%起，無工具的[[job:builder|建築工人]]每份材料的敲擊數減半。在居民面板的「經驗」裡，每項技能有自己的一行，例如「採集 - 鐵礦：{{exp.craft.repeatsQuoted}} 次，產量 +{{exp.quotedPct}}%」。',
          },
        },
        {
          p: '每棵樹、每份、每批也算進職業的通用技能，例如農業。解鎖職業的可能是通用技能，也可能是單項貨物的技能：農業解鎖[[job:miller|磨坊工]]，採集 - 木材解鎖[[job:joiner|木匠]]。條件見[[article:trades|職業與學校]]。沒有專屬技能的貨物也用通用技能。換職業不丟經驗。',
        },
        {
          h: '誰得不到好處',
        },
        {
          list: [
            '[[job:carrier|搬運工]]累積「搬運」。它不會加快工作，但運送{{exp.carrierTrader}}次解鎖[[job:trader|商人]]。',
            '商人每卸1份累積「貿易」，但貿易沒有任何效果。',
            '[[job:scout|偵察兵]]、[[job:woman|婦女]]和兒童不累積經驗。',
            '種植、澆水、[[building:school|學校]]和[[building:barracks|兵營]]都不給經驗。',
          ],
        },
      ],
      see: ['article:tools', 'article:trades', 'article:exp-combat', 'article:construction'],
    },
    {
      id: 'exp-combat',
      name: '戰鬥經驗',
      lead: '同一類武器命中{{combat.fightCapHits}}次，近戰傷害翻倍。',
      blocks: [
        {
          h: '近戰傷害',
        },
        {
          table: {
            head: ['命中次數', '倍率', '{{combat.sampleBlow}}傷害變為'],
            rows: [
              [0, '×1', '{{combat.sampleBlow}}'],
              [10, '×{{fight.factor.10}}', '{{fight.blow.10}}'],
              [25, '×{{fight.factor.25}}', '{{fight.blow.25}}'],
              [50, '×{{fight.factor.50}}', '{{fight.blow.50}}'],
              [75, '×{{fight.factor.75}}', '{{fight.blow.75}}'],
              ['{{combat.fightCapHits}}', '×{{combat.fightCapFactor}}', '{{combat.fightCapBlow}}'],
            ],
            num: [0, 1, 2],
            foot: '超過{{combat.fightCapHits}}次後倍率不再增長。',
          },
        },
        {
          p: '倍率適用於近戰攻擊人、動物和建築。對[[article:walls|木柵欄]]、[[article:vehicles|載具]]無效，射擊和[[article:catapult|投石機]]也無效。',
        },
        {
          p: '弓和投石機：0次命中時{{aim.basePct}}%的射擊準確，命中{{aim.noSpreadHits}}次起每發都落在目標上。數值表：[[article:aim|命中與射擊]]。',
        },
        {
          h: '什麼算命中',
        },
        {
          p: '命中是指造成傷害的一擊或一箭。每類武器分開算：徒手、矛、劍、弓、投石機。[[job:hunter|獵人]]的弓也算弓。一發打中多個目標只算一次。',
        },
        {
          p: '在居民面板裡，這些是「戰鬥 - 劍」「戰鬥 - 弓」等行。劍的命中對矛兵沒有幫助，換職業也不會丟失。戰鬥不會提高英雄的傷害，除非任務允許。',
        },
        {
          h: '解鎖武器',
        },
        {
          table: {
            head: ['武器', '工匠', '條件'],
            rows: [
              ['[[good:spear_wooden|木矛]]', '[[job:armorer|武器匠]]', '無'],
              ['[[good:spear_iron|鐵矛]]', '[[job:smith|鐵匠]]', '鍛造：{{exp.ironSpearNeed}} 次'],
              ['[[good:sword_shord|短劍]]', '[[job:smith|鐵匠]]', '無'],
              ['[[good:sword_long|長劍]]', '[[job:smith|鐵匠]]', '鍛造：{{exp.longSwordNeed}} 次'],
              ['[[good:bow_short|短弓]]', '[[job:armorer|武器匠]]', '無'],
              ['[[good:bow_long|長弓]]', '[[job:armorer|武器匠]]', '武器製造：{{exp.longBowNeed}} 次'],
            ],
          },
        },
        {
          p: '拿武器不需要命中次數：士兵能拿範圍內倉庫的任何武器，拿到就成為劍兵、矛兵或弓手。{{exp.classLowNeed}}或{{exp.classHighNeed}}次命中的門檻只是讓聚落發現該兵種，並在「更換職業」中開放：[[article:trades|職業與學校]]。',
        },
        {
          h: '星標',
        },
        {
          p: '士兵用手中武器命中{{star.step}}次後佩戴星標。每{{star.step}}次變大一級，{{star.full}}次時最大。每名士兵的星標都看得到，敵人的也一樣。',
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
      name: '職業與學校',
      lead: '發現的職業歸整個聚落，就算發現它的居民死了也不會失去。',
      blocks: [
        {
          p: '大廳選項「職業發展：一開始全部解鎖」取消平民職業和產品的條件。士兵職業的條件和地圖禁令不受影響。',
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
          h: '發現的過程',
        },
        {
          steps: [
            '居民工作，例如[[job:collector|採集者]]砍樹。',
            '砍倒{{exp.joinerNeed}}棵樹後達到[[job:joiner|木匠]]條件，遊戲宣佈發現。',
            '全聚落解鎖該職業，這名居民可以立即轉職。',
            '其他人去[[building:school|學校]]，或靠工作達到同樣條件。',
          ],
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
            foot: '超出名額的學員按報名順序在門口排隊。',
          },
        },
        {
          list: [
            '需求打斷課程不丟進度。取消課程則清零。',
            '派往在建學校的學員先運材料，然後等待。',
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
          p: '「更換職業」會清除工作地點，沒人會自動指派新的。例外是畢業生，前提是在[[article:assistant|助手]]裡打開了他們的開關。',
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
            '「移除工作地點」保留職業和攜帶的貨物，清除生產計數和搬運工推車。',
            '建築被拆也保留職業。',
            '婦女、兒童和英雄永遠不會獲得職業。',
          ],
        },
        {
          h: '換職業的代價',
        },
        {
          table: {
            head: ['物品', '去向'],
            rows: [
              ['工作地點和生產計數', '失去。'],
              ['攜帶的貨物', '掉在地上。'],
              ['工具', '保留。參軍時新工具掉在地上，用過的消失。'],
              ['武器和護甲', '退伍時拿在手裡或掉在地上。'],
              ['命令', '當前命令和隊列作廢。「進食與睡眠」恢復「允許」。'],
              ['已學職業', '保留，包括前一個職業。經驗也保留。'],
            ],
            foot: '學校和兵營換職業的方式相同，但保留命令隊列。搬運工會留下推車。',
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
