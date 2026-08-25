# IAC Reader

A local U.S. History Bee playoff reader with clue-level tracking, IAC 6/5/4/3 scoring, and a probabilistic practice opponent.

The repository includes 152 studied answerlines and 1,715 individually tracked clues. It is an independent study tool and is not affiliated with International Academic Competitions.

**Live reader:** [turbodog111.github.io/IAC-Reader](https://turbodog111.github.io/IAC-Reader/)

## Run locally

Python 3.10 or newer is the only runtime requirement.

```bash
python3 server.py --host 127.0.0.1 --port 8775
```

Open [http://127.0.0.1:8775](http://127.0.0.1:8775). The server binds only to the local machine unless a different host is explicitly supplied.

## Practice modes

- Choose 5, 10, 20, 35, or every available answerline.
- Draw questions randomly, prioritize weak material, or complete a coverage cycle.
- Use compact or standard clue density while keeping the 6/5/4 bands visible.
- Adjust answer checking from exact to standard aliases or typo-tolerant leniency.
- Flag a question for a technical problem, answerline revision, or deeper study.
- Play an unranked race to 40 against a transparent probabilistic opponent.

## Study lessons

The Study view contains readable, playoff-focused lessons with chronology, buzz ladders, confusables, retrieval prompts, and direct IAC precedent. Reviewed dates are kept in browser local storage alongside practice progress. The first set covers the Mayflower Compact, Plymouth Colony, and Massachusetts Bay Colony.

The AI opponent is deliberately a simulation rather than a language model. Each profile first samples a likely buzz zone and then a correct or incorrect result from that zone's configured accuracy. That structure follows the broad idea used by QBReader's open-source AI mode, adapted for IAC scoring and this corpus.

## Scoring

| Buzz position | Correct | Incorrect |
| --- | ---: | ---: |
| Before `(+)` | 6 | -2 |
| After `(+)`, before `(*)` | 5 | -2 |
| After `(*)`, while reading | 4 | -2 |
| After the full question | 3 | -1 |

The server recomputes and validates every score from the recorded reading zone.

## Progress and privacy

Personal progress is intentionally local:

- `data/attempts.jsonl` stores attempts and clue exposure data.
- `data/flags.jsonl` stores question flags and notes.
- Browser local storage keeps a retry cache if a write is interrupted.
- **Backup** downloads both record sets in one portable JSON file.
- **Import** restores that file idempotently, without duplicating existing records.

Both JSONL files are excluded by `.gitignore`. Before publishing a fork, verify with `git status --ignored` that personal data remains ignored.

On GitHub Pages, the same records are stored only in that browser's local storage. Localhost and Pages are separate browser origins, so use **Backup** on one and **Import** on the other when moving progress between them.

## Question construction

Each tossup samples clues from the packaged `corpus/master_clues.jsonl`, records every selected clue ID, and stores exactly how much of each clue was exposed. Questions end with a grammatical `For the points` prompt derived from the answer type. The rendered 6-point material is bold and underlined, the 5-point material is underlined, and both `(+)` and `(*)` remain visible.

Run the corpus audit after changing clues:

```bash
python3 audit_corpus.py
python3 build_static.py
```

It checks IDs, complete sentences, clue length, terminal prompts, answer leakage, and minimum 6/5/4 coverage.

## Tests

```bash
python3 -m unittest test_server.py
```

The interaction model also takes cues from [mglass222/HBReader](https://github.com/mglass222/HBReader). The clue ledger, progress schema, question construction, and playoff scoring are specific to IAC Reader.

## Search indexing

The app includes `noindex` metadata and a restrictive `robots.txt` for deployments that honor them. A public GitHub repository is still public: these directives cannot prevent GitHub indexing or third-party archiving.
