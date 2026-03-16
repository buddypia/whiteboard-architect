# Whiteboard Architect — 機能定義書

> **プロジェクト:** Whiteboard Architect
> **最終更新:** 2026-03-01

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
| F07 | トランスクリプト表示 | ✅ 実装済み | 必須 |
| F08 | GCS スナップショット実画像保存 | ✅ 実装済み | 高 |
| F09 | レビューノート UI 表示 | ✅ 実装済み | 高 |
| F10 | Tool call トースト通知 | ✅ 実装済み | 中 |

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

**受け入れ基準:**
- カメラ起動後1秒以内に最初のフレームが送信される
- 映像が変化したとき（図の追記など）、Archie が変化に気づいてコメントする
- 映像が不明瞭な場合、Archie が確認を求める

**関連ファイル:**
- `frontend/src/hooks/useVideoCapture.ts`
- `frontend/src/lib/constants.ts`（`VIDEO_FPS`, `VIDEO_WIDTH`, `VIDEO_HEIGHT`, `JPEG_QUALITY`）

---

### F02: 音声会話（双方向）

**概要:** ユーザーのマイク音声をリアルタイムでストリーミングし、Archie の音声応答を再生する。

**音声入力処理:**
1. `navigator.mediaDevices.getUserMedia` でマイクアクセス
2. `AudioContext({ sampleRate: 16000 })` で AudioContext 生成
3. `AudioWorkletNode("pcm-capture-processor")` で Float32 PCM を取得
4. `float32ToInt16()` で Float32 → Int16 変換
5. `arrayBufferToBase64()` でエンコード
6. `{ type: "audio", data: base64 }` として WebSocket 送信

**音声出力処理:**
1. WebSocket から `{ type: "audio", data: base64PCM24kHz }` 受信
2. `base64ToArrayBuffer()` + `int16ToFloat32()` で変換
3. `AudioContext({ sampleRate: 24000 })` の `AudioBuffer` に格納
4. `AudioBufferSourceNode` でスケジューリング再生（バッファキュー管理）

**スペック:**
- 入力: PCM16 16kHz モノラル、バッファ 2,048 サンプル（128ms）
- 出力: PCM16 24kHz モノラル
- VAD（Voice Activity Detection）: RMS 閾値 0.015 でユーザー発話検出
- バックプレッシャー制御: WebSocket bufferedAmount > 65,536 bytes でスキップ

**受け入れ基準:**
- ユーザーが話してから 500ms 以内に Archie が応答を開始する
- 音声品質が劣化しない（プチノイズ、欠落なし）

**関連ファイル:**
- `frontend/src/hooks/useAudioCapture.ts`
- `frontend/src/hooks/useAudioPlayback.ts`
- `frontend/public/pcm-capture-processor.js`（AudioWorklet プロセッサ）
- `frontend/src/lib/audio-utils.ts`（変換ユーティリティ）

---

### F03: Barge-in（割り込み検出）

**概要:** ユーザーが話し始めたとき、Archie の発話を即座に停止する自然な会話体験を提供する。

**実装方式（二重保護）:**

1. **Gemini Live API 側（自動）:** `AutomaticActivityDetection(disabled=False)` により、サーバー側で音声活動を検出。割り込みが起きると `event.interrupted = True` イベントが発生し、`{ type: "interrupted" }` をクライアントに送信。

2. **クライアント側（RMS VAD）:** `useAudioCapture` の VAD が `isUserSpeaking = true` を検出した瞬間、`useEffect` 内で `stopPlayback()` を呼び出す。

```typescript
// SessionApp.tsx の barge-in ハンドラ
useEffect(() => {
  const wasSpeaking = prevIsUserSpeakingRef.current;
  prevIsUserSpeakingRef.current = isUserSpeaking;
  if (isUserSpeaking && !wasSpeaking && isPlaying) {
    stopPlayback();
  }
}, [isUserSpeaking, isPlaying, stopPlayback]);
```

