# Backup somente leitura do banco isp_crm (PostgreSQL Docker).
# Não imprime senhas. Gera arquivo com timestamp.
param(
  [string]$Container = "isp-crm-postgres",
  [string]$Database = "isp_crm",
  [string]$User = "crm",
  [string]$OutputDir = "$PSScriptRoot\..\backups"
)

$ErrorActionPreference = "Stop"
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
$Timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$OutFile = Join-Path $OutputDir "isp_crm-backup-$Timestamp.sql"

Write-Host "Gerando backup em: $OutFile"
docker exec $Container pg_dump -U $User -d $Database --no-owner --no-privileges | Set-Content -Encoding utf8 $OutFile

if (-not (Test-Path $OutFile)) { throw "Arquivo de backup não foi criado." }
$Size = (Get-Item $OutFile).Length
if ($Size -le 0) { throw "Arquivo de backup está vazio." }

Write-Host "Backup OK. Tamanho: $Size bytes"
