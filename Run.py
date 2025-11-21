#!/usr/bin/env python3
"""
Simple local HTTP server for opening the EC3 buckling calculator.

Usage:
    python run_server.py

Then your browser will open:
    http://localhost:8000/EC3_member_check.html
"""

import http.server
import socketserver
import webbrowser
from pathlib import Path

PORT = 8000

# Root directory = folder where this script is located
ROOT = Path(__file__).resolve().parent

HTML_FILE = "EC3_member_check.html"  # 改成你自己的 html 文件名也可以


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        # Serve files from ROOT directory
        super().__init__(*args, directory=str(ROOT), **kwargs)


def main():
    url = f"http://localhost:{PORT}/{HTML_FILE}"
    print(f"Serving directory: {ROOT}")
    print(f"Open this URL in your browser if it doesn't open automatically:")
    print(f"  {url}\n")

    with socketserver.TCPServer(("", PORT), Handler) as httpd:
        try:
            # 自动打开默认浏览器
            webbrowser.open(url)
        except Exception:
            pass
        print(f"HTTP server running at http://localhost:{PORT}/ (Ctrl+C to stop)")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nServer stopped.")


if __name__ == "__main__":
    main()
