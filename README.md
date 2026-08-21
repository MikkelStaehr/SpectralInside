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
| `#/beskeder` | Beskeder |

## Design

Retningen kommer fra moodboardet i `src/img/moodboard/`: varm neutral kanvas i
stedet for kold grå, fast sidebar, hvide kort med hårfine kanter, næsten
monokromt med én accent, og store klare tal frem for informationstæthed.

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
`Håret Knopskulpe` · `Agersnerle` · `Pileurt`

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
| **Modeller og materiale** | Udvikleren | Modelversioner, træningshuller, rettelsesmønster |
| **Visning** (`#/visning`) | Produktionen | Stamdata og billedrække. Uden login |

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

Postgres hos Supabase. Syv tabeller: beskeder, vedligeholdelseslog og dagens
registrerede procedurer, plus fire til de scanninger, connectoren lægger op.
Procedurerne selv ligger i git og kan altid genskabes.

Skemaet ligger i [`backend/schema.sql`](backend/schema.sql), som er **genereret**
fra `_SCHEMA` i [`backend/app/db.py`](backend/app/db.py). Ret i `db.py`, ikke i
`.sql`-filen, ellers driver de fra hinanden. Alt er `IF NOT EXISTS`, og
applikationen lægger selv skemaet på plads ved første forbindelse. Forsvinder en
tabel under en kørende server, lægges den på plads igen, og kaldet prøves forfra.

**Row Level Security er slået til på alle syv tabeller, uden en eneste policy.**
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
2. **Næste**: dashboard med resultater af de seneste scanninger, når connectoren
   leverer data.
3. **Senere**: skærm i operatørstuen, hvor fabriksoperatøren afleverer et krus
   og får den procentvise fordeling på modellens klasser tilbage.

Etape 2 og 3 forudsætter connectoren, som er en separat opgave. Tre spørgsmål
skal besvares dér, før tal kan vises for nogen:

- **Hvilken procent?** Autofeederen giver count %, area %, volume % og
  eventuelt weight %. For frø er de langt fra hinanden. Weight % kræver desuden,
  at operatøren indtaster prøvens totalvægt, og er estimeret ud fra area %.
- **Er modellen kaskaderet?** Så er "klasserne i modellen" flere niveauer, og
  det skal vælges, hvilket niveau der vises.
- **Unknown skal med.** Udelades den, summer tallene ikke til 100, eller værre,
  den normaliseres væk, og så skjules det, at modellen var i tvivl.