**`stopPlayback()` の動作:**
- 全ての `AudioBufferSourceNode.stop()` を即時呼び出し
- キュー（`queueRef.current`）を空にする
- `playingCountRef.current = 0`、`setIsPlaying(false)`

**受け入れ基準:**
- ユーザーが話し始めてから 100ms 以内に Archie の音声が停止する
- Barge-in 後、ユーザーの発話が正常に認識される
- `interrupted` と `turn_complete` の両方のシグナルを処理できる

**関連ファイル:**
- `frontend/src/components/SessionApp.tsx`（useEffect barge-in ハンドラ）
- `frontend/src/hooks/useAudioPlayback.ts`（`stopPlayback`）
- `backend/main.py`（`event.interrupted` 検出、`_build_run_config`）

---

### F04: ホワイトボードスナップショット保存

**概要:** 現在のカメラフレームをスナップショットとして保存し、Archie にメタデータ記録を指示する。

**トリガー方法:**
1. UI ボタン（SessionControls の「Snapshot」ボタン）を押す
2. `sendJson({ type: "control", action: "save_snapshot" })` を送信
3. Archie が音声で「保存して」と言う

**フロー:**
```
ユーザー操作
  ↓
handleSnapshot() in SessionApp.tsx
  ├── takeSnapshot() → canvas からスナップショット dataUrl 取得
  ├── Snapshot オブジェクトを snapshots state に追加（UI表示用）
  └── sendJson({ type: "control", action: "save_snapshot" })
        ↓
upstream_task in main.py
  └── LiveRequestQueue.send_content("Please save a snapshot...")
        ↓
Gemini → save_whiteboard_snapshot(description="...")
  ↓
ADK tool 実行: save_whiteboard_snapshot()
  ├── snapshot_id 生成（UUID 8文字）
  ├── ToolContext.state["snapshots"] に追記
  └── 戻り値: { status: "saved", snapshot_id: "...", description: "..." }
        ↓
_persist_session_data() in main.py
  └── firestore_service.save_snapshot_metadata()
        ↓
WS: { type: "tool_call", name: "save_whiteboard_snapshot", result: {...} }
```

**ADK ツール仕様 `save_whiteboard_snapshot`:**

引数:
- `description: str` — Archie が生成するホワイトボードの内容説明

戻り値:
```python
{
    "status": "saved",
    "snapshot_id": "abc12345",  # UUID[:8]
    "description": "...",
    "total_snapshots": 3
}
```

**受け入れ基準:**
- スナップショット操作後、Archie が「保存しました」と音声で確認する
- SnapshotGallery に画像が追加される
- Firestore の `sessions/{id}/snapshots/` にメタデータが保存される

**関連ファイル:**
- `backend/tools/architect_tools.py`（`save_whiteboard_snapshot`）
- `backend/main.py`（`_persist_session_data`）
- `frontend/src/components/SessionApp.tsx`（`handleSnapshot`）
- `frontend/src/components/SnapshotGallery.tsx`

---

### F05: アーキテクチャレビューノート

**概要:** Archie が重要な発見を構造化されたレビューノートとして記録する。

**ADK ツール仕様 `save_review_note`:**

引数:
- `category: str` — `"security"` | `"scalability"` | `"reliability"` | `"cost"` | `"operations"`
- `finding: str` — 発見した問題・ポイントの説明
- `severity: str` — `"critical"` | `"warning"` | `"info"` | `"positive"`
- `recommendation: str` — 改善推奨事項

戻り値:
```python
{
    "status": "saved",
    "note_id": "xyz67890",  # UUID[:8]
    "category": "security",
    "severity": "warning",
    "finding": "..."
}
```

**Archie が `save_review_note` を呼ぶタイミング:**
- 重要なアーキテクチャの問題点を発見したとき
- 良い設計判断を記録すべきとき（severity: "positive"）
- ユーザーから「ノートに残して」と依頼されたとき

**永続化フロー:**
```
save_review_note(tool戻り値)
  ↓
_persist_session_data()
  └── firestore_service.save_review_note(
        session_id, note_id, category, finding, severity, recommendation
      )
```

