import type { ArticleGroup } from '../../../hud/knowledge/articles.js';

export const WORLD: ArticleGroup = {
  group: '世界',
  items: [
    {
      id: 'goals',
      name: '任務目標與遊戲結束',
      lead: '玩家沒有成年男性時就輸了。英雄算數，婦女、希拉和兒童不算。',
      blocks: [
        {
          h: '地圖如何結束',
        },
        {
          table: {
            head: ['地圖', '勝利', '失敗'],
            rows: [
              ['多人地圖，單人遊玩也算', '地圖目標，見下表', '沒有成年男性，或任務宣告失敗'],
              ['劇情任務', '由任務宣告', '由任務宣告，或沒有成年男性'],
              ['無任務地圖', '最後的倖存者', '沒有成年男性'],
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
              ['貨物', '建築裡的庫存。地面貨堆、貨艙和手上的貨物不算', '達到所有要求數量時勝利'],
              ['「居民」', '玩家的所有人，包括兒童', '達到人數時勝利'],
              ['「士兵」', '士兵職業的成年男性，不含英雄', '達到人數時勝利'],
              ['任務宣告', '任務宣告玩家勝利或失敗', '勝利或失敗'],
              [
                '最後的倖存者',
                '至少一名玩家出局，其餘玩家互相友好：[[article:diplomacy|外交]]',
                '其餘玩家全部勝利',
              ],
            ],
            foot: '貨物、「居民」和「士兵」的進度顯示為當前/要求。只有地圖沒有貨物或人數目標、任務也不宣告結果時，「最後的倖存者」才生效。',
          },
        },
        {
          list: [
            '遊戲先檢查男性，再依序檢查地圖目標。遊戲開始{{match.graceSeconds}}秒後才檢查男性。',
            '第一個達成的條件決定該玩家的結局，不再改變。',
            '一名玩家獲勝不會結束其他玩家的遊戲。勝者之後失去所有人，仍是勝者。',
            '地圖可以讓指定玩家不受成年男性規則約束。',
          ],
        },
        {
          h: '戰敗者的結局',
        },
        {
          steps: [
            '沒有成年男性：載具立即消失。',
            '在下一次目標檢查時判定失敗，每{{match.checkSeconds}}秒檢查一次。',
            '再下一次檢查時，建築、載具和路標消失，每個站在陸地上的人原地變成一隻野雞。',
            '玩家的動物原地變為野生。',
          ],
        },
        {
          p: '以上適用於多人地圖。在劇情任務和無任務地圖上，只有載具消失，電腦停止行動。',
        },
      ],
      see: ['article:diplomacy', 'article:family', 'article:heroes'],
    },
    {
      id: 'vehicles',
      name: '載具與船隻',
      lead: '沒有指揮官的載具不動。船載人更多，大船載貨更多。',
      blocks: [
        {
          data: 'vehicles',
        },
        {
          table: {
            head: ['載具', '誰能上'],
            rows: [
              [
                '[[good:handcart|手推車]]、[[good:oxcart|牛車]]',
                '[[job:carrier|搬運工]]、[[job:trader|商人]]',
              ],
              ['[[good:ship_small|船]]、[[good:ship_big|大船]]', '任何成人'],
              ['[[good:catapult|投石機]]', '士兵、英雄'],
            ],
          },
        },
        {
          list: [
            '「乘客」列不含指揮官。第一個被指派的人成為指揮官，他離開後由下一名乘客接任。',
            '上載具的人失去工作地點。例外：有工作地點的搬運工和商人自己拉車，工作保留。',
            '貨艙由指揮官和船上每名成年男性操作。士兵、英雄、[[job:scout|偵察兵]]和[[job:druid|德魯伊]]只有當指揮官時才裝卸。沒人時顯示「沒有搬運工」。',
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
            foot: '單位為格/秒。滿載指手推車{{haul.handcart}}份、牛車{{haul.oxcart}}份。減速隨載重增加：裝半車只減一半。路線選車見[[article:trade|貿易]]。',
          },
        },
        {
          list: [
            '這是有指揮官時車的速度，鞋子在這裡沒有作用。',
            '自己拉車的搬運工和商人按自己的步速走。穿鞋更快，減速的百分比相同。',
            '船不受載重影響，約{{pace.ship}}格/秒。',
          ],
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
                '[[building:work_joinery_02|三級木匠坊]]、[[building:work_joinery_03|四級木匠坊]]',
                '[[good:wood|木材]]{{cost.handcartWood}}份',
              ],
              [
                '[[good:oxcart|牛車]]',
                '[[building:work_joinery_02|三級木匠坊]]、[[building:work_joinery_03|四級木匠坊]]',
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
            '牽走同一陸地上最近的成年[[good:cattle|牛]]。畜牧場裡面的不算。',
            '每座畜牧場保留{{livestock.pair}}頭成年牛。沒有畜牧場的牛群同樣保留這麼多。',
            '牛走到車旁後消失，牛車這才能動。',
          ],
        },
        {
          h: '船隻',
        },
        {
          list: [
            '貨艙容量由所有貨物共用。',
            '船載1輛載具：手推車、牛車或投石機。載具的乘員必須也上得了船。大船不載載具。',
            '「靠岸」：指定岸邊，船停在離它{{vehicle.mooringDistance}}格處。不需要港口。',
            '海上不能上下船。',
            'Ctrl/Cmd + 右鍵：靠岸並讓乘員登陸。',
          ],
        },
        {
          h: '貨艙',
        },
        {
          list: [
            '「目標」：貨艙要裝多少份。目標總和不超過容量。',
            '「由搬運工」：車由搬運工拉，他每趟自己決定裝什麼。不能設定目標。',
            '車輛停下或船靠岸時，負責裝卸的人下來工作。',
            '裝卸的人每次拿1份：先找車輛{{vehicle.cargoSearch}}格內的貨堆，再找同範圍內的建築，最後找路標範圍內的任何地方。',
            '貨物必須和車或船在同一片陸地上。沒人會拿民居裡的食物。',
            '調低目標時，多餘的運到車輛{{vehicle.cargoSearch}}格內最近有空位的倉庫或大本營。沒有就卸在地上。',
            '由身為士兵或英雄的指揮官自己裝卸，而貨物無處可取時，目標會自動調低。[[job:scout|偵察兵]]和[[job:druid|德魯伊]]也一樣。',
            '移動命令會在出發前召回乘員。',
          ],
        },
        {
          h: '失去載具',
        },
        {
          table: {
            head: ['載具', '船上乘員', '載運的載具', '貨物'],
            rows: [
              ['車輛、[[good:catapult|投石機]]', '在旁邊下車', '-', '散落在{{vehicle.spill}}格內'],
              ['船已靠岸', '登岸', '停在岸邊', '消失'],
              ['船在海上', '溺亡', '連同乘員沉沒', '消失'],
            ],
            foot: '載具未毀時，裡面的乘員不會被打中。站在旁邊的人只是不再算乘員。',
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
              ['「最後的倖存者」共同勝利', '否', '否', '是，需雙方'],
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
              ['地圖開始', '態度由地圖設定，未設定的雙方為中立'],
              ['其他玩家攻擊你', '你對他的態度自動變為敵對'],
              ['你對中立的電腦設為敵對', '電腦也轉為敵對'],
              ['島嶼地圖上中立的電腦', '自動對玩家轉為敵對'],
              ['你調低對友好電腦的態度', '電腦也調低到你的程度'],
              ['敵對的電腦', '不會自行恢復和平'],
              ['任務', '可以改變態度，包括在支付貢品之後'],
              ['「態度由劇本設定」', '無法在外交視窗更改'],
            ],
          },
        },
        {
          h: '和平時間',
        },
        {
          list: [
            '「和平時間」在遊戲開始前設定。受保護的玩家之間不能交戰。',
            '不能派人進入，也不能在對方建築{{peace.keepOut}}格內建造，除非該處離你的建築更近。',
            '結束前{{peace.noticeFirstMinutes}}分鐘和{{peace.noticeLastMinutes}}分鐘發出提醒。',
          ],
        },
        {
          h: '初次接觸',
        },
        {
          p: '迷霧之下，你看見某民族的人員、建築、載具或木柵欄，或被其攻擊後，它就出現在外交視窗裡，並且一直留著。',
        },
        {
          h: '貢品',
        },
        {
          p: '貢品只能由任務要求。外交視窗的「支付」立即扣除貨物，無需搬運。扣除來源：',
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
            '任務要求食物時，同類的任何食物都行。',
            '「最低庫存」擋不住貢品扣除。',
          ],
        },
      ],
      see: ['article:trade', 'article:fog', 'article:walls'],
    },
    {
      id: 'fog',
      name: '迷霧與視野',
      lead: '偵察兵和大本營看得最遠，{{vision.scout}}格。工地什麼也看不見。',
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
              ['經典 + 戰爭迷霧', '全黑地圖', '灰色地面，不顯示人和動物'],
              ['偵察', '灰色地面，不顯示人和動物', '探明後保持可見'],
              ['偵察 + 戰爭迷霧', '灰色地面，不顯示人和動物', '灰色地面，不顯示人和動物'],
            ],
          },
        },
        {
          p: '灰色地面按最後一次看見的狀態顯示建築、木柵欄、載具、箱子、資源、樹幹和貨堆，不顯示人和動物。',
        },
        {
          h: '視野範圍',
        },
        {
          figure: {
            id: 'vision',
            caption: '視野範圍',
          },
        },
        {
          table: {
            head: ['對象', '範圍（格）'],
            rows: [
              ['[[job:scout|偵察兵]]、[[building:headquarters|大本營]]', '{{vision.scout}}'],
              ['英雄、[[good:ship_small|船]]、[[good:ship_big|大船]]', '{{vision.hero}}'],
              ['士兵、建築，包括箭塔和民居', '{{vision.soldier}}'],
              ['[[good:handcart|手推車]]、[[good:oxcart|牛車]]、[[good:catapult|投石機]]', '{{vision.cart}}'],
              ['其餘成人、自家動物', '{{vision.adult}}'],
              ['兒童', '{{vision.child}}'],
              ['工地', '0'],
            ],
            num: [1],
            foot: '木柵欄、道路和路標沒有視野。士兵和[[job:hunter|獵人]]在迷霧中也能找到目標。[[good:catapult|投石機]]只會自行選擇看得見的目標。',
          },
        },
      ],
      see: ['article:scout', 'article:stances', 'article:catapult', 'article:diplomacy', 'job:scout'],
    },
    {
      id: 'scout',
      name: '偵察兵',
      lead: '偵察兵沒有工作地點。沒有命令時站著不動。',
      blocks: [
        {
          p: '他不花材料豎立[[article:roads|路標]]，從野生牛和綿羊身旁走過就能收服它們：[[article:livestock|畜牧]]。他不受路標限制，可走遍全圖。',
        },
        {
          h: '「探索」',
        },
        {
          list: [
            '可以同時派出多名。',
            '從下令位置一圈圈向外探索陸地。',
            '他不會離開所在的陸地。要到別處得靠[[article:vehicles|船]]。',
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
              ['連續超過{{explore.maxFailedLegs}}次走不到目標', '其餘視為不可達，「土地已探索」'],
              ['地圖模式「全開」', '立即「土地已探索」'],
              ['新命令、更換職業', '探索作廢'],
              ['按住Shift下令', '探索結束後執行'],
            ],
          },
        },
      ],
      see: ['article:roads', 'article:livestock', 'article:fog', 'job:scout'],
    },
    {
      id: 'wildlife',
      name: '野生動物與狩獵',
      lead: '攻擊性獸群會撲向其吃草處{{wild.aggro}}格內的人。最多追{{wild.giveUp}}格，然後返回。',
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
                '受擊後攻擊',
                '熊、大象',
                '最後一次受擊後{{wild.angrySeconds}}秒內有危險。已開始的攻擊持續到目標死亡或躲起來',
              ],
              ['膽小', '其餘動物', '頭領受擊後逃開{{wild.flight}}格，獸群跟隨'],
            ],
            foot: '野山羊既不攻擊也不逃跑。',
          },
        },
        {
          list: ['你攻擊一隻動物時，{{wild.kinAlarm}}格內的同種動物也會反應。', '動物不攻擊建築和載具。'],
        },
        {
          h: '獸群增長',
        },
        {
          p: '大約每{{wild.breedingShare}}群只有1群會增長。這樣的獸群只要至少有2隻，且少於「獸群」列的數量，每{{wild.growthMinutes}}分鐘增加1隻成年動物。單獨一隻不會繁殖。',
        },
        {
          h: '獵人的獵物',
        },
        {
          list: [
            '獵場是工作旗幟或工作地點周圍{{flag.hunter}}格。追擊可超出獵場{{wild.huntChase}}格。',
            '他選生命值加距離總和最小的動物。生命值以百、千計，所以最弱的動物勝出，再遠也一樣。',
            '一次只獵1隻，收完獵物才找下一隻。',
            '獵人每箭扣動物{{wild.hunterShot}}生命值，射程{{hunterBow.min}}-{{hunterBow.max}}格。',
            '不會主動獵成年野山羊，其幼崽可獵。',
            '跳過有主人的動物和其他陸地上的動物。',
            '「獵人」列：「自動」是他會自己去獵的獵物，「需下令」只有你下令才攻擊。',
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
      lead: '畜牧師只在某種牲畜成年數量正好是{{livestock.pair}}頭時才繁殖。有第三頭時先宰掉。',
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
            head: ['對象', '做法', '範圍（格）'],
            rows: [
              [
                '[[job:scout|偵察兵]]',
                '每走一步都收服野生牛和綿羊，以及敵對玩家的牲畜。離他較遠的四散',
                '收服{{livestock.captureRange}}，四散{{livestock.scatterRange}}',
              ],
              [
                '[[job:breeder|畜牧師]]',
                '把最近的未入場的自家牲畜帶進畜牧場。不足一對時，也從你另一座超過一對的畜牧場牽一頭',
                '同一片陸地',
              ],
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
            foot: '幼崽和屠宰約需{{livestock.cycleSeconds}}秒。畜牧師的生產選擇決定養哪種牲畜。畜牧場肉、羊毛和皮革各存{{livestock.farmShelf}}份。',
          },
        },
        {
          list: [
            '[[building:work_animal_farm|畜牧場]]總共容納{{livestock.farmHerd}}頭，含兩種牲畜和待出生的幼崽。',
            '幼崽{{livestock.growMinutes}}分鐘長大，之前不計入一對。',
            '出生時親代離畜牧場超過{{livestock.birthRange}}格的話，原料白費，沒有幼崽。',
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
            head: ['職業', '{{piety.lowPct}}%', '{{piety.highPct}}%'],
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
            '低於{{need.drivePct}}%時，[[job:joiner|木匠]]、武器匠、鐵匠和裁縫會自己去禱告。沒有禱告場所時，到{{need.criticalPct}}%顯示「想要禱告」。',
            '已開工的批次在0%時也會做完。',
          ],
        },
        {
          h: '在哪裡禱告',
        },
        {
          table: {
            head: ['地點', '條件'],
            rows: [
              ['民居', '燃著聖火時。居民首選這裡'],
              ['[[building:work_temple|神廟]]、[[building:headquarters|大本營]]', '僅限已完工且屬於你的'],
            ],
            foot: '禱告{{pray.seconds}}秒，信仰+{{pray.pct}}%。',
          },
        },
        {
          h: '聖火',
        },
        {
          p: '三級民居起可以點燃。1份[[good:holy_oil|油]]燃燒{{oil.burnMinutes}}分鐘，滿油{{oil.fullBurnMinutes}}分鐘。沒人禱告也會燃燒。',
        },
        {
          h: '神廟光環',
        },
        {
          table: {
            head: ['項目', '數值'],
            rows: [
              ['範圍', '{{aura.range}}格'],
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
          p: '箱子任何成人都能開，魔法箱子只有[[job:druid|德魯伊]]和英雄能開。命令是「打開箱子」。居民必須在步行範圍內走得到。',
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
              ['平民、婦女、長劍兵或長弓手', '{{chest.settlers}}', '{{chest.settlers}}'],
              [
                '狼或獅子。野生，會立刻攻擊',
                '{{chest.wolves}}或{{chest.lions}}',
                '{{chest.wolves}}或{{chest.lions}}',
              ],
            ],
            num: [1, 2],
            foot: '每個箱子的內容由地圖決定，不是隨機。',
          },
        },
        {
          h: '文書',
        },
        {
          table: {
            head: ['文書', '效果'],
            rows: [
              ['放置一座你選擇的建築', '建造清單中任選一座建築，立即建成'],
              ['放置「名稱」', '指定建築，立即建成'],
              ['放置「名稱」並裝滿庫存', '指定建築，庫存全滿'],
            ],
            foot: '文書用後消失。位置不合適時保留。你的文書在建造視窗的「文書」下。',
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
            foot: '這種箱子也給一名該職業的居民，並解鎖該職業。',
          },
        },
      ],
      see: ['article:construction', 'article:trades', 'article:draughts'],
    },
  ],
};
