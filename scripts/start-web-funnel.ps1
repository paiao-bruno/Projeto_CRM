# Inicia o Funil de Vendas (modo web-only) no Windows PowerShell.
# Uso: na raiz do repositório → .\scripts\start-web-funnel.ps1
# Ou de qualquer pasta: powershell -ExecutionPolicy Bypass -File "C:\...\Projeto_CRM\scripts\start-web-funnel.ps1"

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot

Write-Host ""
Write-Host "=== ISP CRM — Funil de Vendas (web-only) ===" -ForegroundColor Cyan
Write-Host "Raiz do repositorio: $RepoRoot"
Write-Host ""

Set-Location -LiteralPath $RepoRoot

if (-not (Test-Path -LiteralPath (Join-Path $RepoRoot "package.json"))) {
    Write-Host "ERRO: package.json nao encontrado em $RepoRoot" -ForegroundColor Red
    Write-Host "Voce precisa estar na pasta raiz do clone (contem apps\web e apps\api)." -ForegroundColor Yellow
    exit 1
}

Write-Host "[1/5] Verificando Node.js..." -ForegroundColor Gray
$nodeVersion = node -v 2>$null
if (-not $nodeVersion) {
    Write-Host "ERRO: Node.js nao encontrado. Instale Node.js 20+ LTS." -ForegroundColor Red
    exit 1
}
Write-Host "  Node: $nodeVersion"

Write-Host "[2/5] Verificando script dev:web:funnel..." -ForegroundColor Gray
$pkg = Get-Content -Raw -LiteralPath (Join-Path $RepoRoot "package.json") | ConvertFrom-Json
if (-not $pkg.scripts."dev:web:funnel") {
    Write-Host "ERRO: script dev:web:funnel ausente. Branch desatualizada." -ForegroundColor Red
    Write-Host "  git fetch origin" -ForegroundColor Yellow
    Write-Host "  git checkout cursor/homologation-fixes-edc0" -ForegroundColor Yellow
    Write-Host "  git pull" -ForegroundColor Yellow
    Write-Host "  npm install" -ForegroundColor Yellow
    exit 1
}

Write-Host "[3/5] Verificando dependencias..." -ForegroundColor Gray
if (-not (Test-Path -LiteralPath (Join-Path $RepoRoot "node_modules"))) {
    Write-Host "  node_modules ausente. Executando npm install..." -ForegroundColor Yellow
    npm install
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

Write-Host "[4/5] Verificando PostgreSQL..." -ForegroundColor Gray
$dbTest = Test-NetConnection -ComputerName localhost -Port 5432 -WarningAction SilentlyContinue
if (-not $dbTest.TcpTestSucceeded) {
    Write-Host "  PostgreSQL nao responde na porta 5432. Tentando Docker..." -ForegroundColor Yellow
    docker compose up -d postgres
    if ($LASTEXITCODE -ne 0) {
        Write-Host "ERRO: nao foi possivel iniciar PostgreSQL." -ForegroundColor Red
        Write-Host "  Inicie Docker Desktop e execute: docker compose up -d postgres" -ForegroundColor Yellow
        exit 1
    }
    Start-Sleep -Seconds 5
    $dbTest = Test-NetConnection -ComputerName localhost -Port 5432 -WarningAction SilentlyContinue
    if (-not $dbTest.TcpTestSucceeded) {
        Write-Host "ERRO: PostgreSQL ainda indisponivel apos docker compose." -ForegroundColor Red
        exit 1
    }
}
Write-Host "  PostgreSQL OK na porta 5432."

Write-Host "[5/5] Iniciando apps/web (sem apps/api)..." -ForegroundColor Gray
Write-Host ""
Write-Host "  Funil: http://localhost:3000/sales-funnel" -ForegroundColor Green
Write-Host "  API interna: http://localhost:3000/api" -ForegroundColor Green
Write-Host "  Pressione Ctrl+C para encerrar." -ForegroundColor Gray
Write-Host ""

npm run dev:web:funnel
exit $LASTEXITCODE
