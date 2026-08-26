# UBS Spectral Inside

Arbejdsbord for de analytikere, der scanner lots af roefrø på VideometerLab med
Autofeeder.

Formålet er ikke at dokumentere softwaren, det har Videometer allerede gjort.
Formålet er, at **fire analytikere udfører den samme arbejdsgang ens**, så
forskelle i data stammer fra frøene og ikke fra betjeningen.

## Det bærende princip

> Applikationen må aldrig kunne påvirke måleprocessen.

Den taler ikke med VideometerLab, læser ikke fra instrumentet og skriver intet
tilbage. Måledata kommer senere ind i systemet ad en helt anden vej: en separat
connector, der læser Autofeederens resultatfiler og skriver til databasen.
Denne applikation vil kun poll'e den data, når den er der.

Bryder man det princip, har man bygget en dataintegritetsrisiko ind i et
laboratorium, hvis hele værdi er reproducerbarhed.

## Kom i gang

Kræver Python 3.11+ og Node 18+.

### Backend

```bash
cd backend
python -m venv .venv
.venv/Scripts/python.exe -m pip install -r requirements.txt      # Windows
# source .venv/bin/activate && pip install -r requirements.txt   # macOS/Linux

.venv/Scripts/python.exe -m uvicorn app.main:app --reload --port 8000
```

API-dokumentation: <http://127.0.0.1:8000/docs>

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Åbn <http://localhost:5173>. Vite proxier `/api` til backenden, så der ikke er
CORS at forholde sig til under udvikling.

### Som én proces

Bygger du frontenden, serverer backenden den selv, og hele applikationen kører
på én port:

```bash
cd frontend && npm run build
cd ../backend && .venv/Scripts/python.exe -m uvicorn app.main:app --port 8000
```

Åbn så bare <http://127.0.0.1:8000>. Det er den form, der skal flyttes til en
fælles server, når I er klar til det.

### Hosting på en maskine i huset

Operatørerne skal **hverken have Python eller Node**. De skal have en browser.
Appen kører ét sted, og de andre åbner en adresse.

```powershell
cd frontend; npm run build
cd ..; .\start-server.ps1
```

Scriptet indlæser `.env.local`, binder til alle netkort og skriver de adresser
ud, operatørerne kan bruge. Maskinnavnet virker også, når IP-adressen skifter,
og det gør den, for adressen kommer fra DHCP.

**Brug scriptet.** Starter man uvicorn i hånden uden `--host`, lytter den kun
på `127.0.0.1`, og så kan ingen anden maskine nå den, uanset hvad firewallen
siger. Det ses med:

```powershell
Get-NetTCPConnection -State Listen -LocalPort 8000 | Select LocalAddress
```

Står der `127.0.0.1`, er det problemet. Der skal stå `0.0.0.0`.

**Derefter skal der en indgående firewall-regel til.** Windows blokerer
indgående forbindelser som standard, og reglen kræver lokal administrator på
den maskine, appen kører på:

```powershell
New-NetFirewallRule -DisplayName "UBS Spectral Inside" `
    -Direction Inbound -Protocol TCP -LocalPort 8000 `
    -Action Allow -Profile Public `
    -RemoteAddress LocalSubnet
```

`LocalSubnet` betyder, at kun maskiner på samme net kan nå den. Den åbner
ingenting mod internettet.

> **Profilen skal passe til maskinen.** Et domænenet kan sagtens være
> kategoriseret `Public`, og det er tilfældet på analyse-PC'en her. En regel
> for `Domain,Private` ville derfor aldrig træde i kraft. Tjek med
> `Get-NetConnectionProfile`, og brug den kategori, der står der.
> `start-server.ps1` slår det op og skriver den rigtige kommando ud.

De to problemer kan skilles ad: når serveren er bundet til `0.0.0.0`, kan man
selv nå `http://<maskinnavn>:8000` **fra værtsmaskinen**, fordi den trafik
aldrig forlader netværksstakken og derfor ikke ses af firewallen. Virker den,
men ikke fra en anden maskine, er firewall-reglen det eneste, der mangler.

### Docker

```bash
cp .env.example .env.local     # udfyld de to VideometerLab-stier
docker compose up -d --build
```

Frontenden bygges i et node-trin og kopieres ind i et Python-billede, så
kørslen kun indeholder Python og de byggede filer. Containeren kører som
almindelig bruger, ikke root.

Fire ting monteres:

| Sti i containeren | Fra | Rettigheder |
| --- | --- | --- |
| `/content` | `./content` | skrivebeskyttet |
| `/data` | navngivet volume | skrivbar, rummer SQLite-databasen |
| `/videometer/blobcollections` | `UBS_HOST_BLOBDB_DIR` | skrivebeskyttet |
| `/videometer/classifiers` | `UBS_HOST_CLASSIFIERS_DIR` | skrivebeskyttet |

**Det, der afgør om Docker giver mening, er ikke containeren, men hvor
VideometerLabs filer ligger.** Kører containeren på en server, skal
instrument-PC'ens mappe deles over netværket, og delingen monteres ind. Kører
den på selve instrument-PC'en, kræver det Docker Desktop på en maskine, hvor
strømstyring på USB-porte allerede er slået fra af hensyn til instrumentet.
Det er en beslutning med konsekvenser for driften, ikke kun for udviklingen.

### Røgtest

Med backenden kørende og frontenden bygget:

```bash
cd frontend && npm run smoke
```

Den klikker sig gennem login, arbejdsbordet og en vedligeholdelsesregistrering
i en rigtig browser, og tjekker at afsenderen havner korrekt i loggen. Den
bruger den Chrome, der allerede er installeret, der hentes ingen browser ned.
Sæt `BASE` for en anden adresse og `SHOTS` for at gemme skærmbilleder.

## Hvem arbejder

Første skærm spørger, hvem der sidder ved maskinen. **Det er ikke
autentificering**: initialerne beskytter ingenting, og der er intet at logge
ind på. De findes, fordi fire analytikere deler PC'en, og en
vedligeholdelseslog uden afsender ikke er værd at have.

To ting følger af det:

- **Valget gemmes kun for den aktuelle dag.** Huskede den i ugevis, ville den
  anden analytikers båndrensning blive registreret på den første. En log, der
  peger på den forkerte, er værre end ingen log.
