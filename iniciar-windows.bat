@echo off
rem =========================================================
rem iniciar-windows.bat - abre Carta Astral Sonica en Windows
rem =========================================================
rem  1. Descarga (una sola vez) p5.js y astronomy-engine a vendor\
rem     para que funcione tambien sin internet.
rem  2. Levanta el servidor local (servidor.py) en http://localhost:8123
rem  3. Abre Chrome (o Edge) en ventana de aplicacion con un perfil
rem     propio y --autoplay-policy=no-user-gesture-required: el audio
rem     suena al abrir, sin dar clic.
rem  Cierra esta ventana para apagar el servidor.
rem =========================================================
setlocal
cd /d "%~dp0"
set PUERTO=8123
set URL=http://localhost:%PUERTO%/
set PERFIL=%LOCALAPPDATA%\CartaAstralSonica-Chrome

echo Carta Astral Sonica
echo.

if not exist vendor mkdir vendor
if not exist vendor\p5.min.js (
  echo Descargando p5.min.js...
  curl -fsSL "https://cdnjs.cloudflare.com/ajax/libs/p5.js/1.9.4/p5.min.js" -o vendor\p5.min.js || del /q vendor\p5.min.js 2>nul
)
if not exist vendor\astronomy.browser.js (
  echo Descargando astronomy.browser.js...
  curl -fsSL "https://cdn.jsdelivr.net/npm/astronomy-engine@2.1.19/astronomy.browser.js" -o vendor\astronomy.browser.js || del /q vendor\astronomy.browser.js 2>nul
)

set PY=
where py >nul 2>nul && set PY=py -3
if not defined PY where python >nul 2>nul && set PY=python
if not defined PY (
  echo No encontre Python. Instalalo desde https://www.python.org/downloads/ y vuelve a intentarlo.
  pause
  exit /b 1
)

set NAVEGADOR=
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set NAVEGADOR=%ProgramFiles%\Google\Chrome\Application\chrome.exe
if not defined NAVEGADOR if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" set NAVEGADOR=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe
if not defined NAVEGADOR if exist "%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe" set NAVEGADOR=%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe
if not defined NAVEGADOR if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" set NAVEGADOR=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe

rem Servidor en segundo plano dentro de esta misma ventana: al cerrarla
rem se apaga. Si ya hay uno en el puerto, simplemente se reutiliza.
curl -s -o nul %URL% && goto servidor_listo
start "" /b %PY% servidor.py %PUERTO% >nul 2>nul
set /a INTENTOS=0
:esperar_servidor
curl -s -o nul %URL% && goto servidor_listo
set /a INTENTOS+=1
if %INTENTOS% GEQ 15 goto servidor_listo
timeout /t 1 /nobreak >nul
goto esperar_servidor
:servidor_listo

if defined NAVEGADOR (
  start "" "%NAVEGADOR%" --user-data-dir="%PERFIL%" --autoplay-policy=no-user-gesture-required --no-first-run --no-default-browser-check --app=%URL%
) else (
  start "" %URL%
)

echo Servidor en %URL%
echo Deja esta ventana abierta mientras usas el programa; cierrala para apagar el servidor.
:mantener
pause >nul
goto mantener
