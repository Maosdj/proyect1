#!/usr/bin/env python3
"""AgroFerre POS - servidor web (solo libreria estandar de Python 3).

Uso:
    python3 server.py [--port 8080] [--host 0.0.0.0] [--reset]
"""

import argparse
import json
import mimetypes
import os
import posixpath
import socket
import sys
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs, unquote

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app import auth, db, router                      # noqa: E402
from app.auth import ApiError                          # noqa: E402
from app.router import Ctx                             # noqa: E402
from app import routes_auth, routes_inventory, routes_sales      # noqa: E402,F401
from app import routes_customers, routes_reports, routes_admin   # noqa: E402,F401

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
WEB_DIR = os.path.join(BASE_DIR, "web")

mimetypes.add_type("application/javascript", ".js")
mimetypes.add_type("text/css", ".css")
mimetypes.add_type("image/svg+xml", ".svg")


class Handler(BaseHTTPRequestHandler):
    server_version = "AgroFerrePOS/1.0"
    protocol_version = "HTTP/1.1"

    # ------------------------------------------------------------- utils
    def log_message(self, fmt, *args):
        if self.path.startswith("/api"):
            sys.stderr.write("  %s %s\n" % (self.command, self.path))

    def _send(self, status, body=b"", content_type="application/json; charset=utf-8", extra=None):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD" and body:
            self.wfile.write(body)

    def _json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False, default=str).encode("utf-8")
        self._send(status, body)

    # ------------------------------------------------------------ metodos
    def do_GET(self):
        self._handle("GET")

    def do_POST(self):
        self._handle("POST")

    def do_PUT(self):
        self._handle("PUT")

    def do_PATCH(self):
        self._handle("PATCH")

    def do_DELETE(self):
        self._handle("DELETE")

    def do_HEAD(self):
        self._handle("GET")

    def do_OPTIONS(self):
        self._send(204, b"", "text/plain")

    # ------------------------------------------------------------ router
    def _handle(self, method):
        parsed = urlparse(self.path)
        path = unquote(parsed.path)
        try:
            if path.startswith("/api/"):
                self._api(method, path, parse_qs(parsed.query))
            else:
                self._static(path)
        except BrokenPipeError:
            pass
        except Exception:
            traceback.print_exc()
            try:
                self._json(500, {"error": "Error interno del servidor"})
            except Exception:
                pass

    def _read_body(self):
        length = int(self.headers.get("Content-Length") or 0)
        if not length:
            return {}
        raw = self.rfile.read(length)
        if not raw:
            return {}
        try:
            data = json.loads(raw.decode("utf-8"))
        except ValueError:
            raise ApiError(400, "El cuerpo de la peticion no es JSON valido")
        return data if isinstance(data, dict) else {"data": data}

    def _api(self, method, path, query):
        try:
            handler, params = router.match(method, path)
            if not handler:
                raise ApiError(404, "Recurso no encontrado")

            token = ""
            header = self.headers.get("Authorization") or ""
            if header.startswith("Bearer "):
                token = header[7:].strip()
            user = auth.user_from_token(token) if token else None

            if handler["roles"]:
                auth.require(user, handler["roles"])

            body = self._read_body() if method in ("POST", "PUT", "PATCH") else {}
            ctx = Ctx(user, params, query, body, token)
            result = handler["fn"](ctx)
            if isinstance(result, tuple):
                status, payload = result
            else:
                status, payload = 200, result
            self._json(status, payload if payload is not None else {"ok": True})
        except ApiError as e:
            self._json(e.status, {"error": e.message})

    # ------------------------------------------------------------ estatico
    def _static(self, path):
        if path == "/":
            path = "/index.html"
        clean = posixpath.normpath(path).lstrip("/")
        full = os.path.join(WEB_DIR, clean)
        if not os.path.abspath(full).startswith(WEB_DIR):
            self._send(403, b"Prohibido", "text/plain")
            return
        if not os.path.isfile(full):
            # Fallback SPA: cualquier ruta desconocida entrega el index.
            if "." in os.path.basename(clean):
                self._send(404, b"No encontrado", "text/plain")
                return
            full = os.path.join(WEB_DIR, "index.html")
        ctype = mimetypes.guess_type(full)[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype in ("application/javascript", "application/json"):
            ctype += "; charset=utf-8"
        with open(full, "rb") as fh:
            body = fh.read()
        self._send(200, body, ctype, {"Cache-Control": "no-store, must-revalidate"})


def local_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"


def main():
    ap = argparse.ArgumentParser(description="Servidor AgroFerre POS")
    ap.add_argument("--port", type=int, default=8080)
    ap.add_argument("--host", default="0.0.0.0")
    ap.add_argument("--reset", action="store_true", help="Borra la base de datos y la vuelve a crear")
    args = ap.parse_args()

    if args.reset:
        for suffix in ("", "-wal", "-shm"):
            p = db.DB_PATH + suffix
            if os.path.exists(p):
                os.remove(p)
        print("Base de datos reiniciada.")

    db.init_db()
    httpd = ThreadingHTTPServer((args.host, args.port), Handler)
    ip = local_ip()
    print("")
    print("  AgroFerre POS  -  servidor en marcha")
    print("  ----------------------------------------------------")
    print("  Escritorio:  http://localhost:%d" % args.port)
    print("  Celular:     http://%s:%d   (misma red WiFi)" % (ip, args.port))
    print("")
    print("  Usuarios de prueba:")
    print("    admin@agroferre.com   / admin123    (Administrador)")
    print("    cajero@agroferre.com  / cajero123   (Cajero)")
    print("    cliente@correo.com    / cliente123  (Cliente)")
    print("")
    print("  Ctrl+C para detener")
    print("", flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n  Servidor detenido.")
        httpd.server_close()


if __name__ == "__main__":
    main()
