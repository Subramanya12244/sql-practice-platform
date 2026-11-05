"""Run every runnable Python example and every Python task in the site content.

- ```python blocks in notes must exit 0 within 5 s (no network, run in a temp dir).
- python tasks (exercises and projects): solution + visible + hidden tests must pass; starter + tests must fail.
Usage: python3 scripts/check_python_blocks.py   (needs pandas + numpy)
"""
import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path

CONTENT = Path(__file__).resolve().parent.parent / "frontend" / "src" / "site" / "content"
BLOCK = re.compile(r"```python\n(.*?)```", re.S)
TASK = re.compile(r"```task\n(\{.*?\})\s*\n```", re.S)


def run(code: str, timeout: float = 5.0) -> tuple[bool, str]:
    with tempfile.TemporaryDirectory() as d:
        try:
            p = subprocess.run([sys.executable, "-c", code], cwd=d, capture_output=True, text=True, timeout=timeout)
        except subprocess.TimeoutExpired:
            return False, "timed out"
        return p.returncode == 0, (p.stderr or p.stdout).strip().splitlines()[-1:] and (p.stderr or p.stdout).strip().splitlines()[-1] or ""


def main() -> int:
    failures: list[str] = []
    blocks = tasks = 0
    for md in sorted(CONTENT.rglob("*.md")):
        text = md.read_text()
        rel = md.relative_to(CONTENT)
        for i, code in enumerate(BLOCK.findall(text)):
            blocks += 1
            ok, msg = run(code)
            if not ok:
                failures.append(f"{rel} block {i}: {msg}")
        for raw in TASK.findall(text):
            t = json.loads(raw)
            if t.get("type") != "python":
                continue
            tasks += 1
            ok, msg = run(t["solution"] + "\n" + t["tests"] + "\n" + t.get("hidden", ""), timeout=20)
            if not ok:
                failures.append(f"{rel} task {t['id']}: solution fails — {msg}")
            ok, _ = run(t["starter"] + "\n" + t["tests"], timeout=20)
            if ok:
                failures.append(f"{rel} task {t['id']}: starter passes the tests")
    print(f"python blocks: {blocks}, python tasks: {tasks}, failures: {len(failures)}")
    for f in failures:
        print("  " + f)
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
