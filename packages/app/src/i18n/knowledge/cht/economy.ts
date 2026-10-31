import type { ArticleGroup } from '../../../hud/knowledge/articles.js';

export const ECONOMY: ArticleGroup = {
  group: '經濟',
  items: [
    {
      id: 'construction',
      name: '建造、升級與修理',
      lead: '一名建築工人建一座一級民居要{{build.noviceSeconds}}秒，用鐵質工具要{{build.noviceIronSeconds}}秒。',
      blocks: [
        {
          h: '哪裡能建造',
        },
        {
          table: {
            head: ['建不了', '規則'],
            rows: [
              ['地形', '陸地、沙地、海灘、石漠可建。山地、雪地、水面和沼澤不行。'],
              ['[[building:work_well_00|水井]]、[[building:work_hive_00|蜂房]]', '建築下方至少1個節點是草地'],
              ['空間', '建築一開始就佔用最高等級的輪廓和周圍邊距。兩座建築的邊距不能重疊。'],
              ['樹木、岩石、礦床、木柵欄', '必須在輪廓之外'],
              [
                '敵方士兵',
                '{{contest.radius}}步內不能建，斜向約{{contest.diagonal}}步。只算可見的士兵，不算箭塔上崗的駐軍。',
              ],
              ['和平關係玩家的建築', '距其{{peace.keepOut}}步內不能建，工地也算，除非你的建築離得更近。'],
              ['升級用地', '現有建築更高等級的輪廓已被佔用，別的建築不能建在那裡。'],
              ['迷霧中的地塊', '該位置此刻必須可見'],
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
          table: {
            head: ['會讓開的', '規則'],
            rows: [
              ['居民、載具、工作旗幟、路標、貨堆、屍體', '被移到一旁'],
              ['灌木、田地、樹樁、已開啟的箱子', '放下工地時被清除'],
              ['道路工地', '被取消，已運到的毛石落在旁邊'],
              [
                '升級用地上的道路、木柵欄',
                '預設繞開。畫線時按鍵切換「跨越升級用地」可鋪在上面，但升級時會拆掉且不返還。',
              ],
            ],
          },
        },
        {
          table: {
            head: ['不受影響', '規則'],
            rows: [
              ['敵方平民、動物', '工地可建在他們旁邊'],
              ['已鋪好的道路', '留在建築下方'],
              ['路標範圍', '不限制。工地可建在網路外，網路覆蓋到那裡後建築工人才能過去。'],
            ],
          },
        },
        {
          h: '建造時長',
        },
        {
          table: {
            head: ['[[building:home_level_00|一級民居]]，1名建築工人', '每擊點數', '敲擊數', '時長'],
            rows: [
              [
                '新手，無工具',
                '{{build.novicePoints}}',
                '{{build.noviceSwings}}',
                '{{build.noviceSeconds}}秒',
              ],
              [
                '新手，[[good:tool_iron|鐵質工具]]',
                '{{build.noviceIronPoints}}',
                '{{build.noviceIronSwings}}',
                '{{build.noviceIronSeconds}}秒',
              ],
              [
                '大師，[[good:tool_iron|鐵質工具]]',
                '{{build.masterIronPoints}}',
                '{{build.masterIronSwings}}',
                '{{build.masterIronSeconds}}秒',
              ],
            ],
            num: [1, 2, 3],
            foot: '1份材料等於{{build.pointsPerUnit}}建造點。一級民居需要{{build.homeUnits}}份材料，共{{build.homePoints}}點。時長只算敲擊，不含搬運材料。每次敲擊{{build.swingSeconds}}秒。',
          },
        },
        {
          table: {
            head: ['經驗', '無工具', '木質', '鐵質'],
            rows: [
              ['0-9%', 1, 1, 2],
              ['10-21%', 1, 2, 2],
              ['22-49%', 1, 2, 3],
              ['50-78%', 2, 2, 3],
              ['79-89%', 2, 2, 4],
              ['90-100%', 2, 3, 4],
            ],
            num: [1, 2, 3],
            foot: '每次敲擊的建造點。[[job:builder|建築工人]]完成{{exp.build.repeatsFull}}次有進度的敲擊後經驗到100%。',
          },
        },
        {
          list: [
            '無成本的建築只需敲1下。',
            '一段木柵欄或道路在材料運到後敲1下，由1名建築工人完成。',
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
            '升級期間生命值不變，完工後按新等級回滿。',
            '開始升級會解除防禦模式。',
            '新建築下方的木柵欄和道路消失，不返還。',
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
              ['木柵欄段', 5, '{{repair.wallCrew}}'],
              ['柵門', 5, '{{repair.wallCrew}}'],
            ],
            num: [1, 2],
            foot: '修理不花材料。建築每個建造點回復{{repair.perPoint}}點生命值。木柵欄和柵門的修理不受經驗和工具影響。',
          },
        },
        {
          list: [
            '敵人攻擊後要等{{repair.calmSeconds}}秒，且{{alert.standTo}}步內不能有人戰鬥，才會修理。玩家命令可跳過這兩個條件。',
            '工地和在建的木柵欄段沒有修理一說，生命值隨建造增長。',
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
              ['拆除或摧毀建築', '庫存加一半成本，每項向上取整'],
              ['拆除升級中的建築', '當前等級同上，另加暫存的庫存和升級材料'],
            ],
            foot: '貨物堆放在{{reach.spill}}步內的同一片陸地上，放不下的消失。',
          },
        },
      ],
      see: ['article:tools', 'article:walls', 'article:roads', 'article:exp-work', 'job:builder'],
    },
    {
      id: 'workshops',
      name: '工坊與產品選擇',
      lead: '計數器決定工人做多少批：0為停止，∞為不停。一批就是執行一次配方。',
      blocks: [
        {
          h: '計數器取值',
        },
        {
          table: {
            head: ['計數器', '工坊', '採集者'],
            rows: [
              ['0', '產品停工', '跳過該貨物'],
              ['1-{{workshop.counterMax}}', '做這麼多批，開工時-1', '採集這麼多份，每得一份-1'],
              ['∞', '不停，計數不減', '不停，計數不減'],
            ],
            foot: '工坊按批計數，不按份。經驗和工具能讓一批產出更多份：[[article:tools|工具]]。',
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
              ['學過多門課程、由助手指派的畢業生', '學校學過的產品∞，其餘0'],
              ['只有1種產品的工坊', '該產品∞'],
              ['[[job:collector|採集者]]', '所有貨物∞'],
            ],
          },
        },
        {
          h: '計數器何時變化',
        },
        {
          p: '每次更換工作地點或職業都會清空，建築被拆時也一樣。升級會保留，新等級增加的產品為0。每名工人的計數器各自獨立：同一工坊的2個人可以做2種產品。',
        },
        {
          h: '同時做多種產品',
        },
        {
          p: '計數大於0的產品按面板順序輪流生產，每次1批。',
        },
        {
          table: {
            head: ['情況', '結果'],
            rows: [
              ['產品貨架已滿', '輪到下一種。在制批次算佔用位置。'],
              ['建築內沒有原料', '輪到下一種'],
              ['建築內原料不足', '等待補齊。無處可取時才輪到下一種。'],
              ['所有計數都是0', '工人不開工'],
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
            '載具不算批次。工匠在工坊旁開工場，自己運材料並建造。',
            '載具計數在完工時減少，不是開工時。',
            '工坊旁放不下工場時，輪到下一種產品。',
          ],
        },
        {
          h: '採集者',
        },
        {
          p: '採集者用同一個面板。貨物按鈕在這裡叫「只採集這項貨物」。',
        },
        {
          table: {
            head: ['操作', '結果'],
            rows: [
              ['「只採集這項貨物」', '此貨物∞，其餘0'],
              ['右鍵點擊資源', '「採集」：此貨物∞，其餘0，工作旗幟不動'],
              ['Ctrl+右鍵點擊資源', '同上，旗幟移到資源處'],
              ['所有計數都是0', '狀態「全部設為 0」'],
              ['有工作地點的採集者', '只能選建築能存放的貨物'],
              ['計數為0但貨物在地上', '計數只管開採。樹幹和貨堆採集者照樣搬運。'],
            ],
            foot: '[[job:hunter|獵人]]、[[job:scout|偵察兵]]和士兵沒有計數器。',
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
      lead: '新手敲{{gather.strokes}}下砍倒一棵樹，得{{gather.treeYield}}份木材。',
      blocks: [
        {
          h: '資源產出',
        },
        {
          table: {
            head: ['資源', '誰來採', '產出', '新手敲擊數', '工具'],
            rows: [
              [
                '樹',
                '[[job:collector|採集者]]',
                '{{gather.treeYield}}份[[good:wood|木材]]',
                '每棵{{gather.strokes}}',
                '是',
              ],
              [
                '岩石',
                '[[job:collector|採集者]]',
                '4-5份[[good:stone|毛石]]',
                '每份{{gather.strokes}}',
                '是',
              ],
              [
                '礦床',
                '[[job:collector|採集者]]',
                '5份[[good:mud|黏土]]、[[good:iron|鐵礦]]或[[good:gold|金礦]]',
                '每份{{gather.strokes}}',
                '是',
              ],
              ['蘑菇', '[[job:collector|採集者]]', '1份[[good:mushroom|蘑菇]]', '拾取1次', '否'],
              ['麥田', '[[job:farmer|農夫]]', '1份[[good:wheat|小麥]]', '每塊{{gather.wheatStrokes}}', '是'],
              [
                '草藥田',
                '[[job:herb_mush_guy|草藥師]]',
                '1份[[good:herb|草藥]]',
                '每塊{{gather.herbStrokes}}',
                '是',
              ],
              ['魚群', '[[job:fisher|漁夫]]', '1份[[good:fish|魚]]', '{{gather.casts}}竿', '是'],
              ['果灌木', '飢餓的居民', '就地吃1餐', '吃1次', '否'],
            ],
          },
        },
        {
          list: [
            '樹一次倒下，{{gather.treeYield}}份木材留在樹幹上，採集者每次搬1份。',
            '岩石或礦床每採1份就掉在礦床旁的地上。',
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
            foot: '[[good:iron|鐵礦]]和[[good:gold|金礦]]的條件分開計算，每名居民也分開計算。達成之前面板顯示「已鎖定」。',
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
          table: {
            head: ['階段', '發生什麼'],
            rows: [
              ['1', '已播種'],
              ['2-{{field.lastSeedStage}}', '每次澆水長1階段，本田和6塊相鄰田都算'],
              ['{{field.ripeStage}}', '成熟，等待收割'],
              ['收割後', '1份留在地上，空地可重新播種'],
            ],
            foot: '田地只靠澆水生長，時間不起作用。',
          },
        },
        {
          table: {
            head: ['建築', '田數', '半徑', '人手', '庫存'],
            rows: [
              [
                '[[building:work_farm_00|農場]]',
                '{{field.max}}',
                '{{field.radius}}步',
                '農夫{{farm.farmers}}名，搬運工{{farm.carriers}}名',
                '{{farm.stock}}',
              ],
              [
                '[[building:work_herb_hut|草藥屋]]',
                '{{field.max}}',
                '{{field.radius}}步',
                '草藥師{{herbHut.herbalists}}名，搬運工{{herbHut.carriers}}名',
                '{{herbHut.stock}}',
              ],
            ],
            num: [1, 4],
            foot: '斜向半徑約{{field.diagonal}}步。田數上限按建築計算，人多只是周轉更快。',
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
          p: '田地需要可耕種的土地，沙地和道路不行。建築半徑內地圖自帶的野生田計入其上限。',
        },
        {
          p: '從建築門口連續{{field.reclaimSeconds}}秒無法到達的田會消失，騰出上限名額。',
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
          h: '誰能受益',
        },
        {
          table: {
            head: ['對象', '收益'],
            rows: [
              ['工坊裡的工匠', '每批多產'],
              ['[[job:collector|採集者]]', '少敲幾下，蘑菇除外'],
              ['[[job:farmer|農夫]]、[[job:herb_mush_guy|草藥師]]', '收割少敲幾下'],
              ['[[job:fisher|漁夫]]', '少拋幾竿'],
              ['[[job:builder|建築工人]]', '每擊建造點更多'],
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
            foot: '需敲{{gather.strokes}}下的資源：樹、岩石、礦床、草藥田。',
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
            foot: '捕魚，每條魚{{gather.casts}}竿。',
          },
        },
        {
          p: '[[good:wheat|小麥]]無工具時每塊田敲{{gather.wheatStrokes}}下，有工具或經驗達到20%時敲1下。',
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
            foot: '按產出1份的配方計算。產出2份的配方：加成×2。每批的原料和時長不變。經驗對屠宰所得貨物同樣有效。',
          },
        },
        {
          p: '小數部分在工坊內累積，湊滿1份放上貨架，可超過容量。',
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
            foot: '用滿{{tool.uses}}次後工具消失，居民徒手工作，直到拿到新工具。',
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
      lead: '沒有推車的搬運工每次搬{{haul.carry}}份，地面同一處最多堆{{haul.groundStack}}份同種貨物。',
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
          h: '優先與最低庫存',
        },
        {
          table: {
            head: ['項目', '優先', '最低庫存'],
            rows: [
              ['適用範圍', '單座建築：倉庫、大本營、兵營、箭塔', '玩家所有倉庫和大本營合計'],
              ['誰來運', '該建築的搬運工', '倉庫、大本營、水井和蜂房的搬運工'],
              ['來源', '其他倉庫、工坊產品、貨堆', '工坊產品、水井、蜂房、貨堆'],
              ['運到何時', '建築還有空位時', '合計低於最低庫存時'],
              ['上限', '建築容量', '每種貨物{{haul.minimumMax}}份'],
              ['限制', '無', '低於最低庫存時沒人能從倉庫取貨'],
            ],
            foot: '倉庫只把高於最低庫存的部分交給優先倉庫。',
          },
        },
        {
          p: '吃飯也受最低庫存限制。全部食物都在最低庫存之內時，沒人能從倉庫吃。',
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
            foot: '減速隨載重增加。[[job:trader|商人]]的車輛數值相同。',
          },
        },
        {
          list: [
            '只有有工作地點的搬運工和[[job:trader|商人]]能用車。搬運工保留工作地點，把車當工具用。',
            '車必須是自己的且空閒：沒有乘員，沒有別的車夫，在同一片陸地上。',
            '車上有空位時，倉庫搬運工順路拾取{{haul.cartTopUp}}步內貨堆和成品中的同種貨物，然後返回。',
            '失去工作地點後車留在原地。',
          ],
        },
        {
          h: '地面貨堆',
        },
        {
          list: [
            '同一處只放1種貨物，最多{{haul.groundStack}}份。',
            '貨堆沒有主人，誰都能拿。',
            '搬運工沒有工作旗幟時在建築{{flag.radius}}步內拾取，有旗幟時在旗幟{{flag.radius}}步內。',
          ],
        },
        {
          h: '工作範圍',
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
            foot: '單位為步。受路標限制的職業，工作區域到路標範圍為止。',
          },
        },
        {
          p: '農場、草藥屋、水井、蜂房、箭塔和兵營的搬運工不接受工作旗幟。',
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
      lead: '旗幟劃定工作區域，本身不存東西。沒有工作地點的採集者把貨物留在地上。',
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
              ['搬運工', '倉庫：建築{{flag.radius}}步內的貨堆'],
              ['獵人', '工作地點周圍'],
              ['漁夫', '從所在位置尋找岸邊'],
            ],
            foot: '有旗幟時的區域見[[article:hauling|搬運工與倉庫]]的「工作範圍」表。',
          },
        },
        {
          h: '旗幟旁的貨堆',
        },
        {
          list: [
            '旗幟下的貨物不會自己進倉庫，需要有工作地點的搬運工。',
            '倉庫搬運工只夠到建築{{flag.radius}}步內。更遠時，在採集者的旗幟旁給他插一面自己的旗幟。',
            '有旗幟的搬運工拿旗幟周圍的貨堆和成品，運回自己的建築。',
            '移動旗幟不影響貨堆，它們留在原地。',
          ],
        },
        {
          h: '按鈕',
        },
        {
          table: {
            head: ['按鈕', '效果'],
            rows: [
              [
                '「插上旗幟」',
                '在指定位置插旗，或把旗幟移過去。目標被佔用時在{{flag.snap}}步內找位置，再遠命令作廢。',
              ],
              ['「拔除旗幟」', '僅限有工作地點者，移除旗幟'],
              ['「顯示工作區域」', '顯示區域圓圈。旗幟在場時有效。'],
              ['「顯示旗幟」', '鏡頭移到旗幟上'],
            ],
            foot: 'Ctrl+右鍵也能移動所選工人的旗幟。',
          },
        },
        {
          p: '開啟[[article:assistant|助手]]的開關後，採集者會自己移動旗幟：與資源相距{{assistant.flagMin}}-{{assistant.flagMax}}步，區域採空後移到離自己建築最近的資源。獵人和漁夫的旗幟不動。',
        },
        {
          h: '路標範圍外的旗幟',
        },
        {
          p: '旗幟可以插在範圍外。工人立即進入「迷路了」狀態，站著不動，直到網路覆蓋那裡。獵人不受影響：[[article:roads|道路與路標]]。',
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
          p: '路標由[[job:scout|偵察兵]]豎立，不花材料。路標網路屬於單個玩家。',
        },
        {
          figure: {
            id: 'reach',
            caption: '網路範圍',
          },
        },
        {
          table: {
            head: ['範圍（步）', '居民', '[[job:carrier|搬運工]]', '備註'],
            rows: [
              ['步行', '{{reach.walk}}', '{{reach.carrier}}', '從所在位置算起'],
              ['居民到路標', '小於{{reach.walk}}', '小於{{reach.carrier}}', '開放整個相連的網路'],
              ['路標到目標', '小於{{reach.walk}}', '小於{{reach.carrier}}', '從該網路任一路標算起'],
              [
                '兩路標相連',
                '小於{{reach.link}}',
                '小於{{reach.link}}',
                '兩者間路線不超過{{reach.linkRoute}}步',
              ],
              ['與自家路標的間距', '至少{{reach.spacing}}', '至少{{reach.spacing}}', '再近放不下'],
              ['尋找貨物', '小於{{reach.goods}}', '小於{{reach.goods}}', '也從此範圍內的路標算起'],
              ['建築壓住路標', '{{reach.displace}}', '{{reach.displace}}', '路標移開，再遠則消失'],
            ],
            num: [1, 2],
          },
        },
        {
          table: {
            head: ['地形', '尋找貨物（步）'],
            rows: [
              ['道路、陸地', '小於{{reach.goods}}'],
              ['沙地', '約{{reach.goodsSand}}'],
              ['山地', '約{{reach.goodsMountain}}'],
              ['雪地', '約{{reach.goodsSnow}}'],
            ],
            num: [1],
          },
        },
        {
          p: '偵察兵、士兵、英雄、[[job:hunter|獵人]]和[[job:druid|德魯伊]]不受範圍限制。',
        },
        {
          p: '工作地點或工作旗幟在範圍外的工人閒著，直到網路覆蓋那裡。手上的貨物還是會送回去。',
        },
        {
          h: '路標面板',
        },
        {
          table: {
            head: ['項目', '含義'],
            rows: [
              ['「網路中的貨物」', '整個相連網路範圍內的貨物：建築、貨堆、車輛、手上。每份只算一次。'],
              ['「路標：N」', '相連路標數，含當前路標'],
              ['「拆除」', '路標立即消失，無需確認，也不用偵察兵'],
              ['相鄰路標', '與被拆路標斷開連接'],
              ['網路', '被拆路標是唯一連接時，網路分裂'],
              ['新範圍外的工人', '狀態「迷路了」，站著不動，直到網路恢復'],
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
            '每段花1份[[good:stone|毛石]]和[[job:builder|建築工人]]敲1下，排在建築和木柵欄之後。',
            '工人還會把毛石鋪到最多6段相鄰路段上，前提是沒人正在去、那裡也沒有毛石。',
            '取消路段：已運到的毛石落在旁邊。',
            '建築升級壓到道路：道路消失，毛石不返還。',
            '居民尋路時，走道路更省就會自動走。',
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
              ['武器和護甲重量2-3，英雄除外', '+{{step.weightLowExtra}}秒'],
              ['武器和護甲重量4-5，英雄除外', '+{{step.weightHighExtra}}秒'],
              ['[[good:amulet_speed|疾風護符]]', '-{{step.amuletSaved}}秒'],
              ['埃及人', '-{{step.egyptSaved}}秒'],
              ['滿載[[good:handcart|手推車]]', '慢{{haul.handcartLossPct}}%'],
              ['滿載[[good:oxcart|牛車]]', '慢{{haul.oxcartLossPct}}%'],
            ],
            foot: '每步最快{{step.shortest}}秒。車輛減速隨載重增加。',
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
            head: ['貨艙', '裝1份用時'],
            rows: [
              ['手拿', '{{trade.handsSeconds}}秒'],
              ['[[good:handcart|手推車]]', '{{trade.handcartSeconds}}秒'],
              ['[[good:oxcart|牛車]]', '{{trade.oxcartSeconds}}秒'],
            ],
            num: [1],
            foot: '卸貨用時相同。容量和減速見[[article:hauling|搬運工與倉庫]]。',
          },
        },
        {
          p: '單程20-30步時，兩種車單位時間運量相同。更短用手推車，更遠用牛車。',
        },
        {
          h: '路線',
        },
        {
          list: [
            '路線包含{{trade.stops}}座已完工的建築。自家任何有庫存的建築都行，外方建築最多1座。',
            '建築升級時，[[job:trader|商人]]等到完工。',
            '商人不從民居拿食物。',
          ],
        },
        {
          h: '自家建築之間',
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
              ['聚落', '從整個聚落裝貨：先此倉庫，再其路標網路覆蓋的倉庫和工坊'],
            ],
            foot: 'A和B是路線上的兩座建築。「聚落」選項只對倉庫或大本營有效，且只能用於一個站點。最低庫存同樣限制裝貨。',
          },
        },
        {
          h: '與電腦貿易',
        },
        {
          list: [
            '外方建築屬於電腦玩家，已完工，且有地圖設定的提議。',
            '加入路線要求雙方態度都友好，每趟只看商人所屬民族一方：[[article:diplomacy|外交]]。',
            '提議是用N份一種貨物換M份另一種，數字由地圖決定。一條路線一次只做一個提議。電腦倉庫每{{trade.refillSeconds}}秒把提議貨物補回{{trade.refillLevel}}份。',
            '商人按貨艙能裝下的完整批次拿貨，並留出回程貨的位置。貨艙小時，一批分多趟運。',
            '交出一批，收取報酬，有貨就重複。建築裡沒有報酬時商人等待，不交貨。「保留 N」在建築裡留下N份待售貨物。回程上限N：建築有N份報酬時停止。',
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
