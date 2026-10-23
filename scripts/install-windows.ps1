# Installs Dossier from github.com/BenVae/dossier with Docker Desktop, or updates it.
# In PowerShell:  irm https://raw.githubusercontent.com/BenVae/dossier/main/scripts/install-windows.ps1 | iex
# It only asks for the password to sign in with; run it again to update, which keeps your data and password.

function Install-Dossier {
  $repo = "BenVae/dossier"
  $branch = "main"
  $image = "dossier:local"
  $dir = Join-Path $HOME "dossier"
  $envFile = Join-Path $dir ".env"

  # Windows PowerShell 5.1 may default to TLS 1.0, which GitHub refuses, and pipes ASCII to programs.
  [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
  $utf8 = New-Object System.Text.UTF8Encoding $false
  $OutputEncoding = $utf8

  docker info *> $null
  if ($LASTEXITCODE -ne 0) {
    Write-Host "Docker isn't running. Start Docker Desktop, wait until it says it's running, then run this again." -ForegroundColor Red
    return
  }

  Write-Host "`n1/4 Building Dossier from github.com/$repo (takes a few minutes the first time)..." -ForegroundColor Cyan
  docker build --target production -t $image "https://github.com/$repo.git#$branch"
  if ($LASTEXITCODE -ne 0) { Write-Host "The build failed; see the messages above." -ForegroundColor Red; return }

  Write-Host "`n2/4 Setting up $dir ..." -ForegroundColor Cyan
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  Invoke-WebRequest -UseBasicParsing -Uri "https://raw.githubusercontent.com/$repo/$branch/compose.production.yml" -OutFile (Join-Path $dir "compose.yml")

  # Existing settings are kept: new secrets would lock Dossier out of its own database and saved keys.
  $lines = @()
  if (Test-Path $envFile) { $lines = @(Get-Content $envFile) }
  $has = { param($key) [bool]($lines -match "^$key=") }
  $random = { param($count) $bytes = New-Object byte[] $count; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes); , $bytes }
  # Hex, not base64: the database password goes into a URL.
  if (-not (& $has "POSTGRES_PASSWORD")) { $lines += "POSTGRES_PASSWORD=" + [BitConverter]::ToString((& $random 24)).Replace("-", "").ToLower() }
  if (-not (& $has "DOSSIER_SECRET")) { $lines += "DOSSIER_SECRET=" + [Convert]::ToBase64String((& $random 32)) }
  if (-not (& $has "DOSSIER_IMAGE")) { $lines += "DOSSIER_IMAGE=$image" }
  if (-not (& $has "TZ")) { $lines += "TZ=Europe/Berlin" }

  if (-not (& $has "DOSSIER_PASSWORD")) {
    Write-Host "`n3/4 Choose the password you'll sign in to Dossier with." -ForegroundColor Cyan
    do {
      $first = (New-Object System.Net.NetworkCredential("", (Read-Host "Password" -AsSecureString))).Password
      $second = (New-Object System.Net.NetworkCredential("", (Read-Host "Same again" -AsSecureString))).Password
      if (-not $first) { Write-Host "The password can't be empty." -ForegroundColor Yellow }
      elseif ($first -ne $second) { Write-Host "The two didn't match. Try again." -ForegroundColor Yellow }
    } until ($first -and $first -eq $second)
    # Only the hash is kept, never the password.
    $hash = $first | docker run --rm -i $image hash-password | Where-Object { $_ -match "^argon2id:\S+$" } | Select-Object -First 1
    if (-not $hash) { Write-Host "Couldn't make the password hash; see the messages above." -ForegroundColor Red; return }
    $lines += "DOSSIER_PASSWORD=$hash"
  } else {
    Write-Host "`n3/4 Keeping your password." -ForegroundColor Cyan
  }
  [IO.File]::WriteAllText($envFile, (($lines -join "`n") + "`n"), $utf8)

  Write-Host "`n4/4 Starting Dossier..." -ForegroundColor Cyan
  Push-Location $dir
  docker compose up -d --wait --wait-timeout 300
  $started = $LASTEXITCODE -eq 0
  Pop-Location
  if (-not $started) { Write-Host "Dossier didn't start; see the messages above, or run: docker compose -f `"$dir\compose.yml`" logs app" -ForegroundColor Red; return }

  Write-Host "`nDossier is running at http://localhost:3000 - sign in with your password, then pick an AI model in Settings -> AI provider." -ForegroundColor Green
  Write-Host "Its files are in $dir. To update it later, run the same command again."
  Start-Process "http://localhost:3000"
}

Install-Dossier
