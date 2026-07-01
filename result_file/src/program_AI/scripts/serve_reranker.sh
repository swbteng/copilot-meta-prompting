#!/usr/bin/env bash
# Reranker - GPU 2 - port 8002
# Model: Qwen/Qwen3-Reranker-4B  -> OpenAI-compatible /v1/score and /v1/rerank
set -euo pipefail
cd "$(dirname "$0")/.."

export CUDA_VISIBLE_DEVICES=1
export VLLM_CACHE_ROOT=/workspace/.cache/vllm
export TRITON_CACHE_DIR=/workspace/.cache/triton
export TORCH_HOME=/workspace/.cache/torch
# export HF_HUB_OFFLINE=1

# Qwen3-Reranker is a causal LM; vLLM converts it to a sequence-classification
# scorer via hf-overrides so it works with the score/rerank API.
exec vllm serve Qwen/Qwen3-Reranker-4B \
  --host 0.0.0.0 \
  --port 4002 \
  --tensor-parallel-size 1 \
  --max-model-len 4096 \
  --gpu-memory-utilization 0.30 \
  --hf-overrides '{"architectures":["Qwen3ForSequenceClassification"],"classifier_from_token":["no","yes"],"is_original_qwen3_reranker":true}'
