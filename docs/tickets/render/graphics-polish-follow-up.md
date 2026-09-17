# Graphics polish: pozostałe eksperymenty

**Area:** render · **Priority:** P3

## Cel i decyzje użytkownika

Poprawiać prezentację **oryginalnych assetów** Cultures w PixiJS, zachowując ich charakter, tak żeby
gra wyglądała na zremasterowaną. Korzyści dla `assets=own` są dodatkowym plusem. Subtelne zmiany
koloru i światła są dopuszczalne, ale każda wymaga porównania A/B i przełącznika. Mieszanie klatek
(crossfade) zostało odrzucone z powodu podwójnych konturów; nie wracać do tej metody.

Branch ma prawdopodobnie stać się nowym standardem, ale integracja z `main` nie została jeszcze
zatwierdzona. Wznawiając, kierować się poleceniem użytkownika.

## Gdzie kontynuować

- Worktree: `~/Projects/vikings/on-graphics-polish`, gałąź `experiment/graphics-polish`.
- Zawartość gry współdzielona tylko do odczytu przez
  `ON_CONTENT_DIR=~/Projects/vikings/open-northland/content`. Główny checkout
  przegenerowuje ją przy zmianie wersji IR; strona „IR version mismatch” oznacza rebase na `main`.
- Port `5175`. Ostatnio zweryfikowany serwer: npm PID 35952, vite PID 36027 (dane sesji, sprawdzić
  tożsamość przed użyciem lub zatrzymaniem). Nie zatrzymywać innych serwerów; `5173` jest główny.

```bash
ON_CONTENT_DIR=~/Projects/vikings/open-northland/content npm run dev -- --port 5175
npm run dev:verify -- 'http://127.0.0.1:5175/?map=magiczny_las&assets=original&polish=on&zoom=2&sound=off&intro=off&fullscreen=off'
```

Opis działających efektów i parametrów `polish=` / `scaler=` jest w
[DEVELOPMENT.md](../../DEVELOPMENT.md#worktree-previews). Headless Chromium (SwiftShader) nie
wyrabia z shaderami powiększania na pełnym ekranie; do zrzutów i pomiarów uruchamiać Playwright
z widocznym oknem (prawdziwe GPU). Porównania oceniać różnicą pikseli, nie na oko.

## Stan

Zaakceptowane wcześniej: przełączniki jakości, miękkie cienie, płynny ruch, woda, subpikselowe
pozycjonowanie, filtrowanie terenu przy pomniejszeniu, mipmapy gotowych budynków.

Dodane, jeszcze bez akceptacji wizualnej użytkownika (każdy krok osobnym commitem):

- xBR na kolorach po rozwiązaniu palety dla oryginalnych postaci i zwierząt.
- Nazwany batcher `world` z tym samym filtrem dla pozostałej oryginalnej grafiki świata (budynki,
  drzewa, dekoracje, bake'i budowy i odsłaniania); HUD, własne grafiki i teren bez zmian.
- Bikubiczne (Catmull-Rom) powiększanie terenu w miejscu poprzedniego podbicia kontrastu.
- Uśrednianie 2x2 przy pomniejszeniu grafiki świata.

Zmierzone na prawdziwym GPU (DPR 2, zoom 1 i 2): 120 fps, ok. 6 ms GPU w każdym trybie.

## Scope

1. **Izolowane kafle terenu z mipmapami** dla silnego oddalenia na ekranach 1×. Strony atlasu
   terenu nie mają paddingu pod mipmapy całej strony. Porównać migotanie, szwy, pamięć i czas
   przygotowania z obecnym filtrem 4-tapowym.
2. **Cienie kontaktowe pod budynkami.** Oryginalne grafiki mają już domalowane cienie (np. chata
   w `?scene=construction`), więc najpierw sprawdzić, czy nie podwoi to zaciemnienia. Decyzja
   artystyczna, wymaga osobnej oceny.
3. **Wiatr na oryginalnej roślinności.** Większość oryginalnych drzew ma własne klatki kołysania
   (8 klatek); statyczne obiekty jednoklatkowe (ok. 12 tys. na `magiczny_las`) nie mają
   rozróżnienia drzewo/skała w `MapObjectSprite`, więc shear wymagałby klasyfikacji rodzaju.
4. **Rzeczywiste klatki pośrednie** postaci lub ruch wydzielonego mechanizmu. Nie wracać do
   crossfade; wymaga nowych kształtów i zachowania perspektywy oraz zasłaniania.

## Verify

- Oryginalne assety jako pierwszy podgląd, własne jako kontrola zgodności; ta sama mapa, kamera
  i zoom, także ×2 i przy oddaleniu w ruchu ([WORLD-STYLE.md](../../art/WORLD-STYLE.md#quality-and-characters)).
- HUD i jednostki świata pozostają stałe; nie powiększać źródłowych PNG.
- Testować alfa, maski budowy, bounds/picking, przełączanie ustawień na żywo i lifecycle cache.
- Bramki według [TESTING.md](../../TESTING.md), niezależny przegląd istotnych zmian, zweryfikowany
  URL na końcu. Akceptacja użytkownika decyduje o zachowaniu efektu.
