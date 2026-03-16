# Whiteboard Architect — 機能定義書

> **プロジェクト:** Whiteboard Architect
> **最終更新:** 2026-03-17

---

## 1. 機能一覧

| ID | 機能名 | 状態 | 優先度 |
|----|--------|------|-------|
| F01 | リアルタイム映像解析 | ✅ 実装済み | 必須 |
| F02 | 音声会話（双方向） | ✅ 実装済み | 必須 |
| F03 | Barge-in（割り込み検出） | ✅ 実装済み | 必須 |
| F04 | ホワイトボードスナップショット保存 | ✅ 実装済み | 必須 |
| F05 | アーキテクチャレビューノート | ✅ 実装済み | 必須 |
| F06 | セッション管理 | ✅ 実装済み | 必須 |
| F07 | トランスクリプト表示（バイリンガル） | ✅ 実装済み | 必須 |
| F08 | GCS スナップショット実画像保存 | ✅ 実装済み | 高 |
| F09 | レビューノート UI 表示 | ✅ 実装済み | 高 |
| F10 | Tool call トースト通知 | ✅ 実装済み | 中 |
| F11 | バックグラウンド構造化分析 | ✅ 実装済み | 高 |
| F12 | 視覚アノテーション自動生成 | ✅ 実装済み | 高 |
| F13 | SVGダイアグラム自動生成 | ✅ 実装済み | 高 |
| F14 | 画像アップロード | ✅ 実装済み | 中 |
| F15 | セッションサマリー | ✅ 実装済み | 中 |
| F16 | スナップショット詳細レビュー | ✅ 実装済み | 中 |
| F17 | 英→日翻訳サービス | ✅ 実装済み | 高 |

---

## 2. 実装済み機能の詳細定義

### F01: リアルタイム映像解析

**概要:** カメラ映像をリアルタイムで Gemini Live API に送り、ホワイトボード上のアーキテクチャ図を認識・解析する。

**入力:**
- `MediaStream` からの映像フレーム（カメラデバイス、`facingMode: "environment"` 優先）

**処理:**
1. `useVideoCapture` フックが `setInterval(1000ms)` でフレームをキャプチャ
2. オフスクリーン `<canvas>` に `ctx.drawImage(video, 0, 0, 640, 480)` で描画
3. `canvas.toDataURL("image/jpeg", 0.7)` でエンコード
4. data URL プレフィックスを除去した raw base64 を WebSocket で送信
5. サーバー側で `types.Blob(data=image_bytes, mime_type="image/jpeg")` として `LiveRequestQueue` に投入
6. Gemini が映像コンテキストをリアルタイムで解析

**関連ファイル:**
- `frontend/src/hooks/useVideoCapture.ts`
- `frontend/src/lib/constants.ts`

---

### F02: 音声会話（双方向）

**概要:** ユーザーのマイク音声をリアルタイムでストリーミングし、Archie の英語音声応答を再生する。

**スペック:**
- 入力: PCM16 16kHz モノラル、バッファ 2,048 サンプル（128ms）
- 出力: PCM16 24kHz モノラル
- VAD（Voice Activity Detection）: RMS 閾値 0.015 でユーザー発話検出
- バックプレッシャー制御: WebSocket bufferedAmount > 65,536 bytes でスキップ
- エージェント言語: **英語**（TranslationServiceで日本語翻訳を提供）

**関連ファイル:**
- `frontend/src/hooks/useAudioCapture.ts`
- `frontend/src/hooks/useAudioPlayback.ts`
- `frontend/public/pcm-capture-processor.js`
- `frontend/src/lib/audio-utils.ts`

---

### F03: Barge-in（割り込み検出）

**概要:** ユーザーが話し始めたとき、Archie の発話を即座に停止する自然な会話体験を提供する。

**実装方式（二重保護）:**
1. **Gemini Live API 側（自動）:** サーバー側で音声活動を検出。割り込みが起きると `interrupted` イベント発生
2. **クライアント側（RMS VAD）:** `useAudioCapture` の VAD が検出した瞬間に `stopPlayback()` を呼び出し
3. **Recovery Task:** 偽barge-in（ユーザーが実際には話していないのにAI停止）を検出・復旧

**関連ファイル:**
- `frontend/src/components/SessionApp.tsx`（barge-in ハンドラ）
- `frontend/src/hooks/useAudioPlayback.ts`（`stopPlayback`）
- `backend/main.py`（`recovery_task`）

---

### F04: ホワイトボードスナップショット保存

**概要:** 現在のカメラフレームをスナップショットとして保存。

