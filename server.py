#!/usr/bin/env python3
"""Local API and static server for the IAC Reader prototype."""

from __future__ import annotations

import argparse
from collections import defaultdict
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import re
import threading
from urllib.parse import urlparse
import uuid


APP_DIR = Path(__file__).resolve().parent
ROOT = APP_DIR.parent
BANK_PATH = ROOT / "clue_bank/studied/master_clues.jsonl"
PACKAGED_BANK_PATH = APP_DIR / "corpus/master_clues.jsonl"
DATA_DIR = APP_DIR / "data"
ATTEMPTS_PATH = DATA_DIR / "attempts.jsonl"
FLAGS_PATH = DATA_DIR / "flags.jsonl"
WRITE_LOCK = threading.Lock()

FLAG_CATEGORIES = {"technical", "revision", "study"}

DOMAIN_NAMES = {
    "ANTH": "Anthropology",
    "ARCH": "Architecture and design",
    "COL": "Colonial America",
    "DIP": "Diplomacy and treaties",
    "ELEC": "Elections",
    "EVT": "Events and incidents",
    "EXP": "Expansion and exploration",
    "FAC": "Political factions",
    "GOV": "Government and orations",
    "LAB": "Labor",
    "LAW": "Law and courts",
    "LEG": "Legislation",
    "LIT": "Literature",
    "MISC": "Culture and society",
    "MON": "Monuments",
    "PH": "Photography",
    "POL": "Political figures",
    "REF": "Reform and civil rights",
    "REL": "Religion",
    "VA": "Visual arts",
    "WAR": "Wars and conflicts",
}

PERSON_PREFIXES = {"ANTH", "ARCH", "EXP", "PH", "POL", "REL", "VA"}
SPEECH_IDS = {
    "GOV-001", "GOV-003", "GOV-004", "GOV-006", "GOV-016", "GOV-017",
    "GOV-018", "GOV-019", "GOV-020", "GOV-021", "GOV-022", "REF-001",
    "REF-002", "REF-003", "REF-004",
}

SPECIAL_ANSWER_TYPES = {
    "COL-001": "document",
    "COL-002": "colony",
    "COL-003": "colony",
    "FAC-001": "pair of political factions",
    "GOV-005": "person",
    "GOV-010": "set of resolutions",
    "MISC-040": "thinker",
    "MISC-041": "thinker",
    "MISC-042": "person",
    "MISC-043": "pamphlet",
    "MISC-044": "series of essays",
    "MISC-045": "city or settlement",
}

PROMPT_ALIASES = {
    "COL-003": ["massachusetts"],
    "POL-025": ["adams"],
}


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def read_jsonl(path: Path) -> list[dict]:
    if not path.exists():
        return []
    records = []
    with path.open(encoding="utf-8") as stream:
        for number, raw in enumerate(stream, 1):
            line = raw.strip()
            if not line:
                continue
            try:
                records.append(json.loads(line))
            except json.JSONDecodeError as error:
                raise ValueError(f"Invalid JSON at {path}:{number}: {error}") from error
    return records


