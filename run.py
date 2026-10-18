#!/usr/bin/env python3
"""Unbored - one-command launcher.

    python run.py

The whole app runs in the browser: the recommender, search and browse all
work from a static data pack, so there is no API server to start. This:

  1. Installs frontend deps with npm (first run only).
  2. Starts the Vite dev server, which also serves the optional AI functions
     in frontend/api (see frontend/vite.devApi.ts).
  3. Opens your browser when the app is ready.

No API keys are required. Bring your own Gemini/DeepSeek key in the app, or
put GEMINI_API_KEY in frontend/.env.local to try the shared free tier locally.
Press Ctrl+C once to stop.

Python is only needed for the offline tooling in backend/ (catalog builder,
data pack, the reference engine and its tests).

Flags:
  --setup-only   Do the install step and exit (don't start the server).
  --no-browser   Don't open the browser automatically.
  --reinstall    Force-reinstall frontend dependencies.
"""

from __future__ import annotations

import os
import platform
import shutil
import subprocess
import sys
import threading
import time
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parent
FRONTEND = ROOT / "frontend"
IS_WINDOWS = platform.system() == "Windows"

WEB_PORT = 5173
WEB_URL = f"http://localhost:{WEB_PORT}"

# -- tiny ANSI helpers ------------------------------------------------------
_USE_COLOR = sys.stdout.isatty() and not IS_WINDOWS or os.environ.get("FORCE_COLOR")


def _c(text: str, code: str) -> str:
    return f"\033[{code}m{text}\033[0m" if _USE_COLOR else text


def info(msg: str) -> None:
    print(f"{_c('  ->', '36')} {msg}")


def ok(msg: str) -> None:
    print(f"{_c('  OK', '32')} {msg}")


def warn(msg: str) -> None:
    print(f"{_c('   !', '33')} {msg}")


def die(msg: str) -> None:
    print(f"{_c('   x', '31')} {msg}", file=sys.stderr)
    sys.exit(1)


# -- setup ------------------------------------------------------------------
def ensure_frontend(reinstall: bool) -> None:
    npm = shutil.which("npm")
    if npm is None:
        die("npm not found. Install Node.js 18+ from https://nodejs.org and re-run.")
    node_modules = FRONTEND / "node_modules"
    if reinstall and node_modules.exists():
        shutil.rmtree(node_modules, ignore_errors=True)
    if not node_modules.exists():
        info("Installing frontend dependencies (first run, ~1 min)...")
        subprocess.run([npm, "install"], cwd=str(FRONTEND), check=True)
    ok("Frontend ready.")


# -- process management -----------------------------------------------------
def _pump(proc: subprocess.Popen, label: str, color: str) -> None:
    prefix = _c(f"[{label}]", color)
    assert proc.stdout is not None
    for line in proc.stdout:
        sys.stdout.write(f"{prefix} {line}")
        sys.stdout.flush()


def start_server(open_browser: bool) -> int:
    npm = shutil.which("npm")
    info("Starting the app...")
    web = subprocess.Popen(
        [npm, "run", "dev", "--", "--port", str(WEB_PORT), "--strictPort"],
        cwd=str(FRONTEND),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
    )
    threading.Thread(target=_pump, args=(web, "web", "35"), daemon=True).start()

    if open_browser:
        def _open():
            time.sleep(3.0)
            try:
                webbrowser.open(WEB_URL)
            except Exception:
                pass
        threading.Thread(target=_open, daemon=True).start()

    print()
    ok(f"Unbored is starting at {_c(WEB_URL, '1;32')}")
    print(f"     {_c('Press Ctrl+C to stop.', '90')}\n")

    try:
        while web.poll() is None:
            time.sleep(0.4)
        warn("The dev server exited.")
    except KeyboardInterrupt:
        print()
        info("Stopping...")
    finally:
        if web.poll() is None:
            web.terminate()
            try:
                web.wait(timeout=8)
            except subprocess.TimeoutExpired:
                web.kill()
    ok("Stopped.")
    return 0


def main() -> int:
    args = set(sys.argv[1:])
    reinstall = "--reinstall" in args

    if not FRONTEND.exists():
        die("Run this from the repository root (frontend/ not found).")

    print(_c("\n  UNBORED  ", "1;33") + _c("one-command launcher\n", "90"))
    ensure_frontend(reinstall)

    if "--setup-only" in args:
        ok("Setup complete. Run `python run.py` to start.")
        return 0

    return start_server(open_browser="--no-browser" not in args)


if __name__ == "__main__":
    try:
        sys.exit(main())
    except subprocess.CalledProcessError as exc:
        die(f"A setup command failed (exit {exc.returncode}). See the output above.")
    except KeyboardInterrupt:
        sys.exit(130)
