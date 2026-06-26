#!/usr/bin/env python3
"""Inspect the local Chroma task-template vector DB."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import chromadb
from chromadb.config import Settings

from build_vector_db import DEFAULT_CHROMA_DIR, DEFAULT_COLLECTION_NAME


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--chroma-dir", type=Path, default=DEFAULT_CHROMA_DIR)
    parser.add_argument("--collection-name", default=DEFAULT_COLLECTION_NAME)
    parser.add_argument("--limit", type=int, default=5)
    args = parser.parse_args()

    client = chromadb.PersistentClient(path=str(args.chroma_dir), settings=Settings(anonymized_telemetry=False))
    collection = client.get_collection(args.collection_name)
    peek = collection.peek(args.limit)
    output = {
        "chroma_dir": str(args.chroma_dir),
        "collection_name": args.collection_name,
        "count": collection.count(),
        "sample_ids": peek.get("ids", []),
        "sample_metadatas": peek.get("metadatas", []),
        "sample_document_previews": [doc[:300] for doc in peek.get("documents", [])],
    }
    print(json.dumps(output, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
