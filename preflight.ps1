# Tjekker om en maskine kan kore UBS Spectral Inside.
#
#   .\preflight.ps1
#
# Kores pa den maskine, appen skal kore pa. Skriver intet, andrer intet, rorer
# ikke VideometerLab. Den laser og maler, og siger sa hvad der mangler.
#
# Den vigtigste af de tre ting, den maler, er den sidste: om maskinen kan na
# Supabases pooler. Det er malt fra udviklerens PC, men den maling gaelder ikke
# nodvendigvis her. Instrument-PC'en kan ligge pa et andet VLAN eller vaere
# omfattet af en strammere politik, og sa er svaret et andet.

param(
    [string]$BlobDir,
    [string]$ClassifierDir,
    [string]$PoolerHost,
    [int]$Port = 8000
)

$root = $PSScriptRoot
$problems = @()
$notes = @()

function Section($text) {
    Write-Host ""
    Write-Host $text -ForegroundColor Cyan
    Write-Host ("-" * $text.Length) -ForegroundColor DarkGray
}

function Ok($text)   { Write-Host "  ok    $text" -ForegroundColor Green }
function Bad($text)  { Write-Host "  MANGLER  $text" -ForegroundColor Red;    $script:problems += $text }
function Warn($text) { Write-Host "  ?     $text" -ForegroundColor Yellow;    $script:notes += $text }
function Info($text) { Write-Host "  --    $text" -ForegroundColor DarkGray }

Write-Host ""
Write-Host "UBS Spectral Inside - tjek af $env:COMPUTERNAME" -ForegroundColor White

# --- 1. Kan maskinen kore backenden? ----------------------------------------

Section "1. Python"

$python = $null
foreach ($candidate in @("python", "py")) {
    $cmd = Get-Command $candidate -ErrorAction SilentlyContinue
    if ($cmd) {
        $raw = & $cmd.Source --version 2>&1 | Out-String
        if ($raw -match "Python (\d+)\.(\d+)\.(\d+)") {
            $major = [int]$Matches[1]; $minor = [int]$Matches[2]
            if ($major -eq 3 -and $minor -ge 11) {
                Ok "$($raw.Trim())  ($($cmd.Source))"
                $python = $cmd.Source
                break
            } else {
                Warn "$($raw.Trim()) er for gammel, der skal 3.11 eller nyere til"
            }
        }
    }
}
if (-not $python) {
    Bad "Python 3.11+ findes ikke. Hentes pa https://www.python.org/downloads/"
    Info "Kun nodvendigt, hvis appen skal kore pa DENNE maskine."
}

# --- 2. VideometerLabs filer ------------------------------------------------

Section "2. VideometerLabs filer"

$vmUser = Join-Path $env:USERPROFILE "Documents\Videometer\VideometerLab"
if (-not $BlobDir)       { $BlobDir       = Join-Path $vmUser "Blobs\BlobCollections" }
if (-not $ClassifierDir) { $ClassifierDir = Join-Path $vmUser "Classification\Classifiers" }

# Filnavnet er den eneste kilde til opskrift, lot, analytiker og dato.
# Samme udtryk som backendens blobdb.parse_name.
$namePattern = '^(?<recipe>[^_]+)_(?<lot>.+)_(?<operator>[A-Za-zÆØÅæøå]{2,4})_(?<date>\d{8})$'