**REST API での取得:**
```
GET /api/sessions/{session_id}/notes
```

**受け入れ基準:**
- Archie が重要な発見時に自動的にノートを作成する
- Firestore にノートデータが保存される
- REST API でノート一覧を取得できる（タイムスタンプ順）

**関連ファイル:**
- `backend/tools/architect_tools.py`（`save_review_note`）
- `backend/main.py`（`_persist_session_data`、`/api/sessions/{id}/notes`）
- `backend/services/firestore_service.py`（`save_review_note`）

---

### F06: セッション管理

**概要:** セッションの開始・停止・再接続を管理する。

**セッション開始フロー:**
1. 「Start Session」ボタン押下
2. 新しい `sessionId`（UUID）を生成
3. `startVideo()` → カメラアクセス取得
4. `startAudio()` → マイクアクセス取得
5. `wsUrl` を更新（`{NEXT_PUBLIC_WS_URL}/{userId}/{sessionId}`）
6. `useEffect` が `wsUrl` 変化を検知して `connect()` 呼び出し
7. WebSocket 接続確立 → バックエンドが ADK セッション生成 + Firestore レコード作成

**セッション停止フロー:**
1. 「Stop Session」ボタン押下
2. `stopAudio()` → AudioContext・マイクストリーム解放
3. `stopVideo()` → カメラストリーム・インターバル解放
4. `disconnect()` → WebSocket クローズ（intentional フラグでAuto再接続を抑制）
5. バックエンド: `finally` ブロックで `firestore_service.close_session(session_id)` 実行

**自動再接続:**
- 非意図的な切断（ネットワーク障害等）で 1秒後に再接続試行
- 指数バックオフ: `delay * 2` でリトライ、最大 30,000ms（30秒）
- `session_resumption=SessionResumptionConfig()` でセッション状態を復元

**受け入れ基準:**
- セッション開始から 3 秒以内に WebSocket が `connected` 状態になる
- セッション停止時にメディアデバイスが正常に解放される
- ネットワーク切断後、自動的に再接続される

**関連ファイル:**
- `frontend/src/components/SessionApp.tsx`（`handleToggleSession`）
- `frontend/src/hooks/useWebSocket.ts`（再接続ロジック）
- `backend/main.py`（セッション生成・クリーンアップ）

---

### F07: トランスクリプト表示

**概要:** ユーザーと Archie の発話内容をリアルタイムでテキスト表示する。

**ストリーミング結合ロジック:**
```typescript
// 同一ロール・2,000ms 以内のメッセージを結合
if (last && last.role === event.role && Date.now() - last.timestamp < 2000) {
  // テキストを連結して最後のエントリを更新
  updated[updated.length - 1] = { ...last, text: last.text + event.text, timestamp: Date.now() };
}
```

**表示形式:**
- `role: "user"` → 右寄せ、グレー背景
- `role: "agent"` → 左寄せ、インディゴ系背景
- タイムスタンプを表示

**受け入れ基準:**
- 発話のたびにリアルタイムにテキストが追加される
- ストリーミングで断片的に届くテキストが自然に結合される
- スクロールは最新メッセージに自動追従する

**関連ファイル:**
- `frontend/src/components/TranscriptPanel.tsx`
- `frontend/src/components/SessionApp.tsx`（`handleServerEvent` の transcript ハンドラ）

---

## 3. 追加実装機能の詳細

### F08: GCS スナップショット実画像保存

**現状の問題:**
`storage_service.upload_snapshot()` は実装済みだが、`main.py` の `_persist_session_data()` から呼ばれていない。スナップショットのメタデータは Firestore に保存されるが、画像ファイル本体は GCS に保存されない。

また、`save_whiteboard_snapshot` ツール実行時点ではフロントエンドが送信した最後のビデオフレームを取得する手段がない（ビデオフレームはバックエンドを素通りして Gemini へ）。

**実装方針:**

