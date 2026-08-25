#!/usr/bin/env python3
"""Unit tests for IAC Reader scoring and clue statistics."""

from __future__ import annotations

import json
from pathlib import Path
import unittest

import server


class ScoringTests(unittest.TestCase):
    def test_correct_scores_match_zone(self):
        self.assertEqual([server.score_for(zone, True) for zone in (6, 5, 4, 3)], [6, 5, 4, 3])

    def test_wrong_scores_split_midstream_and_final(self):
        self.assertEqual([server.score_for(zone, False) for zone in (6, 5, 4, 3)], [-2, -2, -2, -1])

    def test_invalid_zone_is_rejected(self):
        with self.assertRaises(ValueError):
            server.score_for(2, True)


class BankTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.topics, cls.clues = server.load_bank()

    def test_every_loaded_topic_has_all_three_bands(self):
        by_topic = {}
        for clue in self.clues:
            by_topic.setdefault(clue["answerId"], set()).add(clue["tier"])
        self.assertTrue(by_topic)
        self.assertTrue(all(tiers == {4, 5, 6} for tiers in by_topic.values()))

    def test_clue_ids_are_unique(self):
        ids = [clue["id"] for clue in self.clues]
        self.assertEqual(len(ids), len(set(ids)))

    def test_every_topic_supports_multiple_tossup_variants(self):
        counts = {}
        for clue in self.clues:
            counts.setdefault(clue["answerId"], {}).setdefault(clue["tier"], 0)
            counts[clue["answerId"]][clue["tier"]] += 1
        self.assertTrue(all(
            all(topic_counts.get(tier, 0) >= 3 for tier in (6, 5, 4))
            for topic_counts in counts.values()
        ))

    def test_amistad_aliases_are_accepted(self):
        topic = next(topic for topic in self.topics if topic["id"] == "LAW-003")
        self.assertIn("amistad", topic["aliases"])
        self.assertIn("la amistad", topic["aliases"])

    def test_every_topic_has_an_iac_terminal_prompt(self):
        self.assertTrue(all(topic["questionPrompt"].startswith("name ") for topic in self.topics))
        self.assertFalse(any("answerline" in topic["questionPrompt"] for topic in self.topics))

    def test_paired_factions_use_a_plural_terminal_prompt(self):
        topic = next(topic for topic in self.topics if topic["id"] == "FAC-001")
        self.assertEqual(topic["answerType"], "pair of political factions")
        self.assertEqual(topic["questionPrompt"], "name these two political factions")


class AttemptTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.topics, cls.clues = server.load_bank()
        cls.topic = cls.topics[0]
        cls.topic_clues = [clue for clue in cls.clues if clue["answerId"] == cls.topic["id"]]

    def payload(self, *, correct=True, zone=6, score=6):
        clue = self.topic_clues[0]
        return {
            "client_attempt_id": "test-attempt",
            "session_id": "test-session",
            "question_id": "test-question",
            "answer_id": self.topic["id"],
            "correct": correct,
            "zone": zone,
            "score": score,
            "typed_answer": self.topic["answerline"],
            "buzz_char": 12,
            "elapsed_ms": 1200,
            "clues": [{
                "clue_id": clue["id"],
                "position": 0,
                "shown_chars": len(clue["text"]),
                "active_at_buzz": True,
            }],
        }

    def test_valid_attempt_is_normalized(self):
        record = server.validate_attempt(self.payload(), self.topics, self.clues)
        self.assertEqual(record["score"], 6)
        self.assertTrue(record["clues"][0]["completed"])
        self.assertEqual(record["client_attempt_id"], "test-attempt")

    def test_forged_score_is_rejected(self):
        with self.assertRaises(ValueError):
            server.validate_attempt(self.payload(score=5), self.topics, self.clues)

    def test_stats_attribute_a_buzz_to_the_active_clue(self):
        record = server.validate_attempt(self.payload(), self.topics, self.clues)
        stats = server.build_stats(self.topics, self.clues, [record])
        row = stats["byClue"][record["clues"][0]["clue_id"]]
        self.assertEqual(row["exposures"], 1)
        self.assertEqual(row["completed"], 1)
        self.assertEqual(row["correctBuzzes"], 1)


class FlagTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.topics, cls.clues = server.load_bank()
        cls.topic = cls.topics[0]
        cls.clue = next(clue for clue in cls.clues if clue["answerId"] == cls.topic["id"])

    def test_valid_flag_is_normalized(self):
        record = server.validate_flag({
            "client_flag_id": "flag-test",
            "answer_id": self.topic["id"],
            "category": "study",
            "note": "Review this clue.",
            "clue_ids": [self.clue["id"]],
        }, self.topics, self.clues)
        self.assertEqual(record["category"], "study")
        self.assertEqual(record["clue_ids"], [self.clue["id"]])

    def test_unknown_flag_category_is_rejected(self):
        with self.assertRaises(ValueError):
            server.validate_flag({
                "answer_id": self.topic["id"],
                "category": "other",
                "clue_ids": [],
            }, self.topics, self.clues)


class StaticBuildTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.payload = json.loads((Path(__file__).parent / "static/bootstrap.json").read_text(encoding="utf-8"))
        cls.topics, cls.clues = server.load_bank()

    def test_static_payload_matches_the_canonical_bank(self):
        self.assertEqual(
            {topic["id"] for topic in self.payload["topics"]},
            {topic["id"] for topic in self.topics},
        )
        self.assertEqual(
            {clue["id"] for clue in self.payload["clues"]},
            {clue["id"] for clue in self.clues},
        )

    def test_static_payload_contains_no_personal_progress(self):
        self.assertNotIn("attempts", self.payload)
        self.assertNotIn("flags", self.payload)


if __name__ == "__main__":
    unittest.main()
