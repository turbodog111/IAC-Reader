#!/usr/bin/env python3
"""Build the corpus payload used by static hosts such as GitHub Pages."""

from __future__ import annotations

import json
from pathlib import Path

from server import load_bank


ROOT = Path(__file__).resolve().parent
OUTPUT = ROOT / "static/bootstrap.json"


def main() -> None:
    topics, clues = load_bank()
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "meta": {"runtime": "static", "format": "iac-reader-static-v1"},
        "topics": topics,
        "clues": clues,
    }
    OUTPUT.write_text(
        json.dumps(payload, ensure_ascii=True, separators=(",", ":")),
        encoding="utf-8",
    )
    print(f"Wrote {OUTPUT}: {len(topics)} answerlines, {len(clues)} clues")


if __name__ == "__main__":
    main()
