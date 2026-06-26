# HR Deployment Notes

## Transfer set

Move these production files to `/workspace/copilot-meta-prompting/result_file/src/program_db` on the deployment server:

- `requirements.deploy.txt`
- `.env.production.example`
- `DEPLOYMENT.md`
- `scripts/`
- `contests/copilot_meta_prompting_stage1_context.md`
- `artifacts/production_task_templates/`
- `artifacts/production_chroma_qwen3_8b/`

Do not move `hr_venv/`, `codex_backup*/`, `codex backup/`, `temp.ipynb`, root `chroma.sqlite3`, or `artifacts/chroma_task_templates/`. Those are local environment, backups, notebooks, or the old 10-record test DB.

## Python environment

Create the virtualenv outside `/workspace/copilot-meta-prompting/result_file/src/program_db` so deployments can replace `/workspace/copilot-meta-prompting/result_file/src/program_db` without deleting installed packages:

```bash
python3 -m venv /opt/hr-venv
/opt/hr-venv/bin/python -m pip install --upgrade pip
/opt/hr-venv/bin/pip install -r /workspace/copilot-meta-prompting/result_file/src/program_db/requirements.deploy.txt
```

The deployment requirements intentionally exclude `vllm` and `transformers`. Embedding, reranker, and LLM inference are served by RunPod endpoints, so this server only needs the Chroma DB plus API clients.

## Runtime environment

Set the real secret at runtime instead of saving it in the repo:

```bash
export RUNPOD_API_KEY="..."
export EMBED_BASE_URL="https://l6nd3k5ginxe6f.api.runpod.ai/v1"
export EMBED_MODEL="Qwen/Qwen3-Embedding-8B"
```

Search smoke test:

```bash
/opt/hr-venv/bin/python /workspace/copilot-meta-prompting/result_file/src/program_db/scripts/search_vector_db.py \
  "업무 PPT 만들어줘" \
  --chroma-dir /workspace/copilot-meta-prompting/result_file/src/program_db/artifacts/production_chroma_qwen3_8b \
  --collection-name production_task_prompt_templates \
  --top-k 5
```

If you rebuild the Chroma DB, use the same embedding model as production (`Qwen/Qwen3-Embedding-8B`) so the stored vectors and query vectors stay compatible.
