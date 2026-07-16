$ErrorActionPreference = 'Stop'

$adapterRoot = Split-Path -Parent $PSScriptRoot
$suiteRoot = Split-Path -Parent $adapterRoot
$codexRoot = Join-Path $suiteRoot 'codex-cli'
$adapterProcess = $null

function Test-TetherAdapterListening {
  return $null -ne (Get-NetTCPConnection -LocalAddress '127.0.0.1' -LocalPort 8766 -State Listen -ErrorAction SilentlyContinue)
}

if (-not (Test-TetherAdapterListening)) {
  $node = (Get-Command node -ErrorAction Stop).Source
  $stateDir = Join-Path $adapterRoot 'state'
  New-Item -ItemType Directory -Path $stateDir -Force | Out-Null
  $adapterProcess = Start-Process `
    -FilePath $node `
    -ArgumentList @('src/cli.js') `
    -WorkingDirectory $adapterRoot `
    -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $stateDir 'adapter.stdout.log') `
    -RedirectStandardError (Join-Path $stateDir 'adapter.stderr.log') `
    -PassThru

  $deadline = (Get-Date).AddSeconds(10)
  while (-not (Test-TetherAdapterListening)) {
    if ($adapterProcess.HasExited) {
      throw "TETHER adapter exited during startup. See $stateDir\\adapter.stderr.log"
    }
    if ((Get-Date) -gt $deadline) {
      Stop-Process -Id $adapterProcess.Id -Force -ErrorAction SilentlyContinue
      throw 'TETHER adapter did not begin listening on 127.0.0.1:8766 within 10 seconds.'
    }
    Start-Sleep -Milliseconds 150
  }
}

try {
  & codex `
    -C $codexRoot `
    -m tether-compact `
    -c 'model_provider="tether"' `
    -c 'model_providers.tether.name="TETHER local adapter"' `
    -c 'model_providers.tether.base_url="http://127.0.0.1:8766/v1"' `
    -c 'model_providers.tether.wire_api="responses"' `
    -c 'model_providers.tether.supports_websockets=true' `
    -c 'model_providers.tether.requires_openai_auth=false' `
    -c 'model_providers.tether.request_max_retries=0' `
    -c 'model_providers.tether.stream_max_retries=0'
} finally {
  if ($adapterProcess) {
    Stop-Process -Id $adapterProcess.Id -ErrorAction SilentlyContinue
  }
}