- **Analytikerne kan defineres i [`content/operators.yaml`](content/operators.yaml).**
  Er filen tom, beder login om initialer som fritekst, det virker, men så kan
  den samme person over tid stå som `MSM`, `msm` og `Mikkel` i loggen. Skriv de
  fire ind, så vælger man bare sig selv.

`Skift bruger` nederst i sidebaren fører tilbage til login.

## Adresser

Hver visning har sin egen adresse, så en operatør kan lægge en genvej til den
arbejdsgang, hun bruger mest, direkte på skrivebordet, og en besked kan linke
til et bestemt sted.

| Adresse | Visning |
| --- | --- |
| `#/` | Arbejdsbordet |
| `#/procedure/koer-et-lot` | En arbejdsgang, med `id` fra dens frontmatter |
| `#/lots` | Lots. Start et lot, registrér prøver |
| `#/beskeder` | Beskeder |
| `#/visning` | Lot-listen i produktionen. Uden login |
| `#/visning/<lotnr>` | Operatørskærmen for ét lot |
| `#/visning/proeve/<id>` | Én prøve med metrikker og billeder, sidste led |
| `#/visning/scanning/<id>` | Frøbillederne fra én scanning |

## Design

Retningen kommer fra moodboardet i `src/img/moodboard/`: fast sidebar, hvide
flader med hårfine kanter, næsten monokromt med én accent, og store klare tal
frem for informationstæthed.

**Kanvassen er lys og næsten neutral**, `#f3f2f0`. Den var `#eae8e3`, altså en
decideret beige, som trak hele skærmen mod cremet. Der er nu to til tre point
mere rødt end blåt: nok til at den ikke tipper over i kold blågrå, ikke nok til
at den læses som en farve.

Forskellen mellem kanvas og flade er lille med vilje. Adskillelsen kommer af
hårfine linjer, ikke af et spring i lyshed. Sidebaren er hvid som fladerne og
skilles fra indholdet af sin kant.

**Fladt, skarpt og roligt.** Fire regler, som `styles.css` retter sig efter:

| Regel | Hvad det betyder |
| --- | --- |
| Skarpe kanter | `--radius` er `0`. Runding findes kun, hvor formen **er** rund: prikker og punkter i grafer, og hætterne på hårfine stregmarkeringer. Aldrig på en kasse |
| Flade flader | `--shadow` er `none`. Dybde kommer af en 1 px linje, ikke af en skygge. Også dialogen |
| Fire vægte | 400 brødtekst, 500 dæmpede etiketter, 600 tal og overskrifter, 700 kun det største |
| Ti størrelser | 12 13 15 17 21 27 34 46 56 76 |

De to sidste er ikke kosmetik. Filen havde **tretten fontvægte og toogtredive
størrelser**, og det er den egentlige grund til, at typografien ikke matchede
sig selv. Brødteksten er 17 px, og ingen værdi, operatøren skal læse på tre
meters afstand, går under den.

### Skriften

**Inter, bundtet med applikationen** gennem `@fontsource-variable/inter`, ikke
hentet fra et CDN. Skærmen kører på en maskine i produktionen, som ikke
nødvendigvis har internet, og en font, der ikke kommer, giver et layout, der
hopper, mens man kigger på det.

Lotnummeret bruger ikke `tabular-nums`. Lige brede cifre gør et tal i
displaystørrelse løst, og bindestregen i `DEMO-4110` får luft om sig.
Tabulering hører til, hvor tal skal flugte lodret: tabelrækker og aksemærker.

### Ingen kasser inde i kasser

Operatørskærmen havde en ramme om tre kort, der selv er rammer. To lag kant om
det samme indhold er det, der får en skærm til at se tung ud. Lot-headeren står
nu direkte på kanvassen med en hårfin streg under sig, og kortene ligger under
den. Adskillelsen kommer af luft, ikke af en streg.

**Markering og alarm er to kanaler.** Kanten siger, hvilket kort tabellen
nedenunder hører til. Et fladt bånd foroven siger, at der er et nyt resultat.
Før bar kanten begge beskeder, og så kunne man ikke se det valgte kort, når det
også alarmerede. En rød ramme om et helt kort læses desuden som en fejl, hvor
et bånd læses som en markering.

Alle tre kort er hvide. Før var det valgte hvidt og de to andre grå, og så bar
fladen den samme besked som kanten.

Farverne er hentet direkte ud af UBS' logofiler i `src/img/`:

| Token | Hex | Rolle |
| --- | --- | --- |
| Navy | `#144077` | Primære knapper, bærende mørk |
| Green | `#7FBE42` | Accent, aktiv tilstand, "i orden" |
| Azure | `#0075BB` | Links og sekundært |

Grøn bruges aldrig som baggrund for hvid tekst, kontrasten er kun cirka 2:1.
Navy bærer den rolle med cirka 9,7:1.

Layoutet fylder hele vinduet, fordi værktøjet kun bruges på PC. Brødtekst er
til gengæld holdt på et læsbart mål via `--measure` (78 tegn), og på skærme
over 1500 px lægges trinets nummer og titel i en egen venstre spalte. Den
vandrette plads bliver altså brugt til struktur frem for til at strække
sætninger.

## Sådan skriver du en procedure

Procedurerne er Markdown-filer i [`content/procedures/`](content/procedures/).
De ligger i git, fordi indholdet styrer, hvordan måledata bliver til, så skal
det kunne reviewes, og man skal kunne se hvad der ændrede sig hvornår.

Backenden læser fra disk ved hver forespørgsel. Ret en fil, genindlæs siden,
så er ændringen der. Ingen genstart.

```markdown
---
id: koer-et-lot            # unikt, bruges i URL'en
title: Kør et lot
lead: Kort linje under titlen.
order: 2                   # rækkefølgen på forsiden
trigger: Hvornår proceduren skal køres
duration: 10-20 min
icon: scan-line            # lucide-ikon, se nedenfor
daily: false               # true = skal køres én gang om dagen
---

Tekst her, før det første trin, bliver til indledningen.

## Første trin

En `##`-overskrift bliver til ét trin, som operatøren kan krydse af.

