---
id: koer-et-lot
title: Kør et lot
lead: Den centrale arbejdsgang. Kør den ens hver gang.
order: 2
trigger: Hver gang et lot roefrø skal scannes
duration: 10-20 min afhængigt af prøvestørrelse
icon: scan-line
category: wiki
---

Det er her, data bliver til. Alt hvad der gøres forskelligt fra gang til gang, bliver til forskelle i data, som ingen bagefter kan se stammer fra betjeningen frem for fra frøene.

Instrumentet skal være initialiseret og varmet op, og kalibreringen skal være gyldig. Er den ikke det, så kør **Daglig opstart** først.

## Åbn Autofeeder Blob Analyzer

**Imaging Devices → VideometerLab → Autofeeder Blob Analyzer**

Findes recepten allerede, kan du i stedet klikke direkte på den, så åbner analyzeren med recepten indlæst.

## Indlæs recepten

Klik mappe-ikonet øverst til venstre, og vælg recepten. Klassifikationerne vises derefter i højre side af vinduet.

> [!UDFYLD]
> Her skal stå, hvilken recept der bruges til hvilken frøtype, og hvem der må ændre den. Skriv navnene ind, så ingen skal gætte.

> [!WARNING]
> Står der en stjerne `*` ved receptnavnet under målingen, er recepten valgt, men ikke gemt. Kør ikke videre. Du ved så ikke, hvilke parametre målingen faktisk blev kørt med.

## Klargør prøven og fyld tragten

Hæld prøven i tragten på vibratoren.

Spacer'en skal passe til frøtypen. Den sidder der for at forhindre, at der løber for meget materiale ned i shakeren på én gang.

> [!UDFYLD]
> Angiv hvilken spacer der bruges til roefrø, og hvor de øvrige ligger.

## Skriv Operator og Sample ID

Nederst til venstre: dine initialer under **Operator**, og lottets identifikation under **Sample ID**.

Begge felter er obligatoriske. Start-knappen aktiveres ikke uden dem.

> [!WARNING]
> Sample ID er den eneste tråd tilbage til, hvilket lot resultatet hører til. Findes den ikke, eller er den skrevet på en anden måde end sidst, kan målingen ikke bruges bagefter, uanset hvor god scanningen var.

> [!UDFYLD]
> Her skal jeres navngivningskonvention for Sample ID stå, med et konkret eksempel. Den skal være ens for alle fire.

## Tjek Learn Belt og Conveyor Distance

Åbn **Autofeeder Parameter Control** (tandhjulet øverst til højre).

**Learn Belt** skal være kørt. Den lærer softwaren, hvor skævt båndet sidder i forhold til kameraets synsfelt. Kør den igen, hvis båndenheden har været flyttet eller afmonteret. Værdien er global og gælder for alle produkter.

**Conveyor Distance** skal stå rigtigt. Standard er 105 mm.

> [!NOTE]
> Conveyor Distance styrer overlappet mellem to på hinanden følgende billeder. Er den for stor, bliver blobs klippet over eller helt udeladt af tællingen, uden nogen fejlmeddelelse. Reglen er `Conveyor Distance = 120 − største diameter i mm`.

## Start målingen

Tryk **Start**.

Under den første fremføring skal prøven flytte sig frem på vibratorpladen **uden at falde ned på båndet**. Den skal først forlade vibratoren ved 2. eller 3. kørsel.

Sker det ikke, er **Initial Feeder Speed** sat forkert.

## Juster coverage, indtil fordelingen er jævn

Hold øje med **Coverage** i feltet Product Vibration.

- **For høj**: skru **Feeder Speed** ned
- **For lav**: skru **Feeder Speed** op

Der står to tal. **Brug det første**: det er gennemsnittet over de sidste 3 billeder. Tallet i parentes er kun det seneste billede og svinger for meget til at justere efter.

> [!CHECK]
> Målet er, at frøene ligger jævnt fordelt på båndet, uden at ligge oven på hinanden. Frø, der rører hinanden, bliver segmenteret som én blob og klassificeret forkert.

## Lad målingen køre færdig

Softwaren stopper selv vibrator og bånd, når prøven er kørt igennem, og båndet er tomt.

Du kan pause med **Stop** og derefter enten fortsætte med **Continue** eller afslutte med **Finish**.

## Gennemgå blobs, før du trykker Finish

Inden du afslutter, kan du bladre igennem de scannede blobs og rette klasser, der er forkerte.

Find de blobs, klassifikatoren har placeret forkert, og giv dem den rigtige referenceklasse, enten via **Set Reference Class** eller ved at højreklikke på den enkelte blob.

> [!NOTE]
> Det er ikke oprydning for syns skyld. De rettede blobs er præcis det materiale, modellen bliver bedre af at blive trænet på. Det er den eneste vej, en observation ude ved instrumentet kan blive til en bedre model.

> [!UDFYLD]
> Beskriv hvor meget der forventes rettet, og hvornår det kan springes over. Ellers gør de fire det forskelligt.

## Tryk Finish

**Finish** gemmer blob-collection og resultater til fil og kører derefter vibrator og bånd ved høj hastighed for at tømme instrumentet.

Vent, til instrumentet er tomt, før du lægger næste prøve i.
