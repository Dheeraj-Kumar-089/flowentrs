param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^https://[A-Za-z0-9.-]+/v[0-9]+$')]
  [string] $WakeApiUrl
)

$ErrorActionPreference = 'Stop'
$frontendDir = Join-Path (Split-Path $PSScriptRoot -Parent) 'frontend'
$env:VITE_WAKE_API_URL = $WakeApiUrl
$env:VITE_SANDBOX_HOST_STYLE = 'flat'
$env:VITE_RUNTIME_LABEL = 'K3S'
npm --prefix $frontendDir run build -- --outDir dist-portfolio
if ($LASTEXITCODE -ne 0) { throw 'Building the portfolio frontend failed.' }
Write-Output 'Portfolio frontend is ready in frontend/dist-portfolio.'
