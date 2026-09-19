# Zmiękcz krawędź cieni płaskich dekoracji

**Area:** render · **Focus:** map-objects/decor-batch · **Priority:** P3

Płaskie dekoracje rysują już sylwetki cienia z danych mapy: osobna partia czworokątów na stronę atlasu
cieni (`decor-batch.ts`), w kontenerze pod wszystkimi ciałami dekoracji, ze stylem cienia (siła, sufit,
odcień) w `decor-shadow-shader.ts`. Przy włączonych miękkich cieniach wysokie obiekty dostają rozmyty
wypiek na klatkę (`SoftShadowCache`), a dekoracje zostają z twardą krawędzią, bo osobna tekstura na klatkę
nie wejdzie do jednej siatki. Na `magiczny_las` to 20 114 czworokątów, z czego widoczny cień mają głównie
krzaki (36x24 px), suche drzewa i grzyby; różnicę widać od przybliżenia x2.

Środowisko: worktree `~/Projects/vikings/on-graphics-polish`, gałąź
`experiment/graphics-polish`, zawartość przez `ON_CONTENT_DIR=~/Projects/vikings/open-northland/content`,
port 5175. Przełączniki i podgląd: [DEVELOPMENT.md](../../DEVELOPMENT.md#worktree-previews). Decyzja
o zachowaniu należy do użytkownika po sesji.

## Scope

- Rozmycie w shaderze cienia dekoracji: kilka próbek alfa przyciętych do prostokąta klatki (atrybut na
  czworokąt), z czworokątem poszerzonym o promień rozmycia, tylko przy włączonym przełączniku. Jądro ma
  odpowiadać `softenShadowAlpha` na tyle, żeby krzak obok drzewa nie odstawał.
- Jeśli rozmycie wymaga więcej niż shader i jeden atrybut, zamknąć ticket bez zmian: twarda krawędź
  przy tych rozmiarach jest akceptowalna.
- Poza zakresem: wysokie obiekty, własne assety, cienie wymyślane dla rekordów bez sylwetki.

## Verify

- Test shadera lub partii: atrybut prostokąta klatki i poszerzony czworokąt przy włączonym przełączniku.
- Zrzuty A/B tego samego kadru `magiczny_las` (środek 8600,4950) przy x2 i x3, krzak obok wysokiego drzewa.
- Bramki z [TESTING.md](../../TESTING.md), ocena użytkownika.
