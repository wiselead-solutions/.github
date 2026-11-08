"""Bounded, local Graphify navigation. Usage: python scripts/graphify-navigation.py [build|check]."""
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
SETTINGS = json.loads((ROOT / ".graphify-navigation.json").read_text(encoding="utf-8"))
SCAN = (ROOT / SETTINGS["scope"]).resolve()
OUTPUT = ROOT / "graphify-out"
VERSION = "0.9.102"
EXCLUDES = ["**/Migrations/**", "**/migrations/**", "**/bin/**", "**/obj/**",
            "**/node_modules/**", "**/wwwroot/lib/**", "**/vendor/**", "**/state/**",
            "**/runtime/**", "**/logs/**", "**/runs/**", "**/*.min.js",
            "**/appsettings*.json", "**/.env*", "**/*.pfx", "**/*.pem", "**/*.key",
            "graphify-navigation.py", "**/graphify-navigation.py"]


def command(args, capture=False):
    env = {**os.environ, "GRAPHIFY_BACKEND": "none", "PYTHONUTF8": "1"}
    return subprocess.run(["uv", "tool", "run", "--from", f"graphifyy=={VERSION}", "graphify", *args],
                          cwd=ROOT, env=env, text=True, encoding="utf-8",
                          capture_output=capture, timeout=900)


def build():
    if not SCAN.is_relative_to(ROOT) or not SCAN.is_dir():
        raise ValueError("Graphify scope must be an existing directory inside this checkout")
    args = ["extract", str(SCAN), "--out", str(ROOT), "--code-only", "--max-workers", "4"]
    for pattern in EXCLUDES:
        args.extend(["--exclude", pattern])
    result = command(args)
    if result.returncode:
        raise SystemExit(result.returncode)
    # Avoid large HTML visualizations during the organization rollout.
    result = command(["cluster-only", str(ROOT), "--no-label", "--no-viz"])
    if result.returncode:
        raise SystemExit(result.returncode)


def check():
    graph = json.loads((OUTPUT / "graph.json").read_text(encoding="utf-8"))
    if not graph.get("nodes") or not graph.get("links"):
        raise ValueError("Expected a non-empty graph with relationships")
    results = []

    def query(name, args, code, expected):
        started = time.perf_counter()
        result = command(args, capture=True)
        text = result.stdout + result.stderr
        passed = result.returncode == code and all(value in text for value in expected)
        results.append({"name": name, "passed": passed, "exit_code": result.returncode,
                        "seconds": round(time.perf_counter() - started, 3)})
        (OUTPUT / "pilot-evidence" / f"{name}.txt").write_text(text, encoding="utf-8")

    (OUTPUT / "pilot-evidence").mkdir(exist_ok=True)
    # Check a reported location against the actual source before querying the tool.
    chosen = None
    for node in graph["nodes"]:
        source = node.get("source_file", "")
        if Path(source).name == "graphify-navigation.py":
            continue
        location = str(node.get("source_location") or "")
        match = re.fullmatch(r"L(\d+)(?:-L?\d+)?", location)
        path = (SCAN / source).resolve()
        if not source or not match or not path.is_relative_to(SCAN) or not path.is_file():
            continue
        lines = path.read_text(encoding="utf-8-sig", errors="replace").splitlines()
        index = int(match.group(1)) - 1
        label = str(node.get("label", ""))
        token = re.sub(r"\(.*", "", label).rsplit(".", 1)[-1]
        if 0 <= index < len(lines) and len(token) > 2 and token.lower() in lines[index].lower():
            chosen = node
            break
    if chosen is None:
        raise ValueError("Could not verify a graph symbol against its source line")
    query("source-location", ["explain", chosen["id"]], 0, [chosen["source_file"], str(chosen["source_location"])])
    query("scoped-query", ["query", chosen["label"], "--seed", chosen["id"], "--budget", "1000"], 0, [chosen["label"]])
    query("missing-symbol", ["explain", "GraphifyRolloutMissingSymbol8c97a1"], 4, ["No node matching"])
    summary = {"scope": SETTINGS["scope"], "graphify_version": VERSION,
               "commit": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip(),
               "nodes": len(graph["nodes"]), "edges": len(graph["links"]),
               "source": {key: chosen.get(key) for key in ("label", "source_file", "source_location")},
               "checks": results, "model_tokens": 0}
    (OUTPUT / "pilot-evidence" / "summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(json.dumps(summary))
    if not all(result["passed"] for result in results):
        raise SystemExit(1)


if __name__ == "__main__":
    action = sys.argv[1] if len(sys.argv) == 2 else "build" if len(sys.argv) == 1 else ""
    if action == "build":
        build()
    elif action == "check":
        check()
    else:
        raise SystemExit("Usage: python scripts/graphify-navigation.py [build|check]")
