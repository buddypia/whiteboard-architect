# Whiteboard Architect — 技術仕様書

> **プロジェクト:** Whiteboard Architect
> **ハッカソン:** Gemini Live Agent Challenge（Live Agents部門）
> **締切:** 2026年3月16日 17:00 PT
> **最終更新:** 2026-03-17

---

## 1. プロジェクト概要

### 1.1 目的

カメラ越しにホワイトボードを見ながら、音声でリアルタイムにアーキテクチャレビューを行うAIエージェント。

### 1.2 解決する課題

- アーキテクチャ設計レビューには専門家が必要で、時間的制約やコストがかかる
- ホワイトボードに描いた図を口頭で説明しながらフィードバックを得るプロセスが非同期・低速
- 設計上の問題点が文書化されず、レビュー内容が失われやすい

### 1.3 価値提案

- **リアルタイム視覚認識:** カメラでホワイトボードを撮影しながら、AIがその場で図を読み取り評価
- **自然な音声会話:** 文字入力不要。マイクで話すだけでインタラクティブなレビューが可能
- **Barge-in対応:** ユーザーが話し始めたらAIは即座に停止し、自然な会話を実現
- **自動ドキュメント化:** 重要な発見はノートとして自動保存、後から参照可能
- **バックグラウンド構造化分析:** 別モデルによる定期的深層分析で、ライブ会話を補完
- **自動ダイアグラム生成:** 手描きスケッチをプロフェッショナルなSVGに変換

---

## 2. ハッカソン要件対応マトリクス

| 要件 | 対応実装 | 状態 |
|------|---------|------|
| Gemini モデル使用 | `gemini-2.5-flash-native-audio-preview-09-2025` | ✅ |
| Google GenAI SDK または ADK | Google ADK (`google-adk`) | ✅ |
| Google Cloud サービス最低1つ | Cloud Run + Firestore + Cloud Storage | ✅ |
| Gemini Live API（bidi-streaming） | `runner.run_live()` + `LiveRequestQueue` | ✅ |
| Terraform IaC | `infra/terraform/` | ✅ (+0.2) |
| ブログ/動画 | 未作成 | ⬜ (+0.6) |
| GDG メンバーシップ | - | ⬜ (+0.2) |

---

## 3. システムアーキテクチャ

### 3.1 コンポーネント構成

```
┌─────────────────────────────────────────────────────────────────┐
│                        Frontend (Next.js 16 :3000)               │
│                                                                   │
│  SessionApp.tsx                                                   │
│  ├── useWebSocket     → ws://backend/ws/{userId}/{sessionId}     │
│  ├── useAudioCapture  → PCM16 16kHz → base64 → WS              │
│  ├── useVideoCapture  → JPEG 640x480 1fps → base64 → WS        │
│  └── useAudioPlayback ← PCM16 24kHz ← WS                       │
└────────────────────────────┬────────────────────────────────────┘
                             │ WebSocket (JSON)
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Backend (FastAPI :8080)                       │
│                                                                   │
│  /ws/{user_id}/{session_id}                                       │
│  ├── upstream_task   : WS → LiveRequestQueue → Gemini Live API   │
│  ├── downstream_task : Gemini Live API → WS                      │
│  ├── recovery_task   : セッション健全性監視・偽barge-in検出       │
│  └── perception_task : WhiteboardAnalyzer → 構造化分析           │
│                                                                   │
│  ADK Runner                                                       │
│  └── architect_agent ("Archie")                                   │
│        ├── save_whiteboard_snapshot (tool)                        │
│        ├── save_review_note (tool)                                │
│        └── generate_diagram (tool)                                │
│                                                                   │
│  Services                                                         │
│  ├── DiagramService      : gemini-2.0-flash でSVG生成            │
│  ├── WhiteboardAnalyzer  : gemini-3.1-flash-lite-preview で分析  │
│  ├── TranslationService  : gemini-3.1-flash-lite-preview で翻訳  │
│  └── LiveModelService    : モデル可用性プローブ                   │
│                                                                   │
│  REST API                                                         │
│  ├── GET /health                                                  │
│  ├── GET /api/sessions/{id}/notes                                 │
│  ├── GET /api/sessions/{id}/snapshots                            │
│  ├── GET /api/snapshots/{session_id}/{snapshot_id}.jpg           │
│  ├── POST /api/sessions/{id}/upload                              │
│  └── DELETE /api/snapshots/{session_id}/{snapshot_id}            │
└──────────────────┬───────────────────────┬──────────────────────┘
                   │                       │
        ┌──────────▼──────────┐  ┌────────▼────────────┐
        │  Gemini Live API    │  │  Google Cloud        │
        │  (bidi-streaming)   │  │  ├── Cloud Run       │
        │                     │  │  ├── Firestore        │
        └─────────────────────┘  │  └── Cloud Storage   │
                                 └──────────────────────┘
```

