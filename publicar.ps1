# Publica o sistema no Firebase: functions, regras e índices do Firestore, regras do Storage e o site.
#
#   .\publicar.ps1                 publica tudo
#   .\publicar.ps1 hosting         só o site
#   .\publicar.ps1 functions       só as functions
#   .\publicar.ps1 "functions:emitirNfse,firestore:rules"
#
# O FUNCTIONS_DISCOVERY_TIMEOUT existe porque o Firebase CLI espera só 10 s para o código das
# functions carregar e, nesta máquina, a primeira carga depois do build às vezes passa disso
# ("User code failed to load... Timeout after 10000"). O código em si carrega em ~1,5 s.

param([string]$Alvo = "functions,firestore,storage,hosting")

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

if ($Alvo -match "hosting") {
    Write-Host "== Build do site ==" -ForegroundColor Cyan
    Push-Location web
    npm run build
    if ($LASTEXITCODE -ne 0) { Pop-Location; throw "O build do site falhou: nada foi publicado." }
    Pop-Location
}

if ($Alvo -match "functions") {
    Write-Host "== Testes do backend ==" -ForegroundColor Cyan
    Push-Location functions
    npm test
    if ($LASTEXITCODE -ne 0) { Pop-Location; throw "Há teste falhando: nada foi publicado." }
    Pop-Location
}

$env:FUNCTIONS_DISCOVERY_TIMEOUT = "120"
Write-Host "== Publicando: $Alvo ==" -ForegroundColor Cyan
npx firebase deploy --only $Alvo --project contabilidade-a9d35
if ($LASTEXITCODE -ne 0) { throw "O deploy falhou. Veja a mensagem acima." }
Write-Host "Publicado: https://contabilidade-a9d35.web.app" -ForegroundColor Green
