@echo off
title CAD Drive Viewer - Servidor Local
cls
echo ===================================================
echo       CAD DRIVE VIEWER - SERVIDOR LOCAL DE OBRA
echo ===================================================
echo.

cd /d "%~dp0"

IF NOT EXIST node_modules (
    echo [!] No se detecto la carpeta node_modules. Instalando dependencias...
    call npm install
    echo.
)

echo [*] Verificando archivos de WebWorker CAD...
powershell -Command "New-Item -ItemType Directory -Force 'public\assets' | Out-Null; Copy-Item 'node_modules\@mlightcad\cad-simple-viewer\dist\mtext-renderer-worker.js' 'public\assets\' -Force; Copy-Item 'node_modules\@mlightcad\libredwg-converter\dist\libredwg-parser-worker.js' 'public\assets\' -Force; Copy-Item 'node_modules\@mlightcad\libredwg-converter\dist\libredwg-web.wasm' 'public\assets\' -Force"

echo.
echo [OK] Iniciando el servidor Vite en la red local...
echo      Cualquier celular o dispositivo conectado a tu misma red WiFi
echo      podra acceder usando la direccion IP que aparecera abajo.
echo.
echo ===================================================
echo.

call npm run dev:host

pause