### 3.2 データフロー

**音声入力フロー:**
```
マイク → AudioWorklet(PCM Float32) → PCM16変換 → base64 → WS→ LiveRequestQueue → Gemini
```

**映像入力フロー:**
```
カメラ → setInterval(1fps) → canvas → JPEG(quality=0.7) → base64 → WS → LiveRequestQueue → Gemini
```

**音声出力フロー:**
```
Gemini → runner.run_live() → base64(PCM 24kHz) → WS → AudioContext → スピーカー
```

**ツール実行フロー:**
```
Gemini(function_call) → ADK(tool実行) → function_response → Firestore保存 → WS(tool_call通知)
```

**バックグラウンド分析フロー:**
```
perception_task → WhiteboardAnalyzer(gemini-3.1-flash-lite-preview) → WhiteboardState
  → アノテーション自動生成 → WS(annotation)
  → 分析結果送信 → WS(whiteboard_analysis)
  → エージェントへコンテキスト注入 → LiveRequestQueue
```

**ダイアグラム生成フロー:**
```
generate_diagram(tool) → DiagramService(gemini-2.0-flash) → SVG生成 → ローカル保存
  → WS(diagram_generated, url) → フロントエンド: DiagramPanel表示
```

---

## 4. 技術スタック

### 4.1 バックエンド

| 技術 | バージョン | 用途 |
|------|-----------|------|
| Python | 3.11+ | ランタイム |
| FastAPI | >=0.135.1 | HTTP/WebSocket サーバー |
| Google ADK (`google-adk`) | >=1.27.1 | エージェントフレームワーク |
| `google-genai` | >=1.67.0 | Gemini API クライアント |
| `google-cloud-firestore` | >=2.25.0 | セッション永続化 |
| `google-cloud-storage` | >=3.9.0 | スナップショット保存 |
| uvicorn | >=0.41.0 | ASGI サーバー |
| python-dotenv | >=1.2.2 | 環境変数管理 |
| Pillow | >=12.1.1 | 画像処理 |

### 4.2 フロントエンド

| 技術 | バージョン | 用途 |
|------|-----------|------|
| Next.js | ^16.1.6 | フレームワーク |
| React | ^19.2.4 | UI ライブラリ |
| TypeScript | 5+ | 型安全な開発 |
| Tailwind CSS | ^4.2.1 | スタイリング |
| Web Audio API | ブラウザ標準 | 音声処理 |
| AudioWorklet | ブラウザ標準 | リアルタイム PCM 変換 |
| MediaDevices API | ブラウザ標準 | カメラ・マイクアクセス |

### 4.3 インフラ

| 技術 | 用途 |
|------|------|
| Docker / Docker Compose | ローカル開発環境 |
| Terraform | IaC（本番デプロイ） |
| Cloud Run v2 | バックエンド・フロントエンドホスティング |
| Artifact Registry | Docker イメージ管理 |

### 4.4 AIモデル

| モデル | 用途 | API |
|--------|------|-----|
| `gemini-2.5-flash-native-audio-preview-09-2025` | ライブ会話（音声・映像・ツール呼び出し） | Live API |
| `gemini-3.1-flash-lite-preview` | バックグラウンド分析（Perception Layer） | Standard API |
| `gemini-3.1-flash-lite-preview` | 英→日翻訳 | Standard API |
| `gemini-2.0-flash` | SVGダイアグラム生成 | Standard API |

### 4.5 外部サービス

| サービス | 用途 |
|---------|------|
| Gemini Live API | リアルタイム双方向マルチモーダルAI |
| Cloud Firestore | セッション・ノート・スナップショットメタデータ |
| Cloud Storage | スナップショット画像（JPEG）・セッションサマリー（JSON） |

---

## 5. WebSocket プロトコル仕様

### 5.1 エンドポイント

```
ws://{host}/ws/{user_id}/{session_id}
```

- `user_id`: クライアントが生成する UUID（セッション間で同一ユーザーを識別）
- `session_id`: セッションごとに生成する UUID

### 5.2 クライアント → サーバー メッセージ

全メッセージは JSON テキストフレームで送信。

