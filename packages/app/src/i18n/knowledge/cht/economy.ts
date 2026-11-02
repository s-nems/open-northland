import type { ArticleGroup } from '../../../hud/knowledge/articles.js';

export const ECONOMY: ArticleGroup = {
  group: '經濟',
  items: [
    {
      id: 'construction',
      name: '建造、升級與修理',
      lead: '一名建築工人建一級民居，光是敲擊就要{{build.noviceSeconds}}秒，用鐵質工具要{{build.noviceIronSeconds}}秒。搬材料的時間另算。',
      blocks: [
        {
          h: '哪裡能建造',
        },
        {
          table: {
            head: ['項目', '結果'],
            rows: [
              ['地形', '可以建在陸地、沙地、海灘和石漠上。山地、雪地、水面和沼澤不行。'],
              [
                '[[building:work_well_00|水井]]、[[building:work_hive_00|蜂房]]',
                '建築至少要有邊緣站在草地上。',
              ],
              ['空間', '建築一開始就佔下最高等級所需的位置，外加周圍一圈窄邊。兩座建築的窄邊不能重疊。'],
              ['樹木、岩石、礦床、木柵欄', '會擋住工地，必須在最高等級所需的位置之外。'],
              [
                '敵方士兵',
                '距他{{contest.radius}}格內不能建，斜向約{{contest.diagonal}}格。只算你看得見的士兵，不算箭塔上崗的駐軍。',
              ],
              [
                '和平關係玩家的建築',
                '距其建築或工地{{peace.keepOut}}格內不能建，除非你自己的建築離那裡更近。',
              ],
              ['迷霧中的地塊', '會擋住工地。該位置此刻必須看得見。'],
              ['居民、載具、工作旗幟、路標、貨堆、屍體', '會被移到一旁。'],
              ['灌木、田地、樹樁、已開啟的箱子', '工地放下時消失。'],
              ['道路工地', '被取消，已運到的毛石落在旁邊。'],
              ['升級用地上的道路、木柵欄', '畫線時會繞開這裡。預設按G鍵可以鋪上去，但升級時會拆掉，不返還。'],
              ['敵方平民、動物', '沒有影響，工地可以建在他們旁邊。'],
              ['已鋪好的道路', '留在建築下方。'],
              ['路標範圍', '不限制。工地可建在網路外，網路覆蓋到那裡後建築工人才能過去。'],
            ],
          },
        },
        {
          figure: {
            id: 'step-diamond',
            caption: '為什麼斜向更短',
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
            foot: '每份材料的敲擊數。[[job:builder|建築工人]]敲{{exp.build.repeatsFull}}次後經驗到100%，只算有進度的敲擊。',
          },
        },
        {
          list: [
            '無成本的建築只需敲1下。',
            '一段木柵欄或道路由1名建築工人敲1下完成，前提是材料已經到位。',
            '建築工人和指派到工地的工人運材料，每次1份。',
          ],
        },
        {
          h: '建築工人的工作順序',
        },
        {
          steps: [
            '玩家剛派給這名工人的道路或木柵欄。',
            '修理：先柵門，再建築，最後木柵欄。',
            '建築工地，材料齊且快完工的優先。',
            '新的木柵欄段。',
            '道路。',
          ],
        },
        {
          p: '玩家指派到工地的建築工人會留在那裡，別處有活也不走。',
        },
        {
          h: '升級',
        },
        {
          list: [
            '花費所升等級的材料。可一次跨多級，只要每一級都已解鎖。',
            '建築庫存中屬於升級成本的貨物直接進入工地。其餘庫存在完工後返回。',
            '工人和住戶搬出，保留名額，完工後回來。',
            '升級期間生命值不增長。完工後按新等級回滿。',
            '開始升級會解除防禦模式。',
            '取消時退回庫存和從中取走的貨物，已運到的材料作廢。',
          ],
        },
        {
          h: '修理',
        },
        {
          table: {
            head: ['目標', '每擊回復生命值', '同時工作的工人數'],
            rows: [
              ['建築', '{{repair.minPerSwing}}-{{repair.maxPerSwing}}', '{{repair.crew}}'],
              ['木柵欄段', '{{wall.segmentRepair}}', '{{repair.wallCrew}}'],
              ['柵門', '{{wall.gateRepair}}', '{{repair.wallCrew}}'],
            ],
            num: [1, 2],
            foot: '修理不花材料。修木柵欄和柵門時，經驗和工具沒有作用。',
          },
        },
        {
          list: [
            '最後一次挨打後{{repair.calmSeconds}}秒內，或{{alert.standTo}}格內有戰鬥時，建築工人不會自己去修理。你下命令可以跳過這兩個條件。',
            '工地和在建的木柵欄不用修理，生命值隨建造增長。',
            '受損建築升級時先修理，再升級。',
          ],
        },
        {
          h: '損失與返還',
        },
        {
          table: {
            head: ['情況', '結果'],
            rows: [
              ['拆除工地', '已運到的材料掉在地上'],
              ['拆除或摧毀建築', '庫存加一半成本，每種貨物向上取整'],
              ['拆除升級中的建築', '當前等級同上，另加暫存的庫存和升級材料'],
            ],
            foot: '貨物堆放在{{reach.spill}}格內的同一片陸地上，放不下的消失。',
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
              ['0', '產品停工', '跳過該貨物'],
              ['1-{{workshop.counterMax}}', '做這麼多批，每開工一批-1', '採集這麼多份，每得一份-1'],
              ['∞', '不停，計數不減', '不停，計數不減'],
            ],
            foot: '工坊按批計數，採集者按份計數。經驗和工具能讓一批多出幾份：[[article:tools|工具]]。',
          },
        },
        {
          h: '按鈕',
        },
        {
          table: {
            head: ['按鈕', '點擊', 'Shift', 'Ctrl'],
            rows: [
              ['貨物圖示，「只做這項產品」', '此貨物∞，其餘0', '-', '此貨物：0變∞，其他值變0。其餘不變。'],
              ['減少', '-1。從0跳到∞，從∞跳到{{workshop.counterMax}}', '-10', '歸0'],
              ['增加', '+1。從{{workshop.counterMax}}跳到∞，從∞跳到0', '+10', '設為∞'],
            ],
          },
        },
        {
          h: '新工人的初始設定',
        },
        {
          table: {
            head: ['對象', '初始計數'],
            rows: [
              ['工匠', '工坊第一種產品∞，其餘0'],
              ['[[building:work_animal_farm|畜牧場]]的[[job:breeder|畜牧師]]', '牛∞，綿羊0'],
              ['由助手指派的畢業生，學校教這個職業多種產品時', '學校學過的產品∞，其餘0'],
              ['[[job:collector|採集者]]', '所有貨物∞'],
            ],
          },
        },
        {
          h: '計數器何時變化',
        },
        {
          p: '換工作地點或職業時計數器會清空，建築被拆也一樣。升級不影響計數器，新等級增加的產品為0。每名工人的計數器各自獨立：同一工坊的2個人可以做2種產品。',
        },
        {
          h: '同時做多種產品',
        },
        {
          p: '工人按面板順序輪流做計數大於0的產品，每種做1批。',
        },
        {
          table: {
            head: ['情況', '結果'],
            rows: [
              ['產品庫存已滿', '工人換下一種產品。正在做的批次也算佔位。'],
              ['建築裡沒有原料', '工人換下一種產品'],
              ['建築內原料不足', '等著補齊。無處可取時才換下一種。'],
              ['產品缺少所需經驗', '計數器處顯示「已鎖定」，輪轉時跳過'],
              ['有計數的產品全被鎖定', '工人做已經會做的，包括計數為0的產品'],
            ],
          },
        },
        {
          h: '載具',
        },
        {
          list: [
            '載具造在工坊外面：工匠在旁邊開工場，自己運材料，自己建造。',
            '載具計數在完工時減少，不是開工時。',
            '工坊旁放不下工場時，工人換下一種產品。',
          ],
        },
        {
          h: '採集者',
        },
        {
          table: {
            head: ['操作', '結果'],
            rows: [
              ['「只採集這項貨物」', '此貨物∞，其餘0'],
              ['右鍵點擊資源', '「採集」：此貨物∞，其餘0，工作旗幟不動'],
              ['Ctrl+右鍵點擊資源', '同上，旗幟移到資源處'],
              ['所有計數都是0', '狀態「全部設為 0」'],
              ['計數為0但貨物在地上', '計數只管開採。倒在地上的樹幹和貨堆，採集者照樣搬運。'],
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
      lead: '一棵樹敲{{gather.strokes}}下，得{{gather.treeYield}}份木材。岩石敲同樣多下只得1份，所以木材大約快{{gather.treeYield}}倍。',
      blocks: [
        {
          h: '資源產出',
        },
        {
          table: {
            head: ['資源', '誰來採', '產出', '無經驗敲擊數', '用時', '工具'],
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
          list: [
            '砍倒的樹變成帶{{gather.treeYield}}份木材的樹幹，採集者每次搬1份。',
            '岩石或礦床每採1份就掉在旁邊地上。',
          ],
        },
        {
          h: '鐵礦與金礦',
        },
        {
          table: {
            head: ['途徑', '條件', '適用對象'],
            rows: [
              [
                '工作',
                '[[good:mud|黏土]]和[[good:stone|毛石]]合計{{gather.oreNeed}}份',
                '該居民本人。第一人為全聚落發現該貨物。',
              ],
              ['[[building:school|學校]]', '貨物已發現後上課', '畢業生'],
            ],
            foot: '每名居民都要自己達成條件，[[good:iron|鐵礦]]和[[good:gold|金礦]]分開算。達成之前面板顯示「已鎖定」。',
          },
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
          p: '田地只靠澆水生長，時間不起作用。每次澆水讓本田和6塊相鄰田長1階段，所以一塊田最多澆{{field.waterings}}次。收割後留下1份，空地可重新播種。',
        },
        {
          p: '播種和澆水不花費任何貨物，也用不到水。',
        },
        {
          table: {
            head: ['建築', '田數', '半徑', '人手', '庫存'],
            rows: [
              [
                '[[building:work_farm_00|農場]]',
                '{{field.max}}',
                '{{field.radius}}格',
                '農夫{{farm.farmers}}名，搬運工{{farm.carriers}}名',
                '{{farm.stock}}',
              ],
              [
                '[[building:work_herb_hut|草藥屋]]',
                '{{field.max}}',
                '{{field.radius}}格',
                '草藥師{{herbHut.herbalists}}名，搬運工{{herbHut.carriers}}名',
                '{{herbHut.stock}}',
              ],
            ],
            num: [1, 4],
            foot: '斜向半徑約{{field.diagonal}}格。田數上限按建築算，不按工人算。人多只是收得快。',
          },
        },
        {
          h: '農夫和草藥師的工作順序',
        },
        {
          steps: [
            '把收割的貨物運回建築。',
            '建築的田不足{{field.max}}塊時播種。',
            '收割最近的成熟田。',
            '給階段最低的田澆水。',
            '在建築裡等待。',
          ],
        },
        {
          p: '沙地和道路上不能播種。建築範圍內地圖自帶的野生田計入其上限。',
        },
        {
          p: '與建築門口隔絕{{field.reclaimSeconds}}秒的田會消失，騰出上限名額。',
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
                '{{bush.regrowSeconds}}秒：開花{{bush.stageSeconds}}秒，結果{{bush.stageSeconds}}秒',
                '1餐',
              ],
              ['魚群', '每{{fish.regrowSeconds}}秒+1條魚', '{{fish.swarmMax}}條'],
              ['樹、岩石、礦床、蘑菇', '不再生', '-'],
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
      lead: '工具減少敲擊次數，增加工坊產量，可用{{tool.uses}}次。',
      blocks: [
        {
          h: '居民從哪裡拿工具',
        },
        {
          p: '工具由[[article:assistant|助手]]發放，它開局就是開著的，也可以由你下令。居民只有在工具欄空著時才去倉庫拿，先拿鐵質，再拿木質。他不會自己換更好的工具。',
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
              ['[[job:builder|建築工人]]', '每份材料少敲幾下'],
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
            head: ['經驗', '無工具', '木質', '鐵質'],
            rows: [
              ['0%', '{{tool.strokes.0.bare}}', '{{tool.strokes.0.wooden}}', '{{tool.strokes.0.iron}}'],
              ['20%', '{{tool.strokes.20.bare}}', '{{tool.strokes.20.wooden}}', '{{tool.strokes.20.iron}}'],
              ['40%', '{{tool.strokes.40.bare}}', '{{tool.strokes.40.wooden}}', '{{tool.strokes.40.iron}}'],
              ['60%', '{{tool.strokes.60.bare}}', '{{tool.strokes.60.wooden}}', '{{tool.strokes.60.iron}}'],
              ['80%', '{{tool.strokes.80.bare}}', '{{tool.strokes.80.wooden}}', '{{tool.strokes.80.iron}}'],
              [
                '100%',
                '{{tool.strokes.100.bare}}',
                '{{tool.strokes.100.wooden}}',
                '{{tool.strokes.100.iron}}',
              ],
            ],
            num: [1, 2, 3],
            foot: '樹、岩石、礦床、草藥田。',
          },
        },
        {
          table: {
            head: ['經驗', '無工具', '木質', '鐵質'],
            rows: [
              ['0%', '{{tool.casts.0.bare}}', '{{tool.casts.0.wooden}}', '{{tool.casts.0.iron}}'],
              ['20%', '{{tool.casts.20.bare}}', '{{tool.casts.20.wooden}}', '{{tool.casts.20.iron}}'],
              ['40%', '{{tool.casts.40.bare}}', '{{tool.casts.40.wooden}}', '{{tool.casts.40.iron}}'],
              ['60%', '{{tool.casts.60.bare}}', '{{tool.casts.60.wooden}}', '{{tool.casts.60.iron}}'],
              ['80-100%', '{{tool.casts.80.bare}}', '{{tool.casts.80.wooden}}', '{{tool.casts.80.iron}}'],
            ],
            num: [1, 2, 3],
            foot: '每條魚的拋竿次數。',
          },
        },
        {
          p: '收割一塊[[good:wheat|小麥]]田：無工具敲{{gather.wheatStrokes}}下，有工具或經驗到20%起敲1下。',
        },
        {
          h: '工坊每批產量',
        },
        {
          table: {
            head: ['經驗', '無工具', '木質', '鐵質'],
            rows: [
              ['0%', '{{tool.output.0.bare}}', '{{tool.output.0.wooden}}', '{{tool.output.0.iron}}'],
              ['20%', '{{tool.output.20.bare}}', '{{tool.output.20.wooden}}', '{{tool.output.20.iron}}'],
              ['40%', '{{tool.output.40.bare}}', '{{tool.output.40.wooden}}', '{{tool.output.40.iron}}'],
              ['60%', '{{tool.output.60.bare}}', '{{tool.output.60.wooden}}', '{{tool.output.60.iron}}'],
              ['80%', '{{tool.output.80.bare}}', '{{tool.output.80.wooden}}', '{{tool.output.80.iron}}'],
              ['100%', '{{tool.output.100.bare}}', '{{tool.output.100.wooden}}', '{{tool.output.100.iron}}'],
            ],
            num: [1, 2, 3],
            foot: '按產出1份的配方計算，產出2份的配方加成翻倍。原料和時長不變。經驗對屠宰同樣有效。',
          },
        },
        {
          p: '小數部分在工坊內累積。湊滿1份就入庫，可超過容量。',
        },
        {
          h: '耗損',
        },
        {
          table: {
            head: ['工作', '工具耗損'],
            rows: [
              ['工坊批次', '每完成一批算1次'],
              ['採集敲擊', '每擊1次，沒採出來也算'],
              ['拋竿', '每竿1次，沒釣到也算'],
              ['建築工人敲擊', '每擊1次，修理和沒有進度的敲擊也算'],
              ['澆水', '每次澆水1次'],
              ['播種、拾蘑菇', '0'],
            ],
            foot: '用滿{{tool.uses}}次後工具消失，居民徒手工作，直到拿到新工具。鐵質工具在沒有經驗的居民手上能砍{{tool.ironTrees}}棵樹。',
          },
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
          h: '容量',
        },
        {
          table: {
            head: ['建築', '每種貨物份數'],
            rows: [
              ['[[building:stock_00|一級倉庫]]', '{{haul.store1}}'],
              ['[[building:stock_01|二級倉庫]]', '{{haul.store2}}'],
              ['[[building:stock_02|三級倉庫]]', '{{haul.store3}}'],
              ['[[building:headquarters|大本營]]', '{{haul.hq}}'],
            ],
            num: [1],
            foot: '這些建築可容納[[job:carrier|搬運工]]、採集者、漁夫和獵人各{{haul.storeSeats}}名。',
          },
        },
        {
          h: '優先',
        },
        {
          p: '優先在單座建築上設定：倉庫、大本營、兵營或箭塔。該建築的搬運工從其他倉庫、工坊和貨堆運貨過來，直到沒有空位。',
        },
        {
          h: '最低庫存',
        },
        {
          p: '最低庫存把所有倉庫和大本營合起來算，每種貨物最多{{haul.minimumMax}}份。合計低於這個數時，倉庫、大本營、水井和蜂房的搬運工會從工坊、水井、蜂房和貨堆運貨過來，而且沒人能從倉庫取走這種貨物。',
        },
        {
          p: '吃飯也一樣：全部食物都在最低庫存之內時，沒人能從倉庫吃。倉庫只把高於最低庫存的部分交給設了優先的倉庫。',
        },
        {
          h: '倉庫搬運工的工作順序',
        },
        {
          steps: [
            '放下手上的東西。',
            '運來本建築標記為優先的貨物。',
            '在倉庫和大本營運來低於最低庫存的貨物。',
            '拾取本建築可收的最近貨堆。',
            '把工坊的成品運回本建築。',
          ],
        },
        {
          table: {
            head: ['搬運工所在', '工作內容'],
            rows: [
              [
                '[[building:work_farm_00|農場]]、[[building:work_herb_hut|草藥屋]]',
                '先把收成運到倉庫，再運貨堆',
              ],
              ['工坊', '先運來原料，再運走產品'],
              ['[[building:work_well_00|水井]]、[[building:work_hive_00|蜂房]]', '運走存貨'],
            ],
          },
        },
        {
          h: '車輛',
        },
        {
          table: {
            head: ['搬運工', '每趟份數', '滿載減速'],
            rows: [
              ['無車', '{{haul.carry}}', '-'],
              ['[[good:handcart|手推車]]', '{{haul.handcart}}', '{{haul.handcartLossPct}}%'],
              ['[[good:oxcart|牛車]]', '{{haul.oxcart}}', '{{haul.oxcartLossPct}}%'],
            ],
            num: [1, 2],
            foot: '載重越小，減速越少。[[job:trader|商人]]的車數值相同。',
          },
        },
        {
          list: [
            '只有有工作地點的搬運工和[[job:trader|商人]]能用車。搬運工保留工作地點。',
            '車必須是自己的且空閒：沒有乘員，沒有別的指揮官，在同一片陸地上。',
            '車上還有空位時，倉庫搬運工會拾取身邊{{haul.cartTopUp}}格內貨堆和工坊裡的同種貨物，然後返回。',
            '失去工作地點後車留在原地。',
          ],
        },
        {
          h: '地面貨堆',
        },
        {
          list: [
            '貨堆沒有主人，誰都能拿。',
            '搬運工沒有工作旗幟時在建築{{flag.radius}}格內拾取，有旗幟時在旗幟{{flag.radius}}格內。',
          ],
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
      lead: '工作旗幟（按鈕上叫「旗幟」）劃定工作區域，本身不存東西。沒有工作地點的採集者把貨物留在地上。',
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
              ['旗幟來源', '轉職時自動插在腳下', '只能用「插上旗幟」'],
              ['工作地點', '旗幟周圍', '旗幟周圍，無旗時見下表'],
              ['可採貨物', '職業能採的全部', '僅建築能存放的'],
              ['貨物去向', '旗幟旁的地面貨堆', '工人所在建築'],
              ['拔除旗幟', '不行，只能移動', '「拔除旗幟」'],
              [
                '失去工作地點',
                '-',
                '採集者、漁夫和獵人繼續圍繞自己的旗幟工作，沒有旗幟時在腳下插新旗。搬運工失去旗幟。',
              ],
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
              ['搬運工', '倉庫：建築{{flag.radius}}格內的貨堆'],
              ['獵人', '工作地點周圍'],
              ['漁夫', '從所在位置尋找岸邊'],
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
            foot: '單位為格。受路標限制的職業只在路標範圍內工作。',
          },
        },
        {
          p: '農場、草藥屋、水井、蜂房、箭塔和兵營的搬運工不接受工作旗幟。',
        },
        {
          h: '旗幟旁的貨堆',
        },
        {
          list: [
            '旗幟下的貨堆只有有工作地點的搬運工才會拿。',
            '離倉庫超過{{flag.radius}}格時，在採集者的旗幟旁給搬運工插一面他自己的旗幟。',
            '有旗幟的搬運工拿旗幟周圍的貨堆和成品，運回自己的建築。',
            '移動旗幟不會帶走貨堆。',
          ],
        },
        {
          h: '插旗',
        },
        {
          p: '「插上旗幟」在指定位置插旗，或把旗幟移過去。該處被佔用時在{{flag.snap}}格內找空位，再遠命令作廢。Ctrl+右鍵效果相同。',
        },
        {
          p: '開啟[[article:assistant|助手]]裡的開關後，採集者會自己移動旗幟：插在距資源{{assistant.flagMin}}-{{assistant.flagMax}}格處。區域採空後，移到離自己建築最近的資源。獵人和漁夫不受此影響。',
        },
        {
          p: '旗幟可以插在範圍外，但工人會站著不動，直到網路覆蓋那裡：[[article:roads|道路與路標]]。',
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
          p: '居民能自己走到{{reach.walk}}格內的目標，[[job:carrier|搬運工]]是{{reach.carrier}}格。更遠就要靠路標：路標比這個範圍近時，會開放整個相連的網路，目標必須在該網路某個路標的同樣範圍內。',
        },
        {
          list: [
            '兩個路標相距小於{{reach.link}}格時相連，兩者間路線不超過{{reach.linkRoute}}格。',
            '自家路標至少要相隔{{reach.spacing}}格。',
            '居民只找小於{{reach.goods}}格的貨物，此範圍內路標周圍的也算。',
            '建築蓋在路標上時，路標最多被移開{{reach.displace}}格，再遠就消失。',
          ],
        },
        {
          table: {
            head: ['地形', '尋找貨物（格）'],
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
          p: '偵察兵、士兵、英雄、[[job:hunter|獵人]]和[[job:druid|德魯伊]]不受範圍限制。',
        },
        {
          p: '工作地點或旗幟落在範圍外的工人，狀態變成「迷路了」，站著不動，直到網路覆蓋那裡。手上的貨物還是會送回去。',
        },
        {
          h: '路標面板',
        },
        {
          table: {
            head: ['項目', '含義'],
            rows: [
              ['「網路中的貨物」', '整個相連網路範圍內的貨物：建築、貨堆、車輛、手上。每份只算一次。'],
              ['「拆除」', '路標立即消失，無需確認，也不用偵察兵。如果它是唯一的連接，網路就會分裂。'],
            ],
            foot: '地圖上的「路標」圖層顯示網路。',
          },
        },
        {
          h: '道路',
        },
        {
          table: {
            head: ['路下地形', '無路每步', '有路每步', '節省'],
            rows: [
              ['陸地', '{{step.land}}秒', '{{step.road}}秒', '{{step.roadSavedOnLandPct}}%'],
              ['沙地', '{{step.sand}}秒', '{{step.road}}秒', '{{step.roadSavedOnSandPct}}%'],
              ['山地', '{{step.mountain}}秒', '{{step.road}}秒', '{{step.roadSavedOnMountainPct}}%'],
              ['雪地', '{{step.snow}}秒', '{{step.road}}秒', '{{step.roadSavedOnSnowPct}}%'],
            ],
            num: [1, 2, 3],
            foot: '穿鞋、空手的居民。鞋子走道路的磨損比走陸地慢：×{{shoes.roadWear}}。',
          },
        },
        {
          list: [
            '每段花1份[[good:stone|毛石]]和[[job:builder|建築工人]]敲1下。',
            '同一份毛石還能鋪最多6段相鄰路段，前提是沒有建築工人接手，那裡也沒有毛石。',
            '取消路段：已運到的毛石落在旁邊。',
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
          h: '各地形的步速',
        },
        {
          table: {
            head: ['地形', '穿鞋', '赤腳', '一雙鞋可走步數'],
            rows: [
              ['道路、鋪石路', '{{step.road}}秒', '{{step.roadBare}}秒', '{{shoes.road}}'],
              ['陸地', '{{step.land}}秒', '{{step.landBare}}秒', '{{shoes.land}}'],
              ['沙地、海灘、石漠', '{{step.sand}}秒', '{{step.sandBare}}秒', '{{shoes.sand}}'],
              ['山地', '{{step.mountain}}秒', '{{step.mountainBare}}秒', '{{shoes.mountain}}'],
              ['雪地', '{{step.snow}}秒', '{{step.snowBare}}秒', '{{shoes.snow}}'],
            ],
            num: [1, 2, 3],
            foot: '手上拿貨時鞋子磨損更快：×{{shoes.carryWear}}。赤腳每步的體力消耗見[[article:needs|需求]]。',
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
              ['武器和護甲合計重量2-3', '+{{step.weightLowExtra}}秒'],
              ['武器和護甲合計重量4-5', '+{{step.weightHighExtra}}秒'],
              ['[[good:amulet_speed|疾風護符]]', '-{{step.amuletSaved}}秒'],
              ['滿載[[good:handcart|手推車]]', '慢{{haul.handcartLossPct}}%'],
              ['滿載[[good:oxcart|牛車]]', '慢{{haul.oxcartLossPct}}%'],
            ],
            foot: '每步最快{{step.shortest}}秒。載重越小，車輛減速越少。英雄不受重量減速。',
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
            foot: '所有民族相同。武器重量加上下表的護甲重量。',
          },
        },
        {
          data: 'armour',
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
              ['商人，穿鞋，滿載手推車', '陸地', '{{step.traderFullCart}}秒'],
            ],
            num: [2],
          },
        },
      ],
      see: ['good:shoes', 'good:amulet_speed', 'article:roads', 'article:needs', 'article:vehicles'],
    },
    {
      id: 'trade',
      name: '貿易',
      lead: '商人往返於{{trade.stops}}座建築之間，無車時每趟拿{{haul.carry}}份。',
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
            foot: '容量和減速：[[article:hauling|搬運工與倉庫]]。',
          },
        },
        {
          p: '穿鞋，車子去程滿載、回程空車時，在陸地上約{{trade.cartParLand}}格或道路上約{{trade.cartParRoad}}格的路線，兩種車運量相同。更短用手推車，更遠用牛車。',
        },
        {
          h: '路線',
        },
        {
          list: [
            '路線連接{{trade.stops}}座有庫存的已完工建築，外方建築最多1座。',
            '建築升級時，[[job:trader|商人]]等到完工。',
            '商人不從民居拿食物。',
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
              ['貨物在建築B標記', '在A裝貨，在B卸貨'],
              ['貨物在兩座建築都標記', '平衡兩邊庫存'],
              ['兩座建築都沒標記', '商人不動'],
              ['最多 N', '目的建築連同貨物達到N時停止運送'],
              ['保留 N', '來源建築留下N份'],
              ['聚落', '從整個聚落裝貨：先此倉庫，再其路標網路內的倉庫和工坊'],
            ],
            foot: '「聚落」選項只對倉庫或大本營有效，且只能用於路線兩座建築之一。最低庫存同樣限制裝貨。',
          },
        },
        {
          h: '與電腦貿易',
        },
        {
          list: [
            '只能和電腦玩家已完工、且有地圖提議的建築貿易。',
            '把建築加入路線時，雙方都必須友好。之後只要商人所屬民族友好就行：[[article:diplomacy|外交]]。',
            '提議是用N份一種貨物換M份另一種，數字由地圖決定。一條路線一次只做一個提議。',
            '電腦倉庫每{{trade.refillSeconds}}秒把提議中的貨物補回{{trade.refillLevel}}份。',
            '商人按車上裝得下的完整交換次數裝貨，並留出放報酬的位置。車小時，一次交換要分幾趟完成。',
            '交出貨物，收取報酬，有貨就重複。建築裡沒有報酬時，商人等待，不交貨。',
            '「保留 N」在建築裡留下N份待售貨物。回程上限N：建築有N份報酬時商人停止。',
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
