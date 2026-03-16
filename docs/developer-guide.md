# Whiteboard Architect — Developer Guide

> エンジニア向けオンボーディングマニュアル
> 最終更新: 2026-03-10

---

## 目次

1. [プロジェクト概要](#1-プロジェクト概要)
2. [全体パイプライン](#2-全体パイプライン)
3. [開発環境セットアップ](#3-開発環境セットアップ)
4. [バックエンド詳細](#4-バックエンド詳細)
5. [フロントエンド詳細](#5-フロントエンド詳細)
6. [WebSocket 通信プロトコル](#6-websocket-通信プロトコル)
7. [AI エージェント "Archie"](#7-ai-エージェント-archie)
8. [データフロー](#8-データフロー)
9. [インフラ・デプロイ](#9-インフラデプロイ)
10. [ファイル構成と責務マップ](#10-ファイル構成と責務マップ)
11. [トラブルシューティング](#11-トラブルシューティング)
12. [ハッカソン提出チェックリスト](#12-ハッカソン提出チェックリスト)

---

## 1. プロジェクト概要

### 何を作るのか

**Whiteboard Architect** は、カメラ越しにホワイトボードを見ながら、音声でリアルタイムにアーキテクチャレビューを行う AI エージェントです。

ユーザーがホワイトボードにシステム構成図を描きながら説明すると、AI（"Archie"）がリアルタイムで以下を行います:

- 描かれた図を **映像で認識**（1fps JPEG）
- ユーザーの説明を **音声で理解**（PCM16 16kHz）
- セキュリティ・スケーラビリティ等の観点で **音声でフィードバック**（PCM 24kHz）
- 重要な知見を **レビューノートとして自動記録**
- ホワイトボードの **スナップショットを自動保存**

### ハッカソン

**Gemini Live Agent Challenge（Live Agents 部門）**
締切: 2026年3月16日 17:00 PT

### 技術スタック一覧

| レイヤー | 技術 | 用途 |
|---|---|---|
| Frontend | Next.js 16 + React 19 + TypeScript 5 | Web UI |
| Backend | Python + FastAPI | WebSocket サーバー |
| AI Framework | Google ADK (Agent Development Kit) | エージェント構築 |
| AI Model | Gemini 2.5 Flash (Live API) | マルチモーダル推論 |
| Database | Cloud Firestore | セッション・ノート永続化 |
| Storage | Cloud Storage (GCS) | スナップショット画像保存 |
| Hosting | Cloud Run | サーバーレスコンテナ |
| IaC | Terraform | インフラ自動構築 |
| Container | Docker + Docker Compose | ローカル開発・ビルド |

---

## 2. 全体パイプライン

### パイプライン概要図

![Pipeline Overview](./pipeline-overview.svg)

### ワークフロー一覧

本プロジェクトは以下の 6 つのワークフローで構成されます:

| # | ワークフロー | 概要 | 主要コンポーネント |
|---|---|---|---|
| W1 | **音声入力パイプライン** | マイク → PCM16 → base64 → WS → Gemini | `useAudioCapture` → `upstream_task` |
| W2 | **映像入力パイプライン** | カメラ → JPEG → base64 → WS → Gemini | `useVideoCapture` → `upstream_task` |
| W3 | **AI 推論・応答パイプライン** | Gemini Live API → 音声/テキスト → WS → UI | `downstream_task` → `useAudioPlayback` |
| W4 | **Barge-in（割り込み）** | ユーザー発話検知 → AI 音声即停止 | クライアント VAD + Gemini AAD |
| W5 | **ツール実行パイプライン** | Gemini → ADK ツール → Firestore/GCS → UI 通知 | `architect_tools` → `services/*` |
| W6 | **デプロイパイプライン** | Docker Build → Artifact Registry → Cloud Run | `deploy.sh` + Terraform |

---

### W1: 音声入力パイプライン

```
[マイク] → getUserMedia(echo cancellation, noise suppression)
       → AudioWorklet (PCM16, 16kHz, mono)
       → float32ToInt16() → base64 encode
       → WebSocket {type: "audio", data: "<base64>"}
       → Backend upstream_task
       → LiveRequestQueue → Gemini Live API
```

**関連ファイル:**
- `frontend/src/hooks/useAudioCapture.ts` — マイク取得、AudioWorklet 処理
- `frontend/src/lib/audio-utils.ts` — PCM 変換ユーティリティ
- `backend/main.py` (`upstream_task`) — WS 受信 → LiveRequestQueue 転送

**ポイント:**
- VAD (Voice Activity Detection) 閾値: RMS 0.015
- エコーキャンセレーション・ノイズ抑制・AGC を有効化
- バックプレッシャー制御: WebSocket バッファ > 64KB の場合送信スキップ

---

### W2: 映像入力パイプライン

```
[カメラ] → getUserMedia(640x480)
        → canvas.drawImage() → toDataURL("image/jpeg", 0.7)
        → base64 抽出（data:image/jpeg;base64, を除去）
        → WebSocket {type: "video", data: "<base64>"}  [1fps]
        → Backend upstream_task
        → LiveRequestQueue (Blob mime=image/jpeg)
        → Gemini Live API
```

**関連ファイル:**
- `frontend/src/hooks/useVideoCapture.ts` — カメラ取得、JPEG キャプチャ
- `frontend/src/lib/constants.ts` — `VIDEO_FPS=1`, `VIDEO_WIDTH=640`, `VIDEO_HEIGHT=480`
- `backend/main.py` (`upstream_task`) — 映像フレーム転送 + 変化検出

**ポイント:**
- JPEG 品質: 0.7（帯域とのバランス）
- 1fps で十分（ホワイトボードは静的に近い）
- バックエンドで `ChangeDetector` が有効な場合、大きな変化を検知してプロアクティブにレビューを開始

---

### W3: AI 推論・応答パイプライン

```
Gemini Live API (bidi-streaming)
  → ADK runner.run_live()
    → イベントストリーム分岐:
       ├─ 音声データ → base64 encode → WS {type: "audio", data: "..."}
       │                             → useAudioPlayback → AudioContext 再生
       ├─ トランスクリプト → WS {type: "transcript", role, text}
       │                   → TranscriptPanel に表示
       ├─ ツール実行結果 → WS {type: "tool_call", name, result}
       │                 → Toast 通知 + ReviewNotesPanel/SnapshotGallery 更新
       ├─ アノテーション → WS {type: "annotation", ...}
       │                → CameraPreview SVG オーバーレイ
       ├─ エージェント状態 → WS {type: "agent_state", mood}
       │                  → StatusBar mood アイコン更新
       ├─ 割り込み → WS {type: "interrupted"}
       │           → useAudioPlayback.stopPlayback()
       └─ ターン完了 → WS {type: "turn_complete"}
                    → UI 状態リセット
```

**関連ファイル:**
- `backend/main.py` (`downstream_task`) — Gemini イベント → WS メッセージ変換
- `frontend/src/hooks/useAudioPlayback.ts` — PCM24kHz 再生、ギャップレス再生
- `frontend/src/components/SessionApp.tsx` — イベントルーティング

**ポイント:**
- 音声再生はギャップレス（チャンクをシーケンシャルにスケジューリング）
- タブがバックグラウンドに行った場合、5秒以上のドリフトを検知してリセット
- 停止後 200ms のミュートウィンドウでパイプライン内の残存チャンクを破棄

---

### W4: Barge-in（割り込み）パイプライン

```
[ユーザーが発話開始]
  → useAudioCapture: RMS > 0.015 → isUserSpeaking = true
  → SessionApp: isUserSpeaking && isPlaying → barge-in 検知
    ├─ クライアント側: useAudioPlayback.stopPlayback()
    │   → AudioContext 即時停止、200ms ミュートウィンドウ
    │   → CameraPreview: amber ボーダーフラッシュ
    └─ サーバー側: Gemini Live API の AAD (Audio Activity Detection)
        → interrupted イベント → WS {type: "interrupted"}
        → クライアント: resumePlayback() でミュートウィンドウ解除

[ユーザー発話 → Gemini が新しい応答を生成]
```

**設計思想:**
- **二重保護**: クライアント VAD（即時応答）+ サーバー AAD（正確な検知）
- クライアント側で先にオーディオを停止するため、体感 < 100ms で割り込み反応
- ADK + Live API のネイティブ barge-in サポートにより、カスタムロジック不要

---

### W5: ツール実行パイプライン

```
Gemini が必要と判断
  → ADK Function Call
    ├─ save_whiteboard_snapshot(description)
    │   → ToolContext に保存
    │   → downstream_task で検知
    │     ├─ StorageService.upload_snapshot() → GCS
    │     ├─ FirestoreService.save_snapshot_metadata() → Firestore
    │     └─ WS {type: "tool_call", name: "save_whiteboard_snapshot", result: {...}}
    │         → フロントエンド: SnapshotGallery 更新 + Toast 通知
    │
    ├─ save_review_note(category, finding, severity, recommendation)
    │   → ToolContext に保存
    │   → downstream_task で検知
    │     ├─ FirestoreService.save_review_note() → Firestore
    │     └─ WS {type: "tool_call", name: "save_review_note", result: {...}}
    │         → フロントエンド: ReviewNotesPanel 更新 + Toast 通知
    │
    └─ add_annotation(x, y, label, annotation_type, severity, ...)
        → ToolContext に保存
        → WS {type: "annotation", ...}
            → フロントエンド: CameraPreview SVG オーバーレイ
            → 30秒後に自動消去
```

**ツール仕様:**

| ツール名 | パラメータ | 永続化先 |
|---|---|---|
| `save_whiteboard_snapshot` | `description` | GCS + Firestore |
| `save_review_note` | `category`, `finding`, `severity`, `recommendation` | Firestore |
| `add_annotation` | `x`, `y`, `label`, `annotation_type`, `severity`, `width`, `height` | フロントエンドのみ（一時的） |

**カテゴリ:** security, scalability, reliability, cost, operations
**重要度:** critical, warning, info, positive

---

### W6: デプロイパイプライン

```
[開発者]
  → deploy.sh 実行
    Phase 1: Setup
      └─ gcloud 認証確認、プロジェクト設定
    Phase 2: Infrastructure
      └─ Terraform init/apply
         ├─ GCP API 有効化 (Cloud Run, Firestore, Storage, etc.)
         ├─ Artifact Registry 作成
         ├─ Service Account + IAM ロール
         ├─ Firestore Database 作成
         └─ GCS Bucket 作成（30日ライフサイクル）
    Phase 3: Backend Build
      └─ Docker build → Artifact Registry push
    Phase 4: Backend Deploy
      └─ Cloud Run デプロイ（CPU=2, Mem=2Gi, max=5）
    Phase 5: Frontend Build
      └─ Docker build（BACKEND_URL 注入）→ push
    Phase 6: Frontend Deploy
      └─ Cloud Run デプロイ（CPU=1, Mem=512Mi, max=3）
      └─ URL 出力
```

**関連ファイル:**
- `deploy.sh` — 6フェーズデプロイスクリプト
- `infra/terraform/main.tf` — GCP リソース定義
- `backend/Dockerfile` — マルチステージビルド
- `frontend/Dockerfile` — マルチステージビルド

---

## 3. 開発環境セットアップ

### 前提条件

| ツール | バージョン | 確認コマンド |
|---|---|---|
| Python | 3.11+ | `python --version` |
| Node.js | 18+ | `node --version` |
| Docker | 最新 | `docker --version` |
| Google Cloud SDK | 最新 | `gcloud --version` |
| Terraform | 1.5+ | `terraform --version` |

### Step 1: リポジトリのクローン

```bash
git clone https://github.com/<your-username>/gemini-live-agent-challenge.git
cd gemini-live-agent-challenge
```

### Step 2: 環境変数の設定

```bash
cp .env.example .env
```

`.env` を編集して以下を設定:

```env
# 必須
GOOGLE_API_KEY=your-gemini-api-key    # AI Studio で取得

# GCP 連携（ローカル開発では省略可）
GOOGLE_CLOUD_PROJECT=your-project-id
GCS_BUCKET_NAME=your-bucket-name

# 自動設定済み（通常変更不要）
BACKEND_PORT=8080
NEXT_PUBLIC_BACKEND_URL=http://localhost:8080
NEXT_PUBLIC_WS_URL=ws://localhost:8080/ws
```

> **最小構成:** `GOOGLE_API_KEY` さえあればローカルで動作します。Firestore/GCS が利用不可でもグレースフルデグレードで動作継続します。

### Step 3: 起動方法（3 パターン）

#### A. Docker Compose（推奨）

```bash
docker-compose up --build
# Backend: http://localhost:8080
# Frontend: http://localhost:3000
```

#### B. 個別起動

```bash
# ターミナル 1: Backend
cd backend
pip install -r requirements.txt
python main.py

# ターミナル 2: Frontend
cd frontend
npm install
npm run dev
```

#### C. npm スクリプト（同時起動）

```bash
npm install          # ルートの concurrently をインストール
npm run install:all  # backend + frontend の依存をインストール
npm run dev          # 両方同時起動
```

### Step 4: 動作確認

1. ブラウザで `http://localhost:3000` を開く
2. カメラ・マイクのアクセスを許可
3. 「セッション開始」をクリック
4. ホワイトボード（紙でも可）をカメラに映しながら話す

### ヘルスチェック

```bash
curl http://localhost:8080/health
# → {"status":"ok","services":{"firestore":"available","storage":"available"}}
```

---

## 4. バックエンド詳細

### アーキテクチャ

```
backend/
├── main.py                    # FastAPI + WebSocket エンドポイント
├── agent.py                   # ADK Agent 定義（Archie）
├── config.py                  # 環境変数管理（frozen dataclass）
├── change_detector.py         # ホワイトボード変化検出
├── tools/
│   └── architect_tools.py     # ADK ツール関数 x3
├── services/
│   ├── firestore_service.py   # Firestore 永続化
│   └── storage_service.py     # GCS アップロード
├── requirements.txt
└── Dockerfile
```

### WebSocket エンドポイント: `/ws/{user_id}/{session_id}`

WebSocket 接続時に 2 つの非同期タスクが並列起動されます:

| タスク | 方向 | 処理内容 |
|---|---|---|
| `upstream_task` | クライアント → Gemini | 音声/映像/テキスト/コントロールを `LiveRequestQueue` に転送 |
| `downstream_task` | Gemini → クライアント | Gemini イベントを WS メッセージに変換して送信 |

どちらかのタスクが完了（切断等）すると、もう一方もキャンセルされます。

### REST エンドポイント

| メソッド | パス | 用途 |
|---|---|---|
| `GET` | `/health` | ヘルスチェック（サービス可用性含む） |
| `GET` | `/api/sessions/{id}/notes` | セッションのレビューノート取得 |
| `GET` | `/api/sessions/{id}/snapshots` | セッションのスナップショット取得 |

### 変化検出 (`change_detector.py`)

ホワイトボードの大きな変化をプロアクティブに検知:

- フレームを 160x120 グレースケールにリサイズ
- ピクセル単位で前フレームと比較（閾値: 輝度差 > 30）
- 変化率 > 5% かつ クールダウン 10秒経過 → 検知
- 検知時: 「ホワイトボードに大きな変化がありました...」プロンプトを注入

### グレースフルデグレード

Firestore/GCS が利用不可の場合:
- エラーログを出力するが **クラッシュしない**
- メタデータは ADK セッション状態（メモリ）に保持
- `local_only` ステータスを返す
- ヘルスチェックで可用性を報告

---

## 5. フロントエンド詳細

### アーキテクチャ

```
frontend/src/
├── app/
│   ├── layout.tsx          # ルートレイアウト（lang="ja"、Inter フォント）
│   ├── page.tsx            # エントリポイント → SessionApp
│   └── globals.css         # デザインシステム（CSS変数、アニメーション）
├── components/
│   ├── SessionApp.tsx      # メインオーケストレーター（状態管理、WS イベントルーティング）
│   ├── CameraPreview.tsx   # カメラプレビュー + SVG アノテーションオーバーレイ
│   ├── StatusBar.tsx       # 接続状態、発話インジケーター、mood 表示
│   ├── TranscriptPanel.tsx # チャット UI（自動スクロール、ストリーミングマージ）
│   ├── ReviewNotesPanel.tsx # レビューノート表示（重要度別色分け）
│   ├── SessionControls.tsx # 開始/停止、スナップショットボタン
│   ├── SnapshotGallery.tsx # サムネイルギャラリー
│   └── SessionSummary.tsx  # セッション終了後サマリー（レーダーチャート、MD エクスポート）
├── hooks/
│   ├── useWebSocket.ts     # WS 接続管理（指数バックオフ再接続）
│   ├── useAudioCapture.ts  # マイク → AudioWorklet → PCM16
│   ├── useAudioPlayback.ts # PCM24kHz → AudioContext 再生
│   └── useVideoCapture.ts  # カメラ → canvas → JPEG 1fps
└── lib/
    ├── types.ts            # 全メッセージ型定義
    ├── constants.ts        # 定数（サンプルレート、FPS 等）
    └── audio-utils.ts      # PCM 変換、base64 変換、RMS 計算
```

### コンポーネント階層

```
<RootLayout lang="ja">
  └── <SessionApp>                    # 全状態管理の中心
        ├── <StatusBar />             # 接続・発話・mood 表示
        ├── <CameraPreview />         # 映像 + アノテーション SVG
        ├── <TranscriptPanel />       # 会話ログ
        ├── <ReviewNotesPanel />      # レビューノート一覧
        ├── <SessionControls />       # 操作ボタン
        ├── <SnapshotGallery />       # スナップショットサムネイル
        ├── Toast 通知               # ツール実行結果のフィードバック
        └── <SessionSummary />        # 終了後モーダル
```

### 状態管理

外部ライブラリ（Redux 等）は使用せず、`SessionApp` 内の `useState` で一元管理:

| State | 型 | 用途 |
|---|---|---|
| `isActive` | `boolean` | セッション開始/停止 |
| `transcripts` | `TranscriptEntry[]` | 会話履歴 |
| `snapshots` | `Snapshot[]` | スナップショット一覧 |
| `reviewNotes` | `ReviewNote[]` | レビューノート |
| `annotations` | `Annotation[]` | アクティブなアノテーション |
| `agentMood` | `AgentMood` | Archie の現在の感情状態 |
| `isUserSpeaking` | `boolean` | ユーザー発話中 |
| `isPlaying` | `boolean` | AI 音声再生中 |

### デザインシステム

- **テーマ:** ダークファースト（背景 `#06080d`）
- **ブランドカラー:** Emerald (`#10b981`)
- **アニメーション:** `breathing-glow`, `wave-pulse`, `annotation-in`, `mood-bounce`, `barge-in-flash` 等
- **グラスモーフィズム:** `.glass` クラスで半透明パネル
- **アクセシビリティ:** ARIA ラベル、ライブリージョン、セマンティック HTML、WCAG 準拠コントラスト

### 定数値

| 定数 | 値 | 用途 |
|---|---|---|
| `MIC_SAMPLE_RATE` | 16000 Hz | マイク入力サンプルレート |
| `PLAYBACK_SAMPLE_RATE` | 24000 Hz | AI 音声再生サンプルレート |
| `VIDEO_FPS` | 1 | カメラキャプチャ頻度 |
| `VIDEO_WIDTH` / `HEIGHT` | 640 x 480 | カメラ解像度 |
| `JPEG_QUALITY` | 0.7 | JPEG 圧縮品質 |
| `WS_RECONNECT_MAX_DELAY` | 30000 ms | WS 再接続最大遅延 |
| `BACKPRESSURE_THRESHOLD` | 65536 bytes | WS 送信スキップ閾値 |
| `ANNOTATION_EXPIRE_MS` | 30000 ms | アノテーション表示時間 |

---

## 6. WebSocket 通信プロトコル

### 接続

```
ws://localhost:8080/ws/{userId}/{sessionId}
```

- `userId`: クライアント生成の UUID
- `sessionId`: セッション単位の UUID

### クライアント → サーバー（`ClientMessage`）

| type | 追加フィールド | 用途 |
|---|---|---|
| `audio` | `data: string` (base64 PCM16 16kHz) | マイク音声ストリーム |
| `video` | `data: string` (base64 JPEG) | カメラフレーム (1fps) |
| `text` | `text: string` | テキスト入力 |
| `control` | `action: string` | `"save_snapshot"` 等 |

### サーバー → クライアント（`ServerMessage`）

| type | 追加フィールド | 用途 |
|---|---|---|
| `audio` | `data: string` (base64 PCM 24kHz) | AI 音声出力 |
| `transcript` | `role: "user"\|"agent"`, `text: string` | 文字起こし |
| `interrupted` | — | Barge-in 検出 |
| `turn_complete` | — | AI 発話完了 |
| `tool_call` | `name: string`, `result: object` | ツール実行結果 |
| `annotation` | `x, y, label, annotation_type, severity, ...` | 映像オーバーレイ |
| `agent_state` | `mood: AgentMood` | エージェント感情状態 |

### メッセージシーケンス例

```
1. [Client] → {type: "audio", data: "..."}    # 連続送信
2. [Client] → {type: "video", data: "..."}    # 1fps
3. [Server] → {type: "transcript", role: "user", text: "ここにDBを..."}
4. [Server] → {type: "audio", data: "..."}    # AI応答音声
5. [Server] → {type: "annotation", x: 0.3, y: 0.5, label: "DB", ...}
6. [Server] → {type: "transcript", role: "agent", text: "このDBは..."}
7. [Server] → {type: "tool_call", name: "save_review_note", result: {...}}
8. [Server] → {type: "turn_complete"}
```

---

## 7. AI エージェント "Archie"

### ペルソナ

- **名前:** Archie（アーキー）
- **役割:** 20年以上のキャリアを持つシニアクラウドアーキテクト
- **声:** Aoede（日本語女性ボイス）
- **言語:** 日本語のみ（英語は一切使用しない）
- **トーン:** 穏やか、教授的、簡潔（聞かれない限り 2-4 文）

### 感情状態（AgentMood）

| Mood | トリガー | 表示 |
|---|---|---|
| `neutral` | デフォルト | — |
| `impressed` | 良い設計を検出 | 感心 |
| `concerned` | critical な問題を発見 | 心配 |
| `surprised` | 予想外の設計を検出 | 驚き |
| `thinking` | 分析中 | 思考中 |

### レビュー観点（5 カテゴリ）

| カテゴリ | 観点 |
|---|---|
| **security** | 認証、暗号化、アクセス制御、OWASP 対策 |
| **scalability** | 水平/垂直スケーリング、ボトルネック、キャッシュ戦略 |
| **reliability** | SPOF、フェイルオーバー、冗長性、サーキットブレーカー |
| **cost** | リソース効率、予約 vs オンデマンド、過剰プロビジョニング |
| **operations** | 監視、ログ、デプロイ、CI/CD、障害対応 |

### グラウンディングルール（ハルシネーション対策）

- **見えるものだけコメント**: カメラに映っていないコンポーネントについて言及しない
- **推測しない**: 不明な箇所は「ここは何ですか？」と質問する
- **ツールで記録**: 重要な指摘は `save_review_note` で必ず記録

### モデル設定

```python
model = "gemini-2.5-flash-native-audio-latest"
# 必要なら GEMINI_MODEL_NAME で特定バージョンへ pin 可能
voice = "Aoede"
language_code = "ja-JP"
thinking_budget = 1024  # レイテンシ安定化のため制限
```

---

## 8. データフロー

### データフロー図

![Data Flow](./data-flow.svg)

### Firestore コレクション構造

```
sessions/{session_id}
├── metadata
│   ├── session_id: string
│   ├── user_id: string
│   ├── created_at: timestamp
│   ├── status: "active" | "closed"
│   └── closed_at: timestamp | null
├── snapshots/{snapshot_id}
│   ├── snapshot_id: string
│   ├── session_id: string
│   ├── description: string
│   ├── image_url: string (gs://...)
│   └── timestamp: timestamp
└── notes/{note_id}
    ├── note_id: string
    ├── session_id: string
    ├── category: string
    ├── finding: string
    ├── severity: string
    ├── recommendation: string
    └── timestamp: timestamp
```

### Cloud Storage パス構造

```
{bucket}/
└── {session_id}/
    ├── snapshots/
    │   ├── {timestamp}_{snapshot_id}.jpg
    │   └── ...
    └── summary.json
```

---

## 9. インフラ・デプロイ

### ローカル開発（Docker Compose）

```yaml
services:
  backend:   # :8080, ホットリロード有効
  frontend:  # :3000, depends_on backend
```

### GCP アーキテクチャ

```
Cloud Run
├── whiteboard-backend   (CPU=2, Mem=2Gi, max=5, session affinity)
└── whiteboard-frontend  (CPU=1, Mem=512Mi, max=3)

Artifact Registry
└── whiteboard-architect/  (Docker イメージ保管)

Cloud Firestore
└── (default) database

Cloud Storage
└── {project}-whiteboard-snapshots  (30日ライフサイクル)

IAM
└── whiteboard-backend SA
    ├── roles/datastore.user
    └── roles/storage.objectAdmin
```

### デプロイ手順

#### 自動デプロイ（推奨）

```bash
# 1. 環境変数設定
cp .env.example .env && vi .env

# 2. デプロイスクリプト実行
chmod +x deploy.sh
./deploy.sh
```

#### Terraform 単体

```bash
cd infra/terraform
cp terraform.tfvars.example terraform.tfvars
# terraform.tfvars を編集
terraform init
terraform apply
```

#### 手動デプロイ

```bash
# Backend
cd backend
gcloud run deploy whiteboard-backend \
  --source . --region us-central1 --allow-unauthenticated

# Frontend (環境変数にデプロイ済み Backend URL を設定)
cd frontend
gcloud run deploy whiteboard-frontend \
  --source . --region us-central1 --allow-unauthenticated
```

### 重要な Cloud Run 設定

| 設定 | 値 | 理由 |
|---|---|---|
| Session Affinity | `true` | WebSocket 接続をスティッキーにする |
| Timeout | `3600s` | 長時間セッション対応 |
| Min Instances | `0` | コスト最適化 |
| Max Instances | `5` (backend) | スケーリング上限 |

---

## 10. ファイル構成と責務マップ

```
gemini-live-agent-challenge/
├── .env.example                    # 環境変数テンプレート
├── .gitignore                      # Git 除外ルール
├── CLAUDE.md                       # AI 開発コンテキスト
├── README.md                       # プロジェクト概要
├── package.json                    # ルートスクリプト（concurrently）
├── docker-compose.yml              # ローカル開発環境
├── deploy.sh                       # GCP 自動デプロイスクリプト
│
├── backend/                        # Python バックエンド
│   ├── main.py                     # FastAPI + WS エンドポイント
│   ├── agent.py                    # ADK Agent "Archie" 定義
│   ├── config.py                   # 環境変数管理
│   ├── change_detector.py          # ホワイトボード変化検出
│   ├── tools/
│   │   └── architect_tools.py      # ADK ツール（snapshot, note, annotation）
│   ├── services/
│   │   ├── firestore_service.py    # Firestore CRUD
│   │   └── storage_service.py      # GCS アップロード
│   ├── requirements.txt            # Python 依存
│   └── Dockerfile                  # マルチステージビルド
│
├── frontend/                       # Next.js フロントエンド
│   ├── src/
│   │   ├── app/                    # App Router
│   │   │   ├── layout.tsx          # ルートレイアウト
│   │   │   ├── page.tsx            # エントリポイント
│   │   │   └── globals.css         # デザインシステム
│   │   ├── components/             # React コンポーネント
│   │   │   ├── SessionApp.tsx      # メインオーケストレーター
│   │   │   ├── CameraPreview.tsx   # カメラ + アノテーション
│   │   │   ├── StatusBar.tsx       # ヘッダー状態表示
│   │   │   ├── TranscriptPanel.tsx # 会話ログ
│   │   │   ├── ReviewNotesPanel.tsx # レビューノート
│   │   │   ├── SessionControls.tsx # 操作ボタン
│   │   │   ├── SnapshotGallery.tsx # スナップショット
│   │   │   └── SessionSummary.tsx  # 終了後サマリー
│   │   ├── hooks/                  # カスタムフック
│   │   │   ├── useWebSocket.ts     # WS 接続管理
│   │   │   ├── useAudioCapture.ts  # マイク入力
│   │   │   ├── useAudioPlayback.ts # AI 音声再生
│   │   │   └── useVideoCapture.ts  # カメラ入力
│   │   └── lib/                    # ユーティリティ
│   │       ├── types.ts            # 型定義
│   │       ├── constants.ts        # 定数
│   │       └── audio-utils.ts      # 音声変換
│   ├── package.json                # Node.js 依存
│   ├── tsconfig.json               # TypeScript 設定
│   ├── next.config.ts              # Next.js 設定（standalone）
│   └── Dockerfile                  # マルチステージビルド
│
├── infra/                          # Infrastructure as Code
│   └── terraform/
│       ├── main.tf                 # GCP リソース定義
│       ├── variables.tf            # 入力変数
│       ├── outputs.tf              # 出力値
│       └── terraform.tfvars.example # 変数テンプレート
│
└── docs/                           # ドキュメント
    ├── developer-guide.md          # 本マニュアル
    ├── specification.md            # 技術仕様書
    ├── feature-definition.md       # 機能定義書
    ├── submission.md               # Devpost 提出用テキスト
    ├── architecture.svg            # アーキテクチャ図（SVG）
    ├── architecture-diagram.svg    # アーキテクチャ図（日本語版）
    ├── architecture.png            # アーキテクチャ図（PNG）
    ├── pipeline-overview.svg       # パイプライン全体図
    └── data-flow.svg               # データフロー図
```

---

## 11. トラブルシューティング

### よくある問題

| 症状 | 原因 | 対処 |
|---|---|---|
| WS 接続が切れる | Cloud Run のタイムアウト | `timeout: 3600s` を確認、session affinity 有効化 |
| AI が英語で応答する | システムプロンプトの言語指定不足 | `agent.py` の instruction に日本語明記済み |
| 音声が途切れる | バックプレッシャー | `BACKPRESSURE_THRESHOLD` 調整、ネットワーク確認 |
| カメラが映らない | ブラウザ権限 | HTTPS（または localhost）でアクセス、権限許可 |
| Firestore エラー | 認証情報不足 | `GOOGLE_CLOUD_PROJECT` 設定、`gcloud auth` 実行 |
| ツール呼び出しが失敗 | モデルバージョン | `-09-2025` を使用（`-12-2025` にバグあり） |
| Barge-in が遅い | クライアント VAD 閾値 | `useAudioCapture` の RMS 閾値を調整 |
| Docker build が遅い | レイヤーキャッシュ | `requirements.txt`/`package.json` を先に COPY |

### ログ確認

```bash
# ローカル
docker-compose logs -f backend
docker-compose logs -f frontend

# Cloud Run
gcloud run services logs read whiteboard-backend --region us-central1
```

### デバッグ Tips

- バックエンドの `main.py` に `logging.DEBUG` レベルのログが出力される
- ブラウザの DevTools > Console で WS メッセージを確認
- ヘルスチェック: `curl localhost:8080/health` でサービス可用性を確認
- ADK テスト: `backend/test_live_model_service.py` でモデルサービスのユニットテスト実行

---

## 12. ハッカソン提出チェックリスト

### 必須技術要件

- [x] Gemini モデル使用（`gemini-2.5-flash-native-audio-latest`）
- [x] Google ADK（Agent Development Kit）使用
- [x] Google Cloud サービス（Cloud Run + Firestore + Storage）
- [x] Gemini Live API（bidi-streaming 実装）

### 提出物

- [ ] テキスト説明（機能概要・使用技術・学び）→ `docs/submission.md`
- [ ] 公開 GitHub リポジトリ + README のスピンアップ手順
- [ ] GCP デプロイ証明スクリーン録画（Cloud Run コンソール画面）
- [ ] アーキテクチャ図 → `docs/architecture.png`
- [ ] デモ動画 4分以内（YouTube/Vimeo、英語字幕付き）

### ボーナスポイント

- [x] Terraform IaC（`infra/terraform/`）→ +0.2
- [ ] ハッカソン参加ブログ/動画 → +0.6
- [ ] GDG メンバーシップ → +0.2

### 採点基準

| 基準 | 配点 | 重要ポイント |
|---|---|---|
| Innovation & Multimodal UX | 40% | Barge-in の自然さ、Live 性、Archie のペルソナ |
| Technical Implementation | 30% | ADK 活用度、Cloud Run 堅牢性、ハルシネーション対策 |
| Demo & Presentation | 30% | 問題/解決の明確さ、実際のソフトウェア動作 |

---

## 付録: キーリソース

| リソース | URL |
|---|---|
| ADK Bidi-streaming ガイド | https://google.github.io/adk-docs |
| Gemini Live API ドキュメント | https://ai.google.dev/gemini-api/docs/live |
| GenAI SDK ドキュメント | https://ai.google.dev/gemini-api/docs |
| Devpost ハッカソンページ | https://geminiliveagentchallenge.devpost.com/ |
