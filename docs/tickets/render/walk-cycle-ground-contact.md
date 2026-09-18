# Umieszczaj idącą oryginalną postać w takt klatki chodu

**Area:** render · **Focus:** sprite-pool/present-entity · **Priority:** P2

Tempo animacji chodu jest nienaruszalne: oryginał gra jedną autorską klatkę na tick z globalnego
licznika (`an original routine`, `the original`, klatka =
`frameList[dir][tick % frameCount]`), a `trackMotion` w `motion.ts` daje dokładnie to samo tempo
(`WALK_ANIMATION_RATE = 18/12` kompensuje 18 ticków na komórkę). Stopy w grafice cofają się 34 px
na 12-klatkowy cykl (pomiar z atlasu `cr_hum_body`, kierunki W/E/SW/SE), a ciało pokonuje w tym
czasie 45 px, więc 0,94 px ślizgu na tick jest własnością oryginału. Dopasowanie zegara do przebytej
drogi próbowano i odrzucono: przyspieszało nogi 1,3 do 2 razy, zwierzętom 3 do 5 razy.

Co zostało: na tej gałęzi `environmentMotion` interpoluje pozycję osadnika między tickami
(`present-entity.ts`, `smooth`), więc w czasie trwania jednej klatki ciało sunie 3,8 px, a oparta
stopa sunie razem z nim. Przy kotwicach ticków (jak `main` i oryginał) całe przesunięcie dzieje się
w chwili zmiany klatki i stopa czyta się jako oparta. Użytkownik pamięta tę zależność jako wcześniej
poprawiony moonwalk: pozycja ma się aktualizować razem z klatką.

Porównanie na 5175: `polish=sampling,shadows` (kotwice ticków) kontra `polish=on` (interpolacja).

## Scope

- Jeśli użytkownik wybierze kotwice: dla oryginalnych klipów chodu `smooth` wynika wyłącznie
  z `interpolateMotion` własnego assetu, a `environmentMotion` nie interpoluje już osadników
  ani zwierząt; własne assety z `travelPerCycle` bez zmian. Zaktualizować opis przełącznika
  w katalogach i `docs/DEVELOPMENT.md`.
- Poza zakresem: tempo klatek, prędkość symulacji, klatki pośrednie, kamera.

## Verify

- Test `present-entity`/`motion`: oryginalny osadnik w ruchu przy `environmentMotion` dostaje
  `alpha = 1`; własny asset z `interpolateMotion` nadal interpoluje.
- GIF przed/po idącego na wschód osadnika przy `polish=on`, kamera przypięta; ocena użytkownika.
- Bramki z [TESTING.md](../../TESTING.md).