> [!WARNING]
> Bruges til det, der ødelægger målingen, hvis det gøres forkert.
```

### Fremhævede blokke

| Skriv | Vises som | Brug til |
| --- | --- | --- |
| `> [!WARNING]` | Vigtigt (rød) | Det, der gør data ubrugelige, hvis det gøres forkert |
| `> [!CHECK]` | Tjek (grøn) | Noget operatøren skal verificere, før der køres videre |
| `> [!NOTE]` | Bemærk (blå) | Baggrund og forklaring |
| `> [!UDFYLD]` | Skal udfyldes (lilla, stiplet) | Lokale detaljer, jeg ikke kunne kende |

### Daglige procedurer

En procedure med `daily: true` i frontmatter skal køres én gang om dagen. Den
møder operatøren som en guide ét trin ad gangen ved dagens første login, frem
for at ligge og vente på, at nogen selv finder den i menuen.

Registreringen hænger på **dagen, ikke på personen**. Når instrumentet først er
varmt, er det varmt for alle fire, så nummer to bliver ikke spurgt igen.

Guiden kan lukkes med `Ikke nu`, men det tæller ikke som udført. Den dukker op
igen ved næste indlæsning, indtil nogen faktisk har kørt den, og arbejdsbordet
viser imens en påmindelse.

### Ventetid på et trin

Et trin kan kræve, at man venter, før man går videre. Det skrives i trinnets
overskrift:

```markdown
## Vent et minut, og start softwaren {wait=60}
```

I guiden vises en nedtælling, og knappen er låst, indtil tiden er gået. Brug
det de steder, hvor det at skynde sig ødelægger målingen.

Vær opmærksom på, at tallet er sekunder, og at guiden reelt spærrer så længe.
Det er fint til et minut. Til opvarmningen på 30 minutter giver det ikke mening
at låse skærmen, så det trin har med vilje ingen ventetid.

### Ikoner

Ikonerne kommer fra [lucide](https://lucide.dev). En procedure vælger sit eget
i frontmatter med navnet i kebab-case, som lucide selv skriver dem, `icon: scan-line`.

Ikonet skal først registreres i
[`frontend/src/components/Icon.tsx`](frontend/src/components/Icon.tsx), fordi
biblioteket importeres navn for navn. Det er med vilje: så ryger kun de ikoner,
der faktisk bruges, med i bundtet. Ukendte navne falder tilbage til et
dokumentikon i stedet for at knække visningen.

### Vedligeholdelse

Linjens indstillinger defineres i
[`content/machine-setup.yaml`](content/machine-setup.yaml), se Opsætning af
linjen.

Opgaver med interval defineres i [`content/maintenance.yaml`](content/maintenance.yaml).
`interval_days: null` betyder hændelsesstyret, opgaven har ingen forfaldsdato,
men vises med sine betingelser under `also_when`.

Udførelser logges i den lokale database, ikke i git.

**Arbejdsbordet beder kun om det, der nærmer sig.** Opgaver, der er inden for
interval, ligger stille bag `Vis de øvrige N`. Et panel, der altid viser seks
opgaver, hvoraf fem er i orden, lærer folk at se bort fra det.

Hvornår en opgave begynder at melde sig, styres af `warn_days` pr. opgave:

```yaml
- id: camera-fov
  interval_days: 90
  warn_days: 14      # melder sig 14 dage før, ikke dagen før
```

Udelades `warn_days`, bruges `UBS_DUE_SOON_DAYS` (standard 1 dag). Sæt den i
forhold til intervallet, en kvartalsopgave, der først varsler dagen før, giver
ingen mulighed for at nå at planlægge den.

**Udførelsesdatoen kan vælges.** Registrerer man en opgave, kan man sætte den
dato, den faktisk blev udført, og næste forfald tælles derfra. Det er nødvendigt
i praksis: rensede man båndet i fredags og først registrerer det mandag, ville
forfaldet ellers skride tre dage hver gang. Fremtidige datoer afvises.

Registreres flere udførelser, gælder altid den seneste. At tilføje "jeg gjorde
det også for tre uger siden" ændrer derfor ikke en opgave, der er registreret
udført i dag.

Dagene regnes i **kalenderdage**, ikke i forløbet tid, en operatør tænker
"båndet skal renses på torsdag", ikke "om 2,17 døgn".

## Det du skal udfylde

Procedurerne indeholder `[!UDFYLD]`-blokke, som er markeret tydeligt i
grænsefladen. Det er de steder, hvor indholdet kræver viden om jeres opsætning:

- **Receptnavne**: hvilken recept til hvilken frøtype, og hvem der må ændre den
- **Sample ID-konvention**: med et konkret eksempel. Den skal være ens for alle fire
- **Spacer**: hvilken bruges til roefrø
- **Drift correction**: til eller fra hos jer, og så det samme hver gang
- **Blob-rettelser**: hvor meget forventes rettet før Finish
- **Båndjustering**: må operatørerne selv, eller er det dig

Indtil de er udfyldt, gætter de fire, og så bliver arbejdsgangen ikke ens,
uanset hvor god resten af proceduren er.

## Struktur

```text
content/            Procedurer (Markdown) og vedligeholdelsesdefinitioner (YAML), kilden til sandhed
backend/            FastAPI. Læser content/, holder beskeder og vedligeholdelseslog i Postgres
frontend/           React + TypeScript (Vite)
```

To mapper ligger kun lokalt og er udeladt af dette arkiv, se `.gitignore`:

```text
.claude/skills/     videometerlab-skill: fagligt grundlag udledt af leverandørens 12 manualer
src/training_guide/ Videometers originale dokumentation (PDF)
src/img/            UBS' logofiler og fotos
```

Skillen i `.claude/skills/videometerlab/` er grundlaget, procedurerne er skrevet
ud fra. Den registrerer også fem steder, hvor leverandørens dokumenter modsiger
hinanden, de bør verificeres mod en rigtig installation, før de kommer ud til
operatørerne. Den er ikke i arkivet, fordi den er referater af Videometers egne
manualer, og de er leverandørens ophavsret. Applikationen læser aldrig fra
hverken `src/` eller `.claude/`.

## Konfiguration

Alt kan overstyres med miljøvariabler, så koden kan flytte fra en lokal PC til
en fælles server uden ændringer.

| Variabel | Standard | Betydning |
| --- | --- | --- |
| `SUPABASE_DB_URL` | — | Postgres-forbindelsen. Uden den svarer alt databasebåret 503 |
| `UBS_CONTENT_DIR` | `./content` | Hvor procedurerne ligger |
| `UBS_FRONTEND_DIST` | `frontend/dist` | Bygget frontend, serveres hvis mappen findes |
| `UBS_CORS_ORIGINS` | `http://localhost:5173,…` | Tilladte origins |
| `UBS_DUE_SOON_DAYS` | `1` | Hvor mange dage før forfald der advares |

