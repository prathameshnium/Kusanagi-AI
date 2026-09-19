"""Serve the Kusanagi AI web suite locally.

    python scripts/serve.py            # http://localhost:8000
    python scripts/serve.py --port 9000 --no-browser

Opening the pages straight off disk (file://) works for most of the suite, but not
for Orochimaru: its PDF reader loads pdf.js as an ES module, and module loading is
subject to CORS, which file:// cannot satisfy. Serving over http fixes that and
matches how the pages behave on GitHub Pages.

Everything is served from the repo, so this works with no network connection.
"""
import argparse
import functools
import http.server
import os
import socketserver
import webbrowser

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class Handler(http.server.SimpleHTTPRequestHandler):
    # Python's mimetypes DB has no entry for .mjs, so it would be served as
    # application/octet-stream and the browser would refuse to execute it.
    extensions_map = dict(http.server.SimpleHTTPRequestHandler.extensions_map)
    extensions_map.update({
        ".mjs": "text/javascript",
        ".js": "text/javascript",
        ".css": "text/css",
        ".woff2": "font/woff2",
        ".json": "application/json",
        ".svg": "image/svg+xml",
    })

    def end_headers(self):
        # Mirror the protections a real deployment should send. The pages also
        # carry a CSP in a <meta> tag; frame-ancestors only works as a header,
        # which is why it is here and not there.
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Content-Security-Policy", "frame-ancestors 'none'")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):
        # One tidy line per request instead of the default noise.
        print("  %s" % (fmt % args))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8000)
    ap.add_argument("--no-browser", action="store_true")
    args = ap.parse_args()

    handler = functools.partial(Handler, directory=ROOT)
    socketserver.TCPServer.allow_reuse_address = True

    with socketserver.TCPServer(("127.0.0.1", args.port), handler) as httpd:
        url = "http://localhost:%d/index.html" % args.port
        print("Kusanagi AI suite -> %s" % url)
        print("Serving %s (Ctrl-C to stop)\n" % ROOT)
        if not args.no_browser:
            webbrowser.open(url)
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nstopped")


if __name__ == "__main__":
    main()
