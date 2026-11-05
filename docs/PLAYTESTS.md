# Mission playtest status

Which maps a playtest session has driven to their end, and what it found. One row per map in
`content/maps-index.json`; a session updates its row in the commit that closes the session.
Method and tools: [TESTING.md](TESTING.md#mission-playtests).

Status values: `–` not tested, `wip` session in progress, `ok` reached the map's end with every
main objective through ordinary play or a logged forced step, `issues` reached the end but left
tickets (link them in Notes), `blocked` could not reach the end (say why). **Headless** is the
drive-library probe a session ran (probes are not committed); **Browser** is a played session in the real app. A sub-mission map is driven
from its parent and takes the parent's row unless it fails on its own.

## Tutorials (8)

| Map | Name | Seats | Headless | Browser | Notes |
| --- | --- | --- | --- | --- | --- |
| `tutorial_001` | 1) STEROWANIE | 3h/1ai | ok | ok | played in Polish; four-language briefing review; family and signpost text corrections |
| `tutorial_002` | 2) KAŻDY WIKING JEST UNIKALNY! | 3h/0ai | – | ok | played in Polish, death/retry covered; open: [family goal specificity](tickets/sim/mission-family-goal-specificity.md) |
| `tutorial_003` | 3) ŁAŃCUCH POKARMOWY | 2h/0ai | ok | ok | played in Polish, no forced step; clay-collector goal text shown, page 1 wording correction; build menu relists under pause; a refused worker order names its reason |
| `tutorial_004` | 4) TECHNOLOGIE | 1h/0ai | ok | issues | played in Polish, no forced step; handcart goal counts the cart as a vehicle (correction); open: [portrait shows HUD behind](tickets/app/portrait-hole-shows-hud-behind.md) |
| `tutorial_005` | 5) HANDEL I STATKI | 2h/2ai | – | – |  |
| `tutorial_006` | 6) WALKA I SYSTEM DYPLOMACJI  | 2h/3ai | – | – |  |
| `tutorial_007` | 7) DODATKOWE BRONIE I PRZEDMIOTY | 2h/3ai | – | – |  |
| `tutorial_009` | 8) SPECJALNY: ROZBUDOWA OSADY PRO | 1h/2ai | – | – |  |

## Campaigns (57 maps)

Campaign maps are converted by the campaigns stage of the full pipeline; `npm run map:convert`
does not reach them.

### Bramy Asgardu (`asgard`, 14)

| Map | Name | Seats | Headless | Browser | Notes |
| --- | --- | --- | --- | --- | --- |
| `asgard-campaign_01_01` | GRENLANDIA | 3h/3ai | ok | ok | played in Polish, mead economy by ordinary orders, voyage and Normandy unlock; Bjarni's death covered; briefing typo corrections; Build window refreshes while paused |
| `asgard-campaign_01_02_sub` | NORMANDIA - zadanie dodatkowe | 2h/5ai | ok | ok | sub-mission; escort in hops under the civilian walk range, valley battle partly forced; catapult capture, reinforcements and princess death covered; Polish typo corrections |
| `asgard-campaign_01_02` | NORMANDIA | 1h/8ai | ok | ok | played in Polish: informant, both letter orders, valley entry, sub-mission and return, ransom and battle endings, unlock of England; Bjarni's death covered; tribute stock and the last of the battle forced; script corrections (informant goal, early victory page, waiting-princess reminder), briefing fixes (prince east of the town, Papers tab); the cave mouth's floor is sealed by the map's own stones, so the valley entry is reached in front of the rocks |
| `asgard-campaign_01_03` | ANGLIA | 2h/7ai | – | – |  |
| `asgard-campaign_01_04_sub` | ITALIA - zadanie dodatkowe | 1h/0ai | – | – | sub-mission |
| `asgard-campaign_01_04` | ITALIA | 2h/5ai | – | – |  |
| `asgard-campaign_01_05_sub` | MIKLAGARD - zadanie dodatkowe | 1h/2ai | – | – | sub-mission |
| `asgard-campaign_01_05` | MIKLAGARD | 1h/7ai | – | – |  |
| `asgard-campaign_01_06` | STRAŻ WAREGÓW | 1h/2ai | – | – |  |
| `asgard-campaign_01_07` | WOJNA O BIZANCJUM | 2h/4ai | – | – |  |
| `asgard-campaign_01_08` | ALEKSANDRIA | 1h/7ai | – | – |  |
| `asgard-campaign_01_10_sub` | BAGDAD - zadanie dodatkowe | 1h/4ai | – | – | sub-mission |
| `asgard-campaign_01_10` | BAGDAD | 3h/8ai | – | – |  |
| `asgard-campaign_01_11` | MUR WIGRID | 1h/5ai | – | – |  |

