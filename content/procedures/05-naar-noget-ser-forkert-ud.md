---
id: naar-noget-ser-forkert-ud
title: Når noget ser forkert ud
lead: Slå symptomet op, før du gætter. Start altid samme sted.
order: 5
trigger: Når en måling, et billede eller instrumentet opfører sig uventet
duration: varierer
icon: life-buoy
category: wiki
---

Kig her, før du begynder at ændre indstillinger. Næsten alle de fejl, I vil møde, står beskrevet, og de har en fastlagt rækkefølge at gå frem i.

> [!WARNING]
> Ændr aldrig parametre i recepten for at få en måling til at se rigtigere ud. Så bliver fejlen gemt i data i stedet for løst, og næste operatør kører videre med en recept, der er blevet ændret uden at nogen ved hvorfor.

## Først: den universelle genstart

Uanset hvad problemet er, prøv altid det her først:

1. Luk VideometerLab-programmet, og sluk instrumentet
2. Vent 10 sekunder
3. Tænd instrumentet, og start softwaren igen

Hjælper det ikke:

4. Luk programmet, og sluk instrumentet igen
5. Tjek at alle kabler sidder korrekt og er spændt, og at der er strøm
6. Genstart Windows
7. Tænd instrumentet, og start softwaren

## Billedet ser forkert ud

Gå frem i denne rækkefølge, og stop når det virker:

1. **Nulstil skalaen**: højreklik på billedet → Scale → Reset scale. Det er oftest bare visningen, og det koster ingenting at udelukke.
2. **Tag et raw-billede** og nulstil skalaen. Ser raw-billedet rigtigt ud, mens det korrigerede ikke gør, så **kør en ny instrumentkalibrering**.
3. Hjælper det ikke: kør **Auto Light**, tag et nyt billede, og se efter igen.
4. Stadig forkert: kør den universelle genstart ovenfor.

## Frøene ser mærkelige ud, eller segmenteringen rammer forkert

Det blå bånd er snavset. Kør **Rens transportbåndet**.

Segmenteringen bygger på båndets farve, så det er næsten altid årsagen, når segmenteringen pludselig bliver dårligere uden at noget andet er ændret.

## Der mangler frø i tællingen

**Conveyor Distance** er forkert, så overlappet mellem billederne er for lille, og blobs falder mellem to billeder.

Tjek den i **Autofeeder Parameter Control**. Standard er 105 mm. Reglen er `Conveyor Distance = 120 − største diameter i mm`.

Der kommer ingen fejlmeddelelse på det her. Tallene ser rigtige ud, de er bare for lave.

## Blobs er klippet over

Conveyor Distance er for stor til frøstørrelsen. Sæt den ned.

## Blob-billederne ser beskårne ud i vinduet

Det er sandsynligvis bare **Cell size** i recepten, altså størrelsen på visningsfeltet.

Blobbet bliver vist beskåret, men **det fulde billede bruges stadig i analysen**. Tallene er ikke påvirket.

## Vibratoren siger ingenting

- Er det ved installation: **transportskruen sidder stadig i bunden af vibratoren**. Den skal fjernes. Kører vibratoren med skruen i, kan enheden tage skade.
- Ellers: tjek kablerne, og tjek **Instrument Preferences → Use Autofeeder**.

## Fremføringen er svag eller ujævn

Vibratoren rører sandsynligvis siderne af båndenheden. Det dæmper vibrationen.

Den skal stå centreret uden at røre sideskinnerne. Positionen drifter langsomt over tid, så den skal tjekkes engang imellem.

## Båndet kører skævt

Kør **Learn Belt** først, den skal altid køres, hvis båndenheden har været flyttet.

Er det båndet selv, der kører skævt, skal det justeres på bolten for enden af Autofeederen, mens båndet kører. Juster meget lidt ad gangen, og lad det køre i mindst 30 sekunder mellem hver justering.

> [!UDFYLD]
> Beslut om operatørerne selv må justere båndet, eller om det er dig, der gør det. Skriv svaret her.

## Start-knappen er grå

Tre ting skal være på plads, før den aktiveres:

1. **Operator** og **Sample ID** er udfyldt
2. **Learn Belt** er kørt
3. **Conveyor Distance** er tjekket

## Sfæren kører ikke op og ned

Positionerne er sandsynligvis sat forkert. Tjek dem under **Movement (F3)**.

Up og down må ikke være ens, og up må ikke være lavere end down.

## Softwaren vil ikke starte, der kører allerede en instans

Softwaren blev ikke lukket korrekt sidst.

`Ctrl + Alt + Del` → Jobliste → afslut alle VideometerLab-processer → start softwaren igen.

## Softwaren er crashet, hvad med mine billeder?

Alt åbent gemmes automatisk som `Error_dato_nummer.HIPS` i VideometerLab-mappen. De kan hentes derfra.

## Det står ikke her

Skriv til udvikleren via beskedfeltet, eller kontakt Videometer Support.

Har du brug for at sende noget til Videometer: kør **Help → Collect Support Information**, og hav **Help → About** klar med softwareversion og serienumre.

Videometer Support: +45 4576 1077 · videometerlabsupport@videometer.com
