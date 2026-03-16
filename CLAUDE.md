# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## Project: Whiteboard Architect

カメラ越しにホワイトボードを見ながら、音声でリアルタイムにアーキテクチャレビューを行うAIエージェント。
ハッカソン: **Gemini Live Agent Challenge（Live Agents部門）** — 締切 **2026年3月16日 17:00 PT**

---

## Development Commands

### ローカル起動

```bash
cp .env.example .env   # 初回のみ — GOOGLE_API_KEY は必須

# 方法1: Docker Compose（推奨）
docker-compose up --build

# 方法2: ルートから両方同時起動
npm install && npm run dev

# 方法3: 個別起動
cd backend && pip install -r requirements.txt && python main.py   # → :8080
cd frontend && npm install && npm run dev                         # → :3000
```

### フロントエンド lint / build

```bash
cd frontend
npm run lint    # ESLint (Next.js + TypeScript presets)
npm run build   # Next.js production build (standalone output)
```

### バックエンド

バックエンドには lint・テストフレームワークの設定なし。`test_live_model_service.py` はユニットテスト。

### クラウドデプロイ

```bash
# 自動デプロイ（6フェーズパイプライン）
./deploy.sh --project YOUR_PROJECT_ID --region us-central1

# Terraform 単体
cd infra/terraform
cp terraform.tfvars.example terraform.tfvars
terraform init && terraform apply
```

---

## Architecture Overview

```
Frontend (Next.js :3000)
  ├── useWebSocket → ws://backend/ws/{userId}/{sessionId}
  ├── useAudioCapture → PCM16 16kHz → base64 → WS
  ├── useVideoCapture → JPEG 1fps → base64 → WS
  └── useAudioPlayback ← PCM 24kHz ← WS

Backend (FastAPI + Google ADK :8080)
  ├── WS /ws/{user_id}/{session_id}
  │     ├── upstream_task  : WS → LiveRequestQueue → Gemini Live API
  │     ├── downstream_task: Gemini Live API → WS
  │     └── ChangeDetector : フレーム差分検出 → エージェント自律コメント
  ├── ADK Runner
  │     └── agent.py: architect_agent ("Archie")
  │           └── tools: save_whiteboard_snapshot, save_review_note, generate_diagram
  ├── GET /health
  ├── GET /api/sessions/{id}/notes
  └── GET /api/sessions/{id}/snapshots

Google Cloud
  ├── Cloud Run    : Backend hosting (session affinity有効)
  ├── Firestore    : sessions/{id}/snapshots, sessions/{id}/notes
  └── Cloud Storage: {bucket}/{session_id}/snapshots/{timestamp}_{id}.jpg
```

---

## Key Implementation Details

### Backend: `backend/`

| ファイル | 役割 |
|---|---|
| `main.py` | FastAPI app + WS エンドポイント。upstream/downstream の2タスクを `asyncio.gather` で並列実行 |
| `agent.py` | ADK `Agent` 定義。モデル: `gemini-2.5-flash-native-audio-latest`、音声: Aoede (ja-JP)、thinking budget: 1024 |
| `config.py` | 環境変数を frozen dataclass にまとめた `config` シングルトン |
| `change_detector.py` | フレーム間差分検出（PIL resize→grayscale→pixel diff）。閾値5%超 + 10秒クールダウンで発火 |
| `tools/architect_tools.py` | ADK ツール3つ: `save_whiteboard_snapshot`, `save_review_note`, `generate_diagram`。`ToolContext.state` 経由でセッション状態管理 |
| `services/firestore_service.py` | Firestore 永続化（利用不可でもグレースフルデグレード） |
| `services/storage_service.py` | GCS スナップショット保存（同上） |

### Frontend: `frontend/src/`

| ファイル | 役割 |
|---|---|
| `components/SessionApp.tsx` | メインオーケストレーター。WS イベントルーティング、全状態管理 |
| `components/CameraPreview.tsx` | カメラ映像 + SVG アノテーションオーバーレイ |
| `components/TranscriptPanel.tsx` | 同一話者の発話を2秒以内ならマージして表示 |
| `components/ReviewNotesPanel.tsx` | カテゴリ別・重要度別レビューノート表示 |
| `components/SessionSummary.tsx` | レーダーチャート + Markdown エクスポート付きサマリーモーダル |
| `hooks/useWebSocket.ts` | WS 接続管理 + 指数バックオフ再接続 (1s→30s) |
| `hooks/useAudioCapture.ts` | AudioWorklet → PCM16 16kHz。RMS ベース VAD (閾値 0.015) |
| `hooks/useAudioPlayback.ts` | ギャップレスPCM再生。barge-in 時200msミュートウィンドウ |
| `hooks/useVideoCapture.ts` | 640x480 JPEG 70%品質 @ 1fps。64KB超でバックプレッシャースキップ |
| `lib/types.ts` | 全メッセージ型定義（ClientMessage / ServerMessage 共用体） |
| `lib/constants.ts` | サンプルレート、FPS、品質等の定数 |
| `lib/audio-utils.ts` | PCM↔float32変換、base64エンコード/デコード、RMS計算 |

### フロントエンドデザインシステム

`globals.css` にCSS カスタムプロパティベースのダークテーマ（エメラルドブランド #10b981）。Tailwind CSS v4。主要アニメーション: `breathing-glow`, `wave-pulse`, `barge-in-flash`, `annotation-in`, `mood-bounce`。`prefers-reduced-motion` 対応済み。

### WebSocket プロトコル