if (Test-Path $BlobDir) {
    $files = @(Get-ChildItem -Path $BlobDir -Filter *.blobdb -ErrorAction SilentlyContinue)
    Ok "Blob-samlinger: $BlobDir"
    Info "$($files.Count) .blobdb-filer"

    if ($files.Count -gt 0) {
        # Er det virkelig SQLite? Filerne begynder med "SQLite format 3".
        $notSqlite = @()
        $badName = @()
        foreach ($f in $files) {
            try {
                $fs = [System.IO.File]::OpenRead($f.FullName)
                $buf = New-Object byte[] 16
                $read = $fs.Read($buf, 0, 16)
                $fs.Close()
                $header = [System.Text.Encoding]::ASCII.GetString($buf, 0, [Math]::Max($read - 1, 0))
                if ($header -notlike "SQLite format 3*") { $notSqlite += $f.Name }
            } catch {
                $notSqlite += "$($f.Name) (kunne ikke laeses: $($_.Exception.Message))"
            }

            if ($f.BaseName -notmatch $namePattern) { $badName += $f.Name }
        }

        if ($notSqlite.Count -eq 0) { Ok "alle filer er SQLite-databaser" }
        else { Bad "$($notSqlite.Count) filer er ikke SQLite: $($notSqlite -join ', ')" }

        if ($badName.Count -eq 0) {
            Ok "alle filnavne folger <opskrift>_<lot>_<initialer>_<DDMMYYYY>"
        } else {
            Warn "$($badName.Count) filnavne afviger fra konventionen"
            foreach ($n in $badName | Select-Object -First 8) { Info "  $n" }
            Info "En fil, der afviger, mister sin opskrift, sit lot, sin analytiker og sin dato pa en gang."
        }

        # Skemaversionen kan kun laeses med SQLite, altsa med Python.
        # Samme tur bruges til at maale, hvor meget data der ligger. Det tal
        # afgor, hvad connectoren kan tillade sig at skubbe til Supabase:
        # miniaturerne er sma, de 19 baand pr. frø er det, der fylder.
        if ($python) {
            $probe = @'
import sqlite3, sys, collections
versions = collections.Counter()
blobs = thumb_bytes = band_bytes = 0
for path in sys.argv[1:]:
    try:
        conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
        row = conn.execute("SELECT value FROM metadata_t WHERE key = 'version'").fetchone()
        versions[row[0] if row else "ukendt"] += 1
        blobs += conn.execute("SELECT COUNT(*) FROM blobs_t").fetchone()[0]
        for table, column, bucket in (
            ("thumbnails_t", "thumbnail", "thumb"),
            ("blobs_t", "blob_data", "band"),
        ):
            try:
                total = conn.execute(
                    f"SELECT COALESCE(SUM(LENGTH({column})), 0) FROM {table}"
                ).fetchone()[0]
            except sqlite3.Error:
                total = 0
            if bucket == "thumb":
                thumb_bytes += total
            else:
                band_bytes += total
        conn.close()
    except Exception as exc:
        versions[f"fejl: {exc}"] += 1
for version, count in sorted(versions.items(), key=lambda kv: str(kv[0])):
    print(f"version\t{version}\t{count}")
print(f"maal\tblobs\t{blobs}")
print(f"maal\tthumb\t{thumb_bytes}")
print(f"maal\tband\t{band_bytes}")
'@
            $probeFile = Join-Path $env:TEMP "ubs-probe-$PID.py"
            Set-Content -Path $probeFile -Value $probe -Encoding utf8
            $paths = $files | Select-Object -First 200 -ExpandProperty FullName
            $result = & $python $probeFile @paths 2>&1
            Remove-Item $probeFile -Force -ErrorAction SilentlyContinue
            $measured = @{}
            foreach ($line in $result) {
                $parts = "$line" -split "`t"
                if ($parts.Count -eq 3 -and $parts[0] -eq "version") {
                    if ($parts[1] -eq "7") { Ok "skemaversion $($parts[1]): $($parts[2]) filer" }
                    else { Warn "skemaversion $($parts[1]): $($parts[2]) filer - laeseren er kun afprovet mod 7, saet UBS_BLOBDB_VERSIONS hvis den er verificeret" }
                }
                elseif ($parts.Count -eq 3 -and $parts[0] -eq "maal") { $measured[$parts[1]] = [long]$parts[2] }
            }

            if ($measured.Count -gt 0) {
                $mb = { param($b) "{0:N1} MB" -f ($b / 1MB) }
                Write-Host ""
                Info "Hvad connectoren ville skulle flytte:"
                Info ("  frø i alt:        {0:N0}" -f $measured["blobs"])
                Info ("  miniaturer:       {0}" -f (& $mb $measured["thumb"]))
                Info ("  19 band pr. frø:  {0}" -f (& $mb $measured["band"]))
                if ($measured["band"] -gt 0) {
                    $ratio = $measured["band"] / [Math]::Max($measured["thumb"], 1)
                    Info ("  bandene fylder {0:N0} gange sa meget som miniaturerne" -f $ratio)
                }
            }
        } else {
            Info "Skemaversionen kraever Python for at kunne laeses."
        }
    }
} else {
    Bad "Blob-samlinger findes ikke: $BlobDir"
    Info "Saet UBS_BLOBDB_DIR, hvis de ligger et andet sted, eller peg pa en UNC-sti."
}

