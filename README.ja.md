# Whiteboard Architect

> Gemini Live API を活用した、リアルタイム AI アーキテクチャレビューエージェント

**カテゴリ**: Live Agents | **ハッカソン**: [Gemini Live Agent Challenge](https://geminiliveagentchallenge.devpost.com/)

[English README](./README.md)

---

## 課題

ホワイトボードを使ったアーキテクチャ設計セッションはソフトウェア開発の基盤ですが、その場で専門家のレビューを受けることは困難です。設計上の欠陥、セキュリティの隙間、スケーラビリティの問題は、開発サイクルのずっと後になって初めて発覚することが多く、そのときには修正コストが大幅に増大しています。

## ソリューション

**Whiteboard Architect** は、AI シニアアーキテクト **Archie（アーチー）** をすべてのホワイトボードセッションに参加させます。カメラを通じて図を**見て**、あなたの説明を**聞き**、リアルタイムに音声で**フィードバック**します。まるで経験豊富な同僚が隣で見守っているかのような体験です。

---

## 主要機能

| 機能 | 説明 |
|---|---|
| **リアルタイム映像分析** | カメラを通じてホワイトボードを継続的に監視し、描かれた図を理解する |
| **自然な音声会話** | アーキテクチャの決定について自然に会話できる。タイピング不要 |
| **バージイン（割り込み）** | AIの発話中に割り込み可能。実際の人間と話すように自然 |
| **5軸アーキテクチャレビュー** | セキュリティ、スケーラビリティ、信頼性、コスト、運用の5観点で即座にフィードバック |
| **視覚アノテーション** | バックグラウンド分析結果に基づき、ホワイトボード上の特定箇所を丸、矢印、四角、ラベルでハイライト |
| **バックグラウンド分析** | Gemini 3.1 Flash Lite による定期的なホワイトボードの構造化深層分析 |
| **自動ダイアグラム生成** | 手描きのホワイトボードスケッチをプロフェッショナルなSVG技術図に変換 |
| **バイリンガルトランスクリプト** | エージェントは英語で発話。トランスクリプトは英語と日本語の両方で表示 |
| **レビューノート** | 発見事項を重要度別・カテゴリ別に自動記録し、改善推奨を提示 |
| **スナップショット履歴** | ホワイトボードの重要な状態をタイムスタンプ付きで保存。画像アップロードにも対応 |
| **セッションサマリー** | レーダーチャートによる可視化 + Markdown エクスポート |

---

## アーキテクチャ

![アーキテクチャ図](./docs/architecture-diagram.svg)

<details>
<summary>テキスト版アーキテクチャ概要</summary>

```
Frontend (Next.js 16 :3000)
  +-- useWebSocket      --> ws://backend/ws/{userId}/{sessionId}
  +-- useAudioCapture   --> PCM16 16kHz --> base64 --> WS
  +-- useVideoCapture   --> JPEG 1fps --> base64 --> WS
  +-- useAudioPlayback  <-- PCM 24kHz <-- WS

Backend (FastAPI + Google ADK :8080)
  +-- WS /ws/{user_id}/{session_id}
  |     +-- upstream_task   : WS --> LiveRequestQueue --> Gemini Live API
  |     +-- downstream_task : Gemini Live API --> WS
  |     +-- recovery_task   : セッション健全性監視
  |     +-- perception_task : WhiteboardAnalyzer による定期的深層分析
  +-- ADK Runner
  |     +-- agent.py: architect_agent ("Archie")
  |           +-- tools: save_whiteboard_snapshot, save_review_note,
  |                      generate_diagram
  +-- DiagramService    : SVG 生成 (Gemini 2.0 Flash)
  +-- TranslationService: 英 --> 日 翻訳
  +-- GET /health
  +-- GET /api/sessions/{id}/notes
  +-- GET /api/sessions/{id}/snapshots
  +-- GET /api/snapshots/{session_id}/{snapshot_id}.jpg
  +-- POST /api/sessions/{id}/upload
  +-- DELETE /api/snapshots/{session_id}/{snapshot_id}

Google Cloud
  +-- Cloud Run     : Backend + Frontend ホスティング (セッションアフィニティ)
  +-- Firestore     : sessions/{id}/snapshots, sessions/{id}/notes
  +-- Cloud Storage : {bucket}/{session_id}/snapshots/{timestamp}.jpg
```
</details>

[`docs/`](./docs/) ディレクトリに追加の図があります:

- [データフロー図](./docs/data-flow.svg) -- フォーマット詳細を含むエンドツーエンドのデータフロー
- [シーケンス図](./docs/data-flow-sequence.svg) -- メッセージレベルのやり取り（セッション開始、会話、バージイン、ツール呼び出し、変化検出）
- [デプロイメントパイプライン](./docs/deployment-pipeline.svg) -- 6フェーズの deploy.sh パイプラインと Terraform リソース

---

## 技術スタック

| レイヤー | テクノロジー |
|---|---|
| フロントエンド | Next.js 16 (React 19), Tailwind CSS v4 |
| バックエンド | Python 3.11+ (FastAPI, Uvicorn) |
| AI エージェントフレームワーク | Google ADK (Agent Development Kit) |
| AI モデル（ライブ） | Gemini 2.5 Flash Native Audio (Live API) |
| AI モデル（分析） | Gemini 3.1 Flash Lite (Standard API) |
| AI モデル（ダイアグラム） | Gemini 2.0 Flash (Text) |
| AI モデル（翻訳） | Gemini 3.1 Flash Lite |
| データベース | Google Cloud Firestore |
| オブジェクトストレージ | Google Cloud Storage |
| ストリーミングプロトコル | WebSocket（双方向） |
| ホスティング | Google Cloud Run |
| インフラ | Terraform (IaC) |
| コンテナ | Docker, Docker Compose |

---

## 前提条件

- **Python** 3.11 以上
- **Node.js** 18 以上
- **Docker** および **Docker Compose**（推奨）
- [Google AI Studio](https://aistudio.google.com/) から取得した **Gemini API キー**
- （クラウド機能利用時）課金が有効な **Google Cloud プロジェクト**

---

## クイックスタート

### 1. リポジトリのクローン

```bash
git clone https://github.com/buddypia/whiteboard-architect.git
cd whiteboard-architect
```

### 2. 環境変数の設定

```bash
cp .env.example .env
# .env を編集 -- 最低限 GOOGLE_API_KEY を設定
```

### 3. Docker Compose で起動（推奨）

```bash
docker-compose up --build
```

### 4. または個別に起動

**方法A: ルートから両方同時起動**

```bash
npm install && npm run dev
```

**方法B: 各サービスを個別起動**

```bash
# ターミナル1 - バックエンド
cd backend
pip install -r requirements.txt
python main.py
# --> http://localhost:8080

# ターミナル2 - フロントエンド
cd frontend
npm install
npm run dev
# --> http://localhost:3000
```

### 5. アプリを開く

ブラウザで `http://localhost:3000` にアクセスします。カメラとマイクのアクセスを許可し、ホワイトボードにカメラを向けてアーキテクチャについて話し始めましょう!

---

## 動作に関する注意事項

- 本プロジェクトは `GOOGLE_API_KEY` による Gemini API を使用しています。Vertex AI は不要です。
- ライブオーディオモデルは `gemini-2.5-flash-native-audio-preview-09-2025` に固定されています。
- 起動時にバックエンドが設定されたモデル候補をプローブし、Live API + ツール呼び出しパスに失敗するバリアントを自動的に除外します。
- Firestore と Cloud Storage はオプションです。利用できない場合はインメモリストレージにフォールバックし、ローカル開発が完全に機能します。
- エージェントは英語で発話します。翻訳サービスが日本語翻訳を提供し、バイリンガルトランスクリプトとして表示されます。

---

## クラウドデプロイ

### Terraform による自動デプロイ（推奨）

```bash
cd infra/terraform
cp terraform.tfvars.example terraform.tfvars  # project_id と region を設定
terraform init
terraform apply
```

### deploy.sh による自動デプロイ

```bash
./deploy.sh --project YOUR_PROJECT_ID --region us-central1
```

6フェーズのパイプラインを実行します: セットアップ --> インフラ --> バックエンドビルド --> バックエンドデプロイ --> フロントエンドビルド --> フロントエンドデプロイ。

### 手動デプロイ

```bash
# バックエンドを Cloud Run にデプロイ
cd backend
gcloud run deploy whiteboard-architect-backend \
  --source . \
  --region us-central1 \
  --allow-unauthenticated
```

---

## 使い方

1. **ホワイトボードを準備** -- 物理的なホワイトボード、紙、またはタブレットをカメラの前に置きます。
2. **セッションを開始** -- 「Start Session」をクリックしてカメラとマイクのキャプチャを開始します。
3. **描きながら話す** -- システムアーキテクチャをスケッチしながら、設計判断について説明します。
4. **フィードバックを受ける** -- Archie がリアルタイムで図を分析し、以下について音声フィードバックを提供します:
   - セキュリティの脆弱性
   - スケーラビリティの懸念
   - 単一障害点（SPOF）
   - コスト最適化の機会
   - 運用上のベストプラクティス
5. **視覚アノテーション** -- バックグラウンド分析結果に基づいて、ホワイトボード上の特定箇所が自動的に視覚マーカーでハイライトされます。
6. **ダイアグラム生成** -- 「generate a diagram」と依頼すると、手描きスケッチがプロフェッショナルなSVG技術図に変換されます。
7. **画像アップロード** -- カメラの代わりに既存のアーキテクチャ図をアップロードしてレビューできます。
8. **レビューノート** -- Review Notes パネルで重要度別に分類された発見事項を確認します。
9. **エクスポート** -- セッション終了時にレーダーチャートと Markdown エクスポート付きのサマリーを取得します。

---

## プロジェクト構成

```
whiteboard-architect/
+-- README.md                    # 英語版 README
+-- README.ja.md                 # 日本語版 README（本ファイル）
+-- CLAUDE.md                    # AI 開発コンテキスト
+-- docker-compose.yml           # ローカル開発セットアップ
+-- package.json                 # ルートスクリプト（concurrent dev）
+-- deploy.sh                    # 6フェーズデプロイスクリプト
|
+-- frontend/                    # Next.js フロントエンドアプリ
|   +-- src/
|   |   +-- app/                 # Next.js App Router
|   |   +-- components/          # React コンポーネント（14ファイル）
|   |   |   +-- SessionApp.tsx   #   メインオーケストレーター
|   |   |   +-- CameraPreview    #   カメラ + アノテーションオーバーレイ
|   |   |   +-- TranscriptPanel  #   バイリンガル会話トランスクリプト
|   |   |   +-- ReviewNotesPanel #   カテゴリ別レビューノート
|   |   |   +-- DiagramPanel     #   生成ダイアグラム表示（PiP + モーダル）
|   |   |   +-- WhiteboardAnalysisPanel  # 構造化分析結果表示
|   |   |   +-- SessionSummary   #   レーダーチャート + エクスポート
|   |   |   +-- SnapshotGallery  #   スナップショットサムネイル
|   |   |   +-- SnapshotReviewView #  スナップショット詳細レビュー
|   |   |   +-- AnnotationOverlay#   SVGアノテーション描画
|   |   |   +-- ImageUploadZone  #   画像アップロードUI
|   |   |   +-- RadarChart       #   レビューサマリーレーダーチャート
|   |   +-- hooks/               # カスタム React Hooks（5ファイル）
|   |   |   +-- useWebSocket     #   WS + 指数バックオフ
|   |   |   +-- useAudioCapture  #   AudioWorklet PCM16 16kHz
|   |   |   +-- useAudioPlayback #   ギャップレス PCM + バージイン
|   |   |   +-- useVideoCapture  #   JPEG キャプチャ @ 1fps
|   |   |   +-- useReducedMotion #   prefers-reduced-motion 対応
|   |   +-- lib/                 # ユーティリティと型定義
|   +-- public/
|   +-- Dockerfile
|
+-- backend/                     # Python バックエンドサービス
|   +-- main.py                  # FastAPI + WebSocket サーバー
|   +-- agent.py                 # ADK エージェント定義 (Archie)
|   +-- config.py                # 環境設定
|   +-- whiteboard_state.py      # 構造化分析データモデル
|   +-- image_context.py         # 画像状態管理
|   +-- tools/
|   |   +-- architect_tools.py   # 3つの ADK ツール（+ 1つ自動生成）
|   +-- services/
|   |   +-- firestore_service.py # Firestore 永続化
|   |   +-- storage_service.py   # GCS スナップショット保存
|   |   +-- diagram_service.py   # SVGダイアグラム生成
|   |   +-- whiteboard_analyzer.py # バックグラウンド分析（Perception Layer）
|   |   +-- translation_service.py # 英→日翻訳
|   |   +-- live_model_service.py  # モデル可用性プローブ
|   +-- Dockerfile
|
+-- infra/                       # Infrastructure as Code
|   +-- terraform/
|       +-- main.tf              # 全 GCP リソース
|       +-- variables.tf
|       +-- outputs.tf
|
+-- docs/                        # ドキュメントと図
    +-- architecture-diagram.svg # システムアーキテクチャ
    +-- data-flow.svg            # データフロー図
    +-- data-flow-sequence.svg   # シーケンス図
    +-- deployment-pipeline.svg  # デプロイメントパイプライン
    +-- specification.md         # 技術仕様書
    +-- developer-guide.md       # 開発者ガイド
    +-- feature-definition.md    # 機能定義書
    +-- submission.md            # Devpost 提出用テキスト
```

---

## WebSocket プロトコル

### クライアント --> サーバー（`ClientMessage`）

| タイプ | ペイロード | 説明 |
|---|---|---|
| `audio` | `{type: "audio", data: "<base64>"}` | PCM16 16kHz マイク音声 |
| `video` | `{type: "video", data: "<base64>"}` | JPEG カメラフレーム (1fps) |
| `text` | `{type: "text", text: "..."}` | テキスト入力 |
| `control` | `{type: "control", action: "..."}` | 制御コマンド: `save_snapshot`, `generate_diagram`, `review_snapshot`, `back_to_live` |

### サーバー --> クライアント（`ServerMessage`）

| タイプ | ペイロード | 説明 |
|---|---|---|
| `audio` | `{type: "audio", data: "<base64>"}` | PCM 24kHz AI 音声 |
| `transcript` | `{type: "transcript", role, text}` | 音声テキスト変換（role: user/agent/thought） |
| `interrupted` | `{type: "interrupted"}` | バージイン検出 |
| `turn_complete` | `{type: "turn_complete"}` | AI 発話完了 |
| `tool_call` | `{type: "tool_call", name, result}` | ツール実行結果 |
| `annotation` | `{type: "annotation", id, x, y, ...}` | 視覚マーカー（30秒で自動消去） |
| `agent_state` | `{type: "agent_state", mood, trigger}` | エージェント感情状態 |
| `snapshot_saved` | `{type: "snapshot_saved", ...}` | スナップショット保存完了 |
| `diagram_generating` | `{type: "diagram_generating", diagram_id}` | ダイアグラム生成開始 |
| `diagram_generated` | `{type: "diagram_generated", diagram_id, url}` | ダイアグラム生成完了 |
| `diagram_error` | `{type: "diagram_error", ...}` | ダイアグラム生成失敗 |
| `whiteboard_analysis` | `{type: "whiteboard_analysis", ...}` | 構造化分析結果 |
| `error` | `{type: "error", message}` | エラー通知 |

---

## 再現可能なテスト手順（審査員向け）

以下の手順で、ローカルマシン上で Whiteboard Architect をエンドツーエンドでテストできます。

### 前提条件

| 必要なもの | バージョン | 確認コマンド |
|---|---|---|
| Docker + Docker Compose | 最新版 | `docker --version && docker compose version` |
| Gemini API キー | -- | [Google AI Studio](https://aistudio.google.com/) で無料取得 |
| ウェブカメラ + マイク | -- | 内蔵または外付け。ブラウザが許可を要求します |
| モダンブラウザ | Chrome/Edge 推奨 | AudioWorklet + WebSocket に対応 |

> **注意**: ローカルテストに Google Cloud プロジェクトは不要です。Firestore と Cloud Storage はグレースフルに機能低下し、Gemini API キーだけで完全に動作します。

### セットアップ手順

```bash
# 1. リポジトリをクローン
git clone https://github.com/buddypia/whiteboard-architect.git
cd whiteboard-architect

# 2. 環境変数を設定
cp .env.example .env
# .env を編集し、GOOGLE_API_KEY に Gemini API キーを設定:
#   GOOGLE_API_KEY=AIza...

# 3. 両サービスを起動（バックエンド :8080、フロントエンド :3000）
docker-compose up --build
```

以下のログが表示されるまで待ちます:
```
backend-1   | INFO: Uvicorn running on http://0.0.0.0:8080
frontend-1  | Ready in Xs
```

### バックエンドの動作確認

```bash
curl http://localhost:8080/health
# 期待値: {"status":"healthy","model":"gemini-2.5-flash-native-audio-preview-09-2025",...}
```

### フル体験のテスト

1. Chrome/Edge で **http://localhost:3000** を開きます。
2. ブラウザのプロンプトで**カメラとマイクを許可**します。
3. **「Start Session」**をクリックしてセッションを開始します。
4. **カメラをホワイトボードに向けます**（紙や画面上のアーキテクチャ図でも可）。
5. **Archie と会話します**: アーキテクチャについて説明してください。例:
   - *"This is a three-tier web application with a React frontend, Node.js API, and PostgreSQL database."*
   - *"Can you review the security of this design?"*
6. **リアルタイムの動作を観察**:
   - Archie が音声でフィードバック（スピーカーから再生）。
   - 右パネルにトランスクリプト（英語原文 + 日本語翻訳）が表示。
   - カメラオーバーレイに視覚アノテーション（丸、矢印、ラベル）が表示。
   - Whiteboard Analysis パネルに検出されたコンポーネントと接続が表示。
7. **バージインテスト**: Archie が話している最中に話し始めると、AI が即座に停止してリスニングに切り替わります。
8. **ツールのテスト**:
   - *"Save a snapshot of the current whiteboard"* と言う → ギャラリーにスナップショットが表示。
   - *"Generate a clean diagram from this"* と言う → SVGダイアグラムが生成（3-7秒）。
   - レビューノートが自動生成され、Review Notes パネルに表示。
9. **画像アップロード**: アップロードゾーンを使って、カメラの代わりに既存のアーキテクチャ図をレビューできます。
10. **セッション終了**: 「Stop」をクリックすると、レーダーチャートと Markdown エクスポート付きのセッションサマリーが表示されます。

### Docker を使わない場合

```bash
# ターミナル1 - バックエンド
cd backend
pip install -r requirements.txt
python main.py        # --> http://localhost:8080

# ターミナル2 - フロントエンド
cd frontend
npm install
npm run dev           # --> http://localhost:3000
```

### 期待される動作

| 機能 | 確認できること |
|---|---|
| 音声会話 | Archie からのリアルタイム音声応答（英語） |
| カメラ分析 | カメラプレビュー上にアノテーションオーバーレイ |
| バージイン | Archie の発話中に割り込むと自然に切り替わる |
| トランスクリプト | 右パネルにバイリンガル表示（英語原文 + 日本語翻訳） |
| レビューノート | 重要度バッジ付きの構造化された発見事項（critical/warning/info/positive） |
| ダイアグラム生成 | フローティング PiP サムネイルにSVGダイアグラム（クリックで拡大） |
| ホワイトボード分析 | 分析パネルにコンポーネント・接続・問題点の検出結果 |
| スナップショットギャラリー | 保存されたホワイトボード状態のサムネイル |
| セッションサマリー | セッション終了時にレーダーチャート + Markdown エクスポート |

### トラブルシューティング

| 問題 | 解決策 |
|---|---|
| Archie の音声が出ない | ブラウザのオーディオ許可を確認。スピーカー/ヘッドホンが接続されているか確認 |
| カメラが検出されない | ブラウザのカメラ許可を確認。別のブラウザを試す |
| WebSocket が切断される | ページをリフレッシュ。アプリは指数バックオフで自動再接続 |
| `health` エンドポイントがエラー | `.env` の `GOOGLE_API_KEY` が正しく設定されているか確認 |
| Docker ビルドが失敗 | Docker デーモンが起動中か確認。`docker-compose down && docker-compose up --build` を試す |

---

## 学んだこと

- **Gemini Live API による双方向ストリーミング** -- 音声、映像、テキストの双方向ストリーミングを WebSocket 上で実装するには、upstream（クライアント → Gemini）、downstream（Gemini → クライアント）、recovery（セッション健全性監視）、perception（バックグラウンド分析）の4つの並列非同期タスクによる慎重な設計が必要でした。`LiveRequestQueue` が音声フレームと映像フレームのシームレスな多重化の鍵となりました。

- **ADK によるネイティブバージイン** -- Google ADK と Live API の組み合わせにより、カスタムコードなしでネイティブなバージインがサポートされます。ユーザーが話し始めると AI の音声出力が自動的に中断され、`interrupted` イベントがクライアントに送信されます。フロントエンドで AudioContext バッファを即座にクリアすることで、自然な割り込み体験を実現しています。

- **マルチモデルアーキテクチャ** -- タスクごとに異なる Gemini モデルを使用（Live API で会話、3.1 Flash Lite で分析/翻訳、2.0 Flash でダイアグラム生成）することで、能力・速度・コストの最適なバランスを実現しました。

- **英語ファーストと翻訳** -- ネイティブオーディオモデルは英語でより信頼性が高く自然な応答を生成します。翻訳サービスが日本語翻訳を提供してバイリンガル表示にすることで、システムプロンプトで日本語を強制するよりも高品質な結果が得られます。

- **グレースフルデグレード** -- クラウドサービス（Firestore, GCS）はオプションとして設計されています。起動時に可用性を確認し、利用できない場合はインメモリストレージにフォールバックします。これにより、Gemini API キー以外のクラウド認証情報なしで完全に機能するローカル開発が可能です。

---

## 使用技術

- **[Gemini Live API](https://ai.google.dev/gemini-api/docs/live)** -- 映像、音声、関数呼び出しを備えたリアルタイム双方向ストリーミング
- **[Google ADK](https://google.github.io/adk-docs)** -- ツール付き AI エージェント構築のための Agent Development Kit
- **[Google Cloud Run](https://cloud.google.com/run)** -- セッションアフィニティ対応のサーバーレスコンテナホスティング
- **[Cloud Firestore](https://cloud.google.com/firestore)** -- セッション履歴用 NoSQL データベース
- **[Cloud Storage](https://cloud.google.com/storage)** -- ホワイトボードスナップショット用オブジェクトストレージ
- **[Next.js](https://nextjs.org/)** -- フロントエンド用 React フレームワーク
- **[Terraform](https://www.terraform.io/)** -- 自動プロビジョニングのための Infrastructure as Code

---

## ライセンス

MIT

---

[Gemini Live Agent Challenge](https://geminiliveagentchallenge.devpost.com/) のために構築。 #GeminiLiveAgentChallenge
