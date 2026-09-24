# -*- coding: utf-8 -*-
# =========================================================
# servidor.py — servidor local de Carta Astral Sónica
# =========================================================
#
# Lo usan los lanzadores (iniciar-windows.bat / iniciar-mac.command) en
# lugar de "python -m http.server", que tiene dos problemas aquí:
#
#   1. Su cola de conexiones pendientes es de solo 5. Al abrir la página
#      Chrome pide ~25 scripts casi a la vez y, sobre todo en Windows, las
#      conexiones que no caben se RECHAZAN: algunos scripts (config.js,
#      synth.js…) no cargan y el programa arranca roto
#      ("synth is not defined"). Aquí la cola es de 128 y cada petición
#      se atiende en su propio hilo.
#   2. No manda Cache-Control, así que el navegador puede mezclar
#      archivos viejos en caché con archivos nuevos después de una
#      actualización. Aquí todo va con "no-cache" (revalida siempre).
#
# Escucha solo en esta computadora, en IPv4 e IPv6 a la vez (localhost
# puede resolver a 127.0.0.1 o a ::1) y fuerza el tipo MIME correcto de .js/.css/.json aunque el
# registro de Windows diga otra cosa. Funciona con Python 3 y con el
# Python 2.7 que traen las Mac viejas.
#
#   python servidor.py [puerto]      (por defecto 8123)
# =========================================================

import os
import socket
import sys

try:
    from http.server import SimpleHTTPRequestHandler, HTTPServer
    from socketserver import ThreadingMixIn
except ImportError:  # Python 2.7
    from SimpleHTTPServer import SimpleHTTPRequestHandler
    from BaseHTTPServer import HTTPServer
    from SocketServer import ThreadingMixIn

PUERTO = int(sys.argv[1]) if len(sys.argv) > 1 else 8123
os.chdir(os.path.dirname(os.path.abspath(__file__)))


class Manejador(SimpleHTTPRequestHandler):
    extensions_map = dict(SimpleHTTPRequestHandler.extensions_map)
    extensions_map.update({
        ".js": "application/javascript",
        ".css": "text/css",
        ".json": "application/json",
        ".html": "text/html",
        ".svg": "image/svg+xml",
        ".png": "image/png",
    })

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        SimpleHTTPRequestHandler.end_headers(self)

    def log_message(self, formato, *args):
        pass  # sin ruido en la consola del lanzador


class Servidor(ThreadingMixIn, HTTPServer):
    daemon_threads = True
    allow_reuse_address = False   # en Windows, True deja a dos servidores compartir el puerto
    request_queue_size = 128


class ServidorIPv6(Servidor):
    address_family = socket.AF_INET6


def crear_servidores():
    # Solo en esta computadora (loopback), no en la red local.
    # IPv4 es obligatorio; IPv6 (::1) se suma si el sistema lo tiene,
    # porque "localhost" puede resolver a cualquiera de los dos.
    servidores = [Servidor(("127.0.0.1", PUERTO), Manejador)]
    if socket.has_ipv6:
        try:
            servidores.append(ServidorIPv6(("::1", PUERTO), Manejador))
        except (socket.error, OSError):
            pass
    return servidores


if __name__ == "__main__":
    import threading
    try:
        servidores = crear_servidores()
    except (socket.error, OSError) as e:
        print("No se pudo abrir el puerto %d (%s). ¿Ya hay otro servidor abierto?" % (PUERTO, e))
        sys.exit(1)
    print("Servidor en http://localhost:%d" % PUERTO)
    for s in servidores[1:]:
        hilo = threading.Thread(target=s.serve_forever)
        hilo.daemon = True
        hilo.start()
    try:
        servidores[0].serve_forever()
    except KeyboardInterrupt:
        pass