### Wyprawa na Północ (`northland`, 12)

| Map | Name | Seats | Headless | Browser | Notes |
| --- | --- | --- | --- | --- | --- |
| `northland-campaign_02_01` | PLAGA | 1h/7ai | ok | ok | played in Polish; win, unlock of stage 2, hero and village defeats, defence and large-attack routes, save/restore; Miguel's gold goal and Polish defeat page corrected; without orders the village kills 57 of the 92 snakes and holds, so the main goal needs the player |
| `northland-campaign_02_02_sub` | TRZY ŻYCZENIA - WIELKA KLĘSKA GŁODU | 1h/1ai | ok | ok | sub-mission played in Polish; doors, genie, three answers, wrong answer, hero death, return to the parent; cave crossing forced; Polish "step off the switches" page corrected; open: [idle heroes opening the snake chamber](tickets/sim/idle-heroes-open-dungeon-doors.md) |
| `northland-campaign_02_02` | WIELKA KLĘSKA GŁODU | 1h/6ai | ok | ok | played in Polish; both routes to the catacombs (own heroes, bribed Saracens and Ykol), win, unlock of stage 3, hero and village defeats, refugees after 30 min, save/restore; goal 0 restored by reading a missing description as string 0; buildings past the technology gate and the tributes' goods forced |
| `northland-campaign_02_03` | STARZY PRZYJACIELE | 1h/4ai | – | – |  |
| `northland-campaign_02_04_sub1` | MIECZE KRÓLI - ŁAŃCUCH FENRISA | 1h/2ai | – | – | sub-mission |
| `northland-campaign_02_04_sub2` | WYSPA MILCZĄCYCH - ŁAŃCUCH FENRISA | 1h/0ai | – | – | sub-mission |
| `northland-campaign_02_04` | ŁAŃCUCH FENRISA | 1h/6ai | – | – |  |
| `northland-campaign_02_05` | HORDY FENRISA | 2h/3ai | – | – |  |
| `northland-campaign_02_06` | PÓŁNOC | 2h/2ai | – | – |  |
| `northland-campaign_02_07_sub` | LODOWA KRAINA | 2h/4ai | – | – | sub-mission |
| `northland-campaign_02_07` | KRÓLESTWO HEL | 1h/5ai | – | – |  |
| `northland-campaign_02_08` | ASGARD | 2h/2ai | – | – |  |

### Ósmy Cud Świata (`wonder`, 17)

