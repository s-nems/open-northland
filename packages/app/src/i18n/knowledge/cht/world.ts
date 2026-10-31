import type { ArticleGroup } from '../../../hud/knowledge/articles.js';

export const WORLD: ArticleGroup = {
  group: '世界',
  items: [
    {
      id: 'goals',
      name: '任務目標與遊戲結束',
      lead: '玩家沒有一名在世的成年男性時出局。成年男性和英雄算數，婦女和希拉不算，兒童也不算。',
      blocks: [
        {
          h: '由什麼決定',
        },
        {
          table: {
            head: ['地圖', '勝利', '失敗'],
            rows: [
              ['多人地圖，單人遊玩也算', '地圖清單中的目標', '沒有成年男性；腳本的失敗目標'],
              ['劇情任務', '地圖腳本', '地圖腳本；沒有成年男性'],
              ['無腳本地圖', '最後的倖存者', '沒有成年男性'],
            ],
          },
        },
        {
          h: '多人地圖目標',
        },
        {
          table: {
            head: ['目標', '計入範圍', '結果'],
            rows: [
              ['貨物', '建築貨架上的庫存。地面貨堆、貨艙和手上的貨物不算', '清單全部達標時勝利'],
              ['「居民」', '玩家的所有人，包括兒童', '達到要求人數時勝利'],
              ['「士兵」', '士兵職業的成年男性，不含英雄', '達到要求人數時勝利'],
              ['腳本勝利', '任務事件指定玩家', '勝利'],
              ['腳本失敗', '任務事件指定玩家', '失敗'],
              [
                '最後的倖存者',
                '至少一名對手出局，其餘玩家互為友好：[[article:diplomacy|外交]]',
                '其餘玩家全部勝利',
              ],
            ],
            foot: '貨物、「居民」和「士兵」的進度顯示為當前/要求。只有地圖沒有貨物、人數或腳本結果目標時，「最後的倖存者」才生效。',
          },
        },
        {
          list: [
            '先檢查是否沒有男性，再按地圖順序檢查目標清單。',
            '第一個達成的條件決定該玩家的結局，不再改變。勝者之後失去所有人，仍是勝者。',
            '一名玩家獲勝，其他玩家繼續遊戲。',
            '地圖可以讓指定玩家不受成年男性規則約束。',
          ],
        },
        {
          h: '戰敗者的結局',
        },
        {
          steps: [
            '沒有成年男性：載具立即消失。',
            '下一次目標檢查時判定失敗。',
            '再下一次檢查時，建築、人員、載具和路標消失。',
            '玩家的動物原地變為野生。',
          ],
        },
        {
          p: '以上適用於多人地圖。在劇情任務和無腳本地圖中，只有載具消失，電腦停止行動，建築和人員留下。',
        },
      ],
      see: ['article:diplomacy', 'article:family', 'article:heroes'],
    },
    {
      id: 'vehicles',
      name: '載具與船隻',
      lead: '沒有指揮官的載具不動。船載{{vehicle.shipSeats}}人，大船載{{vehicle.bigShipSeats}}人，都含指揮官。',
      blocks: [
        {
          data: 'vehicles',
        },
        {
          table: {
            head: ['載具', '誰能上', '含指揮官的座位'],
            rows: [
              [
                '[[good:handcart|手推車]]、[[good:oxcart|牛車]]',
                '[[job:carrier|搬運工]]、[[job:trader|商人]]',
                '1',
              ],
              ['[[good:ship_small|船]]', '任何成人', '{{vehicle.shipSeats}}'],
              ['[[good:ship_big|大船]]', '任何成人', '{{vehicle.bigShipSeats}}'],
              ['[[good:catapult|投石機]]', '士兵、英雄', '1'],
            ],
            num: [2],
          },
        },
        {
          list: [
            '第一個被指派的人成為指揮官。他離開後由下一名乘客接任。',
            '上載具的人失去工作地點。有工作地點的搬運工和商人把空閒車輛當工具，工作地點保留。',
            '貨艙由指揮官或船上的搬運工操作。兩者都沒有時顯示「沒有搬運工」。',
          ],
        },
        {
          h: '載重與速度',
        },
        {
          table: {
            head: ['載具', '滿載減速', '道路：空載', '道路：滿載', '陸地：空載', '陸地：滿載'],
            rows: [
              [
                '[[good:handcart|手推車]]',
                '{{vehicle.handcartLossPct}}%',
                '{{pace.cartRoad}}',
                '{{pace.handcartRoadFull}}',
                '{{pace.cartLand}}',
                '{{pace.handcartLandFull}}',
              ],
              [
                '[[good:oxcart|牛車]]',
                '{{vehicle.oxcartLossPct}}%',
                '{{pace.cartRoad}}',
                '{{pace.oxcartRoadFull}}',
                '{{pace.cartLand}}',
                '{{pace.oxcartLandFull}}',
              ],
              ['[[good:catapult|投石機]]', '-', '{{pace.catapultRoad}}', '-', '{{pace.catapultLand}}', '-'],
            ],
            num: [1, 2, 3, 4, 5],
            foot: '單位為步/秒。滿載指手推車{{haul.handcart}}/{{haul.handcart}}、牛車{{haul.oxcart}}/{{haul.oxcart}}。按赤腳車夫計算，穿鞋更快。船不受載重影響，約{{pace.ship}}步/秒。拉車的搬運工步速也按相同比例下降。路線選車見[[article:trade|貿易]]。',
          },
        },
        {
          h: '建造',
        },
        {
          table: {
            head: ['載具', '工坊', '成本'],
            rows: [
              [
                '[[good:handcart|手推車]]',
                '[[building:work_joinery_02|三級木匠坊]]、4級',
                '[[good:wood|木材]]{{cost.handcartWood}}份',
              ],
              [
                '[[good:oxcart|牛車]]',
                '[[building:work_joinery_02|三級木匠坊]]、4級',
                '[[good:wood|木材]]{{cost.oxcartWood}}份',
              ],
              [
                '[[good:ship_small|船]]',
                '[[building:work_joinery_03|四級木匠坊]]',
                '[[good:wood|木材]]{{cost.shipWood}}份，[[good:leather|皮革]]{{cost.shipLeather}}份',
              ],
              [
                '[[good:ship_big|大船]]',
                '[[building:work_joinery_03|四級木匠坊]]',
                '[[good:wood|木材]]{{cost.bigShipWood}}份，[[good:leather|皮革]]{{cost.bigShipLeather}}份',
              ],
              [
                '[[good:catapult|投石機]]',
                '[[building:work_joinery_03|四級木匠坊]]',
                '[[good:wood|木材]]{{catapult.wood}}份，[[good:iron|鐵礦]]{{catapult.iron}}份',
              ],
            ],
            foot: '[[job:joiner|木匠]]在工坊旁的工場造載具，在岸邊水面造船。',
          },
        },
        {
          h: '牛車用牛',
        },
        {
          steps: [
            '造好的牛車狀態為「等待役畜」。',
            '它牽走同一陸地上玩家最近的空閒成年[[good:cattle|牛]]，畜牧場裡面的不算。',
            '每座畜牧場保留最先的{{livestock.pair}}頭成年牲畜。沒有畜牧場的牛同樣保留{{livestock.pair}}頭。',
            '牛走到車旁後消失，牛車這才能動。',
          ],
        },
        {
          h: '船隻',
        },
        {
          list: [
            '貨艙由所有貨物共用。',
            '船載1輛載具：手推車、牛車或投石機。載具的乘員必須也上得了船。大船不載載具。',
            '「靠岸」需要指定岸邊。船停在離指定位置{{vehicle.mooringDistance}}步處，不需要港口建築。',
            '海上不能上下船。',
            'Ctrl/Cmd + 點擊：靠岸並讓乘員登陸。',
          ],
        },
        {
          h: '貨艙',
        },
        {
          list: [
            '「目標」：貨艙要裝多少份。目標總和不超過容量。',
            '「由搬運工」：有工作地點的搬運工拉車，車上裝的是他每趟搬起的貨物。目標被鎖定。',
            '車輛停下或船靠岸時，指揮官或搬運工下來工作。海上沒人工作。',
            '每次拿1份：貨堆、{{vehicle.cargoSearch}}步內的建築，然後更遠處。',
            '來源必須在船門所在的陸地上。不拿民居裡的食物。',
            '目標為0或低於現有數量：多餘的運到{{vehicle.cargoSearch}}步內最近的有空位的倉庫或大本營。沒有就卸在地上。',
            '船上沒有搬運工時，指揮官在貨物無處可取時調低目標。有搬運工時目標不變。',
            '移動命令會在出發前召回乘員。',
          ],
        },
        {
          h: '失去載具',
        },
        {
          table: {
            head: ['狀態', '船上乘員', '載運的載具', '貨物'],
            rows: [
              ['車輛、[[good:catapult|投石機]]', '在門口下車', '-', '散落在{{vehicle.spill}}步內'],
              ['船已靠岸', '登岸', '停在門口', '消失'],
              ['船在海上', '溺亡', '連同乘員沉沒', '消失'],
            ],
            foot: '船體未毀時，船上的乘員不會被打中。不在船上的乘員只是失去指派。',
          },
        },
      ],
      see: ['article:hauling', 'article:trade', 'article:catapult', 'article:livestock', 'good:handcart'],
    },
    {
      id: 'diplomacy',
      name: '外交',
      lead: '態度是單向的：你對他們和他們對你是兩項獨立設定。',
      blocks: [
        {
          h: '態度的作用',
        },
        {
          table: {
            head: ['行為', '敵對', '中立', '友好'],
            rows: [
              ['攻擊對方人員和建築', '是', '否', '否'],
              ['[[job:scout|偵察兵]]收服對方的牛和綿羊', '是', '否', '否'],
              ['[[job:trader|商人]]在對方有提議的建築交易', '否', '否', '是，需雙方'],
              ['共享地圖視野', '否', '否', '是，需雙方'],
              ['最後的倖存者共同勝利', '否', '否', '是，需雙方'],
            ],
            foot: '共享視野還需要在對戰設定中開啟「盟友共用地圖」。',
          },
        },
        {
          h: '什麼會改變態度',
        },
        {
          table: {
            head: ['事件', '結果'],
            rows: [
              ['地圖開始', '地圖設定態度，未設定的雙方為中立'],
              ['受到外方攻擊', '受害者對攻擊者轉為敵對'],
              ['中立的電腦，你對它敵對', '電腦轉為敵對'],
              ['你調低對友好電腦的態度', '電腦也調低到你的程度'],
              ['敵對的電腦', '不會自行恢復和平'],
              ['支付貢品、任務事件', '可能改變對方態度'],
              ['「態度由劇本設定」', '無法在外交視窗更改'],
            ],
          },
        },
        {
          h: '和平時間',
        },
        {
          list: [
            '受和平保護的玩家之間不能交戰。',
            '不能進入或在對方建築{{peace.keepOut}}步內建造，除非離你自己的建築更近。',
            '結束前{{peace.noticeFirstMinutes}}分鐘和{{peace.noticeLastMinutes}}分鐘發出提醒。',
          ],
        },
        {
          h: '初次接觸',
        },
        {
          p: '迷霧之下，你看見某民族的人員、建築、載具或木柵欄，或被其攻擊後，它就進入外交視窗。接觸不會失效。',
        },
        {
          h: '貢品',
        },
        {
          p: '貢品只能由地圖腳本發起。外交視窗的「支付」立即扣除貨物，無需搬運。扣除來源順序：',
        },
        {
          steps: [
            '第一座[[building:headquarters|大本營]]。',
            '其他大本營和倉庫。',
            '工坊，只扣自產產品，不扣原料。',
          ],
        },
        {
          list: [
            '民居、箭塔、[[building:barracks|兵營]]、[[building:school|學校]]和地面貨堆不參與支付。',
            '要求食物時，同類的任何食物都行。',
            '「最低庫存」擋不住貢品扣除。',
          ],
        },
      ],
      see: ['article:trade', 'article:fog', 'article:walls'],
    },
    {
      id: 'fog',
      name: '迷霧與視野',
      lead: '你只能看見己方人員和建築視野內的東西。',
      blocks: [
        {
          h: '地圖模式',
        },
        {
          table: {
            head: ['設定', '開局', '視野外的地面'],
            rows: [
              ['全開', '全部可見', '無迷霧'],
              ['經典', '全黑地圖', '探明後保持可見'],
              ['經典 + 戰爭迷霧', '全黑地圖', '灰色地面，不顯示單位'],
              ['偵察', '灰色地面，不顯示單位', '探明後保持可見'],
              ['偵察 + 戰爭迷霧', '灰色地面，不顯示單位', '灰色地面，不顯示單位'],
            ],
          },
        },
        {
          p: '灰色地面按最後一次看見的狀態顯示建築、木柵欄、載具、箱子、資源、樹幹和貨物貨堆，不顯示人和動物。這份記憶也儲存在小地圖和存檔中。',
        },
        {
          h: '視野範圍',
        },
        {
          figure: {
            id: 'vision',
            caption: '各單位的視野',
          },
        },
        {
          table: {
            head: ['對象', '範圍（步）'],
            rows: [
              ['[[job:scout|偵察兵]]、[[building:headquarters|大本營]]', '{{vision.scout}}'],
              ['英雄、[[good:ship_small|船]]、[[good:ship_big|大船]]', '{{vision.hero}}'],
              ['士兵、建築，包括箭塔和民居', '{{vision.soldier}}'],
              ['[[good:handcart|手推車]]、[[good:oxcart|牛車]]、[[good:catapult|投石機]]', '{{vision.cart}}'],
              ['成年平民、婦女、自家動物', '{{vision.adult}}'],
              ['兒童', '{{vision.child}}'],
              ['工地', '0'],
            ],
            num: [1],
            foot: '步數按橫向計算。木柵欄、道路和路標沒有視野。',
          },
        },
        {
          h: '迷霧中的戰鬥',
        },
        {
          p: '士兵在迷霧中也會攻擊，[[good:catapult|投石機]]不會自行攻擊。[[job:hunter|獵人]]狩獵不受迷霧影響。',
        },
      ],
      see: ['article:scout', 'article:stances', 'article:catapult', 'article:diplomacy', 'job:scout'],
    },
    {
      id: 'scout',
      name: '偵察兵',
      lead: '偵察兵沒有工作地點。沒有命令時站著等待。',
      blocks: [
        {
          h: '能做什麼',
        },
        {
          table: {
            head: ['任務', '方式', '詳情'],
            rows: [
              ['路標', '「放置路標」命令，不花材料', '[[article:roads|道路與路標]]'],
              ['探索陸地', '「探索」命令', '見下'],
              ['動物', '從野生牛和綿羊身旁走過即可收服', '[[article:livestock|畜牧]]'],
              ['視野', '{{vision.scout}}步，人員中最遠', '[[article:fog|迷霧與視野]]'],
            ],
            foot: '不受路標範圍限制，可走遍全圖。',
          },
        },
        {
          h: '「探索」',
        },
        {
          list: [
            '只對偵察兵有效，可同時選中多名。',
            '從下令位置一圈圈向外走，總是去最近的未探明陸地。',
            '留在同一片陸地上。只有[[article:vehicles|船]]能把他送到別處。',
            '跳過沿海岸和地圖邊緣的窄條，零碎小塊會保持未探明。',
            '途中照常吃飯睡覺，然後從所在位置繼續。',
          ],
        },
        {
          h: '何時結束',
        },
        {
          table: {
            head: ['事件', '結果'],
            rows: [
              ['沒有可探明的陸地', '通知「土地已探索」，偵察兵等待'],
              ['連續{{explore.maxFailedLegs}}個以上目標失敗', '其餘視為不可達，「土地已探索」'],
              ['地圖模式「全開」', '立即「土地已探索」'],
              ['新命令', '探索作廢'],
              ['按住Shift下令', '排到探索結束後'],
              ['更換職業', '探索作廢'],
            ],
          },
        },
      ],
      see: ['article:roads', 'article:livestock', 'article:fog', 'job:scout'],
    },
    {
      id: 'wildlife',
      name: '野生動物與狩獵',
      lead: '攻擊性獸群會撲向其所在地{{wild.aggro}}步內的人，超出{{wild.giveUp}}步後返回。',
      blocks: [
        {
          data: 'animals',
        },
        {
          h: '攻擊性',
        },
        {
          table: {
            head: ['類型', '動物', '行為'],
            rows: [
              ['攻擊性', '狼、獅子、母獅、北極熊', '主動攻擊'],
              [
                '受擊後激怒',
                '熊、大象',
                '憤怒持續到最後一次受擊後{{wild.angrySeconds}}秒，已開始的攻擊持續到目標死亡或避難',
              ],
              ['膽小', '其餘動物', '頭領受擊後逃開{{wild.flight}}步，獸群跟隨'],
            ],
            foot: '野山羊既不攻擊也不逃跑。',
          },
        },
        {
          list: ['攻擊會驚動受擊者{{wild.kinAlarm}}步內的同種動物。', '動物不攻擊建築和載具。'],
        },
        {
          h: '獸群增長',
        },
        {
          p: '數量大於1且小於「獸群」列的野生獸群，每{{wild.growthMinutes}}分鐘增加1只成年動物，但大約每5群只有1群會增長。',
        },
        {
          h: '獵人的獵物',
        },
        {
          list: [
            '獵場是工作旗幟或工作地點周圍{{flag.hunter}}步。追擊可超出獵場{{wild.huntChase}}步。',
            '優先選擇又近又弱的動物。',
            '一次只獵1隻，收完獵物才找下一隻。',
            '獵人的弓每箭造成{{wild.hunterShot}}，射程{{hunterBow.min}}-{{hunterBow.max}}步。',
            '不會主動獵成年野山羊，其幼崽可獵。',
            '跳過有主人的動物、被激怒的動物和其他陸地上的動物。',
          ],
        },
        {
          h: '獵物產出',
        },
        {
          table: {
            head: ['動物', '獵人殺死', '其他人殺死'],
            rows: [
              ['成年', '2份[[good:leather|皮革]]，2份[[good:meat|肉]]', '1份[[good:meat|肉]]'],
              ['幼崽', '1份[[good:leather|皮革]]，1份[[good:meat|肉]]', '無'],
              ['成年馬', '1份[[good:leather|皮革]]，1份[[good:meat|肉]]', '1份[[good:meat|肉]]'],
              ['幼馬', '1份[[good:leather|皮革]]', '無'],
            ],
          },
        },
      ],
      see: ['article:damage', 'article:gathering', 'article:livestock', 'job:hunter'],
    },
    {
      id: 'livestock',
      name: '畜牧',
      lead: '某種牲畜的成年數量正好是{{livestock.pair}}頭時，畜牧師才繁殖。第三頭成年牲畜送去屠宰。',
      blocks: [
        {
          figure: {
            id: 'livestock-cycle',
            caption: '畜牧循環',
          },
        },
        {
          h: '牲畜來源',
        },
        {
          table: {
            head: ['對象', '做法', '範圍（步）'],
            rows: [
              [
                '[[job:scout|偵察兵]]',
                '每走一步都收服野生牛和綿羊，以及你持敵對態度的玩家的畜群。附近其餘敵方畜群四散',
                '{{livestock.captureRange}}，四散{{livestock.scatterRange}}',
              ],
              ['[[job:breeder|畜牧師]]', '把最近的未入場牲畜帶進畜牧場', '同一片陸地'],
              ['[[job:breeder|畜牧師]]', '不足一對時，從你另一座超過一對的畜牧場牽一頭', '同一片陸地'],
            ],
            foot: '站著不動的偵察兵收服不了動物。',
          },
        },
        {
          h: '幼崽與屠宰',
        },
        {
          table: {
            head: ['牲畜', '幼崽成本', '屠宰產出'],
            rows: [
              [
                '[[good:sheep|綿羊]]',
                '[[good:water|水]]{{livestock.calfWater}}份，[[good:wheat|小麥]]{{livestock.calfWheat}}份',
                '[[good:wool|羊毛]]{{livestock.sheepWool}}份，[[good:meat|肉]]{{livestock.sheepMeat}}份',
              ],
              [
                '[[good:cattle|牛]]',
                '[[good:water|水]]{{livestock.calfWater}}份，[[good:wheat|小麥]]{{livestock.calfWheat}}份',
                '[[good:leather|皮革]]{{livestock.cattleLeather}}份，[[good:meat|肉]]{{livestock.cattleMeat}}份',
              ],
            ],
            foot: '繁殖和屠宰各需8秒。畜牧師的生產選擇決定養哪種牲畜。畜牧場肉、羊毛和皮革各存{{livestock.farmShelf}}份。',
          },
        },
        {
          list: [
            '[[building:work_animal_farm|畜牧場]]總共容納{{livestock.farmHerd}}頭，含兩種牲畜和待出生的幼崽。',
            '幼崽{{livestock.growSeconds}}秒（{{livestock.growMinutes}}分鐘）長大，不計入一對。',
            '出生時親代必須在畜牧場門口{{livestock.birthRange}}步內。否則原料白費，沒有幼崽。',
            '畜牧場人手：[[job:breeder|畜牧師]]{{livestock.breeders}}名，[[job:carrier|搬運工]]{{livestock.carriers}}名。',
          ],
        },
        {
          h: '畜牧場狀態',
        },
        {
          table: {
            head: ['提示', '含義'],
            rows: [
              ['「沒有動物」', '該種牲畜為零，需要偵察兵'],
              ['「只有一隻動物」', '需要第二頭'],
              ['「幼崽成長中」', '一對長大後恢復繁殖'],
              ['「獸群已滿」', '畜牧師等待幼崽長大'],
            ],
          },
        },
      ],
      see: ['article:vehicles', 'article:wildlife', 'article:food', 'building:work_animal_farm'],
    },
    {
      id: 'religion',
      name: '信仰與神廟',
      lead: '信仰只在生產武器和護甲時下降。降到0%時，工匠不會開工消耗信仰的批次。',
      blocks: [
        {
          h: '每批消耗',
        },
        {
          table: {
            head: ['職業', '15%', '30%'],
            rows: [
              [
                '[[job:armorer|武器匠]]',
                '[[good:bow_short|短弓]]、[[good:spear_wooden|木矛]]',
                '[[good:bow_long|長弓]]',
              ],
              [
                '[[job:smith|鐵匠]]',
                '[[good:spear_iron|鐵矛]]、[[good:sword_shord|短劍]]',
                '[[good:sword_long|長劍]]、[[good:armor_chain|鎖甲]]、[[good:armor_plate|板甲]]',
              ],
              ['[[job:sewer|裁縫]]', '[[good:armor_wool|布甲]]、[[good:armor_leather|皮甲]]', '-'],
            ],
            foot: '所有民族相同。這些職業的其他貨物不消耗信仰。',
          },
        },
        {
          list: [
            '低於{{need.drivePct}}%時，武器匠和鐵匠去禱告。沒有禱告場所時，到{{need.criticalPct}}%顯示「想要禱告」。',
            '裁縫不會自己去，要下令「禱告」。',
            '到0%時，工匠會做完已付出信仰的批次。',
          ],
        },
        {
          h: '在哪裡禱告',
        },
        {
          table: {
            head: ['地點', '條件'],
            rows: [
              ['民居', '燃著聖火，始終首選'],
              ['[[building:work_temple|神廟]]', '已完工，屬於你'],
              ['[[building:headquarters|大本營]]', '已完工，屬於你'],
            ],
            foot: '禱告{{pray.seconds}}秒，信仰+{{pray.pct}}%。無聖火的民居和外方建築無效。',
          },
        },
        {
          h: '聖火',
        },
        {
          p: '三級民居起可用。1份[[good:holy_oil|油]]燃燒{{oil.burnMinutes}}分鐘，滿油{{oil.fullBurnMinutes}}分鐘。',
        },
        {
          h: '神廟光環',
        },
        {
          table: {
            head: ['項目', '數值'],
            rows: [
              ['範圍', '{{aura.range}}步'],
              ['生命值', '每秒+{{aura.perSecond}}，上限{{aura.ceiling}}'],
              ['信仰', '需求條不超過{{need.satedPct}}%時每秒+{{aura.pietyPct}}%'],
              ['對象', '神廟所有者的全部人員。兒童獲得生命值'],
              ['條件', '神廟已完工且無損傷'],
              ['多座神廟', '只有一層光環，數值不疊加'],
            ],
            foot: '超過{{health.human}}的生命值一直保留，直到被傷害扣除。',
          },
        },
      ],
      see: ['article:needs', 'article:health', 'building:work_temple', 'good:holy_oil'],
    },
    {
      id: 'chests',
      name: '箱子與文書',
      lead: '箱子裡的文書能直接放下建築，無需建造、材料和發現條件。',
      blocks: [
        {
          h: '誰能開啟',
        },
        {
          table: {
            head: ['箱子', '對象'],
            rows: [
              ['箱子', '任何成人'],
              ['魔法箱子', '[[job:druid|德魯伊]]、英雄'],
            ],
            foot: '使用「打開箱子」命令。居民受步行範圍限制。貨物掉在箱子旁。',
          },
        },
        {
          h: '內容',
        },
        {
          table: {
            head: ['獎勵', '箱子', '魔法箱子'],
            rows: [
              ['藥水或護符', '{{chest.singleWooden}}', '{{chest.singleMagical}}'],
              ['大型藥水，1種', '{{chest.bulkWooden}}', '{{chest.bulkMagical}}'],
              [
                '[[good:armor_chain|鎖甲]]、[[good:armor_plate|板甲]]或[[good:shoes|鞋子]]',
                '{{chest.wearWooden}}',
                '{{chest.wearMagical}}',
              ],
              ['[[good:bread|食物]]', '{{chest.foodWooden}}', '{{chest.foodMagical}}'],
              ['[[good:catapult|投石機]]', '1', '1'],
              [
                '平民{{chest.settlers}}名、婦女{{chest.settlers}}名、長劍兵{{chest.settlers}}名或長弓手{{chest.settlers}}名',
                '{{chest.settlers}}',
                '{{chest.settlers}}',
              ],
              [
                '狼{{chest.wolves}}只或獅子{{chest.lions}}只，野生獸群',
                '{{chest.wolves}}或{{chest.lions}}',
                '{{chest.wolves}}或{{chest.lions}}',
              ],
            ],
            num: [1, 2],
            foot: '每個箱子的內容由地圖決定。',
          },
        },
        {
          h: '文書',
        },
        {
          table: {
            head: ['文書', '效果'],
            rows: [
              ['放置一座你選擇的建築', '建築目錄中任選一座，立即建成'],
              ['放置「名稱」', '指定建築，立即建成'],
              ['放置「名稱」並裝滿庫存', '指定建築，庫存全滿'],
            ],
            foot: '文書用後消失，位置被拒時不消耗。清單在建造視窗的「文書」下。',
          },
        },
        {
          p: '文書中的建築：[[building:home_level_01|二級民居]]、[[building:home_level_04|五級民居]]、[[building:stock_02|三級倉庫]]、[[building:headquarters|大本營]]、[[building:work_well_00|水井]]、[[building:work_farm_00|農場]]、[[building:work_mill_00|磨坊]]、[[building:work_bakery_00|一級烘焙坊]]、[[building:work_temple|神廟]]、[[building:school|學校]]、[[building:barracks|兵營]]、[[building:tower_01|二級箭塔]]。',
        },
        {
          h: '帶工坊的文書',
        },
        {
          table: {
            head: ['帶庫存的建築', '居民', '永久發現'],
            rows: [
              ['[[building:work_smithy_01|二級鐵匠鋪]]', '1名[[job:smith|鐵匠]]', '[[good:sword_long|長劍]]'],
              [
                '[[building:work_armory_00|一級武器坊]]',
                '1名[[job:armorer|武器匠]]',
                '[[good:bow_short|短弓]]',
              ],
              ['[[building:work_coin_mint|鑄幣廠]]', '1名[[job:coin_maker|鑄幣師]]', '[[good:coin|金幣]]'],
              ['[[building:work_druid_00|一級鍊金小屋]]', '1名[[job:druid|德魯伊]]', '[[good:holy_oil|油]]'],
              [
                '[[building:work_druid_01|二級鍊金小屋]]',
                '1名[[job:druid|德魯伊]]',
                '[[good:holy_oil|油]]、小型藥水',
              ],
            ],
            foot: '這種箱子給出文書、一名該職業的居民，並解鎖該職業。',
          },
        },
      ],
      see: ['article:construction', 'article:trades', 'article:draughts'],
    },
  ],
};