#### AudioMessage
```typescript
{
  type: "audio",
  data: string  // base64エンコードされた PCM16 16kHz モノラル音声
}
```
- サンプルレート: 16,000 Hz
- チャンネル数: 1（モノラル）
- ビット深度: 16-bit signed integer（リトルエンディアン）
- バッファサイズ: 2,048 サンプル（128ms）
- バックプレッシャー閾値: 64KB（超過時はフレームをスキップ）

#### VideoMessage
```typescript
{
  type: "video",
  data: string  // base64エンコードされた JPEG 画像
}
```
- 解像度: 640 x 480 px
- フォーマット: JPEG（quality=0.7）
- フレームレート: 1 fps（setInterval 1,000ms）
- data は data URL プレフィックス（`data:image/jpeg;base64,`）を除いたraw base64

#### TextMessage
```typescript
{
  type: "text",
  text: string  // テキスト入力
}
```
- `text` が空文字列の場合、サーバー側でスキップ

#### ControlMessage
```typescript
{
  type: "control",
  action: string  // "save_snapshot" | "generate_diagram" | "review_snapshot" | "back_to_live"
}
```
- `action: "save_snapshot"`: エージェントに現在のホワイトボード状態の保存を指示
- `action: "generate_diagram"`: ダイアグラム生成を開始
- `action: "review_snapshot"`: スナップショットの詳細レビューモードに切替
- `action: "back_to_live"`: ライブカメラモードに戻る

### 5.3 サーバー → クライアント メッセージ

全メッセージは JSON テキストフレームで受信。

#### AudioOutMessage
```typescript
{
  type: "audio",
  data: string  // base64エンコードされた PCM16 24kHz モノラル音声
}
```

#### TranscriptMessage
```typescript
{
  type: "transcript",
  role: "user" | "agent" | "thought",
  text: string  // 文字起こしテキスト（ストリーミング）
}
```
- ストリーミング送信のため、同一ロールの連続メッセージは 2,000ms 以内に結合表示
- `role: "thought"` はエージェントの内部思考（thinking）

#### InterruptedMessage
```typescript
{
  type: "interrupted"
}
```
- Barge-in 検出時に送信。クライアントは即時再生停止すること

#### TurnCompleteMessage
```typescript
{
  type: "turn_complete"
}
```

#### ToolCallMessage
```typescript
{
  type: "tool_call",
  name: string,   // "save_whiteboard_snapshot" | "save_review_note" | "generate_diagram"
  result: unknown // ツールの戻り値
}
```

#### AnnotationMessage
```typescript
{
  type: "annotation",
  id: string,
  x: number,        // 正規化座標 0.0-1.0
  y: number,
  label: string,
  annotation_type: "circle" | "arrow" | "label" | "rectangle",
  severity: "critical" | "warning" | "info" | "positive",
  width?: number,
  height?: number
}
```
- バックグラウンド分析結果から自動生成（エージェントのツール呼び出しではない）
- 30秒で自動消去

#### AgentStateMessage
```typescript
{
  type: "agent_state",
  mood: "neutral" | "impressed" | "concerned" | "surprised" | "thinking",
  trigger: string
}
```

#### SnapshotSavedMessage
```typescript
{
  type: "snapshot_saved",
  snapshot_id: string,
  description: string
}
```

#### DiagramGeneratingMessage
```typescript
{
  type: "diagram_generating",
  diagram_id: string
}
```

#### DiagramGeneratedMessage
```typescript
{
  type: "diagram_generated",
  diagram_id: string,
  url: string  // SVGファイルURL
}
```

#### DiagramErrorMessage
```typescript
{
  type: "diagram_error",
  diagram_id: string,
  error: string
}
```

#### WhiteboardAnalysisMessage
```typescript
{
  type: "whiteboard_analysis",
  components: AnalysisComponent[],
  connections: AnalysisConnection[],
  issues: AnalysisIssue[]
}
```

#### ErrorMessage
```typescript
{
  type: "error",
  message: string
}
```

---

## 6. REST API 仕様

### 6.1 ヘルスチェック

```
GET /health
```

**レスポンス:**
```json
{
  "status": "healthy",
  "model_candidates": ["gemini-2.5-flash-native-audio-preview-09-2025"],
  "firestore": true,
  "storage": true
}
```

### 6.2 セッションノート取得

```
GET /api/sessions/{session_id}/notes
```

**レスポンス:**
```json
{
  "session_id": "string",
  "notes": [
    {
      "note_id": "string",
      "category": "security | scalability | reliability | cost | operations",
      "finding": "string",
      "severity": "critical | warning | info | positive",
      "recommendation": "string",
      "timestamp": "2026-03-17T00:00:00+00:00"
    }
  ]
}
```

### 6.3 セッションスナップショット取得

