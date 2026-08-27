# Run frontend and API together (Windows)

$ErrorActionPreference = "Stop"
Set-Location (Split-Path -Parent $PSScriptRoot)

Start-Process powershell -ArgumentList "-NoExit", "-Command", "uvicorn backend.app.main:app --port 8000 --reload"
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd frontend; npm run dev"
Write-Output "API  : http://127.0.0.1:8000"
Write-Output "App  : http://localhost:3000"
