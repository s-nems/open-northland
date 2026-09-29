# Minimapa

Minimapa ma trzy ciemne ramki do wyboru w ustawieniach grafiki (sekcja „Interfejs”): **Żelazo**
(domyślna, okuty ciemny dąb), **Księga** (rzeźbiony dąb i mosiężne narożniki jak w księdze misji)
oraz **Urnes** (wędzony dąb z rzeźbioną bestią w narożnikach). Zmiana działa w grze od razu. Wspólny
kontrakt wyglądu znajduje się w [FOUNDATION.md](../ingame-menu/FOUNDATION.md#minimap-direction),
a pochodzenie grafik i prompty w [generation.md](generation.md).

## Rozmiary i układ

- S / M / L / XL: docelowy dłuższy bok **224 / 280 / 344 / 416 px projektu**.
- Panel przylega do lewego dolnego rogu. Mieści się przed wyśrodkowaną belką nawigacji z odstępem
  6 px projektu oraz pozostawia miejsce panelowi zaznaczenia. Dostępna przestrzeń może ograniczyć rozmiar.
- Krótszy bok dopasowuje się do rzutowanej mapy, lecz skraca najwyżej o jedną trzecią dłuższego;
  maksymalne proporcje zewnętrzne to 1,5:1. Oba boki mają minimum 124 px projektu. Jeśli minimum
  nie mieści się na ekranie, minimapa jest ukryta.
- Listwa ramki kończy się 20 px projektu wewnątrz panelu; narożniki zachowują rozmiar, a zmiana
  proporcji rozciąga tylko listwy. Teren zachowuje jednakową skalę osi X i Y. Niewykorzystane pasy
  wypełnia ciemne drewno w odcieniu ramki, a brązowa linia z cieniem podąża za krawędzią mapy.

## Obsługa

Wszystkie pięć przycisków znajduje się na prawej krawędzi: oddalenie, przybliżenie,
**Pokaż całą**, rozmiar i warstwy. Własne podpowiedzi działają po najechaniu i ustawieniu fokusu.
Trzeci przycisk używa symbolu czterech narożników.

| Działanie | Efekt |
| --- | --- |
| LPM i przeciągnięcie po mapie | Przesunięcie kamery gry |
| Rolka lub + / − | Niezależny zoom minimapy 1–4× |
| Środkowy przycisk i przeciągnięcie | Przesunięcie powiększonego wycinka |
| Pokaż całą | Powrót do pełnego zasięgu |
| Rozmiar | Przełączenie S → M → L → XL |
| Warstwy | Pokazanie lub ukrycie ludzi i budynków |

Panel warstw z ciemnego drewna rozwija się po prawej i w razie potrzeby unosi nad nawigacją. Escape zamyka
panel i przywraca fokus. Podgląd świata po najechaniu jest wyłączony. Obowiązują dotychczasowe
reguły mgły, rozkazów i pierwszeństwa aktywnego trybu wskazania celu.

## Kod i dalszy zakres

Geometrię i projekcję utrzymuje [model.ts](../../../packages/app/src/hud/minimap/model.ts), gesty
[input.ts](../../../packages/app/src/hud/minimap/input.ts), a kontrolki
[chrome.ts](../../../packages/app/src/hud/minimap/chrome.ts), a listę ramek
[frames.ts](../../../packages/app/src/hud/minimap/frames.ts). [Testy modelu](../../../packages/app/test/minimap-model.test.ts)
obejmują dopasowanie, krawędzie i odwrotną projekcję; [testy wejścia](../../../packages/app/test/minimap-input.test.ts)
sprawdzają gesty i ich rozdzielenie od kamery świata.

Osobna duża mapa, jej wejście, szczegółowe kategorie oraz oznaczenia zaznaczenia i wydarzeń pozostają
w [tickecie 19](../../tickets/app/ingame-ui-19-map-overview.md). Zatwierdzenie minimapy nie rozstrzyga
wyglądu dużej mapy.