def normalized(value: str) -> str:
    text = str(value or "").lower().replace("’", "'")
    text = re.sub(r"[^a-z0-9]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def topic_answer_type(anchor: str, answerline: str) -> str:
    prefix = anchor.split("-", 1)[0]
    lower = answerline.lower()
    if anchor in SPECIAL_ANSWER_TYPES:
        return SPECIAL_ANSWER_TYPES[anchor]
    if prefix in PERSON_PREFIXES:
        return {
            "ANTH": "anthropologist",
            "ARCH": "architect or designer",
            "EXP": "person",
            "PH": "photographer",
            "POL": "person",
            "REL": "religious figure",
            "VA": "artist",
        }[prefix]
    if anchor in SPEECH_IDS:
        return "speech"
    if prefix == "ELEC":
        return "election year"
    if prefix == "LAW":
        return "case"
    if prefix == "DIP":
        return "treaty or diplomatic event"
    if prefix == "LAB":
        return "labor organization" if "union" in lower or "workers" in lower else "labor event"
    if prefix == "LEG":
        return "law or proposal"
    if prefix == "LIT":
        return "work"
    if prefix == "MON":
        return "monument"
    if prefix == "FAC":
        return "political faction"
    if prefix == "REF":
        return "person"
    if prefix == "REL":
        return "religious figure"
    if prefix == "WAR":
        return "conflict or military event"
    if prefix == "EVT":
        return "event"
    if prefix == "GOV":
        return "document, speech, or institution"
    return "answerline"


def terminal_prompt(answer_type: str) -> str:
    prompts = {
        "pair of political factions": "name these two political factions",
        "set of resolutions": "name these resolutions",
        "series of essays": "name this series of essays",
        "city or settlement": "name this city or settlement",
    }
    return prompts.get(answer_type, f"name this {answer_type}")


def answer_aliases(answerline: str, answer_type: str) -> list[str]:
    aliases: set[str] = set()
    for part in re.split(r"\s*/\s*|\s+or\s+", answerline, flags=re.IGNORECASE):
        clean = re.sub(r"\([^)]*\)", "", part).strip(" .")
        if clean:
            aliases.add(normalized(clean))
    aliases.add(normalized(answerline))

    if any(noun in answer_type for noun in ("person", "artist", "architect", "designer", "photographer", "anthropologist", "figure")):
        words = normalized(answerline).split()
        if words:
            aliases.add(words[-1])

    year = re.search(r"\b(1[6789]\d{2}|20\d{2})\b", answerline)
    if answer_type == "election year" and year:
        aliases.update({year.group(1), f"election of {year.group(1)}"})

    for alias in list(aliases):
        for prefix in ("battle of ", "siege of ", "presidential election of ", "the "):
            if alias.startswith(prefix):
                aliases.add(alias[len(prefix):])
        for suffix in (
            " affair", " strike", " speech", " address", " oration", " treaty",
            " case", " rebellion", " revolt", " riot", " war", " massacre", " fire",
            " colony",
        ):
            if alias.endswith(suffix) and len(alias) > len(suffix) + 2:
                aliases.add(alias[:-len(suffix)])
    return sorted(alias for alias in aliases if len(alias) >= 3)


def load_bank() -> tuple[list[dict], list[dict]]:
    bank_path = PACKAGED_BANK_PATH if PACKAGED_BANK_PATH.exists() else BANK_PATH
    raw_clues = read_jsonl(bank_path)
    by_topic: dict[str, list[dict]] = defaultdict(list)
    for raw in raw_clues:
        if raw.get("status", "active") != "active":
            continue
        by_topic[raw["study_anchor"]].append(raw)

    topics = []
    clues = []
    for anchor, records in sorted(by_topic.items()):
        tiers = {int(record["tier"]) for record in records}
        if tiers != {4, 5, 6}:
            continue
        answerline = records[0]["answerline"]
        prefix = anchor.split("-", 1)[0]
        answer_type = topic_answer_type(anchor, answerline)
        topics.append({
            "id": anchor,
            "answerline": answerline,
            "answerType": answer_type,
            "questionPrompt": terminal_prompt(answer_type),
            "aliases": answer_aliases(answerline, answer_type),
            "promptAliases": PROMPT_ALIASES.get(anchor, []),
            "domain": DOMAIN_NAMES.get(prefix, prefix),
            "prefix": prefix,
            "clueCount": len(records),
        })
        for record in records:
            clues.append({
                "id": record["clue_id"],
                "answerId": anchor,
                "tier": int(record["tier"]),
                "text": record["clue"].strip(),
                "core": bool(record.get("core")),
                "source": record.get("source", ""),
            })
    return topics, clues


def score_for(zone: int, correct: bool) -> int:
    if zone not in {3, 4, 5, 6}:
        raise ValueError("zone must be 3, 4, 5, or 6")
    if correct:
        return zone
    return -1 if zone == 3 else -2


def build_stats(topics: list[dict], clues: list[dict], attempts: list[dict]) -> dict:
    clue_lookup = {clue["id"]: clue for clue in clues}
    topic_lookup = {topic["id"]: topic for topic in topics}
    by_clue: dict[str, dict] = {}
    by_topic: dict[str, dict] = {}

    def clue_row(clue: dict) -> dict:
        return {
            "clueId": clue["id"],
            "answerId": clue["answerId"],
            "tier": clue["tier"],
            "exposures": 0,
            "completed": 0,
            "correctAfterSeeing": 0,
            "incorrectAfterSeeing": 0,
            "buzzes": 0,
            "correctBuzzes": 0,
            "incorrectBuzzes": 0,
            "lastShown": None,
            "lastScore": None,
            "history": [],
        }

    for clue in clues:
        by_clue[clue["id"]] = clue_row(clue)

    valid_attempts = []
    for attempt in attempts:
        answer_id = attempt.get("answer_id")
        if answer_id not in topic_lookup:
            continue
        valid_attempts.append(attempt)
        for exposure in attempt.get("clues", []):
            clue_id = exposure.get("clue_id")
            row = by_clue.get(clue_id)
            shown = int(exposure.get("shown_chars", 0) or 0)
            if not row or shown <= 0:
                continue
            row["exposures"] += 1
            if exposure.get("completed"):
                row["completed"] += 1
            if attempt.get("correct"):
                row["correctAfterSeeing"] += 1
            else:
                row["incorrectAfterSeeing"] += 1
            if exposure.get("active_at_buzz"):
                row["buzzes"] += 1
                if attempt.get("correct"):
                    row["correctBuzzes"] += 1
                else:
                    row["incorrectBuzzes"] += 1
            row["lastShown"] = attempt.get("timestamp")
            row["lastScore"] = attempt.get("score")
            row["history"].append({
                "timestamp": attempt.get("timestamp"),
                "score": attempt.get("score"),
                "correct": bool(attempt.get("correct")),
                "zone": attempt.get("zone"),
                "completed": bool(exposure.get("completed")),
                "shownChars": shown,
                "activeAtBuzz": bool(exposure.get("active_at_buzz")),
            })

    for row in by_clue.values():
        row["history"] = row["history"][-8:]
        row["buzzAccuracy"] = (
            row["correctBuzzes"] / row["buzzes"] if row["buzzes"] else None
        )
        row["resultAccuracy"] = (
            row["correctAfterSeeing"] / row["exposures"] if row["exposures"] else None
        )

    topic_clues: dict[str, list[dict]] = defaultdict(list)
    for clue in clues:
        topic_clues[clue["answerId"]].append(by_clue[clue["id"]])
    for topic in topics:
        rows = topic_clues[topic["id"]]
        exposures = sum(row["exposures"] for row in rows)
        covered = sum(1 for row in rows if row["exposures"])
        by_topic[topic["id"]] = {
            "answerId": topic["id"],
            "exposures": exposures,
            "cluesCovered": covered,
            "clueCount": len(rows),
            "coverage": covered / len(rows) if rows else 0,
            "buzzes": sum(row["buzzes"] for row in rows),
            "correctBuzzes": sum(row["correctBuzzes"] for row in rows),
            "lastShown": max((row["lastShown"] for row in rows if row["lastShown"]), default=None),
        }

    total_points = sum(int(attempt.get("score", 0)) for attempt in valid_attempts)
    correct = sum(1 for attempt in valid_attempts if attempt.get("correct"))
    covered = sum(1 for row in by_clue.values() if row["exposures"])
    return {
        "summary": {
            "attempts": len(valid_attempts),
            "correct": correct,
            "accuracy": correct / len(valid_attempts) if valid_attempts else None,
            "points": total_points,
            "topics": len(topics),
            "clues": len(clues),
            "cluesCovered": covered,
            "coverage": covered / len(clues) if clues else 0,
        },
        "byClue": by_clue,
        "byTopic": by_topic,
    }


def validate_attempt(payload: dict, topics: list[dict], clues: list[dict]) -> dict:
    topic_ids = {topic["id"] for topic in topics}
    clue_lookup = {clue["id"]: clue for clue in clues}
    answer_id = str(payload.get("answer_id", ""))
    if answer_id not in topic_ids:
        raise ValueError("Unknown answerline")
    zone = int(payload.get("zone", 0))
    correct = bool(payload.get("correct"))
    expected_score = score_for(zone, correct)
    if int(payload.get("score", 999)) != expected_score:
        raise ValueError("Score does not match the IAC scoring rule")

    exposures = []
    seen_ids = set()
    for raw in payload.get("clues", []):
        clue_id = str(raw.get("clue_id", ""))
        clue = clue_lookup.get(clue_id)
        if not clue or clue["answerId"] != answer_id or clue_id in seen_ids:
            raise ValueError("Attempt contains an invalid clue")
        seen_ids.add(clue_id)
        total = len(clue["text"])
        shown = max(0, min(total, int(raw.get("shown_chars", 0))))
        exposures.append({
            "clue_id": clue_id,
            "tier": clue["tier"],
            "position": int(raw.get("position", len(exposures))),
            "shown_chars": shown,
            "total_chars": total,
            "completed": shown >= total,
            "active_at_buzz": bool(raw.get("active_at_buzz")),
        })
    if not exposures or not any(exposure["shown_chars"] for exposure in exposures):
        raise ValueError("Attempt must include at least one revealed clue")

    return {
        "id": str(uuid.uuid4()),
        "client_attempt_id": str(payload.get("client_attempt_id") or payload.get("question_id", ""))[:100],
        "timestamp": utc_now(),
        "session_id": str(payload.get("session_id", ""))[:100],
        "question_id": str(payload.get("question_id", ""))[:100],
        "answer_id": answer_id,
        "answerline": next(topic["answerline"] for topic in topics if topic["id"] == answer_id),
        "correct": correct,
        "score": expected_score,
        "zone": zone,
        "typed_answer": str(payload.get("typed_answer", ""))[:500],
        "manual_override": bool(payload.get("manual_override")),
        "mode": str(payload.get("mode", "practice"))[:40],
        "buzz_char": max(0, int(payload.get("buzz_char", 0))),
        "elapsed_ms": max(0, int(payload.get("elapsed_ms", 0))),
        "clues": exposures,
    }


def append_attempt(record: dict) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with WRITE_LOCK:
        with ATTEMPTS_PATH.open("a", encoding="utf-8") as stream:
            stream.write(json.dumps(record, ensure_ascii=True, separators=(",", ":")) + "\n")
            stream.flush()


def validate_flag(payload: dict, topics: list[dict], clues: list[dict]) -> dict:
    topic_ids = {topic["id"] for topic in topics}
    clue_lookup = {clue["id"]: clue for clue in clues}
    answer_id = str(payload.get("answer_id", ""))
    category = str(payload.get("category", ""))
    if answer_id not in topic_ids:
        raise ValueError("Unknown answerline")
    if category not in FLAG_CATEGORIES:
        raise ValueError("Unknown flag category")
    clue_ids = []
    for clue_id in payload.get("clue_ids", []):
        clue_id = str(clue_id)
        clue = clue_lookup.get(clue_id)
        if not clue or clue["answerId"] != answer_id:
            raise ValueError("Flag contains an invalid clue")
        if clue_id not in clue_ids:
            clue_ids.append(clue_id)
    return {
        "id": str(uuid.uuid4()),
        "client_flag_id": str(payload.get("client_flag_id") or uuid.uuid4())[:100],
        "timestamp": utc_now(),
        "answer_id": answer_id,
        "answerline": next(topic["answerline"] for topic in topics if topic["id"] == answer_id),
        "category": category,
        "note": str(payload.get("note", ""))[:2000],
        "question_text": str(payload.get("question_text", ""))[:12000],
        "clue_ids": clue_ids,
    }


def append_jsonl(path: Path, record: dict) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with WRITE_LOCK:
        with path.open("a", encoding="utf-8") as stream:
            stream.write(json.dumps(record, ensure_ascii=True, separators=(",", ":")) + "\n")
            stream.flush()


def progress_bundle() -> dict:
    return {
        "format": "iac-reader-progress-v1",
        "exported_at": utc_now(),
        "attempts": read_jsonl(ATTEMPTS_PATH),
        "flags": read_jsonl(FLAGS_PATH),
    }


class ReaderHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(APP_DIR), **kwargs)

    def log_message(self, format_string: str, *args) -> None:
        print(f"[{self.log_date_time_string()}] {format_string % args}")

    def send_json(self, payload: dict, status: HTTPStatus = HTTPStatus.OK) -> None:
        encoded = json.dumps(payload, ensure_ascii=True, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(encoded)

    def do_GET(self) -> None:
        path = urlparse(self.path).path
        if path == "/api/health":
            self.send_json({"ok": True, "timestamp": utc_now()})
            return
        if path == "/api/bootstrap":
            try:
                topics, clues = load_bank()
                attempts = read_jsonl(ATTEMPTS_PATH)
                self.send_json({
                    "meta": {"generatedAt": utc_now(), "bank": str(PACKAGED_BANK_PATH if PACKAGED_BANK_PATH.exists() else BANK_PATH)},
                    "topics": topics,
                    "clues": clues,
                    "stats": build_stats(topics, clues, attempts),
                    "recentAttempts": list(reversed(attempts[-100:])),
                    "flags": list(reversed(read_jsonl(FLAGS_PATH))),
                })
            except (OSError, ValueError) as error:
                self.send_json({"error": str(error)}, HTTPStatus.INTERNAL_SERVER_ERROR)
            return
        if path == "/api/progress":
            try:
                data = json.dumps(progress_bundle(), ensure_ascii=True, indent=2).encode("utf-8")
                self.send_response(HTTPStatus.OK)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Disposition", "attachment; filename=iac-reader-progress.json")
                self.send_header("Content-Length", str(len(data)))
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                self.wfile.write(data)
            except OSError as error:
                self.send_json({"error": str(error)}, HTTPStatus.INTERNAL_SERVER_ERROR)
            return
        if path == "/api/export":
            data = ATTEMPTS_PATH.read_bytes() if ATTEMPTS_PATH.exists() else b""
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "application/x-ndjson")
            self.send_header("Content-Disposition", "attachment; filename=iac-reader-attempts.jsonl")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(data)
            return
        super().do_GET()

    def do_POST(self) -> None:
        path = urlparse(self.path).path
        if path not in {"/api/attempt", "/api/flag", "/api/progress/import"}:
            self.send_json({"error": "Not found"}, HTTPStatus.NOT_FOUND)
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length <= 0 or length > 1_000_000:
                raise ValueError("Invalid request size")
            payload = json.loads(self.rfile.read(length))
            topics, clues = load_bank()
            if path == "/api/flag":
                flags = read_jsonl(FLAGS_PATH)
                client_flag_id = str(payload.get("client_flag_id", ""))[:100]
                existing = next((flag for flag in flags if flag.get("client_flag_id") == client_flag_id), None)
                if existing:
                    self.send_json({"ok": True, "flag": existing, "flags": list(reversed(flags))})
                    return
                record = validate_flag(payload, topics, clues)
                append_jsonl(FLAGS_PATH, record)
                flags = read_jsonl(FLAGS_PATH)
                self.send_json({"ok": True, "flag": record, "flags": list(reversed(flags))}, HTTPStatus.CREATED)
                return
            if path == "/api/progress/import":
                if payload.get("format") != "iac-reader-progress-v1":
                    raise ValueError("Unsupported progress file")
                attempts = read_jsonl(ATTEMPTS_PATH)
                attempt_ids = {item.get("client_attempt_id") for item in attempts}
                imported_attempts = 0
                for raw in payload.get("attempts", []):
                    client_id = str(raw.get("client_attempt_id", ""))[:100]
                    if not client_id or client_id in attempt_ids:
                        continue
                    record = validate_attempt(raw, topics, clues)
                    append_attempt(record)
                    attempt_ids.add(client_id)
                    imported_attempts += 1
                flags = read_jsonl(FLAGS_PATH)
                flag_ids = {item.get("client_flag_id") for item in flags}
                imported_flags = 0
                for raw in payload.get("flags", []):
                    client_id = str(raw.get("client_flag_id", ""))[:100]
                    if not client_id or client_id in flag_ids:
                        continue
                    record = validate_flag(raw, topics, clues)
                    append_jsonl(FLAGS_PATH, record)
                    flag_ids.add(client_id)
                    imported_flags += 1
                self.send_json({"ok": True, "attemptsImported": imported_attempts, "flagsImported": imported_flags})
                return
            attempts = read_jsonl(ATTEMPTS_PATH)
            client_attempt_id = str(payload.get("client_attempt_id") or payload.get("question_id", ""))[:100]
            existing = next((attempt for attempt in attempts if attempt.get("client_attempt_id") == client_attempt_id), None)
            if existing:
                self.send_json({
                    "ok": True,
                    "attempt": existing,
                    "stats": build_stats(topics, clues, attempts),
                    "recentAttempts": list(reversed(attempts[-100:])),
                })
                return
            record = validate_attempt(payload, topics, clues)
            append_attempt(record)
            attempts = read_jsonl(ATTEMPTS_PATH)
            self.send_json({
                "ok": True,
                "attempt": record,
                "stats": build_stats(topics, clues, attempts),
                "recentAttempts": list(reversed(attempts[-100:])),
            }, HTTPStatus.CREATED)
        except (ValueError, json.JSONDecodeError) as error:
            self.send_json({"error": str(error)}, HTTPStatus.BAD_REQUEST)
        except OSError as error:
            self.send_json({"error": str(error)}, HTTPStatus.INTERNAL_SERVER_ERROR)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8775)
    args = parser.parse_args()
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    topics, clues = load_bank()
    server = ThreadingHTTPServer((args.host, args.port), ReaderHandler)
    print(f"IAC Reader: http://{args.host}:{args.port}")
    print(f"Loaded {len(topics)} answerlines and {len(clues)} clues")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
