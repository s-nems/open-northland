import type { ArticleGroup } from '../../../hud/knowledge/articles.js';

export const SETTLERS: ArticleGroup = {
  group: '居民',
  items: [
    {
      id: 'needs',
      name: '需求',
      lead: '需求條降到{{need.drivePct}}%時，居民會丟下工作去補足。',
      blocks: [
        {
          p: '大廳選項「居民需求：停用」會凍結需求條，也不會再有人挨餓。',
        },
        {
          h: '需求條',
        },
        {
          table: {
            head: ['需求條', '隨時間下降', '工作時下降', '補充方式', '降到0%時'],
            rows: [
              [
                '體力',
                '{{need.drainMinutes}}分鐘掉100%',
                '是',
                '[[article:food|進餐]]',
                '[[article:health|{{health.starveTime}}後死亡]]',
              ],
              [
                '耐力',
                '{{need.drainMinutes}}分鐘掉100%',
                '是',
                '睡覺',
                '沒有別的影響，步子從{{need.drivePct}}%起就已變慢',
              ],
              ['社交', '{{need.drainMinutes}}分鐘掉100%', '否', '交談', '無懲罰'],
              ['信仰', '否', '僅武器和護甲', '[[article:religion|禱告]]', '不製作武器和護甲'],
            ],
            foot: '開局時每條需求隨機為{{need.startMinPct}}-100%。沒有[[good:shoes|鞋子]]時，走{{need.barefootSampleSteps}}步在道路上扣{{need.barefootRoadPct}}%體力，在陸地上扣{{need.barefootLandPct}}%，在最難走的地形上最多扣{{need.barefootMaxPct}}%，負重時翻倍。',
          },
        },
        {
          h: '閾值',
        },
        {
          figure: {
            id: 'need-bar',
            caption: '需求條各段的含義',
          },
        },
        {
          table: {
            head: ['數值', '發生什麼'],
            rows: [
              ['{{need.criticalPct}}%', '發出體力、耐力或信仰通知。'],
              ['{{need.drivePct}}%', '做完手頭動作後丟下工作。耐力到此值時，每步慢{{step.tiredExtra}}秒。'],
              ['{{need.satedPct}}%', '居民在家先補耐力，再補體力，補到此值後出門。'],
              ['{{need.overfillPct}}%', '需求條最多到這裡。在家進餐和在家用傢俱睡覺可以存下超過100%的部分。'],
            ],
          },
        },
        {
          h: '睡眠',
        },
        {
          table: {
            head: ['對象', '睡眠時長', '每次睡眠恢復耐力：在外', '在家', '在家有傢俱'],
            rows: [
              [
                '男性',
                '{{sleep.manSeconds}}秒',
                '+{{sleep.manAwayPct}}%',
                '+{{sleep.manHomePct}}%',
                '+{{sleep.manFurnishedPct}}%',
              ],
              [
                '[[job:woman|婦女]]',
                '{{sleep.womanSeconds}}秒',
                '+{{sleep.womanAwayPct}}%',
                '+{{sleep.womanHomePct}}%',
                '+{{sleep.womanFurnishedPct}}%',
              ],
              ['商人、偵察兵（總按在家算）', '{{sleep.manSeconds}}秒', '+{{sleep.manHomePct}}%', '-', '-'],
              ['士兵（無論睡在哪裡）', '{{sleep.soldierSeconds}}秒', '+{{sleep.soldierPct}}%', '-', '-'],
            ],
            num: [1, 2, 3, 4],
          },
        },
        {
          h: '例外',
        },
        {
          table: {
            head: ['對象', '需求條'],
            rows: [
              ['嬰兒、兒童', '沒有。成年時每條都是100%。'],
              ['[[article:heroes|英雄]]', '沒有。'],
              ['怪物、動物', '沒有。'],
              ['士兵', '沒有社交。'],
              ['車輛乘客', '需求條不下降，生命值不變。'],
              ['船上乘客', '吃貨艙裡的食物，按在外睡覺，可以交談。上岸後才去禱告。'],
            ],
          },
        },
        {
          h: '信仰與社交',
        },
        {
          p: '居民會一直禱告，直到信仰到100%，或體力、耐力降到{{need.drivePct}}%。誰會禱告、在哪裡禱告、能回多少：[[article:religion|信仰與神廟]]。',
        },
        {
          table: {
            head: ['活動', '時長', '效果'],
            rows: [
              ['交談', '{{talk.shortSeconds}}-{{talk.longSeconds}}秒', '社交最多+{{talk.pct}}%。'],
              ['有配偶的居民留在家裡', '-', '社交100%。'],
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
      name: '飲食',
      lead: '食物包括麵包、肉和魚。在家吃的一餐，體力加倍。',
      blocks: [
        {
          h: '進餐效果',
        },
        {
          table: {
            head: ['食物', '在外體力', '在家體力', '社交'],
            rows: [
              ['[[good:bread|食物]]', '+{{meal.plainPct}}%', '+{{meal.plainHomePct}}%', '-'],
              [
                '[[good:candy|餅乾]]',
                '+{{meal.candyPct}}%',
                '+{{meal.candyHomePct}}%',
                '+{{meal.candyCompanyPct}}%',
              ],
              ['成熟的灌木', '+{{meal.plainPct}}%', '-', '-'],
            ],
            num: [1, 2, 3],
            foot: '一餐{{meal.seconds}}秒，吃掉1份。士兵不在家吃飯，餅乾對他和普通食物一樣：+{{meal.plainPct}}%。',
          },
        },
        {
          p: '居民也吃工坊庫存裡的食物。在倉庫先拿食物，然後拿蛋糕。',
        },
        {
          h: '在哪裡吃',
        },
        {
          steps: [
            '自家存糧，住所門口最多{{reach.walk}}格遠。',
            '{{reach.goods}}格內最近的倉庫、工坊或地面貨堆，或{{reach.bushAtHand}}格內的成熟灌木。',
            '{{reach.goods}}格內最近的成熟灌木。',
            '居民能走到的任何地方最近的食物，包括較遠的自家。',
          ],
        },
        {
          p: '別家的存糧和其他玩家的儲備都吃不到，灌木不歸任何人。[[article:roads|路標]]能擴大這些範圍。低於[[article:hauling|最低庫存]]的貨物，沒人會吃，也沒人會拿回家。',
        },
        {
          h: '往家裡運糧',
        },
        {
          steps: [
            '有已完工住所的[[job:woman|婦女]]尋找住所以外最近的食物。',
            '拿1份回家。',
            '家裡有[[good:crockery|陶器]]時，運回1份算2份存糧。',
          ],
        },
        {
          p: '婦女會一直運食物，直到存糧滿。上限見[[article:family|家庭與住所]]。',
        },
      ],
      see: ['article:needs', 'article:family', 'article:gathering', 'good:bread', 'good:candy'],
    },
    {
      id: 'health',
      name: '生命與治療',
      lead: '人有{{health.human}}點生命值，{{health.regenMinutes}}分鐘可自動回滿。',
      blocks: [
        {
          h: '生命值的增減',
        },
        {
          table: {
            head: ['來源', '變化', '條件', '{{health.human}}點生命值所需時間'],
            rows: [
              [
                '自動恢復',
                '+{{health.regenPerSecond}}/秒',
                '體力高於0%，戰鬥中也有效',
                '{{health.regenTime}}',
              ],
              [
                '[[article:religion|神廟光環]]',
                '+{{aura.perSecond}}/秒',
                '距[[building:work_temple|神廟]]{{aura.range}}格',
                '{{aura.time}}',
              ],
              ['飢餓', '-{{health.starvePerSecond}}/秒', '體力0%', '{{health.starveTime}}'],
            ],
            num: [1, 3],
            foot: '合計{{aura.totalPerSecond}}/秒。自動恢復到{{health.human}}為止，但光環可超過上限治療到{{aura.ceiling}}。',
          },
        },
        {
          p: '生命值到{{health.nearDeath}}時，遊戲會通知該居民瀕臨死亡。',
        },
        {
          h: '治療藥水',
        },
        {
          list: [
            '[[good:potion_heal_small|小型治療藥水]]有{{draught.smallUses}}口，共{{draught.healSmallTotal}}點生命值。[[good:potion_heal_big|大型治療藥水]]有{{draught.bigUses}}口，共{{draught.healBigTotal}}點生命值。',
            '一擊會讓生命值降到{{draught.healBelow}}以下時，居民會立刻一口接一口地喝，直到生命值重新至少有{{draught.healBelow}}點，或者藥水喝完。',
            '只要喝下的口數夠抵消傷害，致命一擊也殺不死。',
            '餓到生命值低於{{draught.healBelow}}時也會喝。',
          ],
        },
      ],
      see: ['article:draughts', 'article:needs', 'article:religion', 'good:potion_heal_small'],
    },
    {
      id: 'family',
      name: '家庭與住所',
      lead: '生一個孩子需要{{family.childFood}}份食物。',
      blocks: [
        {
          h: '指派住所',
        },
        {
          list: [
            '只有「指派住所」命令能給人住所。沒人會自己搬進去，結婚也只會搬動伴侶。',
            '一座住所能住幾戶，看等級表的「家庭」列。住滿後命令無效。',
            '重新指派會搬走全家：本人、伴侶和未成年的孩子。',
          ],
        },
        {
          h: '結婚',
        },
        {
          list: [
            '只有「結婚」命令才能結婚。',
            '命令把居民和最近的異性成人配對，須同一民族、同一玩家。',
            '對象必須在該居民的[[article:roads|路標]]範圍內。找不到對象時命令作廢，顯示「找不到對象」。',
            '士兵、英雄、偵察兵，以及被派往[[building:barracks|兵營]]或[[building:school|學校]]的居民不能結婚。',
            '夫妻住在妻子家。妻子沒有住所時住在丈夫家。',
          ],
        },
        {
          h: '成長',
        },
        {
          table: {
            head: ['階段', '年齡', '出生後'],
            rows: [
              ['嬰兒', '0-{{age.babyLastYear}}歲', '0-{{age.childTime}}'],
              ['兒童', '{{age.childYears}}-{{age.childLastYear}}歲', '{{age.childTime}}-{{age.adultTime}}'],
              ['成人', '{{age.adultYears}}歲起', '{{age.adultTime}}起'],
            ],
            foot: '一歲等於{{age.yearSeconds}}秒。兒童在家附近活動。成年後男孩成為[[job:civilist|平民]]，女孩成為[[job:woman|婦女]]。沒有人會老死。',
          },
        },
        {
          h: '住所等級',
        },
        {
          figure: {
            id: 'home-levels',
            caption: '住所等級',
          },
        },
        {
          data: 'homes',
        },
        {
          p: '存糧的食物和蛋糕分開計算：一級民居可存{{home.larder}} + {{home.candyLarder}}份。居民可以住在同一玩家其他民族的住所裡。',
        },
        {
          h: '家中用品',
        },
        {
          table: {
            head: ['貨物', '起始等級', '效果', '1份可用', '婦女補貨線'],
            rows: [
              [
                '[[good:crockery|陶器]]',
                '1級民居',
                '運糧時每份算2份',
                '{{home.crockeryDeliveries}}次運糧',
                '{{home.crockeryFetchBelow}}',
              ],
              [
                '[[good:furniture|傢俱]]',
                '1級民居',
                '睡眠×2',
                '男性睡{{home.furnitureManSleeps}}次，女性睡{{home.furnitureWomanSleeps}}次',
                '{{home.furnitureFetchBelow}}',
              ],
              [
                '[[good:holy_oil|油]]',
                '3級民居',
                '[[article:religion|聖火]]：可在屋前禱告',
                '{{oil.burnTime}}',
                '{{home.oilFetchBelow}}',
              ],
            ],
            num: [4],
            foot: '這些貨物每種最多存{{home.wareUnits}}份。油一直燃燒，沒人禱告時也一樣。',
          },
        },
        {
          p: '在住所面板可以為全聚落關閉陶器、傢俱的使用和油的運送。已存入的油繼續燃燒。',
        },
        {
          h: '誰會失去住所',
        },
        {
          table: {
            head: ['對象', '結果'],
            rows: [
              ['鰥夫', '孩子成年或夭折後失去住所。'],
              ['寡婦', '留在家中。'],
              ['成年子女', '成年時失去住所。'],
              ['商人、偵察兵、士兵', '住所留給家人，但他本人不在家吃住。'],
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
      name: '助手',
      lead: '計數器用來下訂單：還要生幾個孩子、再訓練幾名新兵。訂單每完成一次，計數器就減少。開關把庫存裝備發下去。',
      blocks: [
        {
          h: '計數器',
        },
        {
          table: {
            head: ['計數器', '帶來', '執行者', '何時減少', '可設為∞'],
            rows: [
              ['女兒', '女孩', '有住所的已婚婦女', '出生時', '否'],
              ['兒子', '男孩', '有住所的已婚婦女', '出生時', '是'],
              ['徒手士兵', '新兵', '[[job:civilist|平民]]', '訓練完成後', '是'],
              ['劍兵、矛兵、弓手', '武器，然後新兵', '徒手士兵，然後平民', '拿到武器時', '是'],
            ],
            foot: '計數器可設為0到{{assistant.counterMax}}。對單個人下的命令優先於助手。武器和護甲的順序見[[article:equip|士兵裝備]]。',
          },
        },
        {
          h: '開關',
        },
        {
          table: {
            head: ['開關', '初始', '發給誰'],
            rows: [
              ['[[good:shoes|鞋子]]', '開', '成年男性'],
              ['鐵質工具、木質工具', '開', '除士兵、[[job:scout|偵察兵]]和平民外的所有在職者'],
              ['鐵質工具：替換木質工具', '開', '拿著木質工具的在職者，前提是鐵質工具開關已開'],
              ['[[good:mead|蜂蜜酒]]', '開', '平民、士兵'],
              ['營養藥水、耐力藥水、治療藥水', '關', '平民、士兵'],
              ['護符：營養、耐力、力量、防禦、精準、疾風', '關', '平民、士兵'],
              ['學校畢業生自動分派到工坊', '關', '[[building:school|學校]]畢業生'],
              ['採集者自動移動旗幟', '開', '插了旗的[[job:collector|採集者]]'],
            ],
            foot: '飲品和護符可用「平民」和「士兵」按鈕選擇發放對象，初始都開。關掉不會收回已發放的東西。',
          },
        },
        {
          h: '生育',
        },
        {
          list: [
            '先生女兒，再生兒子。所以女兒計數器不能設為∞，否則永遠生不出兒子。',
            '計數器為3時，最多3對夫妻同時等著生孩子。',
          ],
        },
        {
          h: '徵兵去兵營',
        },
        {
          list: [
            '只有沒工作、閒著的成年平民才去兵營，未婚者優先。助手不會把人從工作中抽走。',
            '「劍兵」「矛兵」「弓手」計數器優先武裝範圍內有武器可拿的徒手士兵。',
          ],
        },
        {
          table: {
            head: ['徵兵停止的原因', '解決辦法'],
            rows: [
              ['沒有建成的[[building:barracks|兵營]]', '建完兵營。'],
              ['沒有空閒平民', '手動派人去兵營。'],
              ['徒手士兵在等這種武器', '提供武器。在此之前他佔著新兵的名額。'],
            ],
            foot: '去兵營路上的新兵已計入計數器。',
          },
        },
        {
          h: '發放',
        },
        {
          list: [
            '助手不給婦女、兒童、[[article:heroes|英雄]]和箭塔駐軍發裝備。',
            '低於[[article:hauling|最低庫存]]的貨物助手不會發放。',
            '它會補空位，鐵質工具先於木質工具。開了「替換木質工具」後，它還會讓拿著木質工具的在職者去換鐵質工具：[[article:tools|工具]]。其他東西它不會換成更好的。',
            '每個居民有{{amulet.slots}}個飲品和護符欄位：[[article:draughts|飲品與護符]]。',
          ],
        },
        {
          h: '畢業生',
        },
        {
          list: [
            '畢業生去本職業最近的空缺，在建的工坊也算。能做他所學產品的工坊優先，哪怕離得更遠。',
            '沒有空缺就在學校旁等待。助手不給[[job:collector|採集者]]、[[job:hunter|獵人]]、[[job:fisher|漁夫]]和士兵指派工作。',
          ],
        },
        {
          p: '採集者如何自己移動旗幟：[[article:work-flag|工作旗幟]]。',
        },
        {
          p: '「臣民」視窗顯示有多少居民缺少住所、工作、工具、鞋子、伴侶、孩子、武器或蜂蜜酒。',
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
      name: '飲品與護符',
      lead: '居民原地飲用，手上的事不停。護符不會耗損。',
      blocks: [
        {
          h: '飲品',
        },
        {
          table: {
            head: ['飲品', '口數', '每口效果', '何時飲用'],
            rows: [
              [
                '[[good:mead|蜂蜜酒]]',
                '{{draught.meadUses}}',
                '體力+{{draught.meadPct}}%，耐力+{{draught.meadPct}}%',
                '體力或耐力降到{{need.drivePct}}%',
              ],
              [
                '[[good:potion_food_small|小型]] / [[good:potion_food_big|大型營養藥水]]',
                '{{draught.smallUses}} / {{draught.bigUses}}',
                '體力+{{draught.potionPct}}%',
                '體力降到{{need.drivePct}}%',
              ],
              [
                '[[good:potion_stamina_small|小型]] / [[good:potion_stamina_big|大型耐力藥水]]',
                '{{draught.smallUses}} / {{draught.bigUses}}',
                '耐力+{{draught.potionPct}}%',
                '耐力降到{{need.drivePct}}%',
              ],
            ],
            num: [1],
            foot: '治療藥水：[[article:health|生命與治療]]。',
          },
        },
        {
          h: '護符',
        },
        {
          table: {
            head: ['護符', '效果', '觸發時機'],
            rows: [
              [
                '[[good:amulet_food|營養護符]]',
                '體力+{{amulet.needPct}}%',
                '每次體力降到{{need.drivePct}}%時',
              ],
              [
                '[[good:amulet_stamina|耐力護符]]',
                '耐力+{{amulet.needPct}}%',
                '每次耐力降到{{need.drivePct}}%時',
              ],
              ['[[good:amulet_strength|力量護符]]', '造成傷害×{{amulet.strengthFactor}}', '每次攻擊'],
              [
                '[[good:amulet_crithit|精準護符]]',
                '{{amulet.critChancePct}}%機率傷害×{{amulet.critFactor}}',
                '每次攻擊',
              ],
              ['[[good:amulet_defense|防禦護符]]', '受到傷害×{{amulet.defenseFactor}}', '每次受擊'],
              ['[[good:amulet_speed|疾風護符]]', '每步快{{step.amuletSaved}}秒', '每一步'],
            ],
          },
        },
        {
          h: '同時佩戴',
        },
        {
          list: [
            '相同護符第二枚無效。',
            '不同護符同時生效：力量加精準，暴擊時×{{amulet.comboFactor}}。',
            '有營養護符的居民從不去吃飯，有耐力護符的從不去睡覺。',
          ],
        },
        {
          h: '誰能佩戴',
        },
        {
          table: {
            head: ['對象', '可攜帶'],
            rows: [
              ['成年男性', '飲品和護符共{{amulet.slots}}個欄位，任何職業都一樣。'],
              ['婦女、兒童', '無。'],
            ],
            foot: '英雄能帶什麼：[[article:heroes|英雄]]。',
          },
        },
      ],
      see: ['article:needs', 'article:health', 'article:heroes', 'article:damage', 'article:walking'],
    },
  ],
};
