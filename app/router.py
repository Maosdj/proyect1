"""Router minimalista para la API REST."""

import re

from .auth import ApiError

ROUTES = []


def route(method, pattern, roles=None):
    """Registra un endpoint. `pattern` admite parametros: /api/products/{id}"""
    regex = re.compile("^" + re.sub(r"\{(\w+)\}", r"(?P<\1>[^/]+)", pattern) + "$")

    def decorator(fn):
        ROUTES.append({"method": method.upper(), "regex": regex, "roles": roles, "fn": fn})
        return fn

    return decorator


def match(method, path):
    found_path = False
    for r in ROUTES:
        m = r["regex"].match(path)
        if m:
            found_path = True
            if r["method"] == method.upper():
                return r, m.groupdict()
    if found_path:
        raise ApiError(405, "Metodo no permitido")
    return None, None


class Ctx(object):
    """Contexto de una peticion."""

    def __init__(self, user, params, query, body, token):
        self.user = user
        self.params = params
        self.query = query
        self.body = body or {}
        self.token = token

    def param(self, name, default=None, cast=None):
        val = self.params.get(name, default)
        if cast and val is not None:
            try:
                return cast(val)
            except (TypeError, ValueError):
                raise ApiError(400, "Parametro invalido: %s" % name)
        return val

    def q(self, name, default=None):
        vals = self.query.get(name)
        return vals[0] if vals else default

    def qint(self, name, default=None):
        val = self.q(name)
        if val in (None, ""):
            return default
        try:
            return int(val)
        except ValueError:
            return default

    def need(self, *fields):
        out = []
        for f in fields:
            val = self.body.get(f)
            if val is None or (isinstance(val, str) and not val.strip()):
                raise ApiError(400, "El campo '%s' es obligatorio" % f)
            out.append(val.strip() if isinstance(val, str) else val)
        return out[0] if len(out) == 1 else out

    def num(self, field, default=0):
        val = self.body.get(field, default)
        if val in (None, ""):
            return default
        try:
            return float(val)
        except (TypeError, ValueError):
            raise ApiError(400, "El campo '%s' debe ser numerico" % field)

    def text(self, field, default=""):
        val = self.body.get(field, default)
        return ("" if val is None else str(val)).strip()

    @property
    def is_admin(self):
        return self.user and self.user["role"] == "admin"