**ADK ツール仕様 `save_whiteboard_snapshot`:**
- 引数: `description: str`
- 戻り値: `{ status, snapshot_id, description, total_snapshots }`
- 永続化: ToolContext.state → GCS画像アップロード → Firestore メタデータ

**関連ファイル:**
- `backend/tools/architect_tools.py`
- `backend/main.py`
- `frontend/src/components/SnapshotGallery.tsx`

---

### F05: アーキテクチャレビューノート

**概要:** Archie が重要な発見を構造化されたレビューノートとして記録する。

**ADK ツール仕様 `save_review_note`:**
- 引数: `category`, `finding`, `severity`, `recommendation`
- カテゴリ: security, scalability, reliability, cost, operations
- 重要度: critical, warning, info, positive
- 永続化: ToolContext.state → Firestore

**関連ファイル:**
- `backend/tools/architect_tools.py`
- `backend/services/firestore_service.py`
- `frontend/src/components/ReviewNotesPanel.tsx`

---

### F06: セッション管理

**概要:** セッションの開始・停止・再接続を管理する。

**自動再接続:** 指数バックオフ: 1秒 → 最大30秒

**関連ファイル:**
- `frontend/src/components/SessionApp.tsx`
- `frontend/src/hooks/useWebSocket.ts`
- `backend/main.py`

---

### F07: トランスクリプト表示（バイリンガル）

**概要:** ユーザーと Archie の発話内容をリアルタイムでテキスト表示する。エージェントの英語発話は日本語翻訳付きで表示。

**ストリーミング結合ロジック:** 同一ロール・2,000ms 以内のメッセージを結合。

**表示形式:**
- `role: "user"` → 右寄せ
- `role: "agent"` → 左寄せ、英語テキスト + 日本語翻訳
- `role: "thought"` → 内部思考表示

**関連ファイル:**
- `frontend/src/components/TranscriptPanel.tsx`
- `backend/services/translation_service.py`

---

### F11: バックグラウンド構造化分析

**概要:** Perception Layer として、`gemini-3.1-flash-lite-preview` がホワイトボードを定期的に構造化分析する。

**処理:**
1. `perception_task` が 10-30秒間隔で起動
2. 現在のカメラフレームを `WhiteboardAnalyzer` に送信
3. Standard API で構造化レスポンス（response_schema指定）を取得
4. `WhiteboardState`（components, connections, issues）を構築
5. 前回分析との差分を検出
6. アノテーション自動生成（F12）
7. 分析結果をフロントエンドに送信（`whiteboard_analysis` メッセージ）
8. 重要な変化があればエージェントにコンテキスト注入

**関連ファイル:**
- `backend/services/whiteboard_analyzer.py`
- `backend/whiteboard_state.py`
- `backend/main.py` (`perception_task`)
- `frontend/src/components/WhiteboardAnalysisPanel.tsx`

---

### F12: 視覚アノテーション自動生成

**概要:** バックグラウンド分析結果から視覚的なアノテーションを自動生成し、カメラオーバーレイに表示する。

**生成ロジック:** `_annotations_from_analysis()` が WhiteboardState から最大5件のアノテーションを生成。issues は `affected_components` の座標に配置。

**アノテーション仕様:**
- 正規化座標: 0.0-1.0
- `annotation_type`: circle, arrow, label, rectangle
- `severity`: critical, warning, info, positive
- 30秒で自動消去

**注意:** `add_annotation` ツールは `architect_tools.py` に定義されているが、エージェントには登録されていない。アノテーションは分析結果から自動生成される。

**関連ファイル:**
- `backend/main.py` (`_annotations_from_analysis`)
- `frontend/src/components/AnnotationOverlay.tsx`
- `frontend/src/components/CameraPreview.tsx`

---

### F13: SVGダイアグラム自動生成

**概要:** 手描きのホワイトボードスケッチをプロフェッショナルなSVG技術図に変換する。

**処理:**
1. `generate_diagram` ツール呼び出し or `control: "generate_diagram"` メッセージ
2. `DiagramService` が `gemini-2.0-flash` テキストモデルでSVG生成（3-7秒）
3. scriptタグをサニタイズ
4. ローカルファイルに保存
5. `diagram_generated` メッセージでフロントエンドに通知

**関連ファイル:**
- `backend/services/diagram_service.py`
- `backend/tools/architect_tools.py` (`generate_diagram`)
- `frontend/src/components/DiagramPanel.tsx`

---

### F14: 画像アップロード

