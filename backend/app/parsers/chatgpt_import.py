"""CLI importer for ChatGPT conversations.json.

Usage:
    python -m app.parsers.chatgpt_import --file conversations.json --start-question 59
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path

from app.parsers.chatgpt_parser import ChatGPTParser


async def _import_cli(filepath: str, start_q: int) -> None:
    path = Path(filepath)
    if not path.exists():
        print(f"Error: file not found: {filepath}", file=sys.stderr)
        sys.exit(1)

    raw = json.loads(path.read_text(encoding="utf-8"))
    parser = ChatGPTParser(start_question=start_q)

    print(f"\nScanning ChatGPT export: {path.name}")
    metas = parser.scan(raw)
    print(f"Conversations found: {len(metas)}")

    if not metas:
        print("No conversations detected.")
        return

    print("\nPotential SQL practice conversations:")
    sql_candidates = [m for m in metas if m.relevance_score >= 20]
    for i, m in enumerate(sql_candidates[:5], 1):
        q_str = (
            f" | Q{m.q_range[0]}–Q{m.q_range[1]}" if m.q_range else ""
        )
        print(f"  {i}. {m.title!r:40s} — {m.relevance_score:5.1f}% match"
              f"  ({m.message_count} messages{q_str})")

    if not sql_candidates:
        print("\nNo SQL-related conversations found.")
        return

    # Select top candidate automatically (or prompt)
    chosen = sql_candidates[0]
    print(f"\nSelected: {chosen.title!r} (id={chosen.conversation_id})")

    result = parser.parse(raw, chosen.conversation_id, start_q)
    q_nums = sorted(q.question_number for q in result.questions)

    print(f"\nQuestions detected: {len(result.questions)}", end="")
    if q_nums:
        print(f" (Q{q_nums[0]}–Q{q_nums[-1]})", end="")
    print()
    print(f"Attempts detected:  {result.total_attempts}")
    print(f"Feedback entries:   {result.total_feedback}")
    print(f"Mistakes:           {result.total_mistakes}")
    print(f"Scores:             {result.total_scores}")
    print(f"Concepts:           {result.total_concepts}")

    print("\nSample questions:")
    for q in result.questions[:5]:
        score_str = f" | Score: {q.score.score_text}" if q.score else ""
        print(
            f"  Q{q.question_number:3d}  {(q.title or '—')[:40]:40s}"
            f"  {len(q.attempts)} attempt(s){score_str}"
        )

    print("\n(Use the web UI to review and confirm the import.)")
    print("Import complete.")


def main() -> None:
    parser = argparse.ArgumentParser(description="Import ChatGPT SQL practice")
    parser.add_argument("--file", required=True, help="Path to conversations.json")
    parser.add_argument("--start-question", type=int, default=59)
    args = parser.parse_args()
    asyncio.run(_import_cli(args.file, args.start_question))


if __name__ == "__main__":
    main()
