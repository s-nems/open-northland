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
              ['攻擊者的[[good:amulet_strength|力量護符]]', '×{{amulet.strengthFactor}}'],
              [
                '攻擊者的[[good:amulet_crithit|精準護符]]',
                '{{amulet.critChancePct}}%機率×{{amulet.critFactor}}',
              ],
              ['目標的[[good:amulet_defense|防禦護符]]', '×{{amulet.defenseFactor}}'],
            ],
            foot: '從正面和前側攻擊不改變傷害。',
          },
        },
        {
          list: [
            '經驗對箭矢、石彈、載具和木柵欄無效。',
            '方向和防禦護符只對人有效。箭矢的方向從發射點算起。',
            '指揮官的護符對投石機的石彈無效。',
            '木柵欄的傷害另算：[[article:walls|木柵欄與柵門]]。',
            '0傷害的攻擊不傷人，也不給經驗。',
            '兒童不會受傷。',
          ],
        },
        {
          h: '民族差異',
        },
        {
          list: [
            '撒拉遜人：[[good:bow_short|短弓]]對布甲{{saracen.bowOnWool}}（他族{{viking.bowOnWool}}），對鎖甲和板甲{{saracen.bowOnChain}}（他族{{viking.bowOnChain}}）。',
            '拜占庭人：地圖上的龍用自己的[[good:spear_wooden|木矛]]戰鬥：{{dragon.hitpoints}}點生命值，射程{{dragon.min}}-{{dragon.max}}，每{{dragon.seconds}}秒{{dragon.blows}}擊，對無甲{{dragon.bare}}傷害。表中這一行顯示的是它。訓練出的矛兵與其他民族相同。',
            '其餘武器所有民族相同。',
          ],
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
      lead: '軍隊用助手視窗的計數器武裝。單個人在他的面板裡更換。',
      blocks: [
        {
          h: '計數器',
        },
        {
          table: {
            head: ['計數器', '作用', '何時減少'],
            rows: [
              ['「徒手士兵」', '在兵營訓練，不發武器', '訓練完成後'],
              ['「劍兵」「矛兵」「弓手」', '先武裝徒手士兵，再訓練新兵', '士兵拿到武器時'],
            ],
            foot: '派誰去兵營：[[article:assistant|助手]]。',
          },
        },
        {
          list: [
            '只要有徒手士兵在等，計數器就不會訓練新兵，哪怕暫時沒有武器。',
            '範圍內有這種武器且沒有別人在等時，徒手士兵才去拿。',
            '調低計數器後，等武器的人不再等待。',
          ],
        },
        {
          h: '武器和護甲排序欄',
        },
        {
          p: '每個兵種有自己的排序欄。士兵從左起拿倉庫裡有的第一件，跳過劃掉的。初始時最強的在左邊。點擊劃掉，按住拖動改變順序。',
        },
        {
          list: [
            '無武器可拿：等待，視窗顯示「人等待武器」。',
            '無護甲可拿：不穿護甲出發。之後只有下令才會穿。',
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
              ['只有其中一樣', '拿上再去取另一樣'],
              ['都沒有', '先取武器，再取護甲'],
            ],
            foot: '倉庫範圍內有排序欄上更好的物品時，新兵去取，不拿兵營裡較差的，然後回到兵營門前。由計數器武裝的士兵也一樣。',
          },
        },
        {
          h: '兵營存放',
        },
        {
          table: {
            head: ['貨物', '份數'],
            rows: [
              [
                '各種武器、護甲、[[good:shoes|鞋子]]、[[good:mead|蜂蜜酒]]、各種藥水和護符',
                '{{barracks.gearStock}}',
              ],
              ['食物', '{{barracks.foodStock}}'],
              ['[[good:coin|金幣]]', '{{barracks.coinStock}}'],
            ],
            num: [1],
            foot: '兵營有{{barracks.carriers}}個搬運工職位。標記為優先的貨物由他們從倉庫運來：[[article:hauling|搬運工與倉庫]]。',
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
            '居民去取東西，再回到接令的地方。',
            '哪裡都找不到就空手而歸。',
            '武器立即改變士兵的兵種。卸下武器後成為[[job:soldier_unarmed|士兵]]。',
            '用過的鞋子、工具和開過封的瓶子在更換和卸下時消失。沒用過的回到倉庫。',
            '武器、護甲和護符不耗損，會回到倉庫。',
            '對單人下的命令優先於助手。',
          ],
        },
        {
          h: '誰能用更好的武器',
        },
        {
          p: '任何士兵都能拿倉庫裡的任何武器，命中次數不限制這一點。限制在生產環節：[[good:spear_iron|鐵矛]]和[[good:sword_long|長劍]]要有經驗的[[job:smith|鐵匠]]，[[good:bow_long|長弓]]要有經驗的[[job:armorer|武器匠]]。數值表：[[article:exp-combat|戰鬥經驗]]。',
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
      lead: '近戰只有在出手瞬間目標超出武器範圍時才落空。弓手的命中率隨弓的命中次數上升。',
      blocks: [
        {
          h: '遠程武器',
        },
        {
          table: {
            head: ['武器', '射程', '塔上射程', '接近到', '射擊間隔'],
            rows: [
              [
                '[[good:bow_short|短弓]]',
                '{{shortBow.min}}-{{shortBow.max}}',
                '0-{{shortBow.towerMax}}',
                '{{shortBow.standoff}}',
                '{{shortBow.seconds}}秒',
              ],
              [
                '[[good:bow_long|長弓]]',
                '{{longBow.min}}-{{longBow.max}}',
                '0-{{longBow.towerMax}}',
                '{{longBow.standoff}}',
                '{{longBow.seconds}}秒',
              ],
              [
                '[[job:hunter|獵人]]',
                '{{hunterBow.min}}-{{hunterBow.max}}',
                '-',
                '-',
                '{{hunterBow.seconds}}秒',
              ],
              [
                '[[job:heroine_bow_xena|希拉]]',
                '{{heroBow.min}}-{{heroBow.max}}',
                '-',
                '{{heroBow.standoff}}',
                '{{heroBow.seconds}}秒',
              ],
              [
                '[[building:catapult|投石機]]',
                '{{catapult.min}}-{{catapult.max}}',
                '-',
                '{{catapult.bandMin}}-{{catapult.max}}',
                '{{catapult.seconds}}秒',
              ],
            ],
            num: [1, 2, 3, 4],
            foot: '射程單位為格。目標比射程下限更近時弓手不射擊。「接近到」是弓手自己走向目標時開始射擊的距離。',
          },
        },
        {
          h: '命中率',
        },
        {
          table: {
            head: ['命中次數', '命中率'],
            rows: [
              ['0', '{{aim.basePct}}%'],
              ['50', '{{aim.samplePct}}%'],
              ['{{aim.noSpreadHits}}+', '總是落在目標上'],
            ],
            num: [0, 1],
            foot: '每命中一次+1%。命中{{aim.noSpreadHits}}次起，沒射準的箭也會落在目標上。短弓和長弓共用命中計數，[[article:catapult|投石機]]單獨計數，數值表相同。英雄百發百中。',
          },
        },
        {
          h: '未命中箭矢的散佈',
        },
        {
          list: [
            '沒射準的箭落在目標附近：[[good:bow_short|短弓]]最多{{aim.spreadShort}}格，[[good:bow_long|長弓]]最多{{aim.spreadLong}}格，箭塔上的長弓最多{{aim.spreadTower}}格。距離越遠偏得越多。',
            '沒射準的箭打中落點的第一個敵人：先是人、動物或載具，然後是建築，最後是木柵欄。',
            '箭會飛過己方、盟友和中立單位。',
            '弓手會對行走中的敵人提前瞄準。建築射向敵人當前的位置。',
          ],
        },
        {
          h: '箭塔職位',
        },
        {
          list: [
            '弓手站在職位上才有更遠的射程，走向職位途中沒有。',
            '敵人不能射擊職位上的弓手，只能射擊箭塔。',
          ],
        },
      ],
      see: ['article:exp-combat', 'article:defence', 'building:tower_00', 'building:tower_01'],
    },
    {
      id: 'stances',
      name: '姿態',
      lead: '姿態決定士兵是否主動找敵人，以及追多遠。士兵和英雄初始為防禦姿態。',
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
              ['進攻', '自身周圍', '{{stance.search}}', '目標倒下或無法到達', '衝向攻擊者'],
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
            foot: '半徑單位為格。駐守點是士兵更換姿態時所站的位置。移動或攻擊命令後換到新位置。',
          },
        },
        {
          list: [
            '進攻姿態的士兵戰鬥結束時若離駐守點超過{{stance.attackReturn}}格，就返回駐守點。',
            '士兵在[[article:fog|迷霧]]中也能找到敵人。',
            '攻擊命令在任何姿態下都有效。',
            '職位上的弓手在任何姿態下都射擊範圍內的目標。',
            '普通移動命令後士兵繼續走，挨打也不停。「沿途攻擊」命令下他會轉身迎敵。',
          ],
        },
        {
          h: '攻擊優先順序',
        },
        {
          steps: ['士兵、英雄、投石機、箭塔和會射擊的建築。', '其餘目標：平民、其他建築、無武裝載具。'],
        },
        {
          p: '士兵不會主動選擇木柵欄和防禦牆：[[article:walls|木柵欄與柵門]]。',
        },
        {
          h: '誰會響應攻擊',
        },
        {
          table: {
            head: ['對象', '距傷者（格）', '反應'],
            rows: [
              ['進攻或防禦姿態的士兵和英雄', '{{stance.soldierAlarm}}', '衝向攻擊者'],
              ['無視姿態的士兵和英雄', '-', '只打武器範圍內的目標'],
              [
                '平民和偵察兵',
                '{{stance.peopleAlarm}}',
                '逃開{{stance.fleeMin}}-{{stance.fleeMax}}格後回去工作',
              ],
              ['建築內的人', '-', '不反應，職位上的弓手除外'],
              ['露天睡覺的平民', '-', '繼續睡，被打才逃'],
            ],
            num: [1],
            foot: '只有人被攻擊才算。建築或動物挨打不會驚動任何人。',
          },
        },
        {
          h: '平民',
        },
        {
          list: [
            '平民不戰鬥。只有士兵和英雄能設定姿態。',
            '平民看見敵人不會動。',
            '逃跑時扔下攜帶的貨物。搬運工丟下推車。',
          ],
        },
        {
          h: '「進食與睡眠」開關',
        },
        {
          p: '「禁止」時，士兵不會自己去吃飯、睡覺或禱告，不吃手上或箭塔存糧裡的食物，飢餓也不打斷長命令。沒有飲品就會餓死。下達進食命令或改回「允許」可救。',
        },
        {
          p: '飲品、護符以及進食、睡覺、禱告命令在兩種狀態下都有效。命令選單裡這兩種狀態叫「允許休息恢復」和「禁止休息恢復」。只有士兵有這個開關，預設「允許」，換職業後恢復「允許」。',
        },
        {
          h: '戒備中',
        },
        {
          p: '這是進攻或防禦姿態的士兵靠近戰鬥時的狀態，不是玩家開啟的[[article:defence|聚落防禦模式]]。',
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
              ['戰鬥經驗', '增長', '不增長，除非任務允許'],
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
            head: ['英雄', '武器', '護甲', '範圍'],
            rows: [
              [
                '[[job:hero_spear_siegfried|西格德]]',
                '矛',
                '[[good:armor_plate|板甲]]',
                '{{hero.spearMin}}-{{hero.spearMax}}',
              ],
              ['[[job:hero_sword_bjarni|比亞尼]]', '劍', '[[good:armor_chain|鎖甲]]', '{{hero.swordReach}}'],
              ['[[job:hero_saber_hatschi|哈奇]]', '彎刀', '[[good:armor_chain|鎖甲]]', '{{hero.saberReach}}'],
              [
                '[[job:heroine_bow_xena|希拉]]',
                '弓',
                '[[good:armor_leather|皮甲]]',
                '{{heroBow.min}}-{{heroBow.max}}',
              ],
            ],
            num: [3],
            foot: '每{{hero.blowSeconds}}秒攻擊一次。傷害：在[[article:damage|武器、護甲與傷害]]的表裡打開「英雄」。',
          },
        },
        {
          h: '民族差異',
        },
        {
          table: {
            head: ['英雄', '民族', '差異'],
            rows: [
              ['西格德', '埃及人', '對鎖甲{{hero.sigurdEgyptChain}}'],
              ['哈奇', '撒拉遜人', '每{{hero.hatchieSaracenSeconds}}秒{{hero.hatchieSaracenBlows}}擊'],
              [
                '希拉',
                '法蘭克人',
                '射程{{frankHeroBow.min}}-{{frankHeroBow.max}}，每{{frankHeroBow.seconds}}秒一箭，對無甲{{hero.frankBowBare}}，對布甲和皮甲{{hero.frankBowWool}}，對鎖甲和板甲{{hero.frankBowChain}}，對建築和載具{{hero.frankBowVehicle}}',
              ],
            ],
          },
        },
        {
          h: '背包',
        },
        {
          list: [
            '只能裝：[[good:amulet_strength|力量護符]]、[[good:amulet_defense|防禦護符]]、[[good:amulet_crithit|精準護符]]、[[good:amulet_speed|疾風護符]]、[[good:potion_heal_small|小型治療藥水]]、[[good:potion_heal_big|大型治療藥水]]。',
          ],
        },
        {
          h: '死亡之後',
        },
        {
          p: '武器消失。護甲、鞋子和背包裡未用的物品留在地上。',
        },
      ],
      see: ['article:damage', 'article:chests', 'article:fog', 'article:exp-combat'],
    },
    {
      id: 'defence',
      name: '箭塔與防禦模式',
      lead: '防禦模式下建築自行射擊。裡面每個人每秒增加{{shelter.shotsPerSeat}}箭。',
      blocks: [
        {
          h: '防禦模式',
        },
        {
          list: [
            '「啟動防禦模式」作用於一座建築，「全城」作用於所有防禦建築。',
            '防禦模式由你開啟。聚落挨打不會自動開啟。',
            '在建建築不能開啟。',
            '防禦模式不會自己解除，持續到「解除防禦模式」或建築被摧毀。',
          ],
        },
        {
          h: '誰去避難',
        },
        {
          list: [
            '平民、婦女和兒童跑向最近有空位的建築。建築必須在步行範圍內。',
            '士兵、英雄和[[job:scout|偵察兵]]留在外面。',
            '找不到位置的人繼續工作。',
            '防禦模式一開，居民就丟下吃飯和睡覺。躲在裡面不工作，只吃隨身帶的。',
            '躲藏者不會受到攻擊。',
            '建築被摧毀時，躲藏者回到外面。',
          ],
        },
        {
          h: '防禦建築',
        },
        {
          table: {
            head: ['建築', '名額', '每秒箭數', '職位'],
            rows: [
              ['[[building:headquarters|大本營]]', '{{shelter.hq}}', '{{shelter.hqShots}}', '-'],
              [
                '[[building:tower_01|二級箭塔]]',
                '{{shelter.tower2}}',
                '{{shelter.tower2Shots}}',
                '短弓{{tower2.posts}}個，長弓{{tower2.longPosts}}個',
              ],
              [
                '[[building:tower_00|一級箭塔]]',
                '{{shelter.tower1}}',
                '{{shelter.tower1Shots}}',
                '短弓{{tower1.posts}}個，長弓{{tower1.longPosts}}個',
              ],
              ['[[building:barracks|兵營]]', '{{shelter.barracks}}', '{{shelter.barracksShots}}', '-'],
            ],
            num: [1, 2],
            foot: '每秒箭數按建築滿員計算。職位不佔建築名額。箭塔裡任職的弓手自己射擊，無需防禦模式：[[article:aim|命中與射擊]]。',
          },
        },
        {
          h: '建築射出的箭',
        },
        {
          table: {
            head: ['目標', '箭矢'],
            rows: [
              ['無甲', '{{arrow.bare}}'],
              ['布甲', '{{arrow.wool}}'],
              ['皮甲', '{{arrow.leather}}'],
              ['鎖甲、板甲', '{{arrow.chain}}'],
              ['載具', '{{arrow.vehicle}}'],
              ['建築', '{{arrow.building}}'],
            ],
            num: [1],
            foot: '所有民族相同。攻擊方向和防禦護符可以改變這個數值：[[article:damage|武器、護甲與傷害]]。',
          },
        },
        {
          list: [
            '建築從最近的牆起射程{{shelter.range}}格，連牆腳下的敵人也打得到。',
            '建築也會射擊迷霧中的敵人。',
            '箭不耗材料，也不給經驗。',
            '目標順序：士兵和英雄、野獸、建築、其他人。',
          ],
        },
        {
          h: '箭塔駐軍',
        },
        {
          table: {
            head: ['箭塔', '搬運工職位', '蜂蜜酒', '食物', '武器，每種份數'],
            rows: [
              [
                '[[building:tower_00|一級箭塔]]',
                '{{tower1.carriers}}',
                '{{tower1.mead}}',
                '{{tower1.food}}',
                '{{tower1.weapon}}',
              ],
              [
                '[[building:tower_01|二級箭塔]]',
                '{{tower2.carriers}}',
                '{{tower2.mead}}',
                '{{tower2.food}}',
                '{{tower2.weapon}}',
              ],
            ],
            num: [1, 2, 3, 4],
          },
        },
        {
          list: [
            '職位只接受自己的弓手：[[job:soldier_bow_short|短弓手]]或[[job:soldier_bow_long|長弓手]]。指派方式與工作地點相同。',
            '弓手拿了別的武器就失去職位。',
            '駐軍吃箭塔存糧，在職位上睡覺，不下塔。存糧空了才去找吃的。',
            '助手不會把弓手調離箭塔，發裝備也不會。',
            '「撤出駐軍」：弓手離開箭塔並保持選中，等待下一條命令。移動命令也能讓弓手離崗。',
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
            foot: '修理不花材料。一段木柵欄同時只有一名建築工人修理。',
          },
        },
        {
          h: '建造柵門',
        },
        {
          figure: {
            id: 'gate',
            caption: '柵門建在哪裡',
          },
        },
        {
          list: [
            '柵門佔用連成直線的{{wall.gateSegments}}段自家已完工柵欄。每段至少要有{{wall.gateMinHealthPct}}%生命值，位於平地，通道內不能有人。',
            '柵門立即建成，處於關閉狀態。生命值全滿，受損的柵欄段上也一樣。',
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
              ['自動', '保持開啟。敵人進入柵門{{wall.gateEnemyNear}}格內時關閉，之後再開啟'],
            ],
            foot: '與你交戰的玩家的任何人或載具都會讓柵門關閉，平民也算。動物不會。',
          },
        },
        {
          list: ['通道內沒人時柵門才關閉。', '電腦把自己的柵門設為自動模式。'],
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
            '戰鬥經驗不增加對木柵欄的傷害。',
            '力量護符提高這個數字：{{wall.ironSpear.blow}}變{{wall.ironSpear.strongBlow}}，{{wall.shortSword.blow}}變{{wall.shortSword.strongBlow}}，{{wall.shortBow.blow}}還是{{wall.shortBow.strongBlow}}。',
            '士兵不會主動選擇木柵欄。只有下令或柵欄擋住去敵人的路時才會砍。',
            '一段倒下後，士兵穿過缺口，不再砍旁邊的柵欄。',
          ],
        },
        {
          h: '防禦牆',
        },
        {
          p: '[[building:work_pottery_02|防禦牆]]是普通建築：{{wall.defenceHp}}點生命值，傷害看「建築」列。士兵把它當木柵欄對待。',
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
          table: {
            head: ['項目', '數值'],
            rows: [
              ['射程', '{{catapult.min}}-{{catapult.max}}格'],
              ['射擊間隔', '{{catapult.seconds}}秒'],
              ['生命值', '{{catapult.hitpoints}}'],
              ['乘員', '1名士兵或英雄，武器不限'],
              [
                '成本',
                '[[building:catapult|投石機]]：[[good:wood|木材]]{{catapult.wood}}份，[[good:iron|鐵礦]]{{catapult.iron}}份',
              ],
            ],
            foot: '沒有指揮官的投石機不能移動也不能射擊。石彈不耗材料。',
          },
        },
        {
          h: '石彈',
        },
        {
          table: {
            head: ['目標', '傷害', '摧毀所需石彈'],
            rows: [
              ['無甲', '{{stone.bare}}', '{{stone.bareKills}}'],
              ['皮甲', '{{stone.leather}}', '{{stone.leatherKills}}'],
              ['布甲', '{{stone.wool}}', '{{stone.woolKills}}'],
              ['鎖甲、板甲', '{{stone.chain}}', '{{stone.chainKills}}'],
              ['投石機', '{{stone.vehicle}}', '{{stone.vehicleKills}}'],
              ['建築', '{{stone.building}}', '{{stone.tower1}}-{{stone.frankHq}}'],
            ],
            num: [2],
            foot: '對正面的人造成的傷害，不含護符。木柵欄見[[article:walls|木柵欄與柵門]]。',
          },
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
          p: '命中率增長與弓手相同：[[article:aim|命中與射擊]]。在{{catapult.max}}格處，未命中的石彈偏離目標：0次命中時最多{{stone.spread.0}}格，25次{{stone.spread.25}}格，50次{{stone.spread.50}}格。命中{{aim.noSpreadHits}}次起落在目標上。經驗歸指揮官：石彈造成損傷就算1次命中，打建築也算。一發打中多個目標只算一次。',
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
            foot: '新投石機為無視姿態。它只自動選擇看得見的目標。攻擊命令在任何姿態下都有效。',
          },
        },
        {
          list: [
            '目標近於{{catapult.min}}格：投石機後撤。目標遠於{{catapult.max}}格：開到{{catapult.bandMin}}-{{catapult.max}}格處。',
            '只在靜止且不與其他載具接觸時射擊。',
            '可以命令它射擊地面上的位置。只有下令才打木柵欄。',
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
    {
      id: 'computer',
      name: '電腦對手',
      lead: '難度在大廳設定。困難電腦可能在和平結束後立刻發動第一波。',
      blocks: [
        {
          table: {
            head: ['項目', '簡單', '中等', '困難'],
            rows: [
              ['第一波', '{{ai.easy.firstWaveMinutes}}分鐘', '{{ai.medium.firstWaveMinutes}}分鐘', '立刻'],
              ['軍隊上限', '{{ai.easy.armyCap}}', '{{ai.medium.armyCap}}', '{{ai.hard.armyCap}}'],
              ['投石機', '{{ai.easy.catapults}}', '最多{{ai.medium.catapults}}', '最多{{ai.hard.catapults}}'],
              ['密集箭塔環', '否', '是', '是'],
              [
                '同時開工的工地',
                '{{ai.easy.sites}}',
                '{{ai.medium.sites}}，{{ai.medium.grownMinutes}}分鐘起{{ai.medium.grownSites}}',
                '{{ai.hard.sites}}，{{ai.hard.midMinutes}}分鐘起{{ai.hard.midSites}}，{{ai.hard.lateMinutes}}分鐘起{{ai.hard.lateSites}}',
              ],
            ],
            foot: '時間均為遊戲時間：×3速度下快三倍。「和平時間」結束前不會出兵。簡單和中等電腦不會訓練超過軍隊上限的士兵。',
          },
        },
        {
          h: '進攻波次',
        },
        {
          table: {
            head: ['波次開始後', '每波人數'],
            rows: [
              ['0', '{{ai.wave.0.min}}-{{ai.wave.0.max}}'],
              ['1小時', '{{ai.wave.1.min}}-{{ai.wave.1.max}}'],
              ['2小時', '{{ai.wave.2.min}}-{{ai.wave.2.max}}'],
              ['3小時及以後', '{{ai.wave.3.min}}-{{ai.wave.3.max}}'],
            ],
            num: [1],
            foot: '時間從「第一波」和和平結束兩者中較晚的時刻算起。波次人數在此區間內隨機。',
          },
        },
        {
          list: [
            '同時只有一波在行動。下一波在[[building:barracks|兵營]]前集結。',
            '集結最多{{ai.gatherMinutes}}分鐘。之後按表中下限的人數出發，人數不夠時能到的全部出發。',
          ],
        },
        {
          h: '何時出發',
        },
        {
          list: [
            '電腦比較自己和你的軍隊實力，算武器、護甲、護符、生命值和治療藥水，不算經驗。',
            '你箭塔上的弓手算作{{ai.towerPostWeight}}。',
            '每個電腦開局隨機選一個計畫。進取型達到你{{ai.planAggressivePct}}%的實力就出發，防守型到{{ai.planDefensivePct}}%才出發，其餘是{{ai.planBalancedPct}}%。',
            '迷霧之下只算它看見過的。對你一無所知時，當作你和它一樣強。',
            '實力不夠時，波次在兵營前等待，集結結束後也一樣。',
            '電腦軍隊達到上限時，照樣出發。',
            '你攻打它的聚落，或比它強{{ai.defendRatio}}倍時，它把軍隊留在家裡，已出發的波次也會折返。',
          ],
        },
        {
          h: '突襲',
        },
        {
          list: [
            '{{ai.raidMen}}人的小隊攻擊你的採集者和經濟建築。它繞開箭塔射程，沒有繞開箭塔的路就不出發。',
            '困難電腦在{{ai.raidChancePct}}%的遊戲裡這樣做，除非開局在島上。騷擾計畫總會這樣做，任何等級都一樣。',
            '第一次突襲在和平結束後{{ai.raidMinMinutes}}-{{ai.raidMaxMinutes}}分鐘出發，之後間隔相近。',
          ],
        },
        {
          h: '目標',
        },
        {
          steps: ['最近的[[building:headquarters|大本營]]。', '箭塔。', '其他建築，包括工地。', '人。'],
        },
        {
          list: [
            '木柵欄和[[building:work_pottery_02|防禦牆]]不是目標：[[article:walls|木柵欄與柵門]]。',
            '迷霧之下，電腦知道地圖開局時的建築和已見過的建築。新建築要看見才知道。',
          ],
        },
        {
          h: '水路',
        },
        {
          list: [
            '步行波次只走電腦兵營所在的陸地。你在這片陸地上的建築或人員會成為目標。',
            '對手大本營在別的陸地時，電腦在岸邊建[[building:work_joinery_03|四級木匠坊]]，造[[good:ship_small|船]]，用船運兵。',
            '岸邊有{{ai.landingShips}}艘船（較弱的電腦更少），且軍隊比守軍強{{ai.landingEdge}}倍時開始登陸。每艘船載{{vehicle.shipSeats}}名士兵。',
            '它在你的箭塔和防禦模式建築的射程外靠岸，盡量靠近大本營，然後攻向大本營。',
            '在岸上損失{{ai.landingRetreatPct}}%的人後，其餘的人回到船上。下一次登陸最早在{{ai.landingCooldownMinutes}}分鐘後。',
          ],
        },
        {
          h: '重建',
        },
        {
          p: '大廳裡設為「地圖 AI」的玩家，在{{ai.rebuildNear}}格內沒有敵人且有自己平民時重建建築。大本營除外。',
        },
      ],
      see: ['article:defence', 'article:walls', 'article:catapult', 'article:fog', 'article:diplomacy'],
    },
  ],
};
