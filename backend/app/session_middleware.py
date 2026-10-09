"""Session cookie middleware with a real "Remember me".

Starlette's own SessionMiddleware signs every cookie with one fixed
max_age for the whole app, so there was no way for a single login to
ask for a shorter-lived cookie -- the "Remember me" checkbox on the
login form was decorative, and the session cookie lasted 14 days
whether or not it was ticked, including on a shared/school PC after
the browser was closed.

This subclass reads `remember_me` out of the session payload itself
(set once at login, see auth.py) and only grants the long 14-day
Max-Age when it's true. Otherwise it omits Max-Age entirely, which
makes it a true browser-session cookie: cleared when the browser is
closed, same as Chrome's own "until you close the browser" cookies.
"""

from __future__ import annotations

import json
import typing
from base64 import b64decode, b64encode

from itsdangerous.exc import BadSignature
from starlette.datastructures import MutableHeaders
from starlette.middleware.sessions import SessionMiddleware
from starlette.requests import HTTPConnection
from starlette.types import Message, Receive, Scope, Send


class RememberAwareSessionMiddleware(SessionMiddleware):
    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] not in ("http", "websocket"):  # pragma: no cover
            await self.app(scope, receive, send)
            return

        connection = HTTPConnection(scope)
        initial_session_was_empty = True

        if self.session_cookie in connection.cookies:
            data = connection.cookies[self.session_cookie].encode("utf-8")
            try:
                # The signature's own max_age is just the outer bound on how
                # old a signed cookie can be and still be trusted -- the
                # browser-side lifetime (below) is what actually controls
                # whether the cookie survives closing the browser.
                data = self.signer.unsign(data, max_age=self.max_age)
                scope["session"] = json.loads(b64decode(data))
                initial_session_was_empty = False
            except BadSignature:
                scope["session"] = {}
        else:
            scope["session"] = {}

        async def send_wrapper(message: Message) -> None:
            if message["type"] == "http.response.start":
                if scope["session"]:
                    remember = bool(scope["session"].get("remember_me"))
                    cookie_max_age: typing.Optional[int] = self.max_age if remember else None
                    data = b64encode(json.dumps(scope["session"]).encode("utf-8"))
                    data = self.signer.sign(data)
                    headers = MutableHeaders(scope=message)
                    header_value = "{session_cookie}={data}; path={path}; {max_age}{security_flags}".format(
                        session_cookie=self.session_cookie,
                        data=data.decode("utf-8"),
                        path=self.path,
                        max_age=f"Max-Age={cookie_max_age}; " if cookie_max_age else "",
                        security_flags=self.security_flags,
                    )
                    headers.append("Set-Cookie", header_value)
                elif not initial_session_was_empty:
                    headers = MutableHeaders(scope=message)
                    header_value = "{session_cookie}={data}; path={path}; {expires}{security_flags}".format(
                        session_cookie=self.session_cookie,
                        data="null",
                        path=self.path,
                        expires="expires=Thu, 01 Jan 1970 00:00:00 GMT; ",
                        security_flags=self.security_flags,
                    )
                    headers.append("Set-Cookie", header_value)
            await send(message)

        await self.app(scope, receive, send_wrapper)
