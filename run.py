#!/usr/bin/env python3
"""Unbored - one-command launcher.

    python run.py

Does everything needed for a first run, then keeps both servers alive:

  1. Creates the backend virtualenv and installs Python deps (first run only).
  2. Copies backend/.env from the example if it's missing.
  3. Installs frontend deps with npm (first run only).
  4. Starts the FastAPI backend and the Vite frontend together.
  5. Opens your browser when the app is ready.

No API keys are required - without them Unbored runs in demo mode. Press
Ctrl+C once to stop everything cleanly.

Flags:
  --setup-only   Do the install steps and exit (don't start servers).
  --no-browser   Don't open the browser automatically.
  --reinstall    Force-reinstall backend and frontend dependencies.
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
BACKEND = ROOT / "backend"
FRONTEND = ROOT / "frontend"
VENV = BACKEND / ".venv"
IS_WINDOWS = platform.system() == "Windows"

API_PORT = 8000
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


# -- paths inside the venv --------------------------------------------------
def venv_python() -> Path:
    return VENV / ("Scripts/python.exe" if IS_WINDOWS else "bin/python")


# -- setup steps ------------------------------------------------------------
def ensure_backend(reinstall: bool) -> None:
    fresh = not VENV.exists()
    if fresh:
        info("Creating backend virtual environment...")
        subprocess.run([sys.executable, "-m", "venv", str(VENV)], check=True)

    sentinel = VENV / ".deps-installed"
    if fresh or reinstall or not sentinel.exists():
        info("Installing backend dependencies...")
        py = str(venv_python())
        subprocess.run([py, "-m", "pip", "install", "--upgrade", "pip", "--quiet"], check=True)
        subprocess.run(
            [py, "-m", "pip", "install", "-r", str(BACKEND / "requirements.txt"), "--quiet"],
            check=True,
        )
        sentinel.write_text("ok", encoding="utf-8")
    ok("Backend ready.")


def ensure_env() -> None:
    env = BACKEND / ".env"
    example = BACKEND / ".env.example"
    if not env.exists() and example.exists():
        shutil.copyfile(example, env)
        ok("Created backend/.env from the example (running in demo mode).")
        info("Add API keys to backend/.env any time to upgrade the experience.")


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


def start_servers(open_browser: bool) -> int:
    npm = shutil.which("npm")
    env = os.environ.copy()
    env["PYTHONUNBUFFERED"] = "1"

    info("Starting backend and frontend...")
    api = subprocess.Popen(
        [str(venv_python()), "-m", "uvicorn", "app.main:app", "--port", str(API_PORT)],
        cwd=str(BACKEND),
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
    )
    web = subprocess.Popen(
        [npm, "run", "dev", "--", "--port", str(WEB_PORT), "--strictPort"],
        cwd=str(FRONTEND),
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
    )

    threading.Thread(target=_pump, args=(api, "api", "36"), daemon=True).start()
    threading.Thread(target=_pump, args=(web, "web", "35"), daemon=True).start()

    if open_browser:
        def _open():
            time.sleep(3.5)
            try:
                webbrowser.open(WEB_URL)
            except Exception:
                pass
        threading.Thread(target=_open, daemon=True).start()

    print()
    ok(f"Unbored is starting at {_c(WEB_URL, '1;32')}")
    print(f"     {_c('Press Ctrl+C to stop.', '90')}\n")

    try:
        while True:
            if api.poll() is not None:
                warn("Backend exited; shutting down.")
                break
            if web.poll() is not None:
                warn("Frontend exited; shutting down.")
                break
            time.sleep(0.4)
    except KeyboardInterrupt:
        print()
        info("Stopping...")
    finally:
        for proc in (web, api):
            if proc.poll() is None:
                proc.terminate()
        for proc in (web, api):
            try:
                proc.wait(timeout=8)
            except subprocess.TimeoutExpired:
                proc.kill()
    ok("Stopped.")
    return 0


def main() -> int:
    args = set(sys.argv[1:])
    reinstall = "--reinstall" in args

    if not BACKEND.exists() or not FRONTEND.exists():
        die("Run this from the repository root (backend/ and frontend/ not found).")

    print(_c("\n  UNBORED  ", "1;33") + _c("one-command launcher\n", "90"))
    ensure_backend(reinstall)
    ensure_env()
    ensure_frontend(reinstall)

    if "--setup-only" in args:
        ok("Setup complete. Run `python run.py` to start.")
        return 0

    return start_servers(open_browser="--no-browser" not in args)


if __name__ == "__main__":
    try:
        sys.exit(main())
    except subprocess.CalledProcessError as exc:
        die(f"A setup command failed (exit {exc.returncode}). See the output above.")
    except KeyboardInterrupt:
        sys.exit(130)
