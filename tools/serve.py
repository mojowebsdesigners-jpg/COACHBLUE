"""Static dev server that understands HTTP Range.

Python's stock `http.server` answers every request with the whole file and a
200. A <video> cannot seek against that, so the scroll transport sits frozen at
0:00 -- which looks exactly like a broken page. Range support is the one thing
this server adds, and it is not optional for this site.

    python tools/serve.py [port]
"""
import os, re, sys, mimetypes
from http.server import HTTPServer, SimpleHTTPRequestHandler

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RANGE_RE = re.compile(r"bytes=(\d*)-(\d*)")


class RangeHandler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def end_headers(self):
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def send_head(self):
        rng = self.headers.get("Range")
        if not rng:
            return super().send_head()

        path = self.translate_path(self.path)
        if os.path.isdir(path) or not os.path.exists(path):
            return super().send_head()

        m = RANGE_RE.match(rng.strip())
        if not m:
            return super().send_head()

        size = os.path.getsize(path)
        first, last = m.group(1), m.group(2)
        if first == "":                        # suffix range: last N bytes
            length = int(last or 0)
            start, end = max(size - length, 0), size - 1
        else:
            start = int(first)
            end = int(last) if last else size - 1
        end = min(end, size - 1)

        if start > end or start >= size:
            self.send_response(416)
            self.send_header("Content-Range", f"bytes */{size}")
            self.end_headers()
            return None

        ctype = mimetypes.guess_type(path)[0] or "application/octet-stream"
        f = open(path, "rb")
        f.seek(start)
        self.send_response(206)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.send_header("Content-Length", str(end - start + 1))
        self.end_headers()
        self._remaining = end - start + 1
        return f

    def copyfile(self, src, dst):
        remaining = getattr(self, "_remaining", None)
        if remaining is None:
            return super().copyfile(src, dst)
        self._remaining = None
        while remaining > 0:
            chunk = src.read(min(64 * 1024, remaining))
            if not chunk:
                break
            try:
                dst.write(chunk)
            except (BrokenPipeError, ConnectionResetError):
                break                          # the browser moved on mid-seek
            remaining -= len(chunk)

    def log_message(self, *a):
        pass                                   # quiet


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8899
    print(f"serving {ROOT}\n  http://127.0.0.1:{port}/   (Range supported)")
    HTTPServer(("127.0.0.1", port), RangeHandler).serve_forever()