**概要:** カメラの代わりに既存のアーキテクチャ図画像をアップロードしてレビューできる。

**処理:**
1. `POST /api/sessions/{id}/upload` で画像をアップロード
2. PNG/WebP は自動的にJPEGに変換
3. `image_context` で画像状態を管理（カメラ vs 静的画像）

**関連ファイル:**
- `backend/main.py` (`/api/sessions/{id}/upload`)
- `backend/image_context.py`
- `frontend/src/components/ImageUploadZone.tsx`

---

### F15: セッションサマリー

**概要:** セッション終了後にレーダーチャートとMarkdownエクスポート付きのサマリーを表示。

**関連ファイル:**
- `frontend/src/components/SessionSummary.tsx`
- `frontend/src/components/RadarChart.tsx`

---

### F16: スナップショット詳細レビュー

**概要:** 保存されたスナップショットを選択して詳細レビュー画面で確認する。

**関連ファイル:**
- `frontend/src/components/SnapshotReviewView.tsx`

---

### F17: 英→日翻訳サービス

**概要:** エージェントの英語発話を日本語に翻訳し、バイリンガルトランスクリプトを提供する。

**処理:**
1. `downstream_task` がエージェントのトランスクリプトを検出
2. `TranslationService` が `gemini-3.1-flash-lite-preview` で英→日翻訳
3. Markdown書式を保持
4. 失敗時は原文をそのまま返す（グレースフルデグレード）

**関連ファイル:**
- `backend/services/translation_service.py`
- `frontend/src/components/TranscriptPanel.tsx`

---

## 3. AI エージェント仕様（Archie）

### 3.1 基本情報

| 属性 | 値 |
|------|-----|
| エージェント名 | archie |
| ペルソナ名 | Archie（アーチー） |
| モデル | `gemini-2.5-flash-native-audio-preview-09-2025` |
| フォールバック | `gemini-2.5-flash-native-audio-preview-12-2025` |
| 音声 | Aoede |
| 言語 | **英語**（system promptで強制） |
| フレームワーク | Google ADK `Agent` |

### 3.2 登録ツール

| ツール | エージェント登録 | 用途 |
|--------|---------------|------|
| `save_whiteboard_snapshot` | ✅ | スナップショット保存 |
| `save_review_note` | ✅ | レビューノート記録 |
| `generate_diagram` | ✅ | SVGダイアグラム生成 |
| `add_annotation` | ❌（定義のみ） | アノテーション（分析から自動生成） |

### 3.3 グラウンディングルール（ハルシネーション対策）

1. ホワイトボード上に**見えるコンポーネントと接続のみ**についてコメントする
2. 描かれていないコンポーネントについて推測しない
3. 不明瞭で読みにくい場合は、ユーザーに確認を求める
4. サービス名・APIエンドポイント・設定の詳細を捏造しない
5. バックグラウンド分析結果を会話に自然に組み込む（重大な変化のみ）

---

## 4. テスト・検証チェックリスト

### 4.1 コア機能検証

- [ ] F01: カメラ映像がホワイトボードを認識し、Archie がコメントする
- [ ] F02: マイクで話すと Archie が英語音声で応答する
- [ ] F03: Archie 発話中に話すと即座に停止する（barge-in）
- [ ] F04: Snapshot ボタンでスナップショットが保存される
- [ ] F05: レビューセッション後に Firestore にノートが保存される
- [ ] F06: セッション開始・停止が正常に動作する
- [ ] F07: 会話がバイリンガル（英語+日本語）でトランスクリプトに表示される

### 4.2 拡張機能検証

- [x] F08: GCS バケットにスナップショット画像が保存される
- [x] F09: `tool_call` イベントでレビューノートがリアルタイム表示される
- [x] F10: ツール実行時にトースト通知が表示される
- [x] F11: バックグラウンド分析が定期的に実行される
- [x] F12: 分析結果からアノテーションが自動生成される
- [x] F13: ダイアグラム生成が動作する（SVG表示）
- [x] F14: 画像アップロードが動作する
- [x] F15: セッションサマリーが表示される
- [x] F16: スナップショット詳細レビューが動作する
- [x] F17: 英語→日本語翻訳が動作する

### 4.3 非機能検証

- [ ] ネットワーク切断後に自動再接続される
- [ ] Firestore 未設定でも音声会話が動作する（グレースフルデグレード）
- [ ] Cloud Storage 未設定でもスナップショット保存が失敗しない
- [ ] Recovery Task が偽barge-inを検出・復旧する
- [ ] CORS設定が正しく動作する