**方針A（推奨）: 最後のフレームをサーバー側でキャッシュ**

`upstream_task` で映像フレームを `LiveRequestQueue` に投入する際、最後のフレームバイト列をセッション単位でキャッシュする。

`main.py` の変更箇所:

```python
# セッションスコープで最後のフレームをキャッシュ
last_video_frame: dict[str, bytes] = {}  # session_id -> image_bytes

async def upstream_task() -> None:
    while True:
        ...
        elif msg_type == "video":
            image_bytes = base64.b64decode(msg["data"])
            last_video_frame[session_id] = image_bytes  # キャッシュ
            live_request_queue.send_realtime(
                blob=types.Blob(data=image_bytes, mime_type="image/jpeg")
            )
```

`_persist_session_data()` の変更箇所:

```python
async def _persist_session_data(session_id: str, event, last_frames: dict) -> None:
    ...
    if name == "save_whiteboard_snapshot" and result.get("status") == "saved":
        snapshot_id = result.get("snapshot_id", uuid.uuid4().hex[:8])
        image_url = ""
        # GCS に画像を保存
        if storage_service.available and session_id in last_frames:
            image_url = await storage_service.upload_snapshot(
                session_id=session_id,
                snapshot_id=snapshot_id,
                image_data=last_frames[session_id],
            )
        await firestore_service.save_snapshot_metadata(
            session_id=session_id,
            snapshot_id=snapshot_id,
            image_url=image_url,  # GCS URI を含める
            description=result.get("description", ""),
        )
```

**受け入れ基準:**
- スナップショット保存後、GCS バケットに `{session_id}/snapshots/{timestamp}_{snapshot_id}.jpg` が存在する
- Firestore の snapshot メタデータに `image_url` フィールドが設定される（`gs://...`）
- `storage_service.available = False` の場合、`image_url = ""` でグレースフルデグレード

**変更ファイル:** `backend/main.py`

---

### F09: レビューノート UI 表示

**現状の問題:**
REST API `/api/sessions/{id}/notes` は実装済みだが、フロントエンドで利用されていない。セッション終了後、ユーザーがレビュー結果を確認できない。

**実装方針:**

**リアルタイム表示（推奨）:** `tool_call` イベントで `save_review_note` を受信したとき、フロントエンド側の state にノートを追加する。

`SessionApp.tsx` の変更:

```typescript
const [reviewNotes, setReviewNotes] = useState<ReviewNote[]>([]);

case "tool_call":
  if (event.name === "save_review_note") {
    const result = event.result as SaveReviewNoteResult;
    if (result.status === "saved") {
      setReviewNotes((prev) => [...prev, {
        id: result.note_id,
        category: result.category,
        severity: result.severity,
        finding: result.finding,
        timestamp: Date.now(),
      }]);
    }
  }
  break;
```

新規コンポーネント `ReviewNotesPanel.tsx`:

```typescript
interface ReviewNote {
  id: string;
  category: "security" | "scalability" | "reliability" | "cost" | "operations";
  severity: "critical" | "warning" | "info" | "positive";
  finding: string;
  timestamp: number;
}

// severity に応じたバッジカラー
const severityColors = {
  critical: "bg-red-500",
  warning: "bg-amber-500",
  info: "bg-blue-500",
  positive: "bg-green-500",
};
```

**表示場所:** TranscriptPanel の下、または右パネルのタブ切り替えで表示。

**受け入れ基準:**
- Archie が `save_review_note` を実行するたびに UI にカードが追加される
- severity に応じて色分けされたバッジが表示される
- セッション終了後もノートが画面上に残る

**変更ファイル:**
- `frontend/src/components/SessionApp.tsx`
- `frontend/src/components/ReviewNotesPanel.tsx`（新規作成）
- `frontend/src/lib/types.ts`（`ReviewNote` 型追加）

---

### F10: Tool call トースト通知

**現状の問題:**
`case "tool_call"` で `console.log()` のみ実行。Archie がツールを実行したことがユーザーに伝わらない。

**実装方針:**