Og på den maskine, hvor VideometerLabs filer ligger, altså den der kører
connectoren:

| Variabel | Standard | Betydning |
| --- | --- | --- |
| `UBS_SYNC` | fra | `1` slår connectoren til. Kun ét sted |
| `UBS_SYNC_INTERVAL` | `300` | Sekunder mellem gennemgange af mappen |
| `UBS_SYNC_BAND_LIMIT` | `200` | Loft over frø pr. scanning, der får hele båndrækken med |
| `UBS_MACHINE` | maskinnavnet | Står på hver scanning, så kilden kan ses |

## Målet

Et bæger med frø kommer ind. Analyseenheden finder ud af, hvor mange frø der er
skadede. Operatøren i produktionen får stamdata plus billedrækken af netop de
skadede frø.

| Led i kæden | Status |
| --- | --- |
| Bægeret får en identitet | Sample ID er obligatorisk i Autofeeder Blob Analyzer. Stregkodelæseren er den understøttede vej |
| Scanningen køres ens hver gang | Procedurerne er skrevet |
| **Hvor mange er skadede** | **Modellen findes ikke endnu** |
| Tallet ud af målingen | Kommer automatisk, når klassen findes |
| Billedrækken af de skadede | Bygget |
| Levering til produktionen | Kræver en firewall-regel, se Hosting |

### Skade-klassen mangler

Alle klasser i data handler om **hvilken art** et frø er, ikke om dets tilstand:

`Sugarbeet` · `Foreign` · `Unknown` · `Natskygge` · `Koriander` · `Katost` ·
`Håret Knopskulpe` · `Agersnerle` · `Pileurt` · `Burresnerre`

Purity-modellen svarer på "er det her et roefrø eller ukrudt". Målet kræver en
model, der svarer på "er dette roefrø helt eller skadet". Videometers egen
Autofeeder-manual beskriver strukturen: en kaskade, hvor første niveau skiller
frø fra iblanding, og andet niveau deler frøene i OK mod skadet.

Indtil den model findes, peger operatørvisningen på en klasse fra
purity-modellen, så hele kæden kan afprøves. Skiftet er to miljøvariabler:

```bash
UBS_FOCUS_CLASS=Skadet
UBS_FOCUS_LABEL="Skadede frø"
```

Intet andet skal ændres.

## Sider

| Side | Til hvem | Indhold |
| --- | --- | --- |
| **Arbejdsbord** | Analytikerne | Forsiden. Påmindelser, besked fra udvikleren, tælling af scanninger, seneste scanninger |
| **Scanninger** | Analytikerne | Browser over alle scanninger med frøbilleder |
| **Wiki** | Analytikerne | Guides. Hvordan man gør |
| **Vedligehold** | Analytikerne | Hvornår noget skal gøres, og fremgangsmåderne der hører til |
| **Beskeder** | Analytikerne | Historik |
| **Lots** | Analytikerne | Start et lot, registrér prøver undervejs |
| **Modeller og materiale** | Udvikleren | Modelversioner, træningshuller, rettelsesmønster |
| **Visning** (`#/visning`) | Produktionen | Lots, prøveresultater og billedrække. Uden login |

**Wiki og vedligehold er skilt ad med vilje.** Wikien fortæller *hvordan* man
gør. Vedligehold fortæller *hvornår* noget skal gøres, og linker til wikien for
fremgangsmåden. Ligger de i samme liste, blandes to forskellige slags indhold.

En procedure hører til det ene eller det andet via `category` i frontmatter:

```yaml
category: wiki          # eller: vedligehold
```

### Påmindelser

Vedligehold ligger ikke på forsiden som et panel. Det kommer op som en
**påmindelse i toppen**, og kun når der faktisk er noget at reagere på. Det
samme gælder daglig opstart. At påmindelsen overhovedet er der, betyder derfor
noget i sig selv.

Hvem der ser analysedelen, styres af `role` i `content/operators.yaml`. Er
listen tom, vises den til alle.

Operatørvisningen har hverken login eller menu: at skulle taste initialer for
at læse et tal er friktion uden formål, og initialerne beskytter alligevel
ingenting.

### Filnavnet bærer al metadata

Blob-samlingen gemmer hverken opskrift, lot eller hvem der kørte den:
`classifiers_t.name` er altid `Unknown`, og `metadata_t` indeholder kun
skemaversionen. **Filnavnet er den eneste kilde:**

```text
<opskrift>_<lot>_<initialer>_<DDMMYYYY>.blobdb
Purity_200_Koriander_HE_06082026.blobdb
```

Lotdelen kan selv indeholde underscores, så der læses bagfra: dato, initialer,
og opskriften som første led. Alle 22 nuværende filer parses korrekt.

Det gør navngivningskonventionen bærende. Afviger en fil fra den, mister
scanningen sin opskrift, sit lot, sin analytiker og sin dato på én gang.

## Scanninger, læst direkte fra VideometerLab

VideometerLabs blob-samlinger, `.blobdb`, er **SQLite-databaser**. Det står
ikke i Videometers manualer, men filerne begynder med `SQLite format 3`, og
skemaet er læsbart. Miniaturerne ligger færdige som PNG i `thumbnails_t`, så de
kan sendes direkte til browseren.

Appen læser dem **udelukkende skrivebeskyttet** og skriver aldrig til dem.

| Variabel | Standard | Betydning |
| --- | --- | --- |
| `UBS_BLOBDB_DIR` | `~/Documents/Videometer/VideometerLab/Blobs/BlobCollections` | Hvor blob-samlingerne ligger |
| `UBS_CLASSIFIERS_DIR` | `~/Documents/Videometer/VideometerLab/Classification/Classifiers` | Hvor klassifikatorerne ligger |
| `UBS_BLOBDB_VERSIONS` | `7` | Skemaversioner læseren er afprøvet mod |

På instrument-PC'en hedder Windows-brugeren typisk noget andet, så stierne skal
sættes der.

