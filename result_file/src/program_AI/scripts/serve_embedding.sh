#!/usr/bin/env bash
# Embedding - GPU 1 - port 8001
# Model: Qwen/Qwen3-Embedding-8B  -> OpenAI-compatible /v1/embeddings
set -euo pipefail
cd "$(dirname "$0")/.."

export CUDA_VISIBLE_DEVICES=1
export VLLM_CACHE_ROOT=/workspace/.cache/vllm
export TRITON_CACHE_DIR=/workspace/.cache/triton
export TORCH_HOME=/workspace/.cache/torch
# export HF_HUB_OFFLINE=1

exec vllm serve Qwen/Qwen3-Embedding-8B \
  --host 0.0.0.0 \
  --port 4001 \
  --runner pooling \
  --tensor-parallel-size 1 \
  --gpu-memory-utilization 0.60