軽量なトースト通知で5秒間表示する。既存のライブラリ（react-hot-toast 等）を使うか、シンプルな state ベースの実装で対応。

`SessionApp.tsx` の変更:

```typescript
const [toasts, setToasts] = useState<ToastMessage[]>([]);

const showToast = useCallback((message: string) => {
  const id = generateId();
  setToasts((prev) => [...prev, { id, message }]);
  setTimeout(() => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, 5000);
}, []);

case "tool_call":
  const toolLabel = event.name === "save_whiteboard_snapshot"
    ? "スナップショットを保存しました"
    : event.name === "save_review_note"
    ? "レビューノートを記録しました"
    : `ツール実行: ${event.name}`;
  showToast(toolLabel);
  break;
```

トーストコンポーネント:
```typescript
// 画面右下に固定表示
<div className="fixed bottom-20 right-4 flex flex-col gap-2 z-50">
  {toasts.map((toast) => (
    <div key={toast.id} className="bg-zinc-800 border border-zinc-600 rounded-lg px-4 py-2 text-sm text-white shadow-lg">
      {toast.message}
    </div>
  ))}
</div>
```

**受け入れ基準:**
- `save_whiteboard_snapshot` 実行時に「スナップショットを保存しました」が5秒表示
- `save_review_note` 実行時に「レビューノートを記録しました」が5秒表示
- 複数のトーストが同時に積み重なって表示できる

**変更ファイル:** `frontend/src/components/SessionApp.tsx`

---

## 4. UI コンポーネント仕様

### SessionApp（メインコンポーネント）

**ファイル:** `frontend/src/components/SessionApp.tsx`

**状態管理:**
| state | 型 | 初期値 | 説明 |
|-------|-----|--------|------|
| `isSessionActive` | boolean | false | セッション稼働中フラグ |
| `transcripts` | TranscriptEntry[] | [] | 会話履歴 |
| `snapshots` | Snapshot[] | [] | スナップショット一覧（ローカル保持） |
| `userId` | string | generateId() | ページロード時に一度生成 |
| `sessionId` | string | generateId() | セッション開始ごとに再生成 |
| `wsUrl` | string | "" | 接続先 WebSocket URL |

**レイアウト:**
```
┌─────────────── StatusBar ────────────────┐
│  [接続状態] [ユーザー発話中] [AI発話中]   │
├──────────────┬───────────────────────────┤
│ CameraPreview│    TranscriptPanel        │
│  (左 1/2)    │    (右 1/2)               │
├──────────────┴───────────────────────────┤
│         SessionControls                  │
│  [Start/Stop]        [Snapshot]          │
├──────────────────────────────────────────┤
│         SnapshotGallery                  │
│  [snap1] [snap2] ...                     │
└──────────────────────────────────────────┘
```

---

### StatusBar

**ファイル:** `frontend/src/components/StatusBar.tsx`

**Props:**
```typescript
interface StatusBarProps {
  connectionState: ConnectionState;  // "disconnected" | "connecting" | "connected"
  isAgentSpeaking: boolean;
  isUserSpeaking: boolean;
  sessionId: string | null;
}
```

---

### CameraPreview

**ファイル:** `frontend/src/components/CameraPreview.tsx`

**Props:**
```typescript
interface CameraPreviewProps {
  videoRef: React.RefObject<HTMLVideoElement>;
  isActive: boolean;
}
```

---

### TranscriptPanel

**ファイル:** `frontend/src/components/TranscriptPanel.tsx`

**Props:**
```typescript
interface TranscriptPanelProps {
  transcripts: TranscriptEntry[];
}
```

---

### SessionControls

**ファイル:** `frontend/src/components/SessionControls.tsx`

**Props:**
```typescript
interface SessionControlsProps {
  isSessionActive: boolean;
  isConnected: boolean;
  onToggleSession: () => void;
  onSnapshot: () => void;
}
```

---

### SnapshotGallery

**ファイル:** `frontend/src/components/SnapshotGallery.tsx`