```
GET /api/sessions/{session_id}/snapshots
```

### 6.4 スナップショット画像取得

```
GET /api/snapshots/{session_id}/{snapshot_id}.jpg
```

ローカルキャッシュ → GCS フォールバックで画像を返す。

### 6.5 画像アップロード

```
POST /api/sessions/{session_id}/upload
```

PNG/WebP は自動的にJPEGに変換される。

### 6.6 スナップショット削除

```
DELETE /api/snapshots/{session_id}/{snapshot_id}
```

ローカルキャッシュ + ADK状態 + Firestore + GCS から削除。

---

## 7. データモデル

### 7.1 Firestore コレクション構造

```
sessions/
  {session_id}/
    - session_id: string
    - user_id: string
    - created_at: ISO8601 string
    - status: "active" | "closed"
    - closed_at: ISO8601 string (クローズ時のみ)

    snapshots/
      {snapshot_id}/
        - snapshot_id: string
        - image_url: string (GCS URI)
        - description: string
        - timestamp: ISO8601 string

    notes/
      {note_id}/
        - note_id: string
        - category: string
        - finding: string
        - severity: string
        - recommendation: string
        - timestamp: ISO8601 string
```

### 7.2 ADK セッション状態（InMemory）

ADK `ToolContext.state` に格納されるデータ:

```python
{
    "snapshots": [
        {
            "snapshot_id": "abc12345",
            "description": "string",
            "timestamp": "ISO8601"
        }
    ],
    "last_snapshot_id": "abc12345",
    "review_notes": [
        {
            "note_id": "xyz67890",
            "category": "security",
            "finding": "string",
            "severity": "warning",
            "recommendation": "string",
            "timestamp": "ISO8601"
        }
    ],
    "diagrams": [
        {
            "diagram_id": "dia12345",
            "description": "string",
            "status": "queued",
            "timestamp": "ISO8601"
        }
    ]
}
```

### 7.3 Cloud Storage オブジェクト構造

```
{GCS_BUCKET_NAME}/
  {session_id}/
    snapshots/
      {timestamp}_{snapshot_id}.jpg
    summary.json
```

### 7.4 構造化分析データモデル（WhiteboardState）

`whiteboard_state.py` に定義:

```python
@dataclass
class Component:
    name: str
    type: str       # e.g. "database", "service", "load_balancer"
    x: float        # 正規化座標 0.0-1.0
    y: float
    confidence: float

@dataclass
class Connection:
    source: str
    target: str
    label: str
    protocol: str   # e.g. "HTTP", "gRPC", "WebSocket"

@dataclass
class DetectedIssue:
    category: str   # security | scalability | reliability | cost | operations
    severity: str   # critical | warning | info
    description: str
    affected_components: list[str]

@dataclass
class WhiteboardState:
    components: list[Component]
    connections: list[Connection]
    issues: list[DetectedIssue]
```

---

## 8. 環境変数仕様

| 変数名 | 必須 | デフォルト | 説明 |
|--------|------|-----------|------|
| `GOOGLE_CLOUD_PROJECT` | 推奨 | `""` | GCP プロジェクト ID。未設定でも起動可能（Firestoreは無効化） |
| `GOOGLE_CLOUD_REGION` | 任意 | `us-central1` | GCP リージョン |
| `GOOGLE_API_KEY` | **必須** | `""` | Gemini API キー（AI Studio で取得）。未設定時はエラー |
| `GEMINI_MODEL_NAME` | 任意 | `gemini-2.5-flash-native-audio-preview-09-2025` | Live API 用モデル名 |
| `GEMINI_FALLBACK_MODEL_NAMES` | 任意 | `gemini-2.5-flash-native-audio-preview-12-2025` | フォールバックモデル（CSV） |
| `FIRESTORE_DATABASE` | 任意 | `(default)` | Firestore データベース ID |
| `GCS_BUCKET_NAME` | 任意 | `""` | Cloud Storage バケット名。未設定時はストレージ無効化 |
| `BACKEND_PORT` | 任意 | `8080` | バックエンドリッスンポート |
| `BACKEND_HOST` | 任意 | `0.0.0.0` | バックエンドリッスンホスト |
| `CORS_ORIGINS` | 任意 | `*` | CORS 許可オリジン（カンマ区切り） |
| `ANALYSIS_ENABLED` | 任意 | `true` | Perception Layer の有効/無効 |
| `ANALYSIS_INTERVAL_S` | 任意 | `10.0` | 分析実行間隔（秒） |
| `ANALYSIS_MODEL_NAME` | 任意 | `gemini-3.1-flash-lite-preview` | 分析用モデル名 |
| `ANALYSIS_THINKING_LEVEL` | 任意 | `""` | 分析モデルの thinking level（budget=0の場合のみ有効） |
| `ANALYSIS_THINKING_BUDGET` | 任意 | `512` | 分析モデルの thinking budget |
| `ANALYSIS_MEDIA_RESOLUTION` | 任意 | `medium` | 分析時の画像解像度 |
| `NEXT_PUBLIC_BACKEND_URL` | 任意 | `http://localhost:8080` | フロントエンドからのバックエンド HTTP URL |
| `NEXT_PUBLIC_WS_URL` | 任意 | `ws://localhost:8080/ws` | フロントエンドからの WebSocket 接続先 |