| Map | Name | Seats | Headless | Browser | Notes |
| --- | --- | --- | --- | --- | --- |
| `wonder-campaign_03_01` | LATARNIA MORSKA Z FAROS | 2h/6ai | ok | ok | played in Polish; goods-first and Sostratos-first routes, vagabonds paid or fought, Viking tribute, hero and Sostratos deaths, unlock of stage 2; economy, stores and the long walks forced; fighter commander restocking a ship got lost (fixed); Polish briefing and settlement goal text corrected; the missing post in the vagabond camp's east wall corrected |
| `wonder-campaign_03_01_sub` | ŚWIĘTY OGIEŃ | 1h/3ai | – | ok | sub-mission; entered and left from the parent in the browser, guard fight and walks forced |
| `wonder-campaign_03_02` | WISZĄCE OGRODY SEMIRAMIDY  | 1h/6ai | ok | ok | played in Polish; win across a save, unlock of stage 3, tribute and fight routes for the women (the fight breaks the robbers' gate and pen wall), hero and women defeats, Kobul, chests, catapults, magic fields; economy, wells and stores forced; slot-5 info line, tunnel refusal after the women's return and Polish page 4 corrected |
| `wonder-campaign_03_02_sub` | PODZIEMNE KORYTARZE  | 1h/4ai | ok | ok | sub-mission; scripted chain to the end transition passes, fight forced; closed gates seal the exit in the route regression and the authored all-gates opening restores access |
| `wonder-campaign_03_03` | KOLOS Z RODOS  | 1h/14ai | – | – |  |
| `wonder-campaign_03_03_sub1` | KOLOS - SEKRETNE PRZEJŚCIE | 1h/1ai | – | – | sub-mission |
| `wonder-campaign_03_03_sub2` | KOLOS - SEKRETNE PRZEJŚCIE | 1h/1ai | – | – | sub-mission |
| `wonder-campaign_03_03_sub3` | KOLOS - WYROCZNIA | 1h/1ai | – | – | sub-mission |
| `wonder-campaign_03_04` | MAUZOLEUM | 1h/8ai | – | – |  |
| `wonder-campaign_03_05` | ŚWIĄTYNIA ARTEMIDY | 2h/5ai | – | – |  |
| `wonder-campaign_03_05_sub1` | SPADKOBIERCY HEROSTRATESA | 1h/2ai | – | – | sub-mission |
| `wonder-campaign_03_05_sub2` | ZAGINIONE BAGNA | 1h/1ai | – | – | sub-mission |
| `wonder-campaign_03_06` | STATUA ZEUSA FIDIASZA W OLIMPII  | 3h/6ai | – | – |  |
| `wonder-campaign_03_06_sub1` | ZAWODY | 1h/2ai | – | – | sub-mission |
| `wonder-campaign_03_06_sub2` | MORZE PŁOMIENI | 1h/1ai | – | – | sub-mission |
| `wonder-campaign_03_07` | PIRAMIDY Z GIZA | 2h/7ai | – | – |  |
| `wonder-campaign_03_08` | ÓSMY CUD ŚWIATA | 1h/9ai | – | – |  |

### Saga (`saga`, 14)

| Map | Name | Seats | Headless | Browser | Notes |
| --- | --- | --- | --- | --- | --- |
| `saga-campaign_04_01` | PRZYGODA W KRAINIE SMOKÓW | 3h/5ai | ok | ok | played in Polish with its three sub-missions; both cake routes, Napalians healed or beaten, hero deaths, save/restore in parent and sub-map, next-stage unlock; the boy now walks to his sister and the children stay young (behaviour bits 8 and 18); holy-hall death pages corrected; four-language page text compared |
| `saga-campaign_04_01_sub1` | POD MORZEM | 1h/1ai | – | – | sub-mission |
| `saga-campaign_04_01_sub2` | POD MORZEM | 1h/2ai | – | – | sub-mission |
| `saga-campaign_04_01_sub3` | ŚWIĘTA KOMNATA KAMIENNYCH SMOKÓW | 1h/4ai | – | – | sub-mission |
| `saga-campaign_04_02` | MROCZNY LAS | 1h/2ai | issues | issues | played in Polish with both sub-missions (sub-map 2 also standalone headless); Pyro dug free, crystal, honey tribute, wool trade with Rzepakówna's store, hero and Pyro deaths, camp goal, save/restore in parent and sub-map, next-stage unlock; a move click into a sealed pocket now stops at its edge; page 14 points south to Pyro in all four languages; forced: economy, trader, collectors at Pyro; open: [dragons lock themselves in](tickets/sim/darkwood-dragons-lock-themselves-in.md) |
| `saga-campaign_04_02_sub1` | CIEMNO CHOĆ OKO WYKOL | 1h/0ai | – | – | sub-mission |
| `saga-campaign_04_02_sub2` | CIEMNO CHOĆ OKO WYKOL | 1h/3ai | – | – | sub-mission |
| `saga-campaign_04_03` | WIELKA PRZEPROWADZKA | 1h/7ai | – | – |  |
| `saga-campaign_04_03_sub1` | POD MORZEM | 1h/1ai | – | – | sub-mission |
| `saga-campaign_04_04` | UWOLNIENIE SMOKÓW ZIEMI | 1h/7ai | – | – |  |
| `saga-campaign_04_04_sub1` | TRZY WODOSPADY | 1h/1ai | – | – | sub-mission |
| `saga-campaign_04_04_sub2` | UWOLNIENIE SMOKÓW | 1h/4ai | – | – | sub-mission |
| `saga-campaign_04_05` | POWRÓT DO DOMU | 2h/8ai | – | – |  |
| `saga-campaign_04_05_sub1` | POD MORZEM | 1h/1ai | – | – | sub-mission |

## Single-player maps (70)

| Map | Name | Seats | Headless | Browser | Notes |
| --- | --- | --- | --- | --- | --- |
| `blekiny_nurt` | BŁĘKITNY NURT | 1h/4ai | – | – |  |
| `boso_przez_swiat` | BOSO PRZEZ ŚWIAT | 1h/15ai | ok | wip | main chain to `MissionWon` with 26 forced steps (economy, armies, ship legs, the pyramid battle), hero and pyramid defeat, side tributes, every sub-mission map to `EndSubMission`; script typo correction; browser: four-language briefing, sub2 and sub5 round trips from saves, sub3 opening; the sub3→sub4 chain was not played in the browser |
| `boso_przez_swiat_sub2` | LOCHY AL-MUKALLAH | 1h/4ai | – | – | sub-mission |
| `boso_przez_swiat_sub3` | ZATOKA ADEŃSKA | 1h/0ai | – | – | sub-mission |
| `boso_przez_swiat_sub4` | PODWODNA JASKINIA | 1h/1ai | – | – | sub-mission |
| `boso_przez_swiat_sub5` | KRYJÓWKA ZOHANOWATEGO | 1h/1ai | – | – | sub-mission |
| `cn_0` | CULTURESNATION: POWRÓT GATO | 2h/13ai | – | – |  |
| `cn_1` | CULTURESNATION: PROLOG | 1h/2ai | – | – |  |
| `cn_2` | CULTURESNATION: ARES | 1h/2ai | – | – |  |
| `cn_2_dni` | CULTURESNATION: 2 DNI | 1h/5ai | – | – |  |
| `cn_2_dni_sub` | CULTURESNATION: 2 DNI - WIZJE ZOHANA | 1h/4ai | – | – | sub-mission |
| `cn_3` | CULTURESNATION: PODZIEMIA | 1h/2ai | – | – |  |
| `cn_4` | CULTURESNATION: LOCHY | 2h/5ai | – | – |  |
| `cn_5` | CULTURESNATION: OKTAGON | 1h/1ai | – | – |  |
| `cn_6` | CULTURESNATION: KWATERA GŁÓWNA | 1h/1ai | – | – |  |
| `demo_mainmenu_10` | CULTURESNATION: PROLOG | 1h/2ai | – | – |  |
| `gringo` | GRINGO WŚRÓD DZIKICH PLEMION | 1h/13ai | ok | ok | played in Polish; every main and side objective, hero and temple defeats, save/restore; the prison palisade broken by right-click, Habibi's boats, tribute and tunnel routes; forced: the miners' battle, the prison guards, both raid defences, Zohan's fortress, the weresnakes and the temple defence, each lost or out of reach by straight assault; browser segments loaded from headless saves (prison, temple countdown, sub-mission round trip to the victory); German Bożygniew naming and English page 514 heading corrected |
| `gringo_sub` | GRINGO - BITWA NA DZIKIM PUSTKOWIU | 1h/3ai | ok | ok | sub-mission; the battle is forced: by straight assault the 247-strong army loses to 486, and the map has no loss branch |
| `kraina_starych_bohaterow` | KRAINA STARYCH BOHATERÓW | 1h/7ai | – | – |  |
| `kraina_starych_bohaterow_sub1` | Grobowiec Starożytnych | 1h/3ai | – | – | sub-mission |
| `kraina_starych_bohaterow_sub2` | Pokonać Nieśmiertelnego | 1h/4ai | – | – | sub-mission |
| `mroczny_swiat` | MROCZNY ŚWIAT | 1h/11ai | ok | ok | played in Polish to the win with all four sub-missions; every side encounter, both Alibaba routes and the hero-death defeat driven; forced: the settlement, the Seljuk ransom gold and 277 of Mrok's 301 warriors; fixed hero needs and a crowd boarding livelock; Kain and north-west briefing corrections in four languages |
| `mroczny_swiat_sub1` | MROCZNY ŚWIAT: PROLOG | 2h/1ai | – | – | sub-mission |
| `mroczny_swiat_sub2` | MROCZNY ŚWIAT: KRYPTA | 1h/1ai | – | – | sub-mission |
| `mroczny_swiat_sub3` | MROCZNY ŚWIAT | 1h/1ai | – | – | sub-mission |
| `mroczny_swiat_sub4` | MROCZNY ŚWIAT: UMYSŁ BJARNIEGO | 1h/3ai | – | – | sub-mission |
| `niezwykla_wyprawa` | NIEZWYKŁA WYPRAWA | 1h/8ai | – | – |  |
| `nowa_nadzieja` | NOWA NADZIEJA | 1h/10ai | – | – |  |
| `nowa_nadzieja_byz` | NOWA NADZIEJA - BIZANTYJCZYCY | 1h/10ai | – | – |  |
| `nowa_nadzieja_egy` | NOWA NADZIEJA - EGIPCJANIE | 1h/10ai | – | – |  |
| `nowa_nadzieja_fra` | NOWA NADZIEJA - FRANKOWIE | 1h/10ai | – | – |  |
| `nowa_nadzieja_sar` | NOWA NADZIEJA - SARACENI | 1h/10ai | – | – |  |
| `nowa_nadzieja_vik` | NOWA NADZIEJA - WIKINGOWIE | 1h/10ai | – | – |  |
| `przekleta_dolina` | PRZEKLĘTA DOLINA | 1h/7ai | – | – |  |
| `saracen_1` | PDP : 01 WRÓG NA NASZEJ ZIEMI | 1h/9ai | – | – |  |
| `saracen_1_sub_1` | PDP : 01 - HATCHIE NA FAZIE | 1h/1ai | – | – | sub-mission |
| `saracen_1_sub_2` | PDP : 01 - KOPALNIA KOBOLDÓW - PRZESZŁOŚĆ | 2h/4ai | – | – | sub-mission |
| `saracen_2` | PDP : 02 KOZOLAND | 1h/12ai | – | – |  |
| `saracen_2_sub_1` | PDP : 02 - KOZOLAND - PRZESZŁOŚĆ | 1h/7ai | – | – | sub-mission |
| `saracen_3` | PDP : 03 W SERCU NAWAŁNICY | 1h/7ai | – | – |  |
| `saracen_3_sub_1` | PDP : 03 - JASKINIA W WODOSPADZIE | 1h/8ai | – | – | sub-mission |
| `saracen_3_sub_2` | PDP : 03 - GNIAZDO MARDUKA | 1h/6ai | – | – | sub-mission |
| `saracen_3_sub_3` | PDP : 03 - W SERCU NAWAŁNICY - PRZESZŁOŚĆ | 1h/10ai | – | – | sub-mission |
| `saracen_4` | PDP : 04 UPADEK RIJADU | 1h/14ai | – | – |  |
| `saracen_4_sub_1` | PDP : 04 - WYSPY CIENIA - PRZESZŁOŚĆ | 1h/2ai | – | – | sub-mission |
| `saracen_4_sub_2` | PDP : 04 - PODZIEMIA PROTEKTORATU | 1h/1ai | – | – | sub-mission |
| `saracen_4_sub_3` | PDP : 04 - PUSTYNIA MEHAT | 1h/2ai | – | – | sub-mission |
| `saracen_4_sub_4` | PDP : 04 - WNĘTRZE SFINKSA | 1h/1ai | – | – | sub-mission |
| `straznicypolnocy` | STRAŻNICY PÓŁNOCY | 1h/12ai | – | – |  |
| `straznicypolnocy_sub1` | LEGOWISKO POTWORÓW | 2h/3ai | – | – | sub-mission |
| `straznicypolnocy_sub2` | JOTUNHEIM | 1h/2ai | – | – | sub-mission; ice-wall blocking has no content regression, full playthrough pending |
| `upadek_krola` | UPADEK KRÓLA | 1h/7ai | – | – |  |
| `upadek_krola_sub` | WIĘŹIENIE ALTERACK | 1h/2ai | – | – | sub-mission |
| `wielka_bitwa_z_saracenami` | WIELKA BITWA Z SARACENAMI | 1h/12ai | – | – |  |
| `wielka_inwazja` | WIELKA INWAZJA | 1h/7ai | – | – |  |
| `wielkie_sprzatanie_2_0` | WIELKIE SPRZĄTANIE 2.0 | 1h/9ai | – | – | open: [pigeon chest](tickets/sim/pigeon-chest-access.md) |
| `wilczy_lad` | WILCZY LĄD | 1h/3ai | – | – |  |
| `wilczy_lad_sub` | Wilczy Lad - Zadanie Dodatkowe | 1h/1ai | – | – | sub-mission |
| `wybrzeze_czarow` | WYBRZEŻE CZARÓW | 1h/11ai | – | – |  |
| `wybrzeze_czarow_sc1` | WYBRZEŻE CZARÓW - SZKOŁA 1 | 1h/2ai | – | – | sub-mission |
| `wybrzeze_czarow_sc2` | WYBRZEŻE CZARÓW - SZKOŁA 2 | 1h/2ai | – | – | sub-mission |
| `wybrzeze_czarow_sub1` | WYBRZEŻE CZARÓW - LEGOWISKO WĘŻY | 1h/1ai | – | – | sub-mission |
| `wybrzeze_czarow_sub2` | WYBRZEŻE CZARÓW - ARABIA | 1h/2ai | – | – | sub-mission |
| `wybrzeze_czarow_sub3` | WYBRZEŻE CZARÓW - JASKINIA | 1h/2ai | – | – | sub-mission |
| `wybrzeze_czarow_sub4` | WYBRZEŻE CZARÓW - JASKINIA | 1h/2ai | – | – | sub-mission |
| `zdradziecka_mielizna` | ZDRADZIECKA MIELIZNA | 1h/8ai | – | – |  |
| `zdradziecka_mielizna_sub1` | ZDRADZIECKA MIELIZNA-sub | 2h/1ai | – | – | sub-mission |
| `zdradziecka_mielizna_sub2` | ZDRADZIECKA MIELIZNA-sub2 | 1h/2ai | – | – | sub-mission |
| `zdradziecka_mielizna_sub3` | ZDRADZIECKA MIELIZNA-sub3 | 1h/2ai | – | – | sub-mission |
| `zimna_wojna` | ZIMNA WOJNA | 1h/12ai | – | – |  |

## Multiplayer maps (45)

A multiplayer map is driven with every seat filled (`computer=` for the others) to its match
verdict; its multiplayer goals table is the objective list.

| Map | Name | Seats | Headless | Browser | Notes |
| --- | --- | --- | --- | --- | --- |
| `arabskie_wyspy_wolna_gra_mieszana` | ARABSKIE WYSPY | 6h/3ai | – | – |  |
| `battle_for_the_four_hills_multiplayer` | BITWA O CZTERY WZGÓRZA | 1h/3ai | – | – |  |
| `burza_piaskowa` | BURZA PIASKOWA | 6h/1ai | – | – |  |
| `burza_przybzezna_1_2` | BURZA PRZYBRZEŻNA | 1h/2ai | – | – |  |
| `ciezka_wspolpraca` | CIEZKA WSPOLPRACA | 4h/0ai | – | – |  |
| `czarnoksieznik_z_szeolu` | CZARNOKSIĘŻNIK Z SZEOLU | 5h/5ai | – | – |  |
| `diamentowa_dolina` | DIAMENTOWA DOLINA | 8h/1ai | – | – |  |
| `flagomania_1_0_01` | CTF: FLAGOMANIA | 2h/3ai | – | – |  |
| `kraina_tysisca_jezior_1_1` | KRAINA TYSIĄCA JEZIOR | 1h/2ai | – | – |  |
| `krol_przeleczy` | KRÓL PRZEŁĘCZY | 1h/2ai | – | – |  |
| `krwawa_rzeka` | KRWAWA RZEKA | 1h/11ai | – | – |  |
| `lowcypustyni2` | ŁOWCY PUSTYNI 2 | 5h/2ai | – | – |  |
| `magiczny_las` | MAGICZNY LAS | 6h/1ai | – | – |  |
| `magiczny_las_12_players` | MAGICZNY LAS (v2) | 12h/1ai | – | – |  |
| `magiczny_las_nations` | MAGICZNY LAS (v3) | 6h/1ai | – | – |  |
| `magiczny_las_rozbudowa_latwa` | MAGICZNY LAS (v4) | 6h/1ai | – | – |  |
| `mroczny_las` | MROCZNY LAS | 3h/2ai | – | – |  |
| `multiplayer_104_militar` | WOJSKO: ZIMNA WIOSNA | 1h/9ai | – | – |  |
| `multiplayer_201_special_coop` | WSPÓŁPRACA: NAWAŁNICA  | 1h/15ai | – | – |  |
| `oasis_o_plenty` | OAZA OBFITOŚCI | 6h/7ai | – | – |  |
| `oczy_weza` | OCZY WEZA | 1h/4ai | – | – |  |
| `piec_dolin` | Pięć Dolin | 15h/0ai | – | – |  |
| `piracka_utopia_1_0` | PIRACKA UTOPIA | 1h/3ai | – | – |  |
| `plytkie_brody_1_1` | PŁYTKIE BRODY | 2h/2ai | – | – |  |
| `polski_mlyn_1_1` | POLSKI MŁYN | 3h/4ai | – | – |  |
| `przekleta_kraina` | PRZEKLĘTA KRAINA | 4h/5ai | – | – |  |
| `samotna_gora` | SAMOTNA GÓRA | 1h/1ai | – | – |  |
| `smocza_kraina` | SMOCZA KRAINA III | 3h/3ai | – | – |  |
| `specjalna_forteca` | SPECJALNA: FORTECA | 1h/12ai | – | – |  |
| `specjalna_mosty_na_rzece` | SPECJALNA: MOSTY NA RZECE | 1h/5ai | – | – |  |
| `starozytny_trakt` | STAROŻYTNY TRAKT | 4h/0ai | – | – |  |
| `the_lake_of_the_mists` | JEZIORO MGIEL | 1h/2ai | – | – |  |
| `trybuty_dwoch_swiatow` | TRYBUTY DWÓCH ŚWIATÓW | 6h/1ai | – | – |  |
| `ucieczka_z_gazy` | UCIECZKA Z GAZY | 5h/3ai | – | – |  |
| `w_oku_niepewnosci` | W OKU NIEPEWNOŚCI | 4h/0ai | – | – |  |
| `walhalla` | WALHALLA | 6h/2ai | – | – |  |
| `walka_niekonczace` | Walka: NIEKOŃCZĄCE SIĘ SUROWCE | 1h/3ai | – | – |  |
| `wichry_zimy` | WICHRY ZIMY | 2h/7ai | – | – |  |
| `wielka_kolonizacja` | WIELKA KOLONIZACJA | 5h/1ai | – | – |  |
| `wielka_kolonizacja_ii_1_1` | WIELKA KOLONIZACJA II | 5h/5ai | – | – |  |
| `wielka_kolonizacja_ii_1_1_10_players` | WIELKA KOLONIZACJA II (v2) | 10h/5ai | – | – |  |
| `wody_nilu` | WODY NILU | 2h/1ai | – | – |  |
| `wyspa_lupiezcow` | WYSPA ŁUPIEŻCÓW | 1h/2ai | – | – |  |
| `wyspy_polnocy` | WYSPY PÓŁNOCY | 6h/1ai | – | – |  |
| `zgielk2` | SPECJALNY ZK: ZGIEŁK 2 | 4h/0ai | – | – |  |