> **Vigtigt:** strukturen i `.blobdb` er ikke dokumenteret af Videometer, og
> `metadata_t.version` viser, at de selv versionerer den. Læseren stopper derfor
> med en tydelig fejl ved en ukendt version i stedet for at gætte. Ser I den
> fejl efter en opdatering af VideometerLab, skal skemaet gennemgås, før tallene
> kan bruges igen.

### De 19 bånd, frø for frø

Klikker man et frø i en scanning, åbner det i fuld størrelse og kan skiftes
mellem bølgelængder og lægges under en linse, ligesom i VideometerLabs egen
visning.

Det kunne lade sig gøre, fordi hvert blobs `blob_data` viste sig at indeholde
**19 selvstændige gråtone-PNG'er, ét pr. bånd**, som tilsammen fylder 94 % af
feltet. De ligger efter hinanden og kan skilles ad på PNG'ens egen start- og
slutmarkør. Der skal altså hverken Videometers Python-værktøjskasse eller
afkodning af HIPS-formatet til.

Farvelægningen sker i browseren ud fra gråtoneværdien, så et linseskift ikke
koster et nyt kald til serveren. Linserne hedder det samme som i instrumentets
software: Gråtone, Jet, Hot, Kold og Inverteret.

> **Bølgelængderne står ikke i filen.** Etiketterne 365-970 nm kommer fra
> båndenes rækkefølge holdt op mod LED-tabellen for VideometerLab 4. Kører I en
> anden Light Setup, passer de ikke. Derfor viser API'et kun bølgelængder, når
> der er præcis 19 bånd, og ellers bare "Bånd 1", "Bånd 2" og så videre.

### Confusion matrix

Analysedelen viser modellens gæt holdt op mod operatørernes referenceklasser.

**Det er ikke modellens træfsikkerhed.** Kun blobs, hvor nogen har sat en
referenceklasse, tæller med, og operatørerne retter fortrinsvis det, modellen
tog fejl af. Tallene viser hvor rettelserne falder, ikke hvor ofte modellen
rammer rigtigt. Det står også på skærmen, så ingen læser dem som noget andet.

## Operatørskærmen

Produktionslinjen, ikke instrumentet. Et lot kommer ind som en ordre, køres
gennem tre processer, og undervejs tages der prøver. Analytikeren registrerer
resultatet under **Lots**, og skærmen på produktionsgangen læser det.

Hierarkiet er stramt og fire niveauer dybt:

```text
Lotnummer -> proces -> testtype -> prøvenummer -> metrikker
```

Et lot bærer **Varietet** og **Item no.** hver for sig. Varieteten er navnet,
item-nummeret er den nøgle, der bruges uden for laboratoriet, og et navn kan
skrives på flere måder. `item_no` kom til efter tabellen fandtes og står derfor
som en `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` i skemaet:
`CREATE TABLE IF NOT EXISTS` tilføjer ikke kolonner til en tabel, der allerede
er der.

| Proces | Testtyper |
| --- | --- |
| Pre Cleaning | Purity |
| Cleaning | Cleaning Damage |
| Post Cleaning | **begge** |

**Purity giver tal for purity-modellens ti klasser**, ikke for en opfundet
liste over urenheder:

`Sugarbeet` · `Foreign` · `Unknown` · `Natskygge` · `Koriander` · `Katost` ·
`Håret Knopskulpe` · `Agersnerle` · `Pileurt` · `Burresnerre`

Sugarbeet er selve renheden og skal op. Alt andet er iblanding og skal ned,
Unknown indbefattet: den er ikke en urenhed, men de frø modellen ikke kunne
afgøre, og udelader man den, summer tallene ikke til 100.

Hver metrik bærer sit `source_class`, altså klassens navn stavet præcis som i
VideometerLab. Metrik-id'et er en slug, fordi det skal kunne stå i en URL og en
databasekolonne, men connectoren skal kunne finde klassen igen uden at gætte på
stavemåden.

Cleaning Damage måler Skader i alt, Red Eyes, White Eyes, Naked Embryo og
Decapped, alle lavere er bedre. **Den model findes ikke endnu**, så de fem er
et udgangspunkt og skal gennemgås, når klassen er trænet.

**Prøvenummeret er løbende inden for (lot, proces, testtype)**, altså "Purity,
prøve 3 i Pre Cleaning". VideometerLabs eget sample-id er et referencefelt ved
siden af og bliver aldrig operatørens nummer. Flere prøver pr. trin er det
normale: man får et dårligt resultat, skruer på noget, og tager en ny prøve.

**Justeringsteksten gemmes på prøven, men vises ikke nogen steder.** Feltet
`adjustment` sættes ved registreringen under Lots og ligger i databasen, men
det er hverken på prøvevisningen eller i prøvehistorikken: som en kolonne med
fri tekst brød det rytmen i en tabel, der ellers kun er tal.

Det er værd at være opmærksom på. Uden den er en forbedring bare et tal, der
ændrede sig af sig selv, og så kan skærmen ikke svare på, hvad der hjalp. Den
skal have et sted at stå, hvis den skal kunne læses.

Definitionen af processer, testtyper og metrikker står i
[`backend/app/lots.py`](backend/app/lots.py) og kommer ud gennem
`/api/lots/meta`. Frontenden gentager den ikke: en ny metrik er én ændring, ikke
to der skal holdes ens.

### Alarmen

En prøve uden `acknowledged_at` alarmerer: lot-boksen skifter kant, der kommer
et blinkende "Nyt resultat" i headeren, og proceskortet og dets fane får en
prik. **Kortet alarmerer også, når det ukvitterede ligger på den fane, der ikke
er valgt**, ellers kunne et nyt resultat ligge og blinke bag en fane, ingen
kigger på.

Intet forsvinder på en timer. Et resultat, ingen har set, er stadig et
resultat, ingen har set. `prefers-reduced-motion` erstatter blinket med en
større, statisk markering frem for at fjerne det.

**Skærmen viser ét lot, og kun ét.** Vil man et andet, går man tilbage til
forsiden. Det er også dér, et ukvitteret resultat på et *andet* lot bliver
synligt: lot-listen markerer de lots, der venter, og henter sig selv forfra
hvert 15. sekund.

### Stemplet

