#!/usr/bin/env python3
"""
serve_offline.py — zero-dependency local server for the Musical Staircase
digital twin frontend. Use this when there is no internet connection: it
serves index.html + css/js/assets from this folder over plain HTTP on your
LAN, so any phone/laptop on the same WiFi (including the ESP32's network)
can open it.

NOTE: The digital twin loads three.js from a CDN
(https://cdnjs.cloudflare.com/.../three.min.js). For a FULLY offline demo
with zero internet at any point, download that file once and save it next
to index.html as "three.min.js", then change the <script src="..."> tag in
index.html to "three.min.js". If you'll have internet at least once (e.g.
to load the page the first time), the PWA service worker (sw.js) caches it
automatically after the first successful load, and it'll keep working
offline after that.

Usage:
    python3 serve_offline.py [port]

Default port: 8000. Then, on any device on the same network, open:
    http://<this-computer's-LAN-IP>:8000
"""
import http.server
import socketserver
import sys
import socket

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000

class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        # Allow service worker registration + module scripts to work cleanly
        # over plain HTTP on a LAN (browsers treat http://localhost and
        # http://<LAN-IP> the same as long as it's the same origin).
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

def local_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(('8.8.8.8', 80))
        return s.getsockname()[0]
    except Exception:
        return '127.0.0.1'
    finally:
        s.close()

if __name__ == '__main__':
    with socketserver.TCPServer(('0.0.0.0', PORT), Handler) as httpd:
        print(f"Serving the digital twin at:")
        print(f"  http://localhost:{PORT}")
        print(f"  http://{local_ip()}:{PORT}   (use this from another device on the same WiFi)")
        print("Press Ctrl+C to stop.")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nStopped.")
