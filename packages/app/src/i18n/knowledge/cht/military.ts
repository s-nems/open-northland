import type { ArticleGroup } from '../../../hud/knowledge/articles.js';

export const MILITARY: ArticleGroup = {
  group: '軍事',
  items: [
    {
      id: 'damage',
      name: '武器、護甲與傷害',
      lead: '人有{{health.human}}點生命值。每次攻擊扣除表中數值，下列倍率會改變它。',
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
            foot: '按此順序生效。正面和前側為×1。箭矢和石彈不隨命中次數增長，方向從發射點算起。方向和防禦護符只對人有效。命中次數對載具和木柵欄無效。指揮官的護符對投石機的石彈無效。木柵欄的傷害另算：[[article:walls|木柵欄與柵門]]。',
          },
        },
        {
          list: [
            '結果不大於0時不造成傷害，也不給經驗。',
            '兒童不會受傷。',
            '武器和護甲不會耗損。',
            '只有成年男性能裝備武器和護甲。',
          ],
        },
        {
          h: '民族差異',
        },
        {
          list: [
            '撒拉遜人：[[good:bow_short|短弓]]對布甲{{saracen.bowOnWool}}（他族{{viking.bowOnWool}}），對鎖甲和板甲{{saracen.bowOnChain}}（他族{{viking.bowOnChain}}）。',
            '拜占庭人：[[good:spear_wooden|木矛]]一行顯示的是地圖上的龍：{{dragon.hitpoints}}點生命值，射程{{dragon.min}}-{{dragon.max}}，每{{dragon.seconds}}秒連擊{{dragon.blows}}次，對無甲{{dragon.bare}}。訓練出的矛兵與其他民族相同。',
            '其餘士兵武器五個民族相同。',
          ],
        },
        {
          h: '護甲',
        },
        {
          data: 'armour',
        },
        {
          p: '武器和護甲的重量相加：[[article:walking|步速]]。',
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
      lead: '助手視窗的兵種計數器負責武裝軍隊。單個士兵在自己的面板裡更換。',
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
            '只要有徒手士兵在等，計數器就不會招人頂替他，哪怕暫時沒有武器。',
            '範圍內有該兵種的武器且沒有別人在等時，徒手士兵才去拿。',
            '調低計數器會取消仍在等武器的人。',
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
            foot: '倉庫範圍內有排位更高的裝備時，新兵去取，不拿兵營裡差一等的。取完回到兵營門前，由計數器武裝的士兵也一樣。',
          },
        },
        {
          h: '武器和護甲排序欄',
        },
        {
          p: '每個兵種有自己的排序欄。士兵從左起取庫存中的第一件，跳過劃掉的。初始按從強到弱排列。點擊劃掉，按住拖動改變順序。',
        },
        {
          list: [
            '無武器可拿：等待，視窗顯示「人等待武器」。',
            '無護甲可拿：不穿護甲出發。之後只有下令才會穿。',
          ],
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
            foot: '「優先」把貨物運進兵營，有{{barracks.carriers}}個搬運工職位：[[article:hauling|搬運工與倉庫]]。',
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
            '途中找不到來源就空手而歸。',
            '武器立即改變士兵的兵種。卸下武器後成為[[job:soldier_unarmed|士兵]]。',
            '換下或卸下的鞋子、工具和開過封的瓶子會消失。',
            '武器、護甲和護符不耗損，會回到倉庫。',
            '對單人下的命令優先於助手。',
          ],
        },
        {
          h: '命中次數與高級武器',
        },
        {
          p: '命中次數不限制高級武器。士兵能拿倉庫裡的任何武器。限制在生產環節：[[good:spear_iron|鐵矛]]和[[good:sword_long|長劍]]需要[[job:smith|鐵匠]]經驗，[[good:bow_long|長弓]]需要[[job:armorer|武器匠]]經驗。數值表見[[article:exp-combat|戰鬥經驗]]。',
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
            foot: '射程單位為步。目標近於射程下限時弓手不射擊。法蘭克人的希拉：射程{{frankHeroBow.min}}-{{frankHeroBow.max}}，每{{frankHeroBow.seconds}}秒一箭。',
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
              ['{{aim.sureHits}}+', '100%'],
            ],
            num: [0, 1],
            foot: '每命中一次+1%。短弓和長弓共用命中計數，[[article:catapult|投石機]]單獨計數，數值表相同。英雄百發百中。',
          },
        },
        {
          h: '未命中箭矢的散佈',
        },
        {
          list: [
            '未命中的箭落在目標3步以內。命中75次起不再偏移。',
            '未命中的箭打中落點的第一個敵人：人、動物或載具，然後是建築，最後是木柵欄。',
            '箭會飛過己方、盟友和中立單位。',
            '士兵會對移動目標提前瞄準。建築瞄準目標當前位置。',
          ],
        },
        {
          h: '箭塔職位',
        },
        {
          list: [
            '弓手站在職位上才有射程加成，走向職位途中沒有。',
            '敵人不能瞄準職位上的射手，只能瞄準箭塔。',
          ],
        },
      ],
      see: ['article:exp-combat', 'article:defence', 'building:tower_00', 'building:tower_01'],
    },
    {
      id: 'stances',
      name: '姿態',
      lead: '士兵和英雄初始為防禦姿態。',
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
              ['進攻', '自身周圍', '{{stance.search}}', '目標倒下或無法到達', '反擊'],
              ['防禦', '駐守點周圍', '{{stance.search}}', '目標離駐守點超過{{stance.defendLeash}}', '反擊'],
              [
                '無視',
                '僅武器範圍內，不接近',
                '武器範圍',
                '目標離駐守點超過{{stance.ignoreLeash}}',
                '不反擊',
              ],
            ],
            foot: '半徑單位為步。駐守點是士兵更換姿態時所站的位置。移動和攻擊命令會改變駐守點。',
          },
        },
        {
          list: [
            '進攻姿態的士兵戰鬥結束時若離駐守點超過{{stance.attackReturn}}步，就返回駐守點。',
            '索敵不受[[article:fog|迷霧]]影響。',
            '攻擊命令在任何姿態下都有效。',
            '職位上的弓手在任何姿態下都射擊範圍內的目標。',
            '普通移動命令讓士兵堅持走完路線，挨打也不停。「沿途攻擊」命令下他會轉身迎敵。',
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
            head: ['對象', '距傷者（步）', '反應'],
            rows: [
              ['進攻或防禦姿態的士兵和英雄', '{{stance.soldierAlarm}}', '衝向攻擊者'],
              ['無視姿態的士兵和英雄', '-', '只打武器範圍內的目標'],
              [
                '平民和偵察兵',
                '{{stance.peopleAlarm}}',
                '逃開{{stance.fleeMin}}-{{stance.fleeMax}}步後回去工作',
              ],
              ['建築內的人', '-', '不反應，職位上的弓手除外'],
              ['露天睡覺的平民', '-', '繼續睡，被打才逃'],
            ],
            num: [1],
            foot: '只有人被攻擊才會觸發響應。',
          },
        },
        {
          h: '平民',
        },
        {
          list: [
            '平民為無視姿態，不參與戰鬥。只有士兵和英雄能設定姿態。',
            '平民只有挨打才逃跑，看見敵人不會動。',
            '逃跑時扔下攜帶的貨物。搬運工丟下推車。',
          ],
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
              ['視野', '{{vision.soldier}}', '{{vision.hero}}'],
              ['弓箭命中率', '隨命中次數上升', '百發百中'],
              ['戰鬥經驗', '增長', '不增長'],
              ['吃飯和睡覺', '需要', '不需要'],
              ['鞋子', '要發放，會磨損', '自帶，不磨損'],
              ['武器、護甲、鞋子', '可更換', '固定'],
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
              ['[[job:hero_axe|戰斧英雄]]', '斧頭', '[[good:armor_chain|鎖甲]]', '{{hero.axeReach}}'],
              [
                '[[job:heroine_bow_xena|希拉]]',
                '弓',
                '[[good:armor_leather|皮甲]]',
                '{{heroBow.min}}-{{heroBow.max}}',
              ],
              ['[[job:hero_unarmed|徒手英雄]]', '拳頭', '[[good:armor_wool|布甲]]', '{{hero.fistReach}}'],
            ],
            num: [3],
            foot: '每{{hero.blowSeconds}}秒攻擊一次。傷害見[[article:damage|武器、護甲與傷害]]表中的「英雄」選項。',
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
              ['戰斧英雄', '維京人', '對板甲{{hero.axeVikingPlate}}，每{{hero.axeVikingSeconds}}秒一擊'],
              [
                '希拉',
                '法蘭克人',
                '射程{{frankHeroBow.min}}-{{frankHeroBow.max}}，每{{frankHeroBow.seconds}}秒一箭，對無甲{{hero.frankBowBare}}，對布甲和皮甲{{hero.frankBowWool}}，對鎖甲和板甲{{hero.frankBowChain}}，對建築和載具{{hero.frankBowVehicle}}',
              ],
              [
                '徒手英雄',
                '拜占庭人、埃及人',
                '每{{hero.fistEasternSeconds}}秒連擊{{hero.fistEasternBlows}}次',
              ],
            ],
          },
        },
        {
          h: '背包',
        },
        {
          list: [
            '可裝：[[good:amulet_strength|力量護符]]、[[good:amulet_defense|防禦護符]]、[[good:amulet_crithit|精準護符]]、[[good:amulet_speed|疾風護符]]、[[good:potion_heal_small|小型治療藥水]]、[[good:potion_heal_big|大型治療藥水]]。',
            '不裝補需求的物品：蜂蜜酒、營養藥水、耐力藥水、[[good:amulet_food|營養護符]]、[[good:amulet_stamina|耐力護符]]。',
          ],
        },
        {
          h: '死亡',
        },
        {
          p: '武器消失。護甲、鞋子和背包裡未用的物品留在地上。',
        },
      ],
      see: ['article:damage', 'article:chests', 'article:fog', 'article:exp-combat'],
    },
    {
      id: 'defence',
      name: '箭塔、防禦模式與避難',
      lead: '防禦模式下建築自行射擊。每名躲藏者每秒為它增加{{shelter.shotsPerSeat}}箭。',
      blocks: [
        {
          h: '防禦模式',
        },
        {
          list: [
            '「啟動防禦模式」作用於一座建築，「全城」作用於所有防禦建築。',
            '防禦模式由玩家開啟。居民挨打不會觸發。',
            '在建建築不能開啟。',
            '持續到「解除防禦模式」或建築被摧毀。',
          ],
        },
        {
          h: '誰去避難',
        },
        {
          list: [
            '平民、婦女和兒童跑向步行範圍內最近的有空位的建築。',
            '士兵、英雄和[[job:scout|偵察兵]]留在外面。',
            '找不到位置的人繼續工作。',
            '防禦模式優先於飢餓和睡眠。躲藏者只吃隨身帶的，不工作。',
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
            foot: '每秒箭數按躲藏者滿員計算。職位不佔避難名額。箭塔駐軍的弓手自己射擊，無需防禦模式：[[article:aim|命中與射擊]]。',
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
            foot: '護甲已計入格擋{{combat.armourBlock}}，與[[article:damage|武器、護甲與傷害]]相同。所有民族一樣，此為倍率前的數值。',
          },
        },
        {
          list: [
            '射程為從建築最近的牆起{{shelter.range}}步，沒有下限。',
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
            head: ['箭塔', '搬運工', '蜂蜜酒', '食物', '每種士兵武器'],
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
            foot: '搬運工職位數和庫存容量。',
          },
        },
        {
          list: [
            '職位只接受對應兵種：[[job:soldier_bow_short|短弓手]]或[[job:soldier_bow_long|長弓手]]。指派方式與工作地點相同。',
            '換別的武器會改變兵種並失去職位。',
            '駐軍不下塔，吃塔內存糧，在職位上睡覺。存糧空了才去找吃的。',
            '助手不會把駐軍調離箭塔，發裝備也不會。',
            '「撤出駐軍」：弓手離開箭塔並保持選中，等待下一條命令。移動命令也能讓弓手離崗。',
            '「已駐守」狀態：箭塔已指派弓手。「沒有駐軍」：一個都沒有。',
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
      lead: '對建築傷害每滿{{wall.damagePerPoint}}點，木柵欄掉1點生命值。不足{{wall.damagePerPoint}}點無效。',
      blocks: [
        {
          table: {
            head: ['部件', '生命值', '每擊修復', '成本'],
            rows: [
              ['木柵欄段', '150', '5', '1份[[good:wood|木材]]'],
              ['柵門', '500', '5', '免費，由柵欄段改建'],
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
            caption: '五段柵欄上的柵門',
          },
        },
        {
          list: [
            '柵門建在連成直線的五段自家已完工柵欄上。',
            '每段至少有75%生命值，且位於平地。',
            '通道內不能有人。',
            '柵門立即建成，處於關閉狀態且生命值全滿，受損的柵欄段上也一樣。',
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
              ['自動', '保持開啟。敵人進入柵門{{wall.gateEnemyNear}}步內時關閉，之後再開啟'],
            ],
            foot: '自動模式只看交戰玩家的活人和載具，平民也算。動物和建築不算。',
          },
        },
        {
          list: ['通道內沒人時柵門才關閉。', '電腦把自己的柵門設為自動模式。'],
        },
        {
          h: '攻擊木柵欄',
        },
        {
          table: {
            head: ['武器', '每擊點數', '擊數：柵欄段', '擊數：柵門', '用時：柵欄段'],
            rows: [
              ['[[building:catapult|投石機]]', '36', '5', '14', '20秒'],
              ['英雄近戰', '5', '30', '100', '30秒'],
              ['[[good:spear_iron|鐵矛]]', '5', '30', '100', '68秒'],
              ['[[good:sword_long|長劍]]', '5', '30', '100', '73秒'],
              ['[[good:sword_shord|短劍]]', '2', '75', '250', '75秒'],
              ['[[good:spear_wooden|木矛]]', '4', '38', '125', '86秒'],
              ['[[good:bow_short|短弓]]', '1', '150', '500', '150秒'],
              ['[[good:bow_long|長弓]]', '2', '75', '250', '175秒'],
              ['拳頭、建築射出的箭', '0', '-', '-', '-'],
            ],
            num: [1, 2, 3, 4],
            foot: '用時按一名士兵計算。希拉2點，法蘭克人的希拉0點。',
          },
        },
        {
          list: [
            '戰鬥經驗不增加對木柵欄的傷害。',
            '力量護符按點數計算：5變7，2變3，1還是1。',
            '士兵不會主動選擇木柵欄。只有下令或柵欄擋住去敵人的路時才會砍。',
            '一段倒下後，士兵穿過缺口，不再砍旁邊的柵欄。',
          ],
        },
        {
          h: '防禦牆',
        },
        {
          p: '[[building:work_pottery_02|防禦牆]]算建築：{{wall.defenceHp}}點生命值，傷害看「建築」列。士兵只有下令或它擋住去敵人的路時才會攻擊。',
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
      lead: '石彈傷及落點和周圍六個節點上的一切，自己人也不例外。',
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
              ['射程', '{{catapult.min}}-{{catapult.max}}步'],
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
              ['木柵欄段', '36點', '5'],
              ['柵門', '36點', '14'],
            ],
            num: [2],
            foot: '對人的數值不含方向和護符。投石機的命中次數不增加傷害。',
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
            head: ['石彈下方', '結果'],
            rows: [
              ['敵人', '受傷'],
              ['己方人員、載具、建築、木柵欄', '受傷'],
              ['中立方和盟友', '受傷，不影響態度'],
              ['大廳設定為和平的玩家', '避開'],
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
          p: '數值表見[[article:aim|命中與射擊]]。在{{catapult.max}}步處，未命中的石彈偏移：0次命中時最多3步，25次2步，50次1步，75次起0步。經驗歸指揮官，石彈打傷目標得1點。',
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
            '目標近於{{catapult.min}}步：投石機後撤。目標遠於{{catapult.max}}步：開到{{catapult.bandMin}}-{{catapult.max}}步處。',
            '只在靜止且不與其他載具接觸時射擊。',
            '命令可以指定地面位置。只有下令才打木柵欄。',
          ],
        },
        {
          h: '什麼能摧毀投石機',
        },
        {
          table: {
            head: ['武器', '傷害', '摧毀所需擊數'],
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
            foot: '戰鬥經驗不增加對載具的傷害。攻擊者的護符有效。',
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
            foot: '時間均為遊戲時間：×3速度下快三倍。「和平時間」結束前不會出兵。簡單和中等不會招募超過軍隊上限的士兵。',
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
            foot: '波次從「第一波」和和平結束二者中較晚的時刻開始。人數在區間內隨機。',
          },
        },
        {
          list: [
            '同時只有一波在行動。下一波在[[building:barracks|兵營]]前集結。',
            '集結最多{{ai.gatherMinutes}}分鐘。之後按區間下限出發，人數不夠時能到的全部出發。',
          ],
        },
        {
          h: '何時出發',
        },
        {
          list: [
            '你的點數更高時波次等待：士兵和英雄1點，箭塔上的弓手3點。電腦每人算1點。',
            '武器、護甲、護符、藥水和經驗都不計入。',
            '在兵營前等待，集結結束後也一樣。',
            '電腦軍隊達到上限時，照樣出發。',
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
            '電腦隔著迷霧也能瞄準。',
          ],
        },
        {
          h: '水路',
        },
        {
          list: [
            '目標必須與電腦的兵營在同一片陸地上。波次不會乘船。',
            '對手大本營在別的陸地時，電腦會在岸邊建[[building:work_joinery_03|四級木匠坊]]並造[[good:ship_small|船]]，但不用船運兵。',
            '你的建築或人員在電腦的陸地上時，會成為目標。',
            '海上登陸由地圖模式實現，例如諸神黃昏。',
          ],
        },
        {
          h: '重建',
        },
        {
          p: '「地圖 AI」在{{ai.rebuildNear}}步內沒有敵人時重建建築。大本營除外。',
        },
      ],
      see: ['article:defence', 'article:walls', 'article:catapult', 'article:fog', 'article:diplomacy'],
    },
  ],
};