Post Cleaning er ikke "juster og prøv igen", der er ikke noget at skrue på.
Den er et kvalitetsstempel og indrammes derfor anderledes. Lottet kan først
godkendes eller afvises, når Post Cleaning har mindst én prøve af **begge**
testtyper, og grunden står på skærmen frem for at knappen bare er grå. Et
stempel uden det bagvedliggende er værre end intet stempel, for nogen tror på
det.

### Sådan bevæger man sig ned gennem hierarkiet

Fire klik, ét pr. niveau, og hvert klik gør præcis én ting:

| Klik på | Sker der |
| --- | --- |
| Et lot på forsiden | Monitoren for det lot |
| Et proceskort | Prøvehistorikken nedenunder skifter til det trin |
| En fane på Post Cleaning | Både fanen og historikken skifter til den testtype |
| En række i historikken | Prøvevisningen, sidste led |

**Hele proceskortet er knappen**, ikke kun overskriften. Skærmen hænger på en
stor touchskærm, og dér er et trykfelt på hele rammen forskellen på at ramme og
at prøve igen. Trykfeltet ligger under indholdet, og de rigtige knapper i kortet
ligger over det, så "Kvittér" og fanerne stadig kan trykkes hver for sig.
Knapperækkerne er bredere end deres knapper og er derfor sat til at lade klik
falde igennem, ellers ville hele båndet omkring "Kvittér" være dødt.

Kortet markeres, når det er dét, tabellen viser. Der er ingen "Alle
prøver"-knap ved siden af: to affordanser til det samme lærer ingen noget.

Processerne har ingen forklarende undertekst. Operatøren ved godt, hvad der
sker i Cleaning, hun står ved maskinen, og en linje der forklarer det koster
plads på hvert eneste kort hele dagen.

**Kæden er ét gitter, og kortene arver dets rækker.** Uden det måler hvert kort
sig selv, og så står overskrift, hovedtal og tabel i trappe hen over de tre
trin, fordi Post Cleaning har en fanerække mere end de to andre. De to kort
uden faner får en tom række af samme højde i stedet. Under 1080 px falder det
hele til én spalte, og så måler kortene sig selv igen, for der er ikke længere
noget at flugte med.

Lot-boksen fylder ikke hele vinduet. Gjorde den det, blev prøvehistorikken
skubbet ned under folden med luft imellem, og tabellen er arbejdsredskabet.

### Prøvevisningen

Sidste led. Her står alt om prøven: hvornår den blev taget og af hvem, hvad der
var skruet på, hvem der kvitterede, alle metrikker med deres ændring mod den
foregående prøve, og billedrækken fra VideometerLab.

**Hovedtallet står for sig** over resten. Det er prøvens svar, og de øvrige
klasser er, hvad det svar består af.

Nedenunder står klasserne som **ét objekt**, ikke en tabel med en graf ved
siden af: navn, værdi, ændring, og som fjerde kolonne et spor, der viser
forrige prøve mod denne. Før stod klassenavnene to gange, én gang i tabellen og
én gang som akseetiketter i grafen, og øjet skulle selv finde den samme række
to steder.

**Søjlen koder værdien, ikke bevægelsen.** Det er et bevidst skifte fra første
udgave, hvor kolonnen viste forrige prøve mod denne på en fælles akse. Den akse
virker ikke til bevægelser her: værdierne spænder fra 0,05 til 0,85,
ændringerne fra 0,02 til 0,25, og på den skala blev netop de rækker, man vil
undersøge, til få pixels. Samtidig stod hver ændring tre gange, som absolut
tal, som procent og som en streglængde.

Til værdierne virker den fælles akse derimod. Foreign er reelt sytten gange
Burresnerre, og en søjle siger det på et halvt sekund, hvor ni tal med to
decimaler skal læses ét ad gangen.

Bevægelsen bæres af tallet i ændringskolonnen plus **ét hårfint mærke pr.
tidligere prøve i trinnet**, hvert med sit prøvenummer over sig. Hele
historikken kan derfor læses af én række: Foreign gik 2,10, så 1,10, så 0,85.
Den seneste tidligere prøve står stærkest, de ældre træder tilbage, så
rækkefølgen kan ses uden at læse numrene.

### Skalaen skal kunne læses

Søjlekolonnen er en akse, og det skal den sige selv. Første udgave viste to tal
i hver ende, hvor det højre var største værdi gange 1,06, altså et vilkårligt
tal som 1,17, der stod og lignede en måling. Det blev spurgt om to gange, og
det er svaret: et tal, der skal forklares, mangler en etiket.

Tre ting gør den læsbar:

- **Aksen ender på et rundt tal.** `d3-scale`'s `nice()` runder domænet af til
  et helt trin, så den slutter på 2,5 og ikke på 1,17.
- **Alle aksens mærker vises**, ikke kun de to yderste. To tal i hver ende
  læses som to målinger, en række jævnt fordelte tal læses som en akse.
- **Gitterlinjer i hvert spor** står på de samme mærker. Uden dem måles søjlen
  kun op mod kassens to kanter, og så er den en dekoration frem for en måling.

Over tabellen står én sætning, der siger hvad skalaen er, og hvad mærkerne er.
Den står **før** tabellen: man skal vide, hvad søjlen måler op imod, før man
læser den, ikke bagefter.

Aksen dækker også de tidligere prøver, ikke kun den nuværende. Ellers ville et
mærke kunne ligge uden for søjlen. Prisen er kortere søjler, når en gammel
prøve lå højt, og det er den ærlige konsekvens af at vise historikken.

Ændringen står som absolut tal med den relative andel efter sig: `↓ 0,25
−23 %`. To kolonner til det samme tal fik skærmen til at sige den samme ting to
gange.

Primærmetrikken er ikke i tabellen. Havde den delt akse med de andre, ville de
ni ligge klemt op ad nul.

**Ikke en radar.** Akserne på en radar står i vilkårlig rækkefølge, så figurens
form siger mere om rækkefølgen end om tallene, og arealet vokser med kvadratet,
så en klasse der fordobles ser fire gange værre ud.

Rækkefølgen er modellens egen og ikke sorteret efter størrelse. Den er den
samme fra prøve til prøve, og en tabel, hvor rækkerne bytter plads hver gang et
tal ændrer sig, kan man ikke sammenligne to prøver i.

