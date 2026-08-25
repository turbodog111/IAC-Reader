#!/usr/bin/env python3
"""Audit the packaged clue bank for structural and answerline-writing errors."""

from __future__ import annotations

from collections import Counter, defaultdict
import json
from pathlib import Path
import re
import sys


CORPUS = Path(__file__).resolve().parent / "corpus/master_clues.jsonl"
GENERIC_WORDS = {
    "address", "affair", "american", "battle", "case", "conflict", "election",
    "event", "first", "incident", "movement", "presidential", "revolt", "second",
    "factory", "great", "inaugural", "railroad", "siege", "slave", "speech",
    "strike", "treaty", "union", "united", "states", "this", "war", "common",
}


def normalized(value: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9]+", " ", value.lower())).strip()


def main() -> int:
    records = [json.loads(line) for line in CORPUS.read_text(encoding="utf-8").splitlines() if line.strip()]
    errors: list[str] = []
    ids = Counter(record["clue_id"] for record in records)
    for clue_id, count in ids.items():
        if count != 1:
            errors.append(f"{clue_id}: duplicate clue ID")

    by_topic: dict[str, list[dict]] = defaultdict(list)
    for record in records:
        by_topic[record["study_anchor"]].append(record)
        clue = record["clue"].strip()
        if not clue or clue[-1] not in ".?!\"'”’":
            errors.append(f"{record['clue_id']}: clue is not a complete sentence")
        if len(clue.split()) > 30:
            errors.append(f"{record['clue_id']}: exceeds 30 words")
        if "for the points" in clue.lower():
            errors.append(f"{record['clue_id']}: contains a terminal prompt")

        answer = normalized(record["answerline"])
        clue_normalized = normalized(clue)
        if answer and answer in clue_normalized:
            errors.append(f"{record['clue_id']}: contains the full answerline")
            continue
        answer_tokens = {
            token for token in answer.split()
            if len(token) >= 5 and token not in GENERIC_WORDS
        }
        leaked = sorted(token for token in answer_tokens if re.search(rf"\b{re.escape(token)}\b", clue_normalized))
        if leaked:
            errors.append(f"{record['clue_id']}: contains answer token(s): {', '.join(leaked)}")

    for topic, clues in by_topic.items():
        tiers = Counter(int(clue["tier"]) for clue in clues)
        if set(tiers) != {4, 5, 6}:
            errors.append(f"{topic}: missing a 6/5/4 band")
        for tier in (6, 5, 4):
            if tiers[tier] < 3:
                errors.append(f"{topic}: fewer than three tier-{tier} clues")
        if len({clue["answerline"] for clue in clues}) != 1:
            errors.append(f"{topic}: inconsistent answerlines")

    if errors:
        print("CORPUS AUDIT FAILED")
        print("\n".join(errors))
        return 1
    print(f"CORPUS AUDIT PASSED: {len(by_topic)} answerlines, {len(records)} clues")
    return 0


if __name__ == "__main__":
    sys.exit(main())
