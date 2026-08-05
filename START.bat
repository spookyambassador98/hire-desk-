@echo off
cd /d "%~dp0"
if not exist node_modules\next (
  echo Installing dependencies...
  call npm install
)
node ".\node_modules\next\dist\bin\next" dev --port 3011
