#!/usr/bin/env python3
"""Search the Chroma task-template DB through an OpenAI-compatible embedding endpoint."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import chromadb
from chromadb.config import Settings

from build_vector_db import (
    DEFAULT_CHROMA_DIR,
    DEFAULT_COLLECTION_NAME,
    DEFAULT_EMBED_MODEL,
    DEFAULT_VLLM_API_KEY,
    DEFAULT_VLLM_BASE_URL,
    create_embedding_client,
    generate_embedding,
)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("query")
    parser.add_argument("--chroma-dir", type=Path, default=DEFAULT_CHROMA_DIR)
    parser.add_argument("--collection-name", default=DEFAULT_COLLECTION_NAME)
    parser.add_argument("--model-name", default=DEFAULT_EMBED_MODEL)
    parser.add_argument("--base-url", default=DEFAULT_VLLM_BASE_URL)
    parser.add_argument("--api-key", default=DEFAULT_VLLM_API_KEY)
    parser.add_argument("--top-k", type=int, default=3)
    args = parser.parse_args()

    embedding_client = create_embedding_client(args.base_url, args.api_key)
    query_embedding = generate_embedding(embedding_client, args.query, args.model_name)
    chroma_client = chromadb.PersistentClient(path=str(args.chroma_dir), settings=Settings(anonymized_telemetry=False))
    collection = chroma_client.get_collection(args.collection_name)
    results = collection.query(query_embeddings=[query_embedding], n_results=args.top_k)

    output = []
    for idx, record_id in enumerate(results["ids"][0]):
        output.append(
            {
                "rank": idx + 1,
                "id": record_id,
                "distance": results["distances"][0][idx],
                "metadata": results["metadatas"][0][idx],
                "document_preview": results["documents"][0][idx][:500],
            }
        )
    print(json.dumps(output, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