if (Test-Path $ClassifierDir) {
    $c = @(Get-ChildItem -Path $ClassifierDir -ErrorAction SilentlyContinue -File)
    Ok "Klassifikatorer: $ClassifierDir  ($($c.Count) filer)"
} else {
    Warn "Klassifikatorer findes ikke: $ClassifierDir"
    Info "Kun modelvisningen mangler noget. Resten af appen virker."
}

# --- 3. Kan maskinen na Supabase? -------------------------------------------

Section "3. Supabase"

function Test-Tcp($targetHost, $tcpPort, $timeoutMs = 6000) {
    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $async = $client.BeginConnect($targetHost, $tcpPort, $null, $null)
        if (-not $async.AsyncWaitHandle.WaitOne($timeoutMs, $false)) { return $false }
        $client.EndConnect($async)
        return $true
    } catch { return $false } finally { $client.Close() }
}

# Værtsnavnet tages fra .env.local, hvis den er udfyldt. Regionen kan ikke
# gættes: alle aws-*.pooler.supabase.com resolver, uanset hvor projektet ligger.
$envFile = Join-Path $root ".env.local"
$projectUrl = $null
if (-not $PoolerHost -and (Test-Path $envFile)) {
    foreach ($line in Get-Content $envFile) {
        if ($line -match '^\s*SUPABASE_DB_URL\s*=\s*\S*@([^:/]+):(\d+)') { $PoolerHost = $Matches[1] }
        if ($line -match '^\s*SUPABASE_URL\s*=\s*https://([^/\s]+)')     { $projectUrl = $Matches[1] }
    }
}

if ($projectUrl) {
    if (Test-Tcp $projectUrl 443) { Ok "443 til $projectUrl" }
    else { Bad "443 til $projectUrl er lukket" }
}

if ($PoolerHost) {
    foreach ($p in @(6543, 5432)) {
        if (Test-Tcp $PoolerHost $p) {
            Ok "$p til $PoolerHost"
        } else {
            if ($p -eq 6543) { Bad "6543 til $PoolerHost er lukket - appen kan ikke na databasen herfra" }
            else { Warn "5432 til $PoolerHost er lukket (kun session mode, ikke pakraevet)" }
        }
    }
} else {
    Warn "SUPABASE_DB_URL er ikke sat i .env.local, sa pooleren kunne ikke males"
    Info "Hentes i dashboardet under Connect -> Transaction pooler."
}

# --- 4. Kan andre maskiner na appen? ----------------------------------------

Section "4. Adgang for de andre maskiner"

$rule = Get-NetFirewallRule -Direction Inbound -Enabled True -Action Allow -ErrorAction SilentlyContinue |
    Where-Object { ($_ | Get-NetFirewallPortFilter -ErrorAction SilentlyContinue).LocalPort -contains "$Port" }

if ($rule) {
    Ok "indgaende firewall-regel for port $Port findes"
} else {
    $profiles = (Get-NetConnectionProfile | Select-Object -ExpandProperty NetworkCategory -Unique) -join ","
    if (-not $profiles) { $profiles = "Domain,Private,Public" }
    Warn "ingen indgaende firewall-regel for port $Port"
    Info "Netvaerksprofil her: $profiles. Kraever lokal administrator:"
    Write-Host ("        New-NetFirewallRule -DisplayName ""UBS Spectral Inside"" -Direction Inbound ``") -ForegroundColor DarkGray
    Write-Host ("            -Protocol TCP -LocalPort $Port -Action Allow -Profile $profiles ``") -ForegroundColor DarkGray
    Write-Host ("            -RemoteAddress LocalSubnet") -ForegroundColor DarkGray
}

# --- Opsamling --------------------------------------------------------------

Section "Opsamling"

if ($problems.Count -eq 0) {
    Write-Host "  Intet blokerer. Maskinen kan kore appen." -ForegroundColor Green
} else {
    Write-Host "  $($problems.Count) ting blokerer:" -ForegroundColor Red
    foreach ($p in $problems) { Write-Host "    - $p" -ForegroundColor Red }
}
if ($notes.Count -gt 0) {
    Write-Host ""
    Write-Host "  $($notes.Count) ting vaerd at kigge pa:" -ForegroundColor Yellow
    foreach ($n in $notes) { Write-Host "    - $n" -ForegroundColor Yellow }
}
Write-Host ""
