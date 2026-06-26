#!/usr/bin/env python3
"""Collect production prompt templates from GitHub and selected_prompts.csv."""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import urlopen


REPO = "aj-geddes/useful-ai-prompts"
TREE_URL = f"https://api.github.com/repos/{REPO}/git/trees/main?recursive=1"
RAW_BASE_URL = f"https://raw.githubusercontent.com/{REPO}/main/"
HTML_BASE_URL = f"https://github.com/{REPO}/blob/main/"
PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_RAW_DIR = PROJECT_ROOT / "artifacts" / "raw" / "production_template_store"
DEFAULT_ARTIFACT_DIR = PROJECT_ROOT / "artifacts" / "production_task_templates"
DEFAULT_CSV_PATH = Path(os.getenv("SELECTED_PROMPTS_CSV", "selected_prompts.csv"))

INCLUDE_PROMPT_DIRS = {
    "administrative",
    "analysis",
    "business",
    "career-development",
    "communication",
    "content-creation",
    "customer-focused",
    "customer-service",
    "decision-making",
    "development",
    "engineering",
    "evaluation-assessment",
    "finance",
    "financial-planning",
    "human-resources",
    "learning-development",
    "management-leadership",
    "operations",
    "optimization",
    "planning",
    "problem-solving",
    "project-management",
    "research",
    "research-workflows",
    "security",
    "supply-chain",
    "technical",
    "technical-templates",
    "technical-workflows",
}


def slugify(value: str) -> str:
    value = value.lower().strip()
    value = re.sub(r"[^a-z0-9가-힣]+", "-", value)
    return re.sub(r"-+", "-", value).strip("-") or "template"


def section(text: str, heading: str) -> str:
    pattern = rf"^## {re.escape(heading)}\s*$([\s\S]*?)(?=^## |\Z)"
    match = re.search(pattern, text, flags=re.MULTILINE)
    return match.group(1).strip() if match else ""


def parse_metadata(block: str) -> dict[str, str]:
    metadata: dict[str, str] = {}
    for line in block.splitlines():
        match = re.match(r"- \*\*(.+?)\*\*:\s*(.+)$", line.strip())
        if match:
            key = slugify(match.group(1)).replace("-", "_")
            metadata[key] = match.group(2).strip().strip("`")
    return metadata


def split_top_level_templates(markdown: str) -> list[tuple[str, str]]:
    matches = list(re.finditer(r"^# (.+)$", markdown, flags=re.MULTILINE))
    if not matches:
        return [("Untitled Template", markdown.strip())]
    parts: list[tuple[str, str]] = []
    for idx, match in enumerate(matches):
        title = match.group(1).strip()
        start = match.start()
        end = matches[idx + 1].start() if idx + 1 < len(matches) else len(markdown)
        body = markdown[start:end].strip()
        if "## Prompt" in body or "## Metadata" in body:
            parts.append((title, body))
    return parts or [(matches[0].group(1).strip(), markdown.strip())]


def fetch_json(url: str) -> dict:
    with urlopen(url, timeout=60) as response:
        return json.loads(response.read().decode("utf-8"))


def fetch_text(url: str) -> str:
    with urlopen(url, timeout=60) as response:
        return response.read().decode("utf-8")


def selected_github_paths() -> list[str]:
    tree = fetch_json(TREE_URL)["tree"]
    paths: list[str] = []
    for item in tree:
        path = item.get("path", "")
        if item.get("type") != "blob" or not path.startswith("prompts/") or not path.endswith(".md"):
            continue
        if path.endswith("/README.md") or path.endswith("README.md"):
            continue
        parts = path.split("/")
        if len(parts) >= 2 and parts[1] in INCLUDE_PROMPT_DIRS:
            paths.append(path)
    return sorted(paths)


