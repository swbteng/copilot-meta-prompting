#!/usr/bin/env python3
"""벡터 DB 2D 시각화 레이아웃을 미리 계산해 정적 JSON 아티팩트로 저장한다.

왜 미리 계산하나:
  - t-SNE 는 비결정적이고(매 실행마다 좌표가 달라짐) 651점에 수 초가 걸린다. 서버가 매번 돌리면
    배치가 흔들리고 느려진다. 한 번 계산해 artifacts/viz_layout.json 으로 고정해 두면
    서버는 그 JSON 만 서빙하면 되고(임베딩 서비스 없이도 지도가 뜸), 배치가 항상 동일하다.

무엇을 만드나 (각 651개 템플릿에 대해):
  - x, y : t-SNE 로 4096차원 임베딩을 2D 로 내린 좌표(0~1 정규화)
  - cluster : 임베딩 자체(고차원)로 KMeans 한 군집 id  → "비슷한 임베딩끼리" 색을 입히기 위함
  - title, tags : 호버/모달 표시용

사용자가 새로 입력한 쿼리는 이 공간에 직접 t-SNE 투영이 안 되므로(런타임), 백엔드가
가장 가까운 이웃들의 (x,y) 를 거리가중 평균해 찍는다(app.py 의 /viz/query). 그래서 쿼리 점은
항상 자기와 매칭된 군집 한가운데 나타난다.

실행:
  python indexing/build_viz_layout.py            # 기본값(k=10)
  python indexing/build_viz_layout.py --clusters 12
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import chromadb
import numpy as np
from chromadb.config import Settings
from sklearn.cluster import KMeans
from sklearn.manifold import TSNE

THIS_DIR = Path(__file__).resolve().parent
BACKEND_DIR = THIS_DIR.parent
DEFAULT_CHROMA_DIR = BACKEND_DIR / "artifacts" / "production_chroma_qwen3_8b"
DEFAULT_COLLECTION = "production_task_prompt_templates"
DEFAULT_OUT = BACKEND_DIR / "artifacts" / "viz_layout.json"

# 군집 색상 팔레트 - 데모의 애플 톤(채도 적당, 선명)에 맞춘 12색. 군집 수가 더 많으면 순환한다.
PALETTE = [
    "#0071e3", "#34c759", "#ff9500", "#ff2d55", "#af52de", "#5ac8fa",
    "#ffcc00", "#ff3b30", "#5856d6", "#00c7be", "#a2845e", "#8e8e93",
]


def _first_tag_list(tags: object) -> list[str]:
    """tags 메타데이터는 'a,b,c' 콤마 문자열. 리스트로 정규화."""
    if isinstance(tags, str):
        return [t.strip() for t in tags.split(",") if t.strip()]
    if isinstance(tags, (list, tuple)):
        return [str(t).strip() for t in tags if str(t).strip()]
    return []


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--chroma-dir", type=Path, default=DEFAULT_CHROMA_DIR)
    parser.add_argument("--collection-name", default=DEFAULT_COLLECTION)
    parser.add_argument("--clusters", type=int, default=10)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    client = chromadb.PersistentClient(path=str(args.chroma_dir), settings=Settings(anonymized_telemetry=False))
    collection = client.get_collection(args.collection_name)
    data = collection.get(include=["embeddings", "metadatas"])
    ids = data["ids"]
    embeddings = np.asarray(data["embeddings"], dtype=np.float32)
    metadatas = data["metadatas"]
    count = len(ids)
    print(f"불러온 임베딩: {count}개, 차원 {embeddings.shape[1]}")

    # 코사인 기준 DB 이므로 단위정규화 후 군집/투영(유클리드가 코사인과 일치).
    norms = np.linalg.norm(embeddings, axis=1, keepdims=True)
    unit = embeddings / np.clip(norms, 1e-12, None)

    k = max(2, min(args.clusters, count))
    print(f"KMeans 군집화 (k={k}) ...")
    kmeans = KMeans(n_clusters=k, random_state=args.seed, n_init=10)
    cluster_ids = kmeans.fit_predict(unit)

    print("t-SNE 2D 투영 ... (수 초 소요)")
    perplexity = float(min(30, max(5, (count - 1) // 3)))
    tsne = TSNE(
        n_components=2,
        metric="cosine",
        init="pca",
        perplexity=perplexity,
        random_state=args.seed,
    )
    coords = tsne.fit_transform(unit)

    # 0~1 정규화(프론트가 캔버스 크기에 맞춰 다시 스케일).
    mins = coords.min(axis=0)
    spans = np.clip(coords.max(axis=0) - mins, 1e-9, None)
    norm_coords = (coords - mins) / spans

    points = []
    sizes = [0] * k
    for i in range(count):
        meta = metadatas[i] or {}
        tags = _first_tag_list(meta.get("tags"))
        c = int(cluster_ids[i])
        sizes[c] += 1
        points.append(
            {
                "id": ids[i],
                "title": meta.get("title") or ids[i],
                "tags": tags,
                "x": round(float(norm_coords[i][0]), 5),
                "y": round(float(norm_coords[i][1]), 5),
                "cluster": c,
            }
        )

    # 비지도(KMeans) 군집이라 의미 라벨 대신 일반 이름을 쓴다. 각 노드의 실제 태그는 호버 툴팁에서 본다.
    clusters = [
        {
            "id": c,
            "label": f"군집 {c + 1}",
            "color": PALETTE[c % len(PALETTE)],
            "size": sizes[c],
        }
        for c in range(k)
    ]

    payload = {
        "collection": args.collection_name,
        "count": count,
        "clusters": clusters,
        "points": points,
    }
    args.out.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    print(f"저장: {args.out}  (점 {count}개, 군집 {k}개)")
    for cl in clusters:
        print(f"  · 군집 {cl['id']:>2} [{cl['size']:>3}점] {cl['label']}")


if __name__ == "__main__":
    main()
