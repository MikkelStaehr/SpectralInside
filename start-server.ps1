# Starter UBS Spectral Inside, så andre maskiner på nettet kan åbne den.
#
#   .\start-server.ps1
#
# Frontenden skal være bygget først:
#   cd frontend; npm run build
#
# To ting skal være på plads, før andre maskiner kan nå appen:
#
#   1. Serveren skal lytte på 0.0.0.0, ikke 127.0.0.1. Det gør dette script.
#      Starter man uvicorn i hånden uden --host, lytter den kun på loopback,
#      og så kan ingen anden maskine nå den, uanset hvad firewallen siger.
#
#   2. Der skal være en indgående firewall-regel for porten. Den kræver lokal
#      administrator. Scriptet nedenfor skriver den præcise kommando ud med
#      den netværksprofil, maskinen faktisk kører på.
#
# LocalSubnet i reglen betyder, at kun maskiner på samme net kan nå den. Den
# åbner ingenting mod internettet.

param(
    [int]$Port = 8000
)

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$python = Join-Path $root "backend\.venv\Scripts\python.exe"
$dist = Join-Path $root "frontend\dist"

if (-not (Test-Path $python)) {
    Write-Host "Fandt ikke $python" -ForegroundColor Red
    Write-Host "Kør: cd backend; python -m venv .venv; .venv\Scripts\python.exe -m pip install -r requirements.txt"
    exit 1
}

if (-not (Test-Path (Join-Path $dist "index.html"))) {
    Write-Host "Frontenden er ikke bygget." -ForegroundColor Red
    Write-Host "Kør: cd frontend; npm run build"
    exit 1
}

# Læs .env.local hvis den findes, så Supabase-nøglerne er tilgængelige.
$envFile = Join-Path $root ".env.local"
if (Test-Path $envFile) {
    Get-Content $envFile | ForEach-Object {
        if ($_ -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$') {
            [Environment]::SetEnvironmentVariable($Matches[1], $Matches[2].Trim())
        }
    }
    Write-Host "Indlæste .env.local"
}

$env:UBS_FRONTEND_DIST = $dist
$env:UBS_CONTENT_DIR = Join-Path $root "content"
$env:UBS_DB_PATH = Join-Path $root "backend\data\ubs.db"
$env:FORWARDED_ALLOW_IPS = "*"

$ips = Get-NetIPAddress -AddressFamily IPv4 |
    Where-Object { $_.IPAddress -notlike "127.*" -and $_.IPAddress -notlike "169.254.*" }

Write-Host ""
Write-Host "UBS Spectral Inside" -ForegroundColor Cyan
Write-Host "Operatørerne kan åbne en af disse:" -ForegroundColor Cyan
foreach ($ip in $ips) {
    Write-Host ("   http://{0}:{1}" -f $ip.IPAddress, $Port)
}
Write-Host ("   http://{0}:{1}   (virker også når IP-adressen skifter)" -f $env:COMPUTERNAME.ToLower(), $Port)
Write-Host ""

$rule = Get-NetFirewallRule -Direction Inbound -Enabled True -Action Allow -ErrorAction SilentlyContinue |
    Where-Object {
        ($_ | Get-NetFirewallPortFilter -ErrorAction SilentlyContinue).LocalPort -contains "$Port"
    }

if (-not $rule) {
    # Reglen skal gælde den profil, maskinen faktisk er på. Et domænenet, der
    # er kategoriseret Public, er almindeligt, og en regel for Domain,Private
    # ville så aldrig træde i kraft.
    $profiles = (Get-NetConnectionProfile | Select-Object -ExpandProperty NetworkCategory -Unique) -join ","
    if (-not $profiles) { $profiles = "Domain,Private,Public" }

    Write-Host "ADVARSEL: ingen indgående firewall-regel for port $Port." -ForegroundColor Yellow
    Write-Host "Kun denne maskine kan nå appen. Kør denne som lokal administrator:" -ForegroundColor Yellow
    Write-Host ""
    Write-Host ("   New-NetFirewallRule -DisplayName ""UBS Spectral Inside"" ``") -ForegroundColor Gray
    Write-Host ("       -Direction Inbound -Protocol TCP -LocalPort {0} ``" -f $Port) -ForegroundColor Gray
    Write-Host ("       -Action Allow -Profile {0} ``" -f $profiles) -ForegroundColor Gray
    Write-Host ("       -RemoteAddress LocalSubnet") -ForegroundColor Gray
    Write-Host ""
    Write-Host "Indtil da kan du selv teste udefra-adressen herfra. Virker den," -ForegroundColor Yellow
    Write-Host "er firewallen det eneste, der mangler." -ForegroundColor Yellow
    Write-Host ""
}

& $python -m uvicorn app.main:app `
    --app-dir (Join-Path $root "backend") `
    --host 0.0.0.0 --port $Port `
    --proxy-headers