def github_records(raw_dir: Path) -> list[dict]:
    records: list[dict] = []
    github_raw_dir = raw_dir / "github" / REPO
    for path in selected_github_paths():
        text = fetch_text(RAW_BASE_URL + path)
        raw_path = github_raw_dir / path
        raw_path.parent.mkdir(parents=True, exist_ok=True)
        raw_path.write_text(text, encoding="utf-8")
        for idx, (title, body) in enumerate(split_top_level_templates(text)):
            metadata = parse_metadata(section(body, "Metadata"))
            tags = [tag.strip() for tag in metadata.get("tags", "").split(",") if tag.strip()]
            category = metadata.get("category") or path.split("/")[1]
            template_id = metadata.get("id") or f"github-{slugify(path.removesuffix('.md'))}"
            if idx:
                template_id = f"{template_id}-{idx + 1}"
            content = "\n\n".join(
                part
                for part in [
                    f"# {title}",
                    f"Source: GitHub useful-ai-prompts",
                    f"Category: {category}",
                    f"Tags: {', '.join(tags)}" if tags else "",
                    body,
                ]
                if part
            )
            records.append(
                {
                    "record_id": f"github::{template_id}",
                    "template_id": template_id,
                    "title": title,
                    "source": "github_useful_ai_prompts",
                    "source_path": path,
                    "source_url": HTML_BASE_URL + path,
                    "raw_path": str(raw_path),
                    "category": category,
                    "tags": tags,
                    "metadata": metadata,
                    "content": content,
                    "embedding_text": content,
                    "content_sha256": hashlib.sha256(content.encode("utf-8")).hexdigest(),
                }
            )
    return records


def csv_records(csv_path: Path, raw_dir: Path) -> list[dict]:
    csv_raw_dir = raw_dir / "csv"
    csv_raw_dir.mkdir(parents=True, exist_ok=True)
    csv_copy = csv_raw_dir / "selected_prompts.csv"
    csv_copy.write_text(csv_path.read_text(encoding="utf-8"), encoding="utf-8")
    records: list[dict] = []
    with csv_path.open(newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        for idx, row in enumerate(reader, start=1):
            title = (row.get("act") or f"Selected Prompt {idx}").strip()
            prompt = (row.get("prompt") or "").strip()
            template_id = f"selected-prompts-{idx:04d}-{slugify(title)}"
            tags = []
            if str(row.get("for_devs", "")).lower() == "true":
                tags.append("for_devs")
            if row.get("type"):
                tags.append(row["type"].lower())
            content = "\n\n".join(
                [
                    f"# {title}",
                    "Source: selected_prompts.csv",
                    f"Type: {row.get('type', '')}",
                    f"For Developers: {row.get('for_devs', '')}",
                    f"Contributor: {row.get('contributor', '')}",
                    "## Prompt\n" + prompt,
                ]
            )
            records.append(
                {
                    "record_id": f"csv::{template_id}",
                    "template_id": template_id,
                    "title": title,
                    "source": "selected_prompts_csv",
                    "source_path": str(csv_path),
                    "source_url": "",
                    "raw_path": str(csv_copy),
                    "category": "selected_prompts",
                    "tags": tags,
                    "metadata": {
                        "act": title,
                        "for_devs": row.get("for_devs", ""),
                        "type": row.get("type", ""),
                        "contributor": row.get("contributor", ""),
                    },
                    "content": content,
                    "embedding_text": content,
                    "content_sha256": hashlib.sha256(content.encode("utf-8")).hexdigest(),
                }
            )
    return records


def write_jsonl(path: Path, rows: list[dict]) -> None:
    with path.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--raw-dir", type=Path, default=DEFAULT_RAW_DIR)
    parser.add_argument("--artifact-dir", type=Path, default=DEFAULT_ARTIFACT_DIR)
    parser.add_argument("--csv-path", type=Path, default=DEFAULT_CSV_PATH)
    args = parser.parse_args()

    args.raw_dir.mkdir(parents=True, exist_ok=True)
    args.artifact_dir.mkdir(parents=True, exist_ok=True)

    generated_at = datetime.now(timezone.utc).isoformat()
    github = github_records(args.raw_dir)
    csv_rows = csv_records(args.csv_path, args.raw_dir)
    records = github + csv_rows
    seen: dict[str, int] = {}
    for record in records:
        base = record["record_id"]
        count = seen.get(base, 0)
        seen[base] = count + 1
        if count:
            record["record_id"] = f"{base}::{count + 1}"
        record["generated_at"] = generated_at

    write_jsonl(args.artifact_dir / "template_records.jsonl", records)
    (args.artifact_dir / "templates.json").write_text(json.dumps(records, ensure_ascii=False, indent=2), encoding="utf-8")
    manifest = {
        "project": "copilot-meta-prompting",
        "stage": "production-template-store",
        "generated_at": generated_at,
        "raw_dir": str(args.raw_dir),
        "artifact_dir": str(args.artifact_dir),
        "github_repo": REPO,
        "github_prompt_count": len(github),
        "csv_prompt_count": len(csv_rows),
        "record_count": len(records),
        "included_github_dirs": sorted(INCLUDE_PROMPT_DIRS),
    }
    (args.artifact_dir / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(manifest, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