### Udvikling gennem trinnet

Under klasserne står **én lille kurve pr. klasse gennem alle prøver i trinnet**,
small multiples, som moodboardets `lotanalysis`. Tabellen ovenfor svarer på
"hvor stor er hver klasse" og bruger derfor en fælles akse. Den her svarer på
"hvilken vej går den", og det er et spørgsmål pr. klasse.

**Hvert felt har sin egen y-skala.** En fælles skala ville flade de små klasser
helt ud: Foreign ligger omkring 0,85, Burresnerre omkring 0,05, og på Foreigns
skala ville Burresnerres kurve være en vandret streg. Til gengæld må felternes
højder ikke sammenlignes med hinanden, og det står på skærmen. Størrelserne
sammenlignes i tabellen ovenfor, hvor aksen er fælles.

Den prøve, man ser på, er markeret i hver kurve. Resten er kontekst i gråt.
Ingen akser, ingen gitterlinjer, ingen tal på de øvrige punkter. Under tre
prøver vises kurverne ikke: to punkter er ingen udvikling, kun en streg, og det
siger delta-tallet allerede.

**Peger man på en kurve, kommer værdien frem.** Et krydshår finder prøven, det
punkt, pegepinden er nærmest, løfter sig, og en boble viser tallet.

Trykfeltet er ikke prikken. Hver prøve har et gennemsigtigt bånd i fuld højde,
omkring 65 px bredt ved tre prøver, så pegepinden kun skal være **nærmest** og
ikke ramme fire pixels. Det gælder også for en finger på touchskærmen.

Tastaturet gør det samme: feltet kan der tabbes til, fokus viser den prøve, man
ser på, og piletasterne bladrer derfra. Det er felterne, der er tabstop, ikke
de enkelte punkter, for ti felter med ti punkter ville ellers give hundrede.

Boblen er en tilføjelse og aldrig den eneste vej til et tal. Alle værdierne står
også i tabellen ovenfor og i prøvehistorikken.

### Om diagrambiblioteker

Der er hentet `d3-scale` og `d3-shape`, tilsammen omkring 11 kB gzippet. De
regner skalaer og kurver ud og **tegner ingenting**, så udseendet forbliver
vores.

Det er et bevidst fravalg af Recharts, Nivo og Chart.js. De koster 100 til
150 kB og leverer generiske dashboardgrafer med deres egne meninger om
udseende, og de ville trække designet væk fra moodboardet frem for hen mod det.

Selve markerne, søjlerne, sparklinen og kurverne, er derfor tegnet i hånden.

Billederne kræver, at prøven er knyttet til en scanning gennem `scan_id`, som
sættes ved registreringen under **Lots**. Er feltet tomt, siger visningen det i
stedet for at vise et tomt felt. Klikker man et frø, åbner det i fuld størrelse
med de 19 bånd og linserne, præcis som i scanningsbrowseren.

### Forsiden sorterer efter hvad der sidst skete

Ikke efter hvornår lottet blev startet. Det lot, der lige har fået en prøve, er
det, nogen står og venter på, og det skal ligge øverst. Et lot startet i går,
som stadig kører, må ikke ligge over et, der fik et resultat for to minutter
siden.

Kvitteringer tæller ikke med. De er nogens svar på et resultat og ikke en
ændring af det, og listen skal ikke hoppe rundt, hver gang nogen trykker
"kvittér".

### Opsætning af linjen

Maskinerne fortæller ikke selv, hvordan de er sat op, så operatøren registrerer
det. Knappen **Opsætning** sidder i lot-boksens header, og opsætningen hænger på
lottet.

Dialogen har to trin: sæt flueben ved det, du har skruet på, og udfyld kun det
på næste side. Listen er lang, fordi linjen har mange indstillinger, men et lot
bruger sjældent dem alle. Skulle man rulle gennem hele listen for at udfylde fem
felter, ville de fem drukne, og en formular, man skal lede i, bliver udfyldt
sjusket.

Opsætningen vises ikke på selve monitoren. Den er baggrund og ikke resultat, og
skærmen skal kunne læses på tre meters afstand af en, der leder efter ét tal.

Hvilke indstillinger der findes, står i
[`content/machine-setup.yaml`](content/machine-setup.yaml), læses fra disk ved
hver forespørgsel og kan derfor rettes uden genstart og uden kodeændring.

> **Listen i filen er et udgangspunkt, ikke jeres virkelighed.** Den er skrevet
> ud fra, hvad en renselinje til roefrø typisk har, og skal gennemgås med en,
> der står ved maskinerne. De fire under `analyse` svarer til de
> `[!UDFYLD]`-blokke, der stadig står åbne i procedurerne.

Gemmes en opsætning, erstattes hele sættet. Fjerner operatøren et flueben,
forsvinder værdien, frem for at blive stående usynligt og dukke op igen næste
gang nogen åbner dialogen.

### Hvornår en ændring er for lille til at vise

Der skal to betingelser til, og det er ikke overdrevet. Med ét absolut tal
alene rammer tærsklen skævt, når metrikkerne ligger i vidt forskellige
størrelsesordener: Sugarbeet ligger omkring 97 og flytter sig i hele procent,
mens Pileurt ligger omkring 0,08. En fælles grænse på 0,05 fik Koriander,
Katost, Agersnerle, Pileurt og Burresnerre til at stå som uændrede, selv om de
var faldet med en femtedel af deres egen værdi.

En ændring regnes derfor kun for uændret, når den er lille **både** absolut og
i forhold til det, den måles på:

| Fra | Til | Absolut | Relativt | Vises som |
| --- | --- | --- | --- | --- |
| 0,25 | 0,20 | 0,05 | 20 % | ↓ 0,05 |
| 97,60 | 97,62 | 0,02 | 0,02 % | uændret |

Begge grænser står i [`backend/app/lots.py`](backend/app/lots.py) og kommer ud
gennem `/api/lots/meta` som `flat_threshold` og `relative_threshold`, så de kun
findes ét sted.

### Hvordan skærmen holdes frisk

Server-sent events fra vores egen backend på `/api/lots/stream`, ikke Supabase
realtime i browseren.

Det er ikke en præference. Prøvetabellerne har Row Level Security uden policies,
netop for at browseren ikke skal kunne tale med Supabase, og en skærm, der står
tændt i produktionen hele dagen, er ikke stedet at fravige det. Realtime i
browseren ville kræve policies på tabellerne og den publicerbare nøgle ude i
frontenden.

