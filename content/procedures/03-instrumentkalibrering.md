---
id: instrumentkalibrering
title: Instrumentkalibrering
lead: Ugentlig kalibrering med de tre targets. Tager cirka 3 minutter.
order: 3
trigger: Ugentligt, efter flytning, og efter montering eller afmontering af Autofeederen
duration: ca. 3 min
icon: target
category: vedligehold
---

Kalibreringen er det, der gør målingerne sammenlignelige over tid. Uden en gyldig kalibrering måler instrumentet stadig. Det måler bare noget, der ikke kan holdes op mod sidste uges tal.

Instrumentet skal have været tændt og varmet op i mindst 30 minutter, før du kalibrerer.

## Kør sfæren ned i nulposition

Sfæren skal stå i **down**-position (0 mm), så udefrakommende lys ikke forstyrrer kalibreringen.

Brug **Page Down**, eller gå til **Movement (F3)**.

## Find de tre targets frem

Du skal bruge:

1. **Bright**: ensfarvet lys, ligger i en sort holder
2. **Dark**: ensfarvet mørk
3. **Geometric**: hvid med sorte prikker i et gitter

> [!WARNING]
> Rør aldrig forsiden af en target. Hold dem i kanten. Fjern støv ved at blæse ren, partikelfri luft over dem med blæsebolden. Brug ikke andet, og aldrig en klud. Ridser og fedt på en target ødelægger kalibreringen for alle målinger, der bygger på den.

Læg dem aldrig oven på hinanden, og læg dem tilbage i deres beholdere efter brug.

## Sæt hver target i kalibreringsfixturet

Med Autofeeder monteret skal hver target sidde i **Calibration Fixture**, før den lægges på båndenheden under sfæren.

Husk at sætte **Top Plate** tilbage igen, når kalibreringen er færdig.

## Start kalibreringen

**Imaging Devices → VideometerLab → Instrument Calibration** (genvej `Ctrl + Shift + C`)

Følg vejledningen på skærmen.

## Vælg drift correction

På den første skærm er der reelt kun én beslutning: om **drift correction** skal være slået til.

Den bruger de fire grå felter inde i den nederste halvsfære til at opdage, om instrumentet har flyttet sig siden sidste kalibrering.

- **Rent miljø**: slå den til. Den virker godt.
- **Støvet miljø**: slå den fra. Der bliver de grå felter støvede hurtigere, end instrumentet drifter, og så korrigerer den efter støv i stedet for efter drift.

> [!UDFYLD]
> Beslut hvad der gælder hos jer, skriv det her, og lad det være det samme hver gang. Skifter indstillingen fra kalibrering til kalibrering, bliver målingerne uens af netop den grund.

## Bright target

Læg bright-target'en på med den **diffuse lyse side opad**, og klik Next.

Tjek på næste skærm, at den røde firkant ligger helt inde i cirklen, og at de fire referencefirkanter ligger helt inde i hver sit grå felt. Normalt skal der ikke ændres noget.

## Dark target

Isæt dark-target'en og klik Next.

Der køres nu en automatisk validering på de to første targets.

> [!CHECK]
> Valideringen skal sige **OK**. Siger den **Not OK**, kan du som regel godt arbejde videre, men gentager det sig over flere kalibreringer, skal Videometer Support kontaktes.

## Geometric target

Isæt geometric-target'en, klik Next, og tryk **Finish**.

## Sæt Top Plate tilbage

Tag Calibration Fixture af, og sæt Top Plate på igen, før du kører næste lot.

## Registrér kalibreringen som udført

Marker den som udført på forsiden af dette arbejdsbord, så de andre kan se, at ugens kalibrering er kørt, og hvornår.
