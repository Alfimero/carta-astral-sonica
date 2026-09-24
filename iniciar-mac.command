#!/bin/bash
# =========================================================
# iniciar-mac.command — abre Carta Astral Sónica en macOS
# =========================================================
#
# Pensado para una MacBook Pro 2012 (macOS 10.13 – 10.15, o más nuevo
# con OpenCore Legacy Patcher). Doble clic en este archivo y:
#
#   1. Descarga (una sola vez) p5.js y astronomy-engine a vendor/ para
#      que el programa funcione también sin internet.
#   2. Levanta el servidor local (servidor.py) en http://localhost:8123 (Web MIDI y
#      las salidas de audio necesitan localhost, no file://).
#   3. Abre Google Chrome en ventana de aplicación, con un perfil propio
#      y --autoplay-policy=no-user-gesture-required: el audio suena en
#      cuanto abre, sin tener que dar clic. Usa ?ligero=1 (modo ligero:
#      menos cuadros por segundo y resolución 1×, para equipos viejos).
#
# Cierra esta ventana de Terminal para apagar el servidor.
#
# Si macOS dice que no se puede abrir: clic derecho → Abrir (solo la
# primera vez). Si dice que no tiene permisos de ejecución, en Terminal:
#     chmod +x iniciar-mac.command
# =========================================================

cd "$(dirname "$0")" || exit 1

PUERTO=8123
URL="http://localhost:${PUERTO}/?ligero=1"
PERFIL="$HOME/Library/Application Support/CartaAstralSonica-Chrome"

echo "✦ Carta Astral Sónica"
echo

# ---------- 1) Librerías locales ----------
mkdir -p vendor
descargar() {
  local destino="$1" url="$2"
  if [ ! -s "vendor/$destino" ]; then
    echo "Descargando $destino…"
    if ! curl -fsSL "$url" -o "vendor/$destino.tmp"; then
      rm -f "vendor/$destino.tmp"
      echo "  (sin internet: se usará el CDN cuando haya conexión)"
      return
    fi
    mv "vendor/$destino.tmp" "vendor/$destino"
  fi
}
descargar "p5.min.js" "https://cdnjs.cloudflare.com/ajax/libs/p5.js/1.9.4/p5.min.js"
descargar "astronomy.browser.js" "https://cdn.jsdelivr.net/npm/astronomy-engine@2.1.19/astronomy.browser.js"

# ---------- 2) Servidor local ----------
SERVIDOR_PID=""
if curl -s -o /dev/null "http://localhost:${PUERTO}/"; then
  echo "Ya hay un servidor en el puerto ${PUERTO}; se reutiliza."
else
  # servidor.py aguanta las ~25 peticiones simultáneas de la página
  # (http.server de serie rechaza conexiones) y funciona con Python 3 o
  # con el 2.7 que traen de fábrica macOS 10.13–10.15.
  if command -v python3 >/dev/null 2>&1 && python3 -c "import http.server" >/dev/null 2>&1; then
    python3 servidor.py "$PUERTO" >/dev/null 2>&1 &
  elif command -v python >/dev/null 2>&1; then
    python servidor.py "$PUERTO" >/dev/null 2>&1 &
  elif command -v ruby >/dev/null 2>&1; then
    ruby -run -e httpd . -p "$PUERTO" >/dev/null 2>&1 &
  else
    echo "No encontré python3, python ni ruby para levantar el servidor."
    echo "Instala Python 3 desde https://www.python.org/downloads/macos/ y vuelve a intentarlo."
    read -r -p "Enter para salir…"
    exit 1
  fi
  SERVIDOR_PID=$!
  trap 'kill $SERVIDOR_PID 2>/dev/null' EXIT INT TERM HUP
  # Esperar a que responda (máx. ~5 s)
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    curl -s -o /dev/null "http://localhost:${PUERTO}/" && break
    sleep 0.5
  done
  echo "Servidor local en http://localhost:${PUERTO}"
fi

# ---------- 3) Navegador ----------
NAVEGADOR=""
for app in "Google Chrome" "Chromium" "Microsoft Edge" "Brave Browser"; do
  if [ -d "/Applications/${app}.app" ] || [ -d "$HOME/Applications/${app}.app" ]; then
    NAVEGADOR="$app"
    break
  fi
done

if [ -n "$NAVEGADOR" ]; then
  echo "Abriendo ${NAVEGADOR}…"
  open -na "$NAVEGADOR" --args \
    --user-data-dir="$PERFIL" \
    --autoplay-policy=no-user-gesture-required \
    --no-first-run \
    --no-default-browser-check \
    --app="$URL"
else
  echo "No encontré Google Chrome. Safari no tiene Web MIDI: instala Chrome"
  echo "(en macOS 10.13–10.14 la última versión compatible es Chrome 116;"
  echo " en 10.15 Catalina, Chrome 128). Abriendo el navegador predeterminado…"
  open "$URL"
fi

echo
echo "Listo. Deja esta ventana abierta mientras usas el programa;"
echo "ciérrala (o Ctrl+C) para apagar el servidor."

if [ -n "$SERVIDOR_PID" ]; then
  wait "$SERVIDOR_PID"
fi
