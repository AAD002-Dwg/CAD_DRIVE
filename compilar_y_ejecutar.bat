@echo off
title CAD Drive Viewer - Produccion Local
cls
echo ===================================================
echo     CAD DRIVE VIEWER - COMPILACION DE PRODUCCION
echo ===================================================
echo.

cd /d "%~dp0"

IF NOT EXIST node_modules (
    echo [!] Instalando dependencias...
    call npm install
)

echo [*] Compilando proyecto para produccion (Optimizado)...
call npm run build

IF %ERRORLEVEL% NEQ 0 (
    echo.
    echo [X] Error durante la compilacion.
    pause
    exit /b %ERRORLEVEL%
)

echo.
echo [OK] Compilacion exitosa. Iniciando servidor de produccion en la red...
echo.

call npm run preview:host

pause
