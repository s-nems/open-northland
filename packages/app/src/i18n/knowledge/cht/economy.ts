import type { ArticleGroup } from '../../../hud/knowledge/articles.js';

export const ECONOMY: ArticleGroup = {
  group: '經濟',
  items: [
    {
      id: 'construction',
      name: '建造、升級與修理',
      lead: '一名建築工人蓋一座一級民居要{{build.noviceSeconds}}秒，用鐵質工具要{{build.noviceIronSeconds}}秒。搬材料的時間另算。',
      blocks: [
        {
          h: '哪裡能建造',
        },
        {
          table: {
            head: ['項目', '規則'],
            rows: [
              ['地形', '可以建在陸地、沙地、海灘和石漠上。山地、雪地、水面和沼澤不行。'],
              [
                '[[building:work_well_00|水井]]、[[building:work_hive_00|蜂房]]',
                '建築至少要有邊緣站在草地上。',
              ],
              ['空間', '建築一開始就佔下最高等級所需的位置，外加周圍一圈窄邊。兩座建築的窄邊不能重疊。'],
              ['樹木、岩石、礦床、木柵欄', '必須在建築最高等級所需的位置之外。'],
              [
                '敵方士兵',
                '他周圍{{contest.radius}}格內不能建，斜向約{{contest.diagonal}}格。只算你看得見的士兵，箭塔駐軍不算。',
              ],
              [
                '和平關係玩家的建築',
                '距其建築或工地{{peace.keepOut}}格內不能建，除非你自己的建築離那裡更近。',
              ],
              ['迷霧中的地塊', '不能建。該位置此刻必須看得見。'],
              ['路標範圍', '沒關係。工地可以放在網路外，但要等網路覆蓋到那裡，建築工人才會過去。'],
            ],
          },
        },
        {
          h: '建造時長',
        },
        {
          table: {
            head: ['[[building:home_level_00|一級民居]]，1名建築工人', '敲擊數', '時長'],
            rows: [
              ['沒有經驗，沒有工具', '{{build.noviceSwings}}', '{{build.noviceSeconds}}秒'],
              [
                '沒有經驗，[[good:tool_iron|鐵質工具]]',
                '{{build.noviceIronSwings}}',
                '{{build.noviceIronSeconds}}秒',
              ],
              [
                '大師，[[good:tool_iron|鐵質工具]]',
                '{{build.masterIronSwings}}',
                '{{build.masterIronSeconds}}秒',
              ],
            ],
            num: [1, 2],
            foot: '一級民居需要{{build.homeUnits}}份材料。時長只算敲擊，每次敲擊{{build.swingSeconds}}秒。',
          },
        },
        {
          h: '每1份材料的敲擊數',
        },
        {
          table: {
            head: ['經驗', '無工具', '木質', '鐵質'],
            rows: [
              ['0-9%', '{{build.perUnit.0.bare}}', '{{build.perUnit.0.wooden}}', '{{build.perUnit.0.iron}}'],
              [
                '10-21%',
                '{{build.perUnit.10.bare}}',
                '{{build.perUnit.10.wooden}}',
                '{{build.perUnit.10.iron}}',
              ],
              [
                '22-49%',
                '{{build.perUnit.22.bare}}',
                '{{build.perUnit.22.wooden}}',
                '{{build.perUnit.22.iron}}',
              ],
              [
                '50-78%',
                '{{build.perUnit.50.bare}}',
                '{{build.perUnit.50.wooden}}',
                '{{build.perUnit.50.iron}}',
              ],
              [
                '79-89%',
                '{{build.perUnit.79.bare}}',
                '{{build.perUnit.79.wooden}}',
                '{{build.perUnit.79.iron}}',
              ],
              [
                '90-100%',
                '{{build.perUnit.90.bare}}',
                '{{build.perUnit.90.wooden}}',
                '{{build.perUnit.90.iron}}',
              ],
            ],
            num: [1, 2, 3],
            foot: '[[job:builder|建築工人]]的經驗只從推進了工程的敲擊中增長：[[article:exp-work|工作經驗]]。',
          },
        },
        {
          p: '材料由建築工人和指派到工地的工人運過去，每次1份。',
        },
        {
          h: '建築工人先做什麼',
        },
        {
          p: '建築工人先修理，再蓋建築，木柵欄和道路放到最後。你把他指派到某個工地後，他會一直留在那裡，別處有活也不走。',
        },
        {
          h: '升級',
        },
        {
          list: [
            '花費新等級的材料。只要每一級都已解鎖，就可以一次跨多級。',
            '升級需要的貨物如果建築庫存裡已經有，會直接用到工程上。',
            '升級期間工人和住戶搬出去，完工後回到原來的位置。',
            '完工後建築按新等級回滿生命值。',
            '取消升級時建築拿回自己的庫存，但已運到的材料作廢。',
          ],
        },
        {
          h: '修理',
        },
        {
          p: '建築工人每敲一下為建築回復{{repair.minPerSwing}}-{{repair.maxPerSwing}}點生命值，一座建築最多{{repair.crew}}名建築工人同時修理。修理不花材料。木柵欄和柵門的修理方式不同，經驗和工具在那裡沒有作用：[[article:walls|木柵欄與柵門]]。',
        },
        {
          p: '最後一次挨打後{{repair.calmSeconds}}秒內，或{{alert.standTo}}格內有戰鬥時，建築工人不會自己去修理。你下命令的話他馬上就去。',
        },
        {
          h: '損失與返還',
        },
        {
          table: {
            head: ['情況', '剩下什麼'],
            rows: [
              ['拆除工地', '已運到的材料留在地上'],
              ['拆除或摧毀建築', '庫存加一半成本，向上取整'],
            ],
            foot: '貨物落在建築{{reach.spill}}格內的地上，放不下的消失。',
          },
        },
      ],
      see: ['article:tools', 'article:walls', 'article:roads', 'article:exp-work', 'job:builder'],
    },
    {
      id: 'workshops',
      name: '工坊與產品選擇',
      lead: '產品旁的計數器決定工人要做多少批：0是停止，∞是不停。一批就是執行一次配方。',
      blocks: [
        {
          h: '計數器取值',
        },
        {
          table: {
            head: ['計數器', '工坊', '採集者'],
            rows: [
              ['0', '不做這種產品', '不採這種貨物'],
              ['1-{{workshop.counterMax}}', '做這麼多批，每批開工時計數減1', '採這麼多份，每得一份計數減1'],
              ['∞', '不停，計數不減', '不停，計數不減'],
            ],
            foot: '經驗和工具能讓一批多出幾份：[[article:tools|工具]]。',
          },
        },
        {
          h: '按鈕',
        },
        {
          table: {
            head: ['按鈕', '點擊', 'Shift', 'Ctrl'],
            rows: [
              ['貨物圖示，「只做這項產品」', '此貨物∞，其餘0', '-', '此貨物在0和∞之間切換，其餘不變'],
              ['減少', '-1。從0跳到∞，從∞跳到{{workshop.counterMax}}', '-10', '歸0'],
              ['增加', '+1。從{{workshop.counterMax}}跳到∞，從∞跳到0', '+10', '設為∞'],
            ],
          },
        },
        {
          h: '計數器何時變化',
        },
        {
          p: '每名工人的計數器各自獨立，所以同一工坊的2個人可以做2種產品。工人換工作地點或職業時計數器會清空，建築被拆也一樣。升級不影響計數器，新等級的產品從0開始。',
        },
        {
          h: '同時做多種產品',
        },
        {
          p: '工人按面板順序輪流做所有計數大於0的產品，每種做1批。',
        },
        {
          table: {
            head: ['情況', '工人怎麼做'],
            rows: [
              ['產品庫存已滿', '換下一種產品'],
              ['缺少原料', '換下一種產品'],
              ['原料只有一部分', '等著補齊。無處可取時換下一種產品。'],
              ['經驗不夠做這種產品', '面板在計數器處顯示「已鎖定」，工人跳過這種產品'],
              ['有計數的產品全被鎖定', '做已經會做的，包括計數為0的產品'],
            ],
          },
        },
        {
          h: '載具',
        },
        {
          p: '載具不在工坊裡面造。工匠在旁邊開工場，自己把材料運過去再建造。工坊旁放不下工場時，他換下一種產品。',
        },
        {
          h: '採集者',
        },
        {
          table: {
            head: ['情況', '結果'],
            rows: [
              ['「只採集這項貨物」', '此貨物∞，其餘0'],
              ['右鍵點擊資源', '「採集」命令：此貨物∞，其餘0。工作旗幟不動。'],
              ['Ctrl+右鍵點擊資源', '同上，但旗幟移到資源處'],
              ['所有計數都是0', '採集者顯示「全部設為 0」，什麼也不採'],
              ['貨物已經在地上', '計數只管開採。砍倒的樹幹和貨堆採集者照樣搬運，計數為0時也一樣。'],
            ],
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
      name: '採集與種植',
      lead: '一棵樹敲{{gather.strokes}}下，得{{gather.treeYield}}份木材。岩石每出一份都要敲這麼多下，所以木材比毛石大約快{{gather.treeYield}}倍。',
      blocks: [
        {
          h: '資源產出',
        },
        {
          table: {
            head: ['資源', '誰來採', '產出', '無經驗敲擊數', '每棵樹、每份或每塊田的用時', '工具有用'],
            rows: [
              [
                '樹',
                '[[job:collector|採集者]]',
                '{{gather.treeYield}}份[[good:wood|木材]]',
                '每棵{{gather.strokes}}',
                '{{gather.treeSeconds}}秒',
                '是',
              ],
              [
                '岩石',
                '[[job:collector|採集者]]',
                '4-5份[[good:stone|毛石]]',
                '每份{{gather.strokes}}',
                '{{gather.stoneSeconds}}秒',
                '是',
              ],
              [
                '礦床',
                '[[job:collector|採集者]]',
                '5份[[good:mud|黏土]]、[[good:iron|鐵礦]]或[[good:gold|金礦]]',
                '每份{{gather.strokes}}',
                '{{gather.oreSeconds}}秒',
                '是',
              ],
              [
                '蘑菇',
                '[[job:collector|採集者]]',
                '1份[[good:mushroom|蘑菇]]',
                '拾取1次',
                '{{gather.mushroomSeconds}}秒',
                '否',
              ],
              [
                '麥田',
                '[[job:farmer|農夫]]',
                '1份[[good:wheat|小麥]]',
                '每塊{{gather.wheatStrokes}}',
                '{{gather.wheatSeconds}}秒',
                '是',
              ],
              [
                '草藥田',
                '[[job:herb_mush_guy|草藥師]]',
                '1份[[good:herb|草藥]]',
                '每塊{{gather.herbStrokes}}',
                '{{gather.herbSeconds}}秒',
                '是',
              ],
              [
                '魚群',
                '[[job:fisher|漁夫]]',
                '1份[[good:fish|魚]]',
                '{{gather.casts}}竿',
                '{{gather.fishSeconds}}秒',
                '是',
              ],
            ],
            foot: '只算工作時間，沒有經驗和工具，也不含走路。',
          },
        },
        {
          p: '砍倒的樹變成帶{{gather.treeYield}}份木材的樹幹，採集者每次搬1份。岩石或礦床每採出一份，都掉在旁邊地上。',
        },
        {
          h: '鐵礦與金礦',
        },
        {
          p: '採集者自己採到[[good:mud|黏土]]和[[good:stone|毛石]]合計{{gather.oreNeed}}份，比例不限，就會發現[[good:iron|鐵礦]]和[[good:gold|金礦]]。兩種礦是同一個條件，一起開放。第一個做到的人為全聚落發現它們，之後也能在[[building:school|學校]]學會。在那之前面板顯示「已鎖定」。',
        },
        {
          h: '田地',
        },
        {
          figure: {
            id: 'field-stages',
            caption: '從播種到收割',
          },
        },
        {
          p: '田地只有被澆水才會長，光等時間不會長。每次澆水讓本田和6塊相鄰田各長1階段，所以一塊田最多澆{{field.waterings}}次。收割後留下1份收成，這塊地可以重新播種。',
        },
        {
          p: '播種和澆水都不花東西，連水也不用。',
        },
        {
          table: {
            head: ['建築', '田數', '半徑'],
            rows: [
              ['[[building:work_farm_00|農場]]', '{{field.max}}', '{{field.radius}}格'],
              ['[[building:work_herb_hut|草藥屋]]', '{{field.max}}', '{{field.radius}}格'],
            ],
            num: [1],
            foot: '斜向半徑約{{field.diagonal}}格。田數上限按建築算，不按工人算，所以人多只是收得快，田不會變多。人手和庫存見建築卡片。',
          },
        },
        {
          p: '沙地和道路上不能播種。建築範圍內地圖自帶的野生田計入其上限。從建築門口{{field.reclaimSeconds}}秒走不到的田會消失，騰出上限名額。',
        },
        {
          h: '什麼會再生',
        },
        {
          table: {
            head: ['來源', '速度', '上限'],
            rows: [
              [
                '[[building:work_well_00|水井]]',
                '每秒+1份[[good:water|水]]，無需工人',
                '建築內{{well.stock}}份',
              ],
              [
                '[[building:work_hive_00|蜂房]]',
                '每秒+1份[[good:honey|蜂蜜]]，無需工人',
                '建築內{{hive.stock}}份',
              ],
              [
                '果灌木',
                '每{{bush.stageSeconds}}秒長一個階段，先開花後結果：最多{{bush.regrowSeconds}}秒',
                '1餐',
              ],
              ['魚群', '每{{fish.regrowSeconds}}秒+1條魚', '{{fish.swarmMax}}條'],
              [
                '樹',
                '樹被砍倒後，有{{regrow.inTen}}/10的機率在{{regrow.minMinutes}}-{{regrow.maxMinutes}}分鐘後於附近空地長出樹苗，該處周圍須至少有{{regrow.forestTrees}}棵樹。樹苗每{{tree.growMinutes}}分鐘長大一階',
                '每棵砍倒的樹1棵樹苗，長成後才能砍伐',
              ],
              [
                '蘑菇',
                '蘑菇被採摘後，有{{regrow.inTen}}/10的機率在{{regrow.minMinutes}}-{{regrow.maxMinutes}}分鐘後於附近空地重新長出，該處周圍須至少有{{regrow.forestTrees}}棵樹',
                '每個採摘的蘑菇長出1個，僅在森林中',
              ],
              ['岩石、礦床', '不再生', '-'],
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
      name: '工具',
      lead: '工具減少敲擊次數，讓工坊多出幾份，可用{{tool.uses}}次。',
      blocks: [
        {
          h: '居民從哪裡拿工具',
        },
        {
          p: '工具由[[article:assistant|助手]]發放，它開局就是開著的，你也可以下命令發。沒有工具的居民會自己去倉庫拿，有鐵質的拿鐵質，沒有就拿木質。助手的「鐵質工具」和「替換木質工具」開關都開著、倉庫裡又有多餘的鐵質工具時，助手會把木質工具換成鐵質的。用過的木質工具在更換時遺失，沒用過的放回倉庫。',
        },
        {
          h: '誰能受益',
        },
        {
          table: {
            head: ['對象', '收益'],
            rows: [
              ['工坊裡的工匠', '每批多出幾份'],
              ['[[job:collector|採集者]]', '少敲幾下，蘑菇除外'],
              ['[[job:farmer|農夫]]、[[job:herb_mush_guy|草藥師]]', '收割少敲幾下'],
              ['[[job:fisher|漁夫]]', '少拋幾竿'],
              ['[[job:builder|建築工人]]', '每份材料少敲幾下：[[article:construction|建造、升級與修理]]'],
              ['[[job:hunter|獵人]]、[[job:carrier|搬運工]]', '無'],
              ['士兵、英雄', '不帶工具'],
            ],
          },
        },
        {
          h: '採集敲擊數',
        },
        {
          table: {
            head: ['無經驗的居民', '無工具', '木質', '鐵質'],
            rows: [
              [
                '每棵樹或每份石頭、黏土、礦石的敲擊數',
                '{{tool.strokes.bare}}',
                '{{tool.strokes.wooden}}',
                '{{tool.strokes.iron}}',
              ],
              ['每1條魚的拋竿數', '{{tool.casts.bare}}', '{{tool.casts.wooden}}', '{{tool.casts.iron}}'],
            ],
            num: [1, 2, 3],
            foot: '敲擊數適用於樹、岩石、礦床和草藥田。經驗會從中減去相應的敲擊數，但至少還要1下：[[article:exp-work|工作經驗]]。',
          },
        },
        {
          p: '一塊[[good:wheat|小麥]]田無工具時要敲{{gather.wheatStrokes}}下，有工具或經驗到{{exp.savedStrokePct}}%時敲1下就夠。',
        },
        {
          h: '工坊每批產量',
        },
        {
          p: '工具為每批固定加成：木質+{{tool.bonus.wooden}}份，鐵質+{{tool.bonus.iron}}份。它與經驗加成相加，經驗加成見[[article:exp-work|工作經驗]]。產出2份的配方加成翻倍。原料和工作時長不變。',
        },
        {
          p: '不足一份的部分會累加，湊滿1份就入庫，可超過容量。',
        },
        {
          h: '耗損',
        },
        {
          p: '每次敲擊、拋竿、澆水和工坊每完成一批，都消耗一次工具，沒成功的也算。播種和拾蘑菇不消耗。用滿{{tool.uses}}次後工具消失，居民徒手工作，直到拿到新工具。鐵質工具在沒有經驗的居民手上能砍{{tool.ironTrees}}棵樹。',
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
      name: '搬運工與倉庫',
      lead: '沒有車的搬運工每次搬{{haul.carry}}份。地面同一處最多堆{{haul.groundStack}}份同種貨物。',
      blocks: [
        {
          p: '倉庫能存多少、有多少人在裡面工作，見[[building:stock_00|一級倉庫]]、[[building:stock_01|二級倉庫]]、[[building:stock_02|三級倉庫]]和[[building:headquarters|大本營]]的卡片。',
        },
        {
          h: '優先',
        },
        {
          p: '優先可以在倉庫、大本營、兵營或箭塔裡設定。設定後，只要還有空位，這座建築的搬運工就從其他倉庫、工坊和貨堆把這種貨物運來。',
        },
        {
          h: '最低庫存',
        },
        {
          p: '最低庫存每種貨物最多{{haul.minimumMax}}份，把所有倉庫和大本營合起來算。合計低於這個數時，搬運工從工坊、水井、蜂房和貨堆把這種貨物運來，也沒人能從倉庫取走它。',
        },
        {
          p: '吃飯也一樣：全部食物都在最低庫存之內時，沒人能從倉庫拿來吃。設了優先的倉庫從別的倉庫只能拿到高於最低庫存的部分。',
        },
        {
          h: '車輛',
        },
        {
          p: '有車時，搬運工每趟搬的份數等於車的容量：[[vehicle:handcart|手推車]]、[[vehicle:oxcart|牛車]]。車載貨後減速多少：[[article:vehicles|載具與船隻]]。',
        },
        {
          list: [
            '只有有工作地點的搬運工和[[job:trader|商人]]能用車。',
            '車必須是你的、空閒的，並且在同一片陸地上。',
            '車上還有空位時，倉庫搬運工會順路拾取{{haul.cartTopUp}}格內貨堆和工坊裡的同種貨物，再返回。',
          ],
        },
        {
          h: '地面貨堆',
        },
        {
          p: '地上的貨堆不屬於任何人，誰都能拿。搬運工從哪裡拾取貨堆：[[article:work-flag|工作旗幟]]。',
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
      name: '工作旗幟',
      lead: '工作旗幟（按鈕上叫「旗幟」）決定工人在哪裡幹活。它本身不存東西，所以沒有工作地點的採集者會把貨物留在地上。',
      blocks: [
        {
          figure: {
            id: 'flag-flow',
            caption: '旗幟下的貨物去向',
          },
        },
        {
          h: '有無工作地點的區別',
        },
        {
          table: {
            head: ['項目', '無工作地點', '有工作地點'],
            rows: [
              [
                '對象',
                '[[job:collector|採集者]]、[[job:fisher|漁夫]]、[[job:hunter|獵人]]',
                '同左，另加倉庫、大本營或工坊的[[job:carrier|搬運工]]',
              ],
              ['旗幟從哪來', '轉職時自動插在腳下', '只能用「插上旗幟」命令'],
              ['工作地點', '旗幟周圍', '旗幟周圍，沒有旗幟時見下表'],
              ['可採貨物', '他的職業能採的全部', '僅建築能存放的'],
              ['貨物去向', '旗幟旁的貨堆', '他所在的建築'],
              ['拔除旗幟', '不行，只能移動', '「拔除旗幟」'],
            ],
          },
        },
        {
          h: '拔除旗幟後',
        },
        {
          table: {
            head: ['對象', '無旗幟時'],
            rows: [
              ['採集者', '整個路標範圍'],
              ['倉庫搬運工', '建築{{flag.radius}}格內的貨堆'],
              ['獵人', '工作地點周圍'],
              ['漁夫', '在所站的地方附近釣魚'],
            ],
          },
        },
        {
          h: '工作區域',
        },
        {
          table: {
            head: ['對象', '計算起點', '橫向、縱向', '斜向'],
            rows: [
              ['[[job:collector|採集者]]', '工作旗幟', '{{flag.radius}}', '約{{flag.diagonal}}'],
              ['搬運工', '工作旗幟或建築', '{{flag.radius}}', '約{{flag.diagonal}}'],
              ['[[job:hunter|獵人]]', '工作旗幟', '{{flag.hunter}}', '{{flag.hunter}}'],
              ['[[job:fisher|漁夫]]', '工作旗幟', '{{flag.fisher}}', '約{{flag.fisherDiagonal}}'],
              [
                '[[job:farmer|農夫]]、[[job:herb_mush_guy|草藥師]]',
                '建築',
                '{{field.radius}}',
                '約{{field.diagonal}}',
              ],
            ],
            num: [2, 3],
            foot: '單位為格。需要路標的人只在路標範圍內工作。',
          },
        },
        {
          p: '農場、草藥屋、水井、蜂房、箭塔和兵營的搬運工插不了工作旗幟。',
        },
        {
          h: '旗幟旁的貨堆',
        },
        {
          list: [
            '旗幟下的貨堆只有有工作地點的搬運工才會拿。',
            '採集者的旗幟離倉庫超過{{flag.radius}}格時，給倉庫搬運工在旁邊插一面旗幟。',
            '移動旗幟後，貨堆留在原地。',
          ],
        },
        {
          h: '插旗',
        },
        {
          p: '「插上旗幟」在指定位置插旗，或把旗幟移過去，效果和Ctrl+右鍵一樣。位置被佔用時，旗幟插到{{flag.snap}}格內的空位上，找不到空位命令就作廢。',
        },
        {
          p: '在[[article:assistant|助手]]裡可以讓採集者自己移動旗幟。這時採集者把旗幟插在距資源{{assistant.flagMin}}-{{assistant.flagMax}}格處，附近採空後，就去離自己建築最近的資源。獵人和漁夫不會這樣做。',
        },
        {
          p: '旗幟可以插在網路外，但工人會站著不動，直到網路覆蓋那裡：[[article:roads|道路與路標]]。',
        },
      ],
      see: ['article:hauling', 'article:workshops', 'article:roads', 'article:assistant', 'job:collector'],
    },
    {
      id: 'roads',
      name: '道路與路標',
      lead: '道路花1份毛石，穿鞋走陸地每步從{{step.landBrief}}秒縮短到{{step.road}}秒。',
      blocks: [
        {
          h: '路標',
        },
        {
          p: '路標由[[job:scout|偵察兵]]豎立，不花材料。',
        },
        {
          figure: {
            id: 'reach',
            caption: '網路範圍',
          },
        },
        {
          p: '沒有路標時，居民最遠能走到{{reach.walk}}格外的目標，[[job:carrier|搬運工]]是{{reach.carrier}}格。更遠就要靠路標：只要這個距離內有路標，居民就能用與它相連的整個網路，目標則要在該網路某個路標的同樣距離內。',
        },
        {
          list: [
            '兩個路標相距小於{{reach.link}}格、之間步行路線不超過{{reach.linkRoute}}格時相連。',
            '你的新路標要離別的路標至少{{reach.spacing}}格。',
            '居民在離自己或這個距離內的路標小於{{reach.goods}}格的範圍內找貨物。',
            '建築蓋在路標上時，路標最多被移開{{reach.displace}}格，移不開就消失。',
          ],
        },
        {
          table: {
            head: ['地形', '找貨物的範圍（格）'],
            rows: [
              ['道路、陸地', '小於{{reach.goods}}'],
              ['沙地', '約{{reach.goodsSand}}'],
              ['山地', '約{{reach.goodsMountain}}'],
              ['雪地', '約{{reach.goodsSnow}}'],
            ],
            num: [1],
            foot: '地形越差，居民找貨物的距離越近。',
          },
        },
        {
          p: '偵察兵、士兵、英雄、[[job:hunter|獵人]]和[[job:druid|德魯伊]]有沒有路標都能到處走。',
        },
        {
          p: '工作地點或旗幟落在範圍外的工人，狀態變成「迷路了」，等到網路覆蓋那裡為止。手上的貨物還是會送回去。',
        },
        {
          h: '路標面板',
        },
        {
          table: {
            head: ['面板項目', '含義'],
            rows: [
              ['「網路中的貨物」', '相連網路範圍內的全部貨物：建築裡、貨堆上、車上和手上的。'],
              ['「拆除」', '路標立即消失，不會詢問。如果它連著網路的兩部分，網路就會斷開。'],
            ],
            foot: '地圖上的「路標」圖層顯示網路。',
          },
        },
        {
          h: '道路',
        },
        {
          table: {
            head: ['路下地形', '走道路每步縮短'],
            rows: [
              ['陸地', '{{step.roadSavedOnLandPct}}%'],
              ['沙地', '{{step.roadSavedOnSandPct}}%'],
              ['山地', '{{step.roadSavedOnMountainPct}}%'],
              ['雪地', '{{step.roadSavedOnSnowPct}}%'],
            ],
            num: [1],
            foot: '穿鞋、空手的居民。各地形的步速見[[article:walking|步速]]。鞋子走道路的磨損比走陸地慢：×{{shoes.roadWear}}。',
          },
        },
        {
          list: [
            '每段花1份[[good:stone|毛石]]和[[job:builder|建築工人]]敲1下。',
            '一份毛石還能鋪最多6段相鄰路段，前提是還沒有建築工人接手那些路段，上面也沒有毛石。',
            '走道路更快時，居民會自己走道路。',
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
      name: '步速',
      lead: '陸地上穿鞋每步{{step.landBrief}}秒，赤腳{{step.landBare}}秒。',
      blocks: [
        {
          p: '格是最小的移動單位：居民每走1步過1格。',
        },
        {
          h: '各地形的步速',
        },
        {
          table: {
            head: ['地形', '穿鞋每步', '赤腳每步', '一雙鞋可走步數'],
            rows: [
              ['道路、鋪石路', '{{step.road}}秒', '{{step.roadBare}}秒', '{{shoes.road}}'],
              ['陸地', '{{step.land}}秒', '{{step.landBare}}秒', '{{shoes.land}}'],
              ['沙地、海灘、石漠', '{{step.sand}}秒', '{{step.sandBare}}秒', '{{shoes.sand}}'],
              ['山地', '{{step.mountain}}秒', '{{step.mountainBare}}秒', '{{shoes.mountain}}'],
              ['雪地', '{{step.snow}}秒', '{{step.snowBare}}秒', '{{shoes.snow}}'],
            ],
            num: [1, 2, 3],
            foot: '手上拿貨時鞋子磨損更快：×{{shoes.carryWear}}。赤腳走路消耗多少體力見[[article:needs|需求]]。道路的好處見[[article:roads|道路與路標]]。',
          },
        },
        {
          h: '影響步速的因素',
        },
        {
          table: {
            head: ['狀態', '變化'],
            rows: [
              ['手上拿貨', '+{{step.carryExtra}}秒'],
              ['耐力不超過{{need.drivePct}}%', '+{{step.tiredExtra}}秒'],
              ['兒童', '+{{step.childExtra}}秒'],
              ['嬰兒', '每步 × 2'],
              ['武器和護甲合計重量{{step.weightLowFrom}}-{{step.weightLowTo}}', '+{{step.weightLowExtra}}秒'],
              [
                '武器和護甲合計重量{{step.weightHighFrom}}-{{step.weightHighTo}}',
                '+{{step.weightHighExtra}}秒',
              ],
              ['[[good:amulet_speed|疾風護符]]', '-{{step.amuletSaved}}秒'],
            ],
            foot: '每步至少{{step.shortest}}秒。英雄不受重量減速。車輛減速多少：[[article:vehicles|載具與船隻]]。',
          },
        },
        {
          h: '武器和護甲重量',
        },
        {
          table: {
            head: ['武器', '重量'],
            rows: [
              ['[[good:sword_shord|短劍]]、[[good:bow_short|短弓]]', '{{weight.shortSword}}'],
              ['[[good:spear_wooden|木矛]]、[[good:bow_long|長弓]]', '{{weight.woodenSpear}}'],
              ['[[good:spear_iron|鐵矛]]、[[good:sword_long|長劍]]', '{{weight.ironSpear}}'],
            ],
            num: [1],
            foot: '所有民族相同。把武器重量加上護甲表中的護甲重量：[[article:damage|傷害計算器]]。',
          },
        },
        {
          h: '示例',
        },
        {
          table: {
            head: ['對象', '地形', '每步'],
            rows: [
              ['搬運工，穿鞋，手上拿貨', '道路', '{{step.carrierOnRoad}}秒'],
              ['士兵，長劍，板甲，穿鞋', '陸地', '{{step.plateSoldierOnLand}}秒'],
            ],
            num: [2],
          },
        },
      ],
      see: [
        'good:shoes',
        'good:amulet_speed',
        'article:roads',
        'article:needs',
        'article:vehicles',
        'article:damage',
      ],
    },
    {
      id: 'trade',
      name: '貿易',
      lead: '商人往返於{{trade.stops}}座建築之間，沒有車時每次拿{{haul.carry}}份。',
      blocks: [
        {
          h: '運輸工具',
        },
        {
          table: {
            head: ['運輸工具', '裝卸1份用時'],
            rows: [
              ['手拿', '{{trade.handsSeconds}}秒'],
              ['[[good:handcart|手推車]]', '{{trade.handcartSeconds}}秒'],
              ['[[good:oxcart|牛車]]', '{{trade.oxcartSeconds}}秒'],
            ],
            num: [1],
            foot: '車的容量見其卡片，減速見[[article:vehicles|載具與船隻]]。',
          },
        },
        {
          p: '車子去程滿載、回程空車時，在陸地上約{{trade.cartParLand}}格或道路上約{{trade.cartParRoad}}格的路線，兩種車運量相同。路線更短時手推車更好，更長時牛車更好。',
        },
        {
          h: '路線',
        },
        {
          list: [
            '路線連接{{trade.stops}}座有庫存的已完工建築，其中最多1座可以屬於別人。',
            '建築升級時，[[job:trader|商人]]等升級結束。',
            '商人不從民居拿食物。',
          ],
        },
        {
          h: '跨海',
        },
        {
          list: [
            '路線上的建築位於不同岸邊時，路線顯示「需跨海」。點擊「指定船隻」，選擇商人所在岸邊的一艘自己的[[good:ship_small|船]]或[[good:ship_big|大船]]，船上不能有乘員和載具。商人會乘它走自己的路線。',
            '安排上這艘船的[[job:carrier|搬運工]]會在岸邊幫商人裝卸，前提是路線兩端的建築都是你的。',
          ],
        },
        {
          h: '自家建築之間',
        },
        {
          p: 'A和B是路線上的兩座建築。',
        },
        {
          table: {
            head: ['設定', '結果'],
            rows: [
              ['貨物在建築B標記', '從A拿貨運到B'],
              ['貨物在兩座建築都標記', '平衡兩邊庫存'],
              ['兩座建築都沒標記', '商人什麼也不運'],
              ['最多 N', '目的建築連同車上貨物將達到N份時停止運送'],
              ['保留 N', '來源建築留下N份'],
              [
                '聚落',
                '從整個聚落拿貨：先從這座倉庫，再從其路標網路內的其他倉庫和工坊。這座倉庫滿了時，送到聚落的另一座倉庫',
              ],
            ],
            foot: '「聚落」選項只能在倉庫或大本營裡開啟。只有兩座建築的聚落沒有共同建築時（例如在兩座島上），路線兩端才能同時開啟。商人不會拿走倉庫裡低於最低庫存的貨物。',
          },
        },
        {
          h: '與電腦貿易',
        },
        {
          list: [
            '只能和電腦玩家已完工、且有地圖提議的建築貿易。',
            '把建築加入路線時，雙方都必須互相友好。之後只要商人所屬民族友好就行：[[article:diplomacy|外交]]。',
            '提議是用N份一種貨物換M份另一種，數字由地圖決定。一條路線一次只做一個提議。',
            '電腦每{{trade.refillSeconds}}秒把自己倉庫裡的提議貨物補到{{trade.refillLevel}}份。',
            '電腦的建築裡沒有報酬時，商人等待，不交貨。',
            '「保留 N」在你的建築裡留下N份待售貨物。回程上限N：你的建築有了N份報酬時交易結束。',
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