**Props:**
```typescript
interface SnapshotGalleryProps {
  snapshots: Snapshot[];
}
```

---

## 5. AI エージェント仕様（Archie）

### 5.1 基本情報

| 属性 | 値 |
|------|-----|
| エージェント名 | archie |
| ペルソナ名 | Archie（アーチー） |
| モデル | `gemini-2.5-flash-native-audio-preview-12-2025` |
| 音声 | Aoede |
| 言語設定 | `ja-JP` |
| フレームワーク | Google ADK `Agent` |

### 5.2 ペルソナ設定

- **役割:** 20年以上の経験を持つシニアクラウドアーキテクト
- **トーン:** 落ち着いた、教授のような口調。デザインレビューにおける信頼できるテックリード
- **応答スタイル:** 簡潔に。詳しく聞かれない限り 2〜4 文で回答
- **視覚的なコメント:** 「なるほど」「見てみると」「これは〜のようですね」などの発話
- **変化への反応:** 図が変わったら、コメントする前に何が変わったかを確認

### 5.3 レビュー観点

以下の5観点でアーキテクチャを評価する:

| 観点 | 評価ポイント |
|------|-----------|
| **セキュリティ** | 認証・認可・暗号化・ネットワーク境界 |
| **スケーラビリティ** | 水平スケーリング・ボトルネック・ステートレス・キャッシュ |
| **信頼性** | 単一障害点・冗長性・フェイルオーバー・ヘルスチェック |
| **コスト** | 過剰プロビジョニング・マネージドvs自前運用・リザーブドvsオンデマンド |
| **運用** | オブザーバビリティ・ログ・CI/CD・ロールバック・インシデント対応 |

### 5.4 グラウンディングルール（ハルシネーション対策）

1. ホワイトボード上に**見えるコンポーネントと接続のみ**についてコメントする
2. 描かれていないコンポーネントについて推測しない
3. 不明瞭で読みにくい場合は、ユーザーに確認を求める
4. 技術選定について確信がない場合は、そう伝えてコンテキストを聞く
5. サービス名・APIエンドポイント・設定の詳細を捏造しない

### 5.5 ツール使用ポリシー

| ツール | 使用タイミング |
|--------|--------------|
| `save_whiteboard_snapshot` | ユーザーが保存を求めたとき、または議論の重要なマイルストーン時 |
| `save_review_note` | 重要な発見を記録するとき。適切にカテゴリ分けし、実行可能な推奨事項を提供 |

### 5.6 音声の振る舞い

- 温かく、落ち着いたペースで話す
- ポイント間で短い間をおいて明確にする
- 中断されたら（barge-in）、すぐに話すのをやめて聞く
- 質問に答えるときは、簡単な確認から始める
- **必ず日本語で会話する**

---

## 6. テスト・検証チェックリスト

### 6.1 機能検証

- [ ] F01: カメラ映像がホワイトボードを認識し、Archie がコメントする
- [ ] F02: マイクで話すと Archie が音声で応答する
- [ ] F03: Archie 発話中に話すと即座に停止する（barge-in）
- [ ] F04: Snapshot ボタンでスナップショットが保存される
- [ ] F05: レビューセッション後に Firestore にノートが保存される
- [ ] F06: セッション開始・停止が正常に動作する
- [ ] F07: 会話がリアルタイムにトランスクリプトに表示される

### 6.2 追加機能の実装確認（F08〜F10）

- [x] F08: GCS バケットにスナップショット画像が保存される
- [x] F08: Firestore の `image_url` に GCS URI が設定される
- [x] F09: `tool_call` イベントでレビューノートがリアルタイム表示される
- [x] F10: ツール実行時にトースト通知が表示される（5秒後に消える）

### 6.3 非機能検証

- [ ] ネットワーク切断後に自動再接続される
- [ ] Firestore 未設定でも音声会話が動作する（グレースフルデグレード）
- [ ] Cloud Storage 未設定でもスナップショット保存が失敗しない
- [ ] CORS設定が正しく動作する