クライアント → サーバー（`ClientMessage`）:
- `{type: "audio", data: "<base64 PCM16 16kHz>"}` — マイク音声
- `{type: "video", data: "<base64 JPEG>"}` — カメラフレーム (1fps)
- `{type: "text", text: "..."}` — テキスト入力
- `{type: "control", action: "save_snapshot"}` — スナップショット保存

サーバー → クライアント（`ServerMessage`）:
- `{type: "audio", data: "<base64 PCM 24kHz>"}` — AI音声
- `{type: "transcript", role: "user"|"agent", text: "..."}` — 文字起こし
- `{type: "interrupted"}` — barge-in 検出
- `{type: "turn_complete"}` — AI発話完了
- `{type: "tool_call", name: "...", result: {...}}` — ツール実行結果
- `{type: "annotation", id, x, y, label, annotation_type, severity}` — 視覚マーカー（30秒で自動消去）
- `{type: "agent_state", mood, trigger}` — エージェント感情状態

### ADK ツールとセッション状態

ツールは `ToolContext.state` に結果を蓄積:
- `state["snapshots"]` — スナップショットメタデータのリスト
- `state["review_notes"]` — レビュー所見のリスト
- `state["diagrams"]` — 図解メタデータのリスト

### アノテーション自動生成（Perception Layer → Frontend）

アノテーションは Archie のツール呼び出しではなく、`WhiteboardAnalyzer`（バックグラウンド分析）の結果から `_annotations_from_analysis()` が自動生成する。issues は affected_components の座標に配置され、残りの枠でコンポーネントラベルを表示。最大5件。正規化座標 (0.0–1.0)。`annotation_type`: circle, arrow, label, rectangle。`severity`: critical, warning, info, positive。

---

## Known Constraints & Gotchas

- **モデルバージョンロック**: `-12-2025` バリアントはツール呼び出し時に WebSocket 1008 エラーを起こすため、`-09-2025` にハードコード。ADK 1.26.0 は thinking config を Live API に自動伝播しない
- **thinking budget 1024**: 双方向ストリーミングのレイテンシ安定化のため制限
- **日本語強制**: system prompt で「日本語のみ」を絶対ルールとして指定しないと英語で応答する
- **Firestore/GCS グレースフルデグレード**: 両サービスとも `.available` プロパティで可用性チェック。ローカル開発時はクラウドなしで動作可能

---

## Environment Variables (`.env`)

```
GOOGLE_CLOUD_PROJECT=   # GCP プロジェクト ID
GOOGLE_CLOUD_REGION=us-central1
GOOGLE_API_KEY=         # Gemini API キー（AI Studio 取得）— 必須
GCS_BUCKET_NAME=        # Cloud Storage バケット名
FIRESTORE_DATABASE=(default)
BACKEND_PORT=8080
BACKEND_HOST=0.0.0.0
NEXT_PUBLIC_BACKEND_URL=http://localhost:8080
NEXT_PUBLIC_WS_URL=ws://localhost:8080/ws
```

---

## Infrastructure (infra/terraform/)

Terraform で Cloud Run (backend: 2CPU/2Gi, frontend: 1CPU/512Mi)、Artifact Registry、Firestore、Cloud Storage (30日ライフサイクル) をプロビジョニング。`deploy.sh` が6フェーズ (setup → infra → backend build → backend deploy → frontend build → frontend deploy) で自動化。

---

## Hackathon Requirements (審査時に常に意識)

**必須技術要件:**
1. Gemini モデル使用（`gemini-2.5-flash-native-audio-latest`）✅
2. Google GenAI SDK または ADK（ADK使用）✅
3. Google Cloud サービス最低1つ（Cloud Run + Firestore + Storage）✅
4. Gemini Live API（bidi-streaming で実装）✅

**提出物チェックリスト:**
- [ ] テキスト説明（機能概要・使用技術・学び）
- [ ] 公開 GitHub リポジトリ + README のスピンアップ手順
- [ ] GCP デプロイ証明スクリーン録画（Cloud Run コンソール画面）
- [ ] アーキテクチャ図（`docs/architecture.png`）
- [ ] デモ動画 4分以内（YouTube/Vimeo、英語字幕付き）

**ボーナスポイント:**
- [ ] Terraform IaC による自動デプロイ（`infra/terraform/`）+0.2
- [ ] #GeminiLiveAgentChallenge ハッカソン参加明記のブログ/動画 +0.6
- [ ] GDG メンバーシップ +0.2

**採点基準（優先度順）:**
1. **Innovation & Multimodal UX (40%)** — barge-in の自然さ、Live性、Archie のペルソナ
2. **Technical Implementation (30%)** — ADK活用度、Cloud Run 堅牢性、ハルシネーション対策
3. **Demo & Presentation (30%)** — 動画の問題/解決の明確さ、実際のソフトウェア動作

---

## Development Philosophy（開発方針）

- **全体把握優先**: 変更に取りかかる前に、関連するコードベース全体を読み通して影響範囲を把握すること。部分的な理解のまま着手しない。時間がかかっても構わない。
- **恒久対応のみ**: 一時対応・応急処置は禁止。長期運用に耐える恒久的な修正・改善を行うこと。
- **ゼロベース提案を歓迎**: 既存の実装に固執せず、根本的に優れた設計があればゼロベースで提案して良い。
- **業界標準をデフォルトとする**: 技術選定・設計パターンは業界標準（well-established best practices）に従う。ただし、独自提案が標準より優れていると判断した場合は、**比較表（標準 vs 提案）** を作成して根拠とともに提示し、ユーザーの判断を仰ぐこと。
- **不明点は質問する**: 曖昧な要件や判断に迷う箇所があれば、推測で進めず必ずユーザーに質問すること。
