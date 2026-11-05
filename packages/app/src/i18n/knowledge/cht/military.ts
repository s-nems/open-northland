import type { ArticleGroup } from '../../../hud/knowledge/articles.js';

export const MILITARY: ArticleGroup = {
  group: '軍事',
  items: [
    {
      id: 'damage',
      name: '武器、護甲與傷害',
      lead: '人有{{health.human}}點生命值。表中是一次攻擊扣除的數值。',
      blocks: [
        {
          data: 'matrix',
        },
        {
          figure: {
            id: 'direction',
            caption: '攻擊方向',
          },
        },
        {
          h: '影響傷害的因素',
        },
        {
          table: {
            head: ['倍率', '數值'],
            rows: [
              ['[[article:exp-combat|該武器的經驗]]（僅近戰）', '最高×{{combat.fightCapFactor}}'],
              ['從後側攻擊', '×{{combat.backSideFactor}}'],
              ['從背後攻擊', '×{{combat.behindFactor}}'],
            ],
            foot: '從正面和前側攻擊不改變傷害。 力量、精準和防禦護符見[[article:draughts|飲品與護符]]。',
          },
        },
        {
          list: [
            '經驗對箭矢、石彈、載具和木柵欄無效。',
            '攻擊方向和防禦護符只對人起作用。箭矢的方向按射出的位置計算。',
            '投石機指揮官的護符不會加強石彈。',
            '木柵欄的傷害另算：[[article:walls|木柵欄與柵門]]。',
            '兒童不會受傷。',
          ],
        },
        {
          h: '民族差異',
        },
        {
          p: '表格按你在視窗頂部選中徽章的民族計算武器。拜占庭人那裡，[[good:spear_wooden|木矛]]這一行顯示的龍有{{dragon.hitpoints}}點生命值。',
        },
        {
          h: '護甲',
        },
        {
          data: 'armour',
        },
        {
          p: '重武器和護甲會拖慢步速：[[article:walking|步速]]。',
        },
      ],
      see: [
        'article:exp-combat',
        'article:aim',
        'article:walking',
        'good:spear_iron',
        'good:sword_long',
        'good:armor_chain',
        'good:armor_plate',
      ],
    },
    {
      id: 'equip',
      name: '士兵裝備',
      lead: '軍隊用助手視窗裡的計數器來武裝。單個居民的裝備在他自己的面板裡更換。',
      blocks: [
        {
          p: '軍隊計數器和兵營徵兵見[[article:assistant|助手]]。',
        },
        {
          h: '武器和護甲排序欄',
        },
        {
          p: '每個兵種有自己的排序欄。士兵從左起拿倉庫裡有的第一件，跳過劃掉的。一開始最強的裝備排在左邊。點擊可劃掉某件裝備，拖動可調整順序。',
        },
        {
          list: [
            '沒有武器時，士兵會等待，視窗顯示「人等待武器」。',
            '沒有護甲時，他不穿護甲就出發，之後只有你下令才會穿上。',
          ],
        },
        {
          h: '新兵訓練後',
        },
        {
          table: {
            head: ['兵營裡有', '新兵'],
            rows: [
              ['武器和護甲', '穿戴整齊出營'],
              ['只有武器或只有護甲', '拿上現有的，再去倉庫取另一樣'],
              ['都沒有', '先取武器，再取護甲'],
            ],
            foot: '範圍內的倉庫有排序欄上更好的物品時，新兵會去取它，而不拿兵營裡較差的。',
          },
        },
        {
          h: '兵營存放',
        },
        {
          table: {
            head: ['貨物', '數量'],
            rows: [
              [
                '各種武器、護甲、[[good:shoes|鞋子]]、[[good:mead|蜂蜜酒]]、各種藥水和護符',
                '{{barracks.gearStock}}',
              ],
              ['食物', '{{barracks.foodStock}}'],
              ['[[good:coin|金幣]]', '{{barracks.coinStock}}'],
            ],
            num: [1],
            foot: '你設為優先的貨物，兵營的搬運工會自己從倉庫運來：[[article:hauling|搬運工與倉庫]]。',
          },
        },
        {
          h: '手動更換',
        },
        {
          table: {
            head: ['對象', '可更換'],
            rows: [
              ['士兵', '武器、護甲、鞋子、裝備'],
              ['有職業的男性', '工具、鞋子、裝備'],
              ['英雄', '僅背包：[[article:heroes|英雄]]'],
              ['婦女、兒童', '無'],
            ],
          },
        },
        {
          list: [
            '換上新武器會立即改變士兵的兵種。卸下武器後，他就成為普通[[job:soldier_unarmed|士兵]]。',
            '用過的鞋子、工具和開過封的瓶子在更換和卸下時消失。沒用過的回到倉庫。',
            '武器、護甲和護符不會耗損，總會回到倉庫。',
          ],
        },
        {
          h: '誰能用更好的武器',
        },
        {
          p: '不管經驗多少，士兵都能拿倉庫裡的任何武器。限制在生產環節：[[good:spear_iron|鐵矛]]和[[good:sword_long|長劍]]只有有經驗的[[job:smith|鐵匠]]做得出，[[good:bow_long|長弓]]只有有經驗的[[job:armorer|武器匠]]做得出。需要多少經驗，寫在這幾種武器各自的卡片上。',
        },
      ],
      see: [
        'article:damage',
        'article:assistant',
        'article:exp-combat',
        'article:hauling',
        'building:barracks',
      ],
    },
    {
      id: 'aim',
      name: '命中與射擊',
      lead: '近戰只有在目標已經走出武器範圍時才會落空。弓手命中的次數越多，射得越準。',
      blocks: [
        {
          h: '遠程武器',
        },
        {
          table: {
            head: ['武器', '塔上射程', '接近目標至'],
            rows: [
              ['[[good:bow_short|短弓]]', '0-{{shortBow.towerMax}}', '{{shortBow.standoff}}'],
              ['[[good:bow_long|長弓]]', '0-{{longBow.towerMax}}', '{{longBow.standoff}}'],
              ['[[job:heroine_bow_xena|希拉]]', '-', '{{heroBow.standoff}}'],
            ],
            num: [1, 2],
            foot: '射程單位為格。普通射程和射擊間隔，包括獵人的弓和投石機，見[[article:damage|武器、護甲與傷害]]裡的表。目標近於射程下限時，弓手不射擊。',
          },
        },
        {
          h: '命中率',
        },
        {
          table: {
            head: ['命中次數', '射準的機率'],
            rows: [
              ['0', '{{aim.basePct}}%'],
              ['50', '{{aim.samplePct}}%'],
              ['{{aim.noSpreadHits}}+', '總是落在目標上'],
            ],
            num: [0, 1],
            foot: '每命中一次增加1%。命中{{aim.noSpreadHits}}次起，沒射準的箭也會落在目標上。短弓和長弓一起累計命中，[[article:catapult|投石機]]單獨累計，但用同一張表。英雄百發百中。',
          },
        },
        {
          h: '未命中箭矢的散佈',
        },
        {
          list: [
            '沒射準的箭落在目標附近：[[good:bow_short|短弓]]最多{{aim.spreadShort}}格，[[good:bow_long|長弓]]最多{{aim.spreadLong}}格，箭塔上的長弓最多{{aim.spreadTower}}格。距離越遠偏得越多。',
            '沒射準的箭可能傷到落點處的其他敵人。',
            '箭不會傷到己方、盟友和中立單位。',
            '弓手會對行走中的敵人提前瞄準，而建築射向敵人射擊瞬間所在的位置。',
          ],
        },
        {
          h: '箭塔職位',
        },
        {
          list: ['職位上的弓手打不到，敵人只能射擊箭塔。'],
        },
      ],
      see: ['article:exp-combat', 'article:defence', 'building:tower_00', 'building:tower_01'],
    },
    {
      id: 'stances',
      name: '姿態',
      lead: '姿態決定士兵是否主動找敵人，以及追多遠。新的士兵和英雄處於防禦姿態。',
      blocks: [
        {
          figure: {
            id: 'leash',
            caption: '追擊距離',
          },
        },
        {
          table: {
            head: ['姿態', '索敵位置', '半徑', '放棄條件', '受擊時'],
            rows: [
              ['進攻', '自身周圍', '{{stance.search}}', '目標死亡或無法到達', '衝向攻擊者'],
              [
                '防禦',
                '駐守點周圍',
                '{{stance.search}}',
                '目標離駐守點超過{{stance.defendLeash}}',
                '衝向攻擊者',
              ],
              [
                '無視',
                '僅武器範圍內，不接近',
                '武器範圍',
                '目標離駐守點超過{{stance.ignoreLeash}}',
                '留在原地',
              ],
            ],
            foot: '距離單位為格。駐守點是你更換姿態時士兵所站的位置。移動或攻擊命令會重新設定它。',
          },
        },
        {
          list: [
            '進攻姿態的士兵戰鬥結束時若離駐守點超過{{stance.attackReturn}}格，就返回駐守點。',
            '士兵在[[article:fog|迷霧]]中也能發現敵人。',
            '攻擊命令在任何姿態下都有效。',
            '職位上的弓手在任何姿態下都會射擊範圍內的所有目標。',
            '下達普通移動命令後，士兵即使挨打也繼續走。下達「沿途攻擊」命令後，他會和攻擊者交戰。',
          ],
        },
        {
          h: '攻擊優先順序',
        },
        {
          p: '士兵先打能還手的目標：士兵、英雄、投石機、箭塔和會射擊的建築。平民、其他建築和無武裝載具放到後面。',
        },
        {
          p: '士兵不會主動攻擊木柵欄和防禦牆：[[article:walls|木柵欄與柵門]]。',
        },
        {
          h: '誰會響應攻擊',
        },
        {
          table: {
            head: ['對象', '與傷者的距離', '做什麼'],
            rows: [
              ['進攻或防禦姿態的士兵和英雄', '{{stance.soldierAlarm}}', '衝向攻擊者'],
              ['無視姿態的士兵和英雄', '-', '只打武器範圍內的目標'],
              [
                '平民和偵察兵',
                '{{stance.peopleAlarm}}',
                '逃開{{stance.fleeMin}}-{{stance.fleeMax}}格後回去工作',
              ],
            ],
            num: [1],
            foot: '距離單位為格。只有人被攻擊才會驚動別人，建築或動物挨打不會。',
          },
        },
        {
          h: '平民',
        },
        {
          list: [
            '平民不戰鬥。只有士兵和英雄能設定姿態。',
            '平民不會一看見敵人就逃跑。',
            '平民逃跑時會扔下攜帶的貨物，搬運工會丟下推車。',
          ],
        },
        {
          h: '「進食與睡眠」開關',
        },
        {
          p: '設為「禁止」時，士兵不會自己去吃飯、睡覺或禱告，連隨身帶的和箭塔存糧裡的食物也不吃，飢餓也不會打斷長命令。沒有飲品的話，他最後會挨餓。下達進食命令或改回「允許」就能解決。',
        },
        {
          p: '飲品、護符以及進食、睡覺、禱告命令在兩種設定下都有效。命令選單裡這兩種設定叫「允許休息恢復」和「禁止休息恢復」。',
        },
        {
          h: '戰鬥附近的休息',
        },
        {
          table: {
            head: ['附近情況', '格數', '士兵'],
            rows: [
              ['戰鬥', '{{alert.restClearance}}以內', '不睡覺、不禱告、不交談'],
              ['視野內有敵人', '{{alert.standTo}}以內', '同上'],
            ],
            foot: '體力降到{{need.criticalPct}}%時才去吃飯。無視姿態下不適用。',
          },
        },
      ],
      see: ['article:defence', 'article:aim', 'article:fog', 'article:needs'],
    },
    {
      id: 'heroes',
      name: '英雄',
      lead: '英雄由地圖提供，不能訓練，也不能換職業。',
      blocks: [
        {
          table: {
            head: ['項目', '士兵', '英雄'],
            rows: [
              ['視野（格）', '{{vision.soldier}}', '{{vision.hero}}'],
              ['弓箭命中率', '隨命中次數上升', '百發百中'],
              ['戰鬥經驗', '增長', '只有任務允許時才增長'],
              ['吃飯和睡覺', '需要', '不需要'],
              ['武器、護甲、鞋子', '可更換，鞋子會磨損', '固定，鞋子不磨損'],
              ['裝備重量', '減速', '不減速'],
              ['住所和工作地點', '可以有', '沒有'],
              ['魔法箱子', '打不開', '能開啟'],
            ],
          },
        },
        {
          h: '英雄的武器',
        },
        {
          table: {
            head: ['英雄', '武器', '護甲'],
            rows: [
              ['[[job:hero_spear_siegfried|西格德]]', '矛', '[[good:armor_plate|板甲]]'],
              ['[[job:hero_sword_bjarni|比亞尼]]', '劍', '[[good:armor_chain|鎖甲]]'],
              ['[[job:hero_saber_hatschi|哈奇]]', '彎刀', '[[good:armor_chain|鎖甲]]'],
              ['[[job:heroine_bow_xena|希拉]]', '弓', '[[good:armor_leather|皮甲]]'],
            ],
            foot: '射程、攻擊間隔和傷害見[[article:damage|武器、護甲與傷害]]裡的表，打開「英雄」即可。其他民族的英雄打法略有不同：在視窗頂部選擇該民族的徽章。',
          },
        },
        {
          h: '背包',
        },
        {
          list: [
            '英雄的背包只能裝：[[good:amulet_strength|力量護符]]、[[good:amulet_defense|防禦護符]]、[[good:amulet_crithit|精準護符]]、[[good:amulet_speed|疾風護符]]、[[good:potion_heal_small|小型治療藥水]]、[[good:potion_heal_big|大型治療藥水]]。',
          ],
        },
      ],
      see: ['article:damage', 'article:chests', 'article:fog', 'article:exp-combat'],
    },
    {
      id: 'defence',
      name: '箭塔與防禦模式',
      lead: '防禦模式下建築會自行向敵人射擊。裡面每多躲一個人，每秒多射{{shelter.shotsPerSeat}}箭。',
      blocks: [
        {
          h: '防禦模式',
        },
        {
          list: [
            '「啟動防禦模式」作用於一座建築，「全城」作用於所有防禦建築。',
            '防禦模式由你開啟。聚落挨打不會自動開啟。',
            '防禦模式不會自己解除，會一直持續到你點「解除防禦模式」或建築被摧毀。',
          ],
        },
        {
          h: '誰去避難',
        },
        {
          list: [
            '平民、婦女和兒童跑向最近、走得到的有空位的建築。',
            '士兵、英雄和[[job:scout|偵察兵]]留在外面。',
            '找不到位置的人繼續工作。',
            '防禦模式一開，居民就會中斷吃飯和睡覺。躲在裡面不工作，只吃隨身帶的。',
            '躲進去的居民不會受到攻擊。',
            '建築被摧毀時，躲在裡面的人會出來。',
          ],
        },
        {
          h: '防禦建築',
        },
        {
          table: {
            head: ['建築', '名額', '每秒箭數'],
            rows: [
              ['[[building:headquarters|大本營]]', '{{shelter.hq}}', '{{shelter.hqShots}}'],
              ['[[building:tower_01|二級箭塔]]', '{{shelter.tower2}}', '{{shelter.tower2Shots}}'],
              ['[[building:tower_00|一級箭塔]]', '{{shelter.tower1}}', '{{shelter.tower1Shots}}'],
              ['[[building:barracks|兵營]]', '{{shelter.barracks}}', '{{shelter.barracksShots}}'],
            ],
            num: [1, 2],
            foot: '每秒箭數按建築住滿計算。弓手職位見箭塔卡片，不佔避難名額。箭塔裡雇用的弓手自己射擊，無需防禦模式：[[article:aim|命中與射擊]]。',
          },
        },
        {
          h: '建築射出的箭',
        },
        {
          p: '一支箭造成多少傷害，見[[article:damage|武器、護甲與傷害]]表中「建築射出的箭」這一行。',
        },
        {
          list: [
            '建築從最近的牆起射程{{shelter.range}}格，連牆腳下的敵人也打得到。',
            '建築也會射擊迷霧中的敵人。',
            '箭不耗材料，也不給經驗。',
            '建築先射士兵和英雄，平民排在最後。',
          ],
        },
        {
          h: '箭塔駐軍',
        },
        {
          table: {
            head: ['箭塔', '蜂蜜酒', '食物', '每種武器'],
            rows: [
              ['[[building:tower_00|一級箭塔]]', '{{tower1.mead}}', '{{tower1.food}}', '{{tower1.weapon}}'],
              ['[[building:tower_01|二級箭塔]]', '{{tower2.mead}}', '{{tower2.food}}', '{{tower2.weapon}}'],
            ],
            num: [1, 2, 3],
            foot: '職位和搬運工名額見箭塔卡片。',
          },
        },
        {
          list: [
            '只有對應的弓手才能就職：[[job:soldier_bow_short|短弓手]]或[[job:soldier_bow_long|長弓手]]。指派方式與工作地點相同。',
            '弓手拿了別的武器就失去職位。',
            '駐軍吃箭塔的存糧，在職位上睡覺。存糧吃完了才下塔找吃的。',
            '助手不會把弓手調離箭塔，換新裝備也不會。',
            '「撤出駐軍」會讓弓手離開箭塔並選中他們，方便你馬上下命令。移動命令也能讓弓手離崗。',
          ],
        },
      ],
      see: [
        'article:aim',
        'article:stances',
        'building:tower_00',
        'building:tower_01',
        'building:headquarters',
        'building:barracks',
        'article:equip',
      ],
    },
    {
      id: 'walls',
      name: '木柵欄與柵門',
      lead: '「建築」列的傷害每滿{{wall.damagePerPoint}}點，木柵欄掉1點生命值。較弱的攻擊對它無效。',
      blocks: [
        {
          table: {
            head: ['部件', '生命值', '每擊修復', '成本'],
            rows: [
              ['木柵欄段', '{{wall.segmentHp}}', '{{wall.segmentRepair}}', '1份[[good:wood|木材]]'],
              ['柵門', '{{wall.gateHp}}', '{{wall.gateRepair}}', '免費，由柵欄段改建'],
            ],
            num: [1, 2],
            foot: '修理不花材料。一段柵欄同時只能由一名建築工人修理。',
          },
        },
        {
          h: '建造柵門',
        },
        {
          list: [
            '柵門佔用連成直線的{{wall.gateSegments}}段自家已完工柵欄。每段至少要有{{wall.gateMinHealthPct}}%生命值，位於平地，通道內不能有人。',
            '柵門立即建成，處於關閉狀態，生命值是滿的，即使原來的柵欄段受過損。',
          ],
        },
        {
          h: '柵門模式',
        },
        {
          table: {
            head: ['模式', '效果'],
            rows: [
              ['開啟', '誰都能過，包括敵人'],
              ['關閉', '誰也過不去，包括自己人'],
              ['自動', '保持開啟。敵人走近到{{wall.gateEnemyNear}}格內時關閉，敵人離開後再開啟'],
            ],
            foot: '與你交戰的玩家的任何人或載具都會讓柵門關閉，平民也算。動物不會。',
          },
        },
        {
          list: ['通道內沒人時柵門才關閉。'],
        },
        {
          h: '木柵欄多快倒下',
        },
        {
          table: {
            head: ['武器', '每擊生命值', '擊數：柵欄段', '擊數：柵門', '用時：柵欄段'],
            rows: [
              [
                '[[building:catapult|投石機]]',
                '{{wall.catapult.blow}}',
                '{{wall.catapult.segmentHits}}',
                '{{wall.catapult.gateHits}}',
                '{{wall.catapult.segmentSeconds}}秒',
              ],
              [
                '英雄近戰',
                '{{wall.hero.blow}}',
                '{{wall.hero.segmentHits}}',
                '{{wall.hero.gateHits}}',
                '{{wall.hero.segmentSeconds}}秒',
              ],
              [
                '[[good:spear_iron|鐵矛]]',
                '{{wall.ironSpear.blow}}',
                '{{wall.ironSpear.segmentHits}}',
                '{{wall.ironSpear.gateHits}}',
                '{{wall.ironSpear.segmentSeconds}}秒',
              ],
              [
                '[[good:sword_long|長劍]]',
                '{{wall.longSword.blow}}',
                '{{wall.longSword.segmentHits}}',
                '{{wall.longSword.gateHits}}',
                '{{wall.longSword.segmentSeconds}}秒',
              ],
              [
                '[[good:sword_shord|短劍]]',
                '{{wall.shortSword.blow}}',
                '{{wall.shortSword.segmentHits}}',
                '{{wall.shortSword.gateHits}}',
                '{{wall.shortSword.segmentSeconds}}秒',
              ],
              [
                '[[good:spear_wooden|木矛]]',
                '{{wall.woodenSpear.blow}}',
                '{{wall.woodenSpear.segmentHits}}',
                '{{wall.woodenSpear.gateHits}}',
                '{{wall.woodenSpear.segmentSeconds}}秒',
              ],
              [
                '[[good:bow_short|短弓]]',
                '{{wall.shortBow.blow}}',
                '{{wall.shortBow.segmentHits}}',
                '{{wall.shortBow.gateHits}}',
                '{{wall.shortBow.segmentSeconds}}秒',
              ],
              [
                '[[good:bow_long|長弓]]',
                '{{wall.longBow.blow}}',
                '{{wall.longBow.segmentHits}}',
                '{{wall.longBow.gateHits}}',
                '{{wall.longBow.segmentSeconds}}秒',
              ],
              ['拳頭、建築射出的箭', '0', '-', '-', '-'],
            ],
            num: [1, 2, 3, 4],
            foot: '用時按一名士兵計算。希拉打掉{{wall.heroBow.blow}}點，法蘭克人的希拉{{wall.frankHeroBow.blow}}點。',
          },
        },
        {
          list: [
            '戰鬥經驗不會加強對木柵欄的攻擊。',
            '力量護符會加強攻擊：{{wall.ironSpear.blow}}變{{wall.ironSpear.strongBlow}}，{{wall.shortSword.blow}}變{{wall.shortSword.strongBlow}}，{{wall.shortBow.blow}}還是{{wall.shortBow.strongBlow}}。',
            '士兵不會主動攻擊木柵欄。只有下令或柵欄擋住去敵人的路時才會砍。',
            '一段柵欄倒下後，士兵會穿過缺口，不再砍旁邊的柵欄。',
          ],
        },
        {
          h: '防禦牆',
        },
        {
          p: '[[building:work_pottery_02|防禦牆]]是普通建築，傷害看「建築」列。士兵把它當木柵欄對待。',
        },
      ],
      see: [
        'article:damage',
        'article:catapult',
        'article:construction',
        'building:work_pottery_02',
        'good:wood',
      ],
    },
    {
      id: 'catapult',
      name: '投石機',
      lead: '石彈傷及落點和周圍六格內的一切，你自己的人也不例外。',
      blocks: [
        {
          figure: {
            id: 'catapult-splash',
            caption: '石彈落點',
          },
        },
        {
          p: '投石機由1名士兵或英雄指揮，拿什麼武器都行。沒有指揮官就不能移動也不能射擊。石彈不耗材料。生命值、射程、射擊間隔和造價見[[building:catapult|投石機]]卡片。',
        },
        {
          h: '石彈',
        },
        {
          p: '石彈對人、載具和建築的傷害，見[[article:damage|武器、護甲與傷害]]表中投石機這一行。木柵欄另算：[[article:walls|木柵欄與柵門]]。',
        },
        {
          table: {
            head: ['建築', '生命值', '石彈數', '用時'],
            rows: [
              [
                '[[building:tower_00|一級箭塔]]',
                '{{hp.tower1}}',
                '{{stone.tower1}}',
                '{{stone.tower1Seconds}}秒',
              ],
              [
                '[[building:tower_01|二級箭塔]]',
                '{{hp.tower2}}',
                '{{stone.tower2}}',
                '{{stone.tower2Seconds}}秒',
              ],
              [
                '[[building:headquarters|大本營]]，維京人',
                '{{hp.hq}}',
                '{{stone.hq}}',
                '{{stone.hqSeconds}}秒',
              ],
            ],
            num: [1, 2, 3],
            foot: '法蘭克人大本營：{{hp.frankHq}}點生命值，{{stone.frankHq}}發石彈，{{stone.frankHqSeconds}}秒。',
          },
        },
        {
          h: '誰會被砸中',
        },
        {
          table: {
            head: ['石彈下方', '石彈'],
            rows: [
              ['敵人', '受傷'],
              ['己方人員、載具、建築、木柵欄', '受傷'],
              ['中立方和盟友', '受傷，不影響態度'],
              ['在大廳設定為和平的玩家', '避開'],
              ['兒童', '避開'],
              ['建築內的人', '避開'],
              ['樹木', '砸倒'],
            ],
          },
        },
        {
          h: '命中率',
        },
        {
          p: '命中率增長與弓手相同：[[article:aim|命中與射擊]]。在{{catapult.max}}格處，未命中的石彈偏離目標：0次命中時最多{{stone.spread.0}}格，25次{{stone.spread.25}}格，50次{{stone.spread.50}}格。命中{{aim.noSpreadHits}}次起落在目標上。命中次數歸指揮官：每發造成損傷的石彈都算，打建築也算，但即使打中多個目標也只算一次。',
        },
        {
          h: '投石機的姿態',
        },
        {
          table: {
            head: ['姿態', '索敵位置', '半徑', '是否移動'],
            rows: [
              ['進攻', '自身周圍', '{{catapult.searchRadius}}', '是'],
              ['防禦', '駐守位置周圍', '{{catapult.searchRadius}}', '是，離駐守位置最多{{catapult.leash}}'],
              ['無視', '駐守位置周圍', '{{catapult.min}}-{{catapult.max}}', '否'],
            ],
            foot: '新投石機為無視姿態。它只會主動攻擊看得見的目標。攻擊命令在任何姿態下都有效。',
          },
        },
        {
          list: [
            '目標近於{{catapult.min}}格時，投石機後撤。目標遠於{{catapult.max}}格時，它會開到{{catapult.bandMin}}-{{catapult.max}}格處。',
            '只在靜止且不與其他載具接觸時射擊。',
            '可以命令它射擊地面上的任意位置。只有下令它才會打木柵欄。',
          ],
        },
        {
          h: '什麼能摧毀投石機',
        },
        {
          table: {
            head: ['武器', '傷害', '摧毀所需命中數'],
            rows: [
              ['另一臺投石機', '{{stone.vehicle}}', '{{stone.vehicleKills}}'],
              [
                '矛、[[good:sword_long|長劍]]、[[good:bow_long|長弓]]',
                '{{vs.catapult.spear}}',
                '{{vs.catapult.spearHits}}',
              ],
              [
                '[[good:sword_shord|短劍]]、[[good:bow_short|短弓]]',
                '{{vs.catapult.shortSword}}',
                '{{vs.catapult.shortSwordHits}}',
              ],
              ['拳頭', '{{vs.catapult.fist}}', '{{vs.catapult.fistHits}}'],
              ['建築射出的箭', '{{arrow.vehicle}}', '{{vs.catapult.arrowHits}}'],
            ],
            num: [1, 2],
            foot: '經驗對載具無效，攻擊者的護符有效。',
          },
        },
      ],
      see: ['article:vehicles', 'article:walls', 'article:aim', 'article:exp-combat', 'building:catapult'],
    },
  ],
};
