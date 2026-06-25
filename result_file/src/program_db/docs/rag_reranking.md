# RAG and Reranking Implementation Notes

This document explains the current implementation at a handoff level. It covers template collection, Chroma DB build, vector search, and reranker top-3 selection.

## Data flow

1. `scripts/collect_production_templates.py` collects prompt templates from GitHub and `selected_prompts.csv`.
2. It writes normalized records to `artifacts/production_task_templates/template_records.jsonl` and `templates.json`.
3. `scripts/build_vector_db.py` calls an OpenAI-compatible embedding endpoint and stores vectors in Chroma.
4. `scripts/rerank_vector_db.py` embeds the user query, asks Chroma for top-20, sends those 20 documents to the reranker, and returns top-3 by reranker score.
5. The later LLM selector stage should consume this top-3 output. It is not implemented here.

## Environment handling

The scripts read normal process environment variables. They also load a local `.env` file from the current working directory or project root when present. Real secrets should live only in `.env` or the server process environment.

Committed examples:

- `.env.example`: local vLLM-style defaults with blank secret values
- `.env.production.example`: RunPod endpoint defaults with blank secret values

Ignored local files:

- `.env`
- `.env.*`, except the committed example files
- virtualenvs, `__pycache__`, notebooks, and malformed DB backups

## Key scripts and functions

### `collect_production_templates.py`

- `selected_github_paths()`: fetches the GitHub tree and keeps prompt markdown files from configured business/technical directories.
- `github_records(raw_dir)`: downloads each selected markdown file, stores a raw copy, splits multi-template markdown files, and normalizes records.
- `csv_records(csv_path, raw_dir)`: converts rows from `selected_prompts.csv` into the same record shape.
- `main()`: combines records, writes JSON/JSONL artifacts, and writes a manifest.

### `build_vector_db.py`

- `load_env_file(path)`: loads local `.env` values without requiring `python-dotenv`.
- `create_embedding_client(base_url, api_key)`: creates the OpenAI-compatible client.
- `generate_embedding()` and `generate_embeddings()`: call the embedding endpoint.
- `build_embeddings()`: batches record text and generates vectors.
- `metadata_for()`: extracts Chroma metadata from each record.
- `write_chroma()`: creates or resets the persistent Chroma collection and upserts documents, embeddings, and metadata.

### `search_vector_db.py`

This is a simple vector-search smoke test. It embeds one query, queries Chroma, and prints ranked candidates with distances and previews.

### `rerank_vector_db.py`

- `load_llm_script_defaults()`: reads endpoint/model defaults from `contests/llm_scripts.py` so local runs match the shared vLLM test script.
- `search_chroma()`: embeds the query and retrieves Chroma top-k candidates. The default is 20.
- `rerank_candidates()`: POSTs `query` and the 20 candidate documents to `/v1/rerank`, then sorts by `relevance_score`.
- `trim_document()`: returns previews by default, or full documents when `--include-full-documents` is passed.
- `main()`: prints a JSON payload containing the query, model names, and final top-n results. The default top-n is 3.

## Current production artifacts

- Template record count: 651
- Embedding model: `Qwen/Qwen3-Embedding-8B`
- Embedding dimension: 4096
- Chroma collection: `production_task_prompt_templates`
- Chroma path: `artifacts/production_chroma_qwen3_8b`

## Verified example

Command:

```bash
/opt/hr-venv/bin/python scripts/rerank_vector_db.py   "Python 서비스 CI/CD 품질 게이트 설계"   --preview-chars 220
```

Observed top-3:

```text
1. DevOps Pipeline Architect
2. DevOps Automator
3. Test Strategy Development Expert
```

The exact scores can change if the reranker model or endpoint changes.

## Git workflow note

This work should be pushed to a feature branch, not `main`. The intended remote is:

```text
https://github.com/swbteng/copilot-meta-prompting.git
```

In this environment the remote required authentication, so the local branch was prepared without pushing.
