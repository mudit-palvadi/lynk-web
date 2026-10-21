"""LynkShare website dev server (stdlib only, no backend changes).

Serves `web/` as the site root and rewrites deep-link paths
(`/send/{transfer_id}`) to the receiver page so local testing matches
production routing without touching the FastAPI backend.
"""
import http.server
import re
import sys
from pathlib import Path

WEB_ROOT = Path(__file__).resolve().parent.parent
RECEIVE_PAGE = "/app/receive.html"
SEND_PATH = re.compile(r"^/send/[^/?#]+$")


class LynkRequestHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(WEB_ROOT), **kwargs)

    def do_GET(self):
        if SEND_PATH.match(self.path):
            self.path = RECEIVE_PAGE
        super().do_GET()

    def guess_type(self, path):
        if path.endswith((".well-known/assetlinks.json", ".well-known/apple-app-site-association")) or path.endswith(
            ("assetlinks.json", "apple-app-site-association")
        ):
            return "application/json"
        if path.endswith(".webmanifest"):
            return "application/manifest+json"
        guessed = super().guess_type(path)
        if path.endswith(".js"):
            return "text/javascript"
        return guessed

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, format, *args):
        print(f"[dev] {args[0]}")


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
    server = http.server.ThreadingHTTPServer(("", port), LynkRequestHandler)
    print(f"LynkShare web dev server -> http://localhost:{port}")
    print(f"Deep links:          http://localhost:{port}/send/<transfer-id>")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.shutdown()


if __name__ == "__main__":
    main()