Strømmen bærer ingen data, kun beskeden om at der er sket noget. Klienten
henter selv bagefter, så en skærm, der har været væk i en time, ikke skal sy et
hul sammen af hændelser, den ikke fik.

Hjerteslaget hvert 15. sekund er ikke pynt: uden det kan skærmen ikke skelne
"der er ingen nye prøver" fra "forbindelsen døde for en time siden". Falder
strømmen ud, hentes der hvert 10. sekund i stedet, og topbaren siger hvad der
er på færde:

| Topbaren siger | Betydning |
| --- | --- |
| Live | Strømmen er åben, hjerteslaget kommer |
| Henter hvert 10. sek. | Strømmen faldt ud, browseren prøver at genoprette |
| Databasen svarer ikke | Strømmen lever, men Supabase svarer ikke |
| Ingen kontakt | Tre hjerteslag udeblev. Skærmen er ikke frisk |

| Variabel | Standard | Betydning |
| --- | --- | --- |
| `UBS_LOT_STREAM_INTERVAL` | `3` | Sekunder mellem serverens tjek for ændringer |
| `UBS_LOT_STREAM_HEARTBEAT` | `15` | Sekunder mellem hjerteslag |

### Det, der med vilje ikke er der

- **Spec-grænser og OK/ikke-OK-domme.** Tabellen `spec_limits` findes, men
  bruges ikke. Den dag dommene kommer, er det en visningsændring og ikke en
  migrering midt i en høstsæson.
- **Rettelse og sletning af prøver.** Skærmen skriver kun to ting: kvitteringen
  og stemplet.

## Supabase

Forbindelsen er målt fra maskinen her:

| | Resultat |
| --- | --- |
| HTTPS 443 til projektets API | virker, TLS verificeret, svar på 0,28 s |
| Proxy på vejen | ingen |
| Den publicerbare nøgle | accepteres |
| `db.<ref>.supabase.co:5432` | findes ikke i DNS, hverken IPv4 eller IPv6 |
| Pooler på 5432 og 6543 | åben |

Direkte forbindelse til databasen er ikke længere en vej: Supabase har fjernet
`db.<ref>` for IPv4. Enten går man gennem **pooleren**, som netværket tillader,
eller gennem **REST-API'et over 443**, som under alle omstændigheder virker.

### Nøgler

To slags, og forskellen er vigtig:

- **`sb_publishable_...`** er beregnet til at være offentlig. Den er beskyttet
  af Row Level Security og kan bruges i browseren.
- **`sb_secret_...`** går uden om RLS. Den må kun bruges serverside. Kommer den
  i frontenden, kan enhver besøgende læse og skrive alt i databasen.

Frontenden her taler kun med vores egen backend og aldrig direkte med Supabase.
Nøglerne bliver derfor på serveren.

`.env.local` er i `.gitignore`. Det gælder også den publicerbare nøgle: den
hører til jeres projekt og har ingen grund til at ligge i historikken.

## Databasen

Postgres hos Supabase. Tolv tabeller: beskeder, vedligeholdelseslog og dagens
registrerede procedurer, fire til de scanninger, connectoren lægger op, og fem
til lots, prøver, deres metrikker, linjens opsætning og de spec-grænser, der
endnu ikke bruges. Procedurerne selv ligger i git og kan altid genskabes.

Skemaet ligger i [`backend/schema.sql`](backend/schema.sql), som er **genereret**
fra `_SCHEMA` i [`backend/app/db.py`](backend/app/db.py). Ret i `db.py`, ikke i
`.sql`-filen, ellers driver de fra hinanden. Alt er `IF NOT EXISTS`, og
applikationen lægger selv skemaet på plads ved første forbindelse. Forsvinder en
tabel under en kørende server, lægges den på plads igen, og kaldet prøves forfra.

**Row Level Security er slået til på alle tolv tabeller, uden en eneste policy.**
Det lukker dem for Supabases REST-API. Backenden forbinder som ejer gennem
pooleren og mærker det ikke, men uden det ville en gyldig publicerbar nøgle
kunne læse vedligeholdelsesloggen og alle scanningsdata direkte ud af en browser.

### Forbindelsen

Der går gennem **transaction pooleren**, ikke direkte til databasen.
`db.<ref>.supabase.co` findes ikke længere i DNS for IPv4, så den direkte vej er
ikke en mulighed. Strengen hentes i dashboardet under **Connect → Transaction
pooler** og hører hjemme i `.env.local`, som er i `.gitignore`.

Vær opmærksom på regionen i værtsnavnet. Alle `aws-*.pooler.supabase.com`
svarer på DNS, uanset hvor projektet ligger, så en forkert region giver
`ENOTFOUND tenant/user`, ikke en DNS-fejl. Tenant slås op før password tjekkes,
så forkert region og forkert password er to fejl, der kan skelnes.

Applikationen starter, også når databasen ikke kan nås. Procedurer og wiki
læses fra disk og virker uanset. Det, der kræver databasen, svarer 503 med en
forklaring frem for at rive resten ned.

## Etaper

1. **Nu**: hjælpeuniverset. Procedurer, vedligeholdelsesstatus, beskeder.
2. **Nu**: operatørskærmen. Lots, processer, prøver og alarm på nye resultater.
   Analytikeren registrerer prøverne i hånden under **Lots**.
3. **Næste**: connectoren fylder prøverne ud automatisk i stedet for hånden, og
   dashboardet viser resultater af de seneste scanninger.

Etape 3 forudsætter connectoren, som er en separat opgave. Tre spørgsmål skal
besvares dér, før tal kan komme ind ad den vej:

- **Hvilken procent?** Autofeederen giver count %, area %, volume % og
  eventuelt weight %. For frø er de langt fra hinanden. Weight % kræver desuden,
  at operatøren indtaster prøvens totalvægt, og er estimeret ud fra area %.
- **Er modellen kaskaderet?** Så er "klasserne i modellen" flere niveauer, og
  det skal vælges, hvilket niveau der vises.
- **Unknown skal med.** Udelades den, summer tallene ikke til 100, eller værre,
  den normaliseres væk, og så skjules det, at modellen var i tvivl.
