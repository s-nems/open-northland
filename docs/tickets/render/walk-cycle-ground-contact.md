# Dopasuj tempo cyklu chodu do przebytej drogi

**Area:** render · **Focus:** sprite-pool/motion · **Priority:** P2

Idące oryginalne postacie ślizgają się i „moonwalkują”: stopa oparta o ziemię przesuwa się względem
gruntu. Zegar chodu w `packages/render/src/gpu/sprite-pool/motion.ts` (`trackMotion`) jest liczony
z realnego przesunięcia, ale z wyprzedzeniem `WALK_ANIMATION_RATE = WALK_TICKS_PER_CELL /
WALK_ANIMATION_TICKS_PER_CYCLE = 18 / 12 = 1.5`: 12-klatkowy cykl gra 1,5 raza szybciej, niż wynika
z założenia „jedna komórka na cykl” (`WALK_FRAME_TRAVEL_PX`). Ta stała powstała z obserwacji, gdy
osadnicy stali na kotwicach ticków i przyciągali się do pikseli ekranu; wtedy wolniejsze tempo
„czytało się jak ślizg”. Ta gałąź włącza umieszczanie między tickami (`present-entity.ts`, gdy
`environmentMotion`) i interpoluje zegar chodu (`motionClocks` w `presentation.ts`), więc rozjazd
między ruchem stóp a ruchem ciała stał się widoczny. Własne assety nie mają tego problemu: ich klipy
podają `travelPerCycle` i `characterGaitRate` (`character-layers.ts`) liczy dokładne tempo;
oryginalne klipy dostają wzór ogólny.

Nieznane: ile pikseli świata pokonuje stopa w autorskim cyklu chodu oryginału, per kierunek. Tylko
z tej liczby wynika właściwe tempo; obecna stała jest przybliżeniem bez źródła.

Środowisko: worktree `~/Projects/vikings/on-graphics-polish`, gałąź
`experiment/graphics-polish`, zawartość przez `ON_CONTENT_DIR=~/Projects/vikings/open-northland/content`,
port 5175. Przełączniki i podgląd: [DEVELOPMENT.md](../../DEVELOPMENT.md#worktree-previews). Zrzuty
z Playwright z widocznym oknem (prawdziwe GPU). Decyzja o zachowaniu należy do użytkownika po sesji.

## Scope

- Najpierw zmierzyć: z klatek atlasu chodu (`cr_hum_body_*`) wyznaczyć przesunięcie stopy opartej
  o ziemię między klatkami, per kierunek, i zsumować na cykl. Równolegle sprawdzić w oryginalnym
  silniku, czy klatka chodu jest związana z tickiem, czy z przebytą drogą (symbole `the original`
  z `WalkSpeed`/animacją w `an original routine`; zapisać źródło jako obserwację lub odczyt symboli).
- Podać oryginalnym klipom chodu zmierzone `travelPerCycle` per kierunek tą samą drogą, którą idą
  własne klipy, i usunąć wyprzedzenie 1,5 albo zastąpić je wartością ze źródła. Zwierzęta z `movespeed`
  idą przez ten sam zegar; limit 3,5 klatki na tick, zatrzymanie i wejście w idle bez zmian.
- Poza zakresem: prędkość symulacji, kamera i sterowanie, klatki pośrednie.

## Verify

- Test `motion`: przy prędkości marszowej jeden cykl przypada na zmierzoną drogę, nie na 12 ticków;
  klip z `travelPerCycle` i klip bez niego dają ten sam wynik dla tej samej drogi.
- Skrypt pomiarowy w Playwright (widoczne okno): seria zrzutów idącej postaci, śledzenie piksela
  stopy opartej o ziemię względem ruchu ciała; ślizg poniżej 1 px ekranowego na klatkę w 8 kierunkach,
  przy `polish=on` i `polish=off`.
- Ocena użytkownika na `magiczny_las`, zoom 1 i 2, także tragarz z ładunkiem i wóz.
- Bramki z [TESTING.md](../../TESTING.md).
