#!/usr/bin/env bash
# LLM (text generation) - GPU 0 - port 8004
# Model: cyankiwi/Qwen3.6-35B-A3B-AWQ-4bit (qwen3_5_moe, AWQ 4-bit MoE)
set -euo pipefail
cd "$(dirname "$0")/.."

export CUDA_VISIBLE_DEVICES=0
export VLLM_CACHE_ROOT=/workspace/.cache/vllm
export TRITON_CACHE_DIR=/workspace/.cache/triton
export TORCH_HOME=/workspace/.cache/torch
# export HF_HUB_OFFLINE=1

# AWQ quantization is auto-detected from the model config.
# 262144 native context won't fit on one A40 (46GB) alongside the 4-bit weights,
# so max-model-len is capped; raise it if you have KV-cache headroom.
exec .venv/bin/vllm serve cyankiwi/Qwen3.6-35B-A3B-AWQ-4bit \
  --host 0.0.0.0 \
  --port 4000 \
  --tensor-parallel-size 1 \
  --max-model-len 32768 \
  --gpu-memory-utilization 0.92 \
  --reasoning-parser qwen3
