---
id: daglig-opstart
title: Daglig opstart
lead: Gør instrumentet klar til dagens første lot.
order: 1
trigger: Første gang instrumentet bruges på en dag
duration: 5 min + 30 min opvarmning
icon: power
category: wiki
daily: true
---

Skal køres, før dagens første lot scannes. Opvarmningen er ikke til forhandling: LED'erne drifter, mens de er kolde, og målinger foretaget i den periode kan ikke sammenlignes med resten af dagens.

## Tænd instrumentet før softwaren

Tænd VideometerLab på kontakten bag på instrumentet.

Kig på Videometer-logoet på fronten:

- **Blinker ca. 1 gang i sekundet**: tændt, men ikke initialiseret. Sådan skal det se ud nu.
- **Lyser konstant**: allerede initialiseret.
- **Slukket**: instrumentet får ikke strøm.

> [!WARNING]
> Rækkefølgen betyder noget. Instrumentet tændes altid før softwaren, og softwaren lukkes altid før instrumentet slukkes. Sluk aldrig hardwaren, mens VideometerLab-softwaren kører.

## Vent et minut, og start softwaren {wait=60}

Giv instrumentet cirka et minut til at boote, før du initialiserer. Start derefter VideometerLab-softwaren.

## Initialize

**Imaging Devices → VideometerLab → Initialize**

Tager 15-20 sekunder. Logoet skifter fra at blinke til at lyse konstant.

> [!CHECK]
> Vibratoren skal sige en lyd under initialiseringen. Gør den ikke det, er Autofeederen ikke forbundet korrekt. Tjek kablerne, og tjek at **Instrument Preferences → Use Autofeeder** er sat.

## Lad instrumentet varme op i 30 minutter

Instrumentet skal have mindst 30 minutter, efter det er initialiseret, før du kalibrerer eller scanner noget, der skal bruges.

Brug tiden på at rense båndet, hvis det er ugedagen for det, eller på at gøre prøverne klar.

> [!NOTE]
> Det er også derfor, det sjældent kan betale sig at slukke instrumentet om aftenen, hvis det skal bruges dagen efter. Lader du det stå tændt, holder LED'erne en konstant temperatur.

## Tjek at kalibreringen er gyldig

Se på statusfeltet på forsiden af dette arbejdsbord.

Kalibrer, hvis en af disse gælder:

- Der er gået mere end en uge siden sidste kalibrering
- Instrumentet er blevet flyttet
- Autofeederen er blevet monteret eller afmonteret
- Der er tvivl om, hvorvidt kalibreringen er gyldig

Er den gyldig, indlæses den seneste kalibrering automatisk, og du kan gå videre.

## Tjek at båndet er rent

Kig på det blå transportbånd, før dagen går i gang.

Segmenteringen adskiller frøene fra baggrunden på båndets **blå farve**. Er båndet snavset, bliver segmenteringen forkert, og det viser sig som mærkelige frø i billederne eller tal, der ikke giver mening.

Er du i tvivl, så rens det. Det tager få minutter og koster ingenting.
