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
          p: '大廳選項「居民需求：停用」會凍結所有需求條，也不會再有人挨餓。此時本文不適用。',
        },
        {
          h: '需求條',
        },
        {
          table: {
            head: ['需求條', '自然下降', '工作時下降', '補充方式', '降到0%時'],
            rows: [
              [
                '體力',
                '{{need.drainMinutes}}分鐘掉100%',
                '是',
                '[[article:food|進餐]]',
                '[[article:health|{{need.starveMinutes}}分鐘後死亡]]',
              ],
              ['耐力', '{{need.drainMinutes}}分鐘掉100%', '是', '睡覺', '生命值不變'],
              ['社交', '{{need.drainMinutes}}分鐘掉100%', '否', '交談', '無懲罰'],
              ['信仰', '否', '僅武器和護甲', '[[article:religion|禱告]]', '不開工消耗信仰的批次'],
            ],
            foot: '開局時每條需求隨機為{{need.startMinPct}}-100%。沒有[[good:shoes|鞋子]]時，每走一步按地面不同扣{{need.barefootStepMinPct}}-{{need.barefootStepMaxPct}}%體力，負重時翻倍。',
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
              ['{{need.overfillPct}}%', '上限。在家進餐和用傢俱睡覺可以存下超過100%的部分。'],
            ],
            foot: '[[job:armorer|武器匠]]和[[job:smith|鐵匠]]會自己去禱告。[[job:sewer|裁縫]]消耗信仰，但只有下令才禱告。',
          },
        },
        {
          h: '居民的行動優先順序',
        },
        {
          steps: [
            '防禦模式：避難。',
            '[[article:draughts|飲品與護符]]，原地使用。',
            '體力：進食。',
            '耐力：睡覺。',
            '信仰：禱告。',
            '玩家命令：兵營、裝備、箭塔。',
            '社交：交談。',
            '工作。',
          ],
        },
        {
          p: '沒東西吃、沒地方禱告時，居民回去工作，需求條繼續下降。{{reach.walk}}格內沒有住所就露天睡覺。',
        },
        {
          p: '士兵戰鬥中只吃隨身帶的或箭塔存糧。進食命令會打斷戰鬥。',
        },
        {
          h: '睡眠',
        },
        {
          table: {
            head: ['對象', '睡眠時長', '在外', '在家', '在家有傢俱'],
            rows: [
              [
                '有住所的男性',
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
              ['商人、偵察兵', '{{sleep.manSeconds}}秒', '+{{sleep.manHomePct}}%', '-', '-'],
              ['士兵', '{{sleep.soldierSeconds}}秒', '+{{sleep.soldierPct}}%', '-', '-'],
            ],
            num: [1, 2, 3, 4],
          },
        },
        {
          h: '誰沒有需求條',
        },
        {
          table: {
            head: ['對象', '需求條'],
            rows: [
              ['嬰兒、兒童', '沒有。成年時每條都是100%。'],
              ['[[article:heroes|英雄]]', '沒有。'],
              ['怪物、動物', '沒有。'],
              ['士兵', '沒有社交。'],
              ['手推車乘客', '需求條和生命值凍結。'],
              ['船上乘客', '吃貨艙裡的食物，按在外睡覺，可以交談。信仰等到上岸。'],
            ],
          },
        },
        {
          h: '進食、睡覺、交談、禱告命令',
        },
        {
          list: [
            '需求條多高都能下令。命令會打斷行軍、攻擊和戰鬥。',
            '滿足不了需求時命令會等待。後面還有排隊的命令時，這條直接作廢。',
            '英雄不接受這些命令。「禱告」只對會禱告的職業有效。',
          ],
        },
        {
          h: '「進食與睡眠」開關',
        },
        {
          table: {
            head: ['士兵', '「允許」', '「禁止」'],
            rows: [
              ['自己去吃飯、睡覺、禱告', '是', '否'],
              ['自己吃隨身食物或箭塔存糧', '是', '否'],
              ['飢餓打斷長命令', '是', '否'],
            ],
            foot: '飲品、護符以及進食、睡覺、禱告命令在兩種狀態下都有效。命令選單裡這兩種狀態叫「允許休息恢復」和「禁止休息恢復」。只有士兵有這個開關，預設「允許」，換職業後恢復「允許」。',
          },
        },
        {
          p: '「禁止」又沒有飲品，士兵會餓死。下達進食命令或改回「允許」可救。',
        },
        {
          h: '飢餓與長命令',
        },
        {
          list: [
            '體力到{{need.criticalPct}}%時，居民離開行軍、偵察或命令隊列。狀態顯示「肚子餓，去吃東西」。',
            '吃到{{need.satedPct}}%，然後從頭執行命令。',
            '找不到吃的就回去執行命令，{{meal.breakRetrySeconds}}秒後再找。',
            '給飢餓的人下新命令時新命令優先：{{meal.breakRetrySeconds}}秒內飢餓不會打斷他。',
            '耐力要等所有命令執行完。',
          ],
        },
        {
          h: '戒備中',
        },
        {
          p: '這是[[article:stances|進攻或防禦姿態]]的士兵靠近戰鬥時的狀態，不是玩家開啟的[[article:defence|聚落防禦模式]]。',
        },
        {
          table: {
            head: ['附近情況', '格數', '結果'],
            rows: [
              ['戰鬥', '{{alert.restClearance}}以內', '不睡覺、不禱告、不交談。'],
              ['可見的進攻或防禦姿態敵人', '{{alert.standTo}}以內', '同上。'],
              ['露天睡覺者附近有戰鬥', '{{alert.standTo}}以內', '起身。'],
            ],
            foot: '體力到{{need.criticalPct}}%才去吃飯。野獸只有正在交戰時才算。無視姿態下此規則無效，需求命令優先。',
          },
        },
        {
          h: '信仰與社交',
        },
        {
          table: {
            head: ['活動', '時長', '效果'],
            rows: [
              [
                '禱告',
                '{{pray.seconds}}秒',
                '信仰+{{pray.pct}}%。重複到100%，除非體力或耐力降到{{need.drivePct}}%。',
              ],
              ['交談', '{{talk.shortSeconds}}-{{talk.longSeconds}}秒', '社交最多+{{talk.pct}}%。'],
              ['已婚者在家補需求條', '-', '社交100%。'],
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
      lead: '食物包括麵包、肉和魚。同樣一餐在家吃，體力加倍。',
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
          h: '食物來源',
        },
        {
          table: {
            head: ['貨物', '來源', '算作'],
            rows: [
              [
                '[[good:bread|麵包]]',
                '[[building:work_bakery_00|一級烘焙坊]]、[[building:work_bakery_01|二級烘焙坊]]',
                '食物',
              ],
              ['[[good:candy|餅乾]]', '[[building:work_bakery_01|二級烘焙坊]]', '蛋糕'],
              ['[[good:meat|肉]]', '[[building:work_animal_farm|畜牧場]]、[[job:hunter|獵人]]', '食物'],
              ['[[good:fish|魚]]', '[[job:fisher|漁夫]]', '食物'],
            ],
            foot: '居民也吃工坊貨架上的食物。在倉庫先拿食物，沒有食物才拿餅乾。成熟的灌木就地吃，吃完灌木變空。',
          },
        },
        {
          h: '在哪裡吃',
        },
        {
          steps: [
            '自家存糧，住所門口最多{{reach.walk}}格遠。',
            '{{reach.goods}}格內最近的倉庫、工坊或地面貨堆，或{{reach.bushAtHand}}格內的成熟灌木。',
            '{{reach.goods}}格內最近的成熟灌木。',
            '步行範圍內任何地方最近的食物，包括較遠的自家。',
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
            '拿1份回家，存糧按食物或蛋糕入賬。',
            '家裡有[[good:crockery|陶器]]時，運回1份算2份存糧。',
          ],
        },
        {
          p: '沒別的事做的婦女會一直運，直到存糧滿。存糧上限見[[article:family|家庭與住所]]。',
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
            head: ['來源', '變化', '條件', '{{health.human}}點所需時間'],
            rows: [
              [
                '自動恢復',
                '+{{health.regenPerSecond}}/秒',
                '體力高於0%，戰鬥中也有效',
                '{{health.regenWholeMin}}分{{health.regenRestSec}}秒',
              ],
              [
                '[[article:religion|神廟光環]]',
                '+{{aura.perSecond}}/秒',
                '距[[building:work_temple|神廟]]{{aura.range}}格',
                '{{aura.wholeMin}}分{{aura.restSec}}秒',
              ],
              ['治療藥水', '每口+{{draught.healSip}}', '受傷後將低於{{draught.healBelow}}', '-'],
              [
                '飢餓',
                '-{{health.starvePerSecond}}/秒',
                '體力0%',
                '{{health.starveWholeMin}}分{{health.starveRestSec}}秒',
              ],
            ],
            num: [1, 3],
            foot: '自動恢復和光環疊加，共{{aura.totalPerSecond}}/秒。自動恢復到{{health.human}}為止，光環可超上限治療到{{aura.ceiling}}。兒童和英雄同樣有{{health.human}}點並會自動恢復。',
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
            '[[good:potion_heal_small|小型治療藥水]]有{{draught.smallUses}}口，共{{draught.healSmallTotal}}點。[[good:potion_heal_big|大型治療藥水]]有{{draught.bigUses}}口，共{{draught.healBigTotal}}點。',
            '居民一口接一口地喝，直到扣除傷害後至少還剩{{draught.healBelow}}點。',
            '只要藥水夠抵消傷害，致命一擊也殺不死。',
            '餓到生命值低於{{draught.healBelow}}時也會喝。',
            '先喝開過封的，再喝小瓶，最後喝大瓶。',
          ],
        },
      ],
      see: ['article:draughts', 'article:needs', 'article:religion', 'good:potion_heal_small'],
    },
    {
      id: 'life',
      name: '生與死',
      lead: '兒童出生{{age.adultMinutes}}分鐘後成年。成年人只要有生命值就一直活著。',
      blocks: [
        {
          h: '人生階段',
        },
        {
          table: {
            head: ['階段', '年齡', '出生後', '備註'],
            rows: [
              [
                '嬰兒',
                '0-{{age.babyLastYear}}歲',
                '0-{{age.childWholeMin}}分{{age.childRestSec}}秒',
                '步速慢一倍。',
              ],
              [
                '兒童',
                '{{age.childYears}}-{{age.childLastYear}}歲',
                '{{age.childWholeMin}}分{{age.childRestSec}}秒-{{age.adultMinutes}}分',
                '每步慢{{step.childExtra}}秒。在家附近活動。',
              ],
              [
                '成人',
                '{{age.adultYears}}歲起',
                '{{age.adultMinutes}}分鐘起',
                '男孩成為[[job:civilist|平民]]，女孩成為[[job:woman|婦女]]。',
              ],
            ],
            foot: '一歲等於{{age.yearSeconds}}秒。沒有職業的平民等待指派。',
          },
        },
        {
          h: '死後留下什麼',
        },
        {
          table: {
            head: ['物品', '去向'],
            rows: [
              ['攜帶的貨物', '全部掉在地上。'],
              ['[[good:shoes|鞋子]]、工具', '磨損不超過{{death.newWearPct}}%時按新品掉落，否則消失。'],
              ['武器', '僅士兵掉落。'],
              ['護甲', '一定掉落。'],
              ['飲品、護符', '掉落護符和未開封的瓶子。'],
              ['搬運工推車', '連同貨物留在原地。'],
              ['遺體', '人留下骸骨。動物留下[[article:wildlife|肉]]。'],
            ],
          },
        },
        {
          p: '已發現的[[article:trades|職業]]留在聚落。對伴侶的影響見[[article:family|家庭與住所]]。',
        },
      ],
      see: ['article:family', 'article:health', 'article:trades'],
    },
    {
      id: 'family',
      name: '家庭與住所',
      lead: '生一個孩子花{{family.childFood}}份存糧，一對夫妻一次只養一個孩子。',
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
            '只有「結婚」命令才能結婚，居民不會自己成婚。',
            '命令把居民和最近的異性成人配對，須同一民族、同一玩家。',
            '對象必須在該居民的[[article:roads|路標]]範圍內。找不到對象時命令作廢，顯示「找不到對象」。',
            '士兵、英雄、偵察兵，以及被派往[[building:barracks|兵營]]或[[building:school|學校]]的居民不能結婚。',
            '夫妻住在妻子家。妻子沒有住所時住在丈夫家。',
          ],
        },
        {
          h: '生孩子',
        },
        {
          steps: [
            '玩家選擇：「生個兒子」或「生個女兒」。',
            '存糧少於{{family.childFood}}份時，妻子去運糧。',
            '夫妻倆進屋。',
            '存糧減少{{family.childFood}}份。',
            '維京人{{family.birthVikingSeconds}}秒後出生，其他民族{{family.birthOtherSeconds}}秒後出生。',
          ],
        },
        {
          table: {
            head: ['生育受阻原因', '解決辦法'],
            rows: [
              ['妻子沒有住所', '指派住所。'],
              ['住所還在建造', '建完。'],
              ['丈夫是士兵、[[job:trader|商人]]或[[job:scout|偵察兵]]', '給他換職業。'],
              ['夫妻分居', '指派同一座住所。'],
              ['範圍內沒有食物', '把食物運到附近倉庫。'],
            ],
          },
        },
        {
          p: '上一個孩子成年後才能生下一個，也就是{{age.adultMinutes}}分鐘後。孩子不佔住所的家庭名額。',
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
          p: '存糧的食物和蛋糕分開計算：一級民居可存{{home.larder}} + {{home.candyLarder}}份。一戶是一名成人、其伴侶和未成年的孩子。住所可以屬於玩家的任何民族。',
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
                '{{oil.wholeMin}}分{{oil.restSec}}秒',
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
              ['全體住戶', '住所被拆毀時失去住所。'],
              ['全家', '「搬離住所」命令後失去住所。'],
              ['商人、偵察兵、士兵', '住所留給家人，但他本人不在家吃住。'],
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
      name: '助手',
      lead: '計數器下單生孩子和招新兵，開關把庫存裝備發下去。',
      blocks: [
        {
          h: '計數器',
        },
        {
          table: {
            head: ['計數器', '下單內容', '執行者', '何時減少', '可設無限'],
            rows: [
              ['女兒', '女孩', '有住所的已婚婦女', '出生時', '否'],
              ['兒子', '男孩', '有住所的已婚婦女', '出生時', '是'],
              ['徒手士兵', '新兵', '[[job:civilist|平民]]', '訓練完成後', '是'],
              ['劍兵、矛兵、弓手', '武器，然後新兵', '徒手士兵，然後平民', '拿到武器時', '是'],
            ],
            foot: '範圍0-{{assistant.counterMax}}，初始為0。對單個人下的命令優先於助手。武器和護甲的順序見[[article:equip|士兵裝備]]。',
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
              ['鐵質工具、木質工具', '開', '從事職業工作的人，不含士兵、[[job:scout|偵察兵]]和平民'],
              ['[[good:mead|蜂蜜酒]]', '開', '平民、士兵'],
              ['營養藥水、耐力藥水、治療藥水', '關', '平民、士兵'],
              ['護符：營養、耐力、力量、防禦、精準、疾風', '關', '平民、士兵'],
              ['學校畢業生自動分派到工坊', '關', '[[building:school|學校]]畢業生'],
              ['採集者自動移動旗幟', '開', '插了旗的[[job:collector|採集者]]'],
            ],
            foot: '飲品和護符可用「平民」和「士兵」按鈕選擇發放對象，初始都開。關掉不會收回任何東西，已有的繼續留著。',
          },
        },
        {
          h: '生育',
        },
        {
          list: [
            '先女兒後兒子。女兒不能設為∞，否則永遠輪不到兒子。',
            '計數器為3表示最多3對夫妻同時生育。',
            '一對夫妻一次接一單。受阻原因和手動下令相同：[[article:family|家庭與住所]]。',
            '調低計數器不會取消夫妻已接的單。',
          ],
        },
        {
          h: '徵兵去兵營',
        },
        {
          list: [
            '只徵沒有工作地點、沒有任務的成年平民，未婚者優先。不會抽走在職的人。',
            '兵種計數器優先武裝範圍內有武器可拿的徒手士兵。',
          ],
        },
        {
          table: {
            head: ['徵兵停止的原因', '解決辦法'],
            rows: [
              ['沒有建成的[[building:barracks|兵營]]', '建完兵營。'],
              ['沒有空閒平民', '手動派人去兵營。'],
              ['徒手士兵在等該兵種的武器', '提供武器。在此之前他佔著新兵的名額。'],
            ],
            foot: '每秒最多{{assistant.draftsPerSecond}}人。在路上的新兵計入計數器，損失的新兵回到隊列。',
          },
        },
        {
          h: '發放',
        },
        {
          list: [
            '跳過婦女、兒童、[[article:heroes|英雄]]和箭塔駐軍。',
            '去一趟倉庫，順便領齊其餘物品。',
            '倉庫裡每1份貨物只派一名居民去領。不動用低於[[article:hauling|最低庫存]]的貨物。',
            '只補空位，不換更好的。鐵質工具先於木質工具，大瓶先於小瓶。',
            '有小瓶的人不再去領大瓶。飲品和護符共{{amulet.slots}}個欄位：[[article:draughts|飲品與護符]]。',
          ],
        },
        {
          h: '畢業生',
        },
        {
          list: [
            '畢業生只指派一次，去本職業最近的空缺，工坊工地也算。能做該課程產品的工坊優先，哪怕離得更遠。',
            '沒有空缺就在學校旁等待。[[job:collector|採集者]]、[[job:hunter|獵人]]、[[job:fisher|漁夫]]和士兵不參與。',
          ],
        },
        {
          p: '旗幟跟著資源移動，與其相距{{assistant.flagMin}}-{{assistant.flagMax}}格：[[article:work-flag|工作旗幟]]。',
        },
        {
          p: '「臣民」視窗統計缺口：住所、工作地點、工具、鞋子、伴侶、孩子、武器、蜂蜜酒。',
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
                '體力或耐力不超過{{need.drivePct}}%',
              ],
              [
                '[[good:potion_food_small|小型]] / [[good:potion_food_big|大型營養藥水]]',
                '{{draught.smallUses}} / {{draught.bigUses}}',
                '體力+{{draught.potionPct}}%',
                '體力不超過{{need.drivePct}}%',
              ],
              [
                '[[good:potion_stamina_small|小型]] / [[good:potion_stamina_big|大型耐力藥水]]',
                '{{draught.smallUses}} / {{draught.bigUses}}',
                '耐力+{{draught.potionPct}}%',
                '耐力不超過{{need.drivePct}}%',
              ],
              [
                '[[good:potion_heal_small|小型]] / [[good:potion_heal_big|大型治療藥水]]',
                '{{draught.smallUses}} / {{draught.bigUses}}',
                '生命值+{{draught.healSip}}',
                '受傷後生命值將低於{{draught.healBelow}}',
              ],
            ],
            num: [1],
            foot: '進食或睡覺命令期間暫停飲用。',
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
                '每次體力不超過{{need.drivePct}}%時',
              ],
              [
                '[[good:amulet_stamina|耐力護符]]',
                '耐力+{{amulet.needPct}}%',
                '每次耐力不超過{{need.drivePct}}%時',
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
            '補需求的順序：開過封的瓶子、護符、剩餘口數較少的瓶子。',
            '因體力喝下的蜂蜜酒也會補耐力。',
            '有營養護符的居民不找吃的，有耐力護符的不去睡覺。',
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
              ['[[article:heroes|英雄]]', '治療藥水以及力量、精準、防禦、疾風護符。'],
              ['婦女、兒童', '無。'],
            ],
          },
        },
      ],
      see: ['article:needs', 'article:health', 'article:damage', 'article:walking'],
    },
  ],
};
