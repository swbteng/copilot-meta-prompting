#!/usr/bin/env python3
"""Build a persistent Chroma DB using an OpenAI-compatible embedding endpoint."""

from __future__ import annotations

import argparse
import json
import os
import shutil
from pathlib import Path
from typing import Iterable

import chromadb
from chromadb.config import Settings
from openai import OpenAI
from tqdm import tqdm


def load_env_file(path: Path) -> None:
    if not path.exists():
        return

    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key:
            os.environ.setdefault(key, value)


for env_path in (Path.cwd() / ".env", Path(__file__).resolve().parents[1] / ".env"):
    load_env_file(env_path)


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_ARTIFACT_DIR = PROJECT_ROOT / "artifacts" / "production_task_templates"
DEFAULT_CHROMA_DIR = PROJECT_ROOT / "artifacts" / "production_chroma_qwen3_8b"
DEFAULT_COLLECTION_NAME = "production_task_prompt_templates"
DEFAULT_EMBED_MODEL = os.getenv("EMBED_MODEL", "Qwen/Qwen3-Embedding-8B")
DEFAULT_VLLM_BASE_URL = os.getenv("EMBED_BASE_URL") or os.getenv("VLLM_BASE_URL", "http://127.0.0.1:4001/v1")
DEFAULT_VLLM_API_KEY = os.getenv("EMBED_API_KEY") or os.getenv("RUNPOD_API_KEY") or os.getenv("VLLM_API_KEY", "EMPTY")


def load_records(path: Path) -> list[dict]:
    with path.open("r", encoding="utf-8") as handle:
        return [json.loads(line) for line in handle if line.strip()]


def batched(items: list[str], batch_size: int) -> Iterable[list[str]]:
    for start in range(0, len(items), batch_size):
        yield items[start : start + batch_size]


def create_embedding_client(base_url: str, api_key: str) -> OpenAI:
    return OpenAI(base_url=base_url, api_key=api_key)


def generate_embedding(client: OpenAI, text: str, model_name: str) -> list[float]:
    return generate_embeddings(client, [text], model_name)[0]


def generate_embeddings(client: OpenAI, texts: list[str], model_name: str) -> list[list[float]]:
    response = client.embeddings.create(model=model_name, input=texts)
    return [item.embedding for item in response.data]


def build_embeddings(client: OpenAI, records: list[dict], model_name: str, batch_size: int) -> list[list[float]]:
    embeddings: list[list[float]] = []
    texts = [record["embedding_text"] for record in records]
    for batch in tqdm(list(batched(texts, batch_size)), desc="embeddings"):
        embeddings.extend(generate_embeddings(client, batch, model_name))
    return embeddings


def metadata_for(record: dict, model_name: str, base_url: str) -> dict:
    return {
        "template_id": record["template_id"],
        "title": record["title"],
        "task_type": record.get("task_type", ""),
        "tags": ",".join(record.get("tags", [])),
        "source_file": record.get("source_file") or record.get("source_path", ""),
        "source_path": record.get("source_path", ""),
        "source_url": record["source_url"],
        "chunk_type": record.get("chunk_type", "full_template"),
        "embedding_model": model_name,
        "embedding_base_url": base_url,
        "content_sha256": record["content_sha256"],
    }


def write_chroma(
    records: list[dict],
    embeddings: list[list[float]],
    chroma_dir: Path,
    collection_name: str,
    model_name: str,
    base_url: str,
    reset: bool,
) -> None:
    if reset and chroma_dir.exists():
        shutil.rmtree(chroma_dir)
    chroma_dir.mkdir(parents=True, exist_ok=True)
    client = chromadb.PersistentClient(path=str(chroma_dir), settings=Settings(anonymized_telemetry=False))
    collection = client.get_or_create_collection(
        name=collection_name,
        metadata={"hnsw:space": "cosine", "embedding_model": model_name, "embedding_base_url": base_url},
    )
    collection.upsert(
        ids=[record["record_id"] for record in records],
        documents=[record["embedding_text"] for record in records],
        embeddings=embeddings,
        metadatas=[metadata_for(record, model_name, base_url) for record in records],
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--artifact-dir", type=Path, default=DEFAULT_ARTIFACT_DIR)
    parser.add_argument("--chroma-dir", type=Path, default=DEFAULT_CHROMA_DIR)
    parser.add_argument("--collection-name", default=DEFAULT_COLLECTION_NAME)
    parser.add_argument("--model-name", default=DEFAULT_EMBED_MODEL)
    parser.add_argument("--base-url", default=DEFAULT_VLLM_BASE_URL)
    parser.add_argument("--api-key", default=DEFAULT_VLLM_API_KEY)
    parser.add_argument("--batch-size", type=int, default=8)
    parser.add_argument("--no-reset", action="store_true")
    args = parser.parse_args()

    records = load_records(args.artifact_dir / "template_records.jsonl")
    client = create_embedding_client(args.base_url, args.api_key)
    embeddings = build_embeddings(client, records, args.model_name, args.batch_size)
    write_chroma(
        records=records,
        embeddings=embeddings,
        chroma_dir=args.chroma_dir,
        collection_name=args.collection_name,
        model_name=args.model_name,
        base_url=args.base_url,
        reset=not args.no_reset,
    )
    manifest = {
        "vector_db": "chroma",
        "record_count": len(records),
        "embedding_dim": len(embeddings[0]) if embeddings else 0,
        "embedding_model": args.model_name,
        "embedding_base_url": args.base_url,
        "collection_name": args.collection_name,
        "chroma_dir": str(args.chroma_dir),
        "artifact_dir": str(args.artifact_dir),
    }
    (args.artifact_dir / "vector_db_manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(manifest, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
