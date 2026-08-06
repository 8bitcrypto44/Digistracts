"""Threaded static server for the QA harness.



python -m http.server is single-threaded and deadlocks on browser keep-alive

connections, which stalls the automated QA runs.

"""

import os

import sys

from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer



PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8801





class NoCacheHandler(SimpleHTTPRequestHandler):

    protocol_version = "HTTP/1.1"



    def end_headers(self):

        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")

        self.send_header("Pragma", "no-cache")

        self.send_header("Expires", "0")

        self.send_header("Connection", "close")

        super().end_headers()



    def handle_one_request(self):
        """Always close after one response — no keep-alive stalls."""
        try:
            super().handle_one_request()
        finally:
            self.close_connection = True

    def log_message(self, fmt, *args):
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))


os.chdir(os.path.dirname(os.path.abspath(__file__)))
server = ThreadingHTTPServer(("127.0.0.1", PORT), NoCacheHandler)
server.daemon_threads = True
server.request_queue_size = 64
print("QA server on http://127.0.0.1:%d/qa.html" % PORT, flush=True)
server.serve_forever()