---

## 9. デプロイメント仕様

### 9.1 ローカル開発（Docker Compose）

```bash
cp .env.example .env
# .env を編集: GOOGLE_API_KEY を設定
docker-compose up --build
```

- バックエンド: http://localhost:8080
- フロントエンド: http://localhost:3000

### 9.2 バックエンド単体起動

```bash
cd backend
pip install -r requirements.txt
python main.py
```

uvicorn が `reload=True` で起動するため、ファイル変更時に自動再起動。

### 9.3 フロントエンド単体起動

```bash
cd frontend
npm install
npm run dev    # 開発サーバー: http://localhost:3000
npm run build  # 本番ビルド
npm run lint   # ESLint
```

### 9.4 Cloud Run デプロイ（手動）

```bash
# deploy.sh を使用
chmod +x deploy.sh
./deploy.sh --project YOUR_PROJECT_ID --region us-central1

# または手動（バックエンドのみ）
cd backend
gcloud run deploy whiteboard-backend \
  --source . \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars GOOGLE_API_KEY=xxx,GCS_BUCKET_NAME=yyy
```

### 9.5 Terraform デプロイ（IaC）

```bash
cd infra/terraform
cp terraform.tfvars.example terraform.tfvars
# terraform.tfvars を編集
terraform init
terraform plan
terraform apply
```

**Terraform 管理リソース:**
- Cloud Run v2（バックエンド / フロントエンド）
- Artifact Registry（Docker リポジトリ）
- Firestore データベース
- Cloud Storage バケット（スナップショット保存用、30日ライフサイクル）
- サービスアカウント + IAM ロール（Firestore User / Storage Object Admin）
- 必要な GCP API の有効化

**スケーリング設定:**
- バックエンド: min=0, max=5, CPU=2, Memory=2Gi, timeout=3600s
- フロントエンド: min=0, max=3, CPU=1, Memory=512Mi
- `session_affinity=true`（WebSocket セッション維持のため必須）

---

## 10. 非機能要件

### 10.1 パフォーマンス

| 項目 | 目標値 |
|------|-------|
| 音声レイテンシ（エコー） | < 500ms |
| 映像フレームレート | 1 fps（固定） |
| WebSocket 再接続時間 | 指数バックオフ（1秒〜30秒） |
| バックエンド応答性 | 非同期 I/O（asyncio）で並列処理 |
| ダイアグラム生成 | 3-7秒（テキストモデル使用） |
| バックグラウンド分析 | 10-30秒間隔 |

### 10.2 可用性

- **グレースフルデグレード:** Firestore / Cloud Storage が不可用でも音声会話機能は動作継続
- **Barge-in:** Gemini Live API の自動音声活動検出（AAD）により実現
- **セッション再接続:** `session_resumption=SessionResumptionConfig()` による自動再接続
- **WebSocket 自動再接続:** フロントエンド側で指数バックオフ付き自動再接続
- **Recovery Task:** セッション健全性監視、偽barge-in検出、スタック応答検知

### 10.3 セキュリティ

- CORS は環境変数 `CORS_ORIGINS` で制御（本番では具体的なオリジンを指定すること）
- `GOOGLE_API_KEY` は環境変数で管理（コードに直書きしない）
- Cloud Run はサービスアカウントで最小権限原則（Firestore User / Storage Object Admin のみ）
- Cloud Storage バケットは ACL パブリック非公開（GCS URI 経由のみアクセス）
- SVGダイアグラム生成時にscriptタグをサニタイズ

### 10.4 ハルシネーション対策

Archie のシステムプロンプトに以下のグラウンディングルールを明記:
- ホワイトボード上に**見えるコンポーネントと接続のみ**についてコメントする
- 描かれていないコンポーネントについて推測しない
- 不明瞭な場合はユーザーに確認を求める
- サービス名・APIエンドポイント・設定の詳細を捏造しない
