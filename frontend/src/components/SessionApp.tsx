"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useWebSocket } from "@/hooks/useWebSocket";
import { useAudioCapture } from "@/hooks/useAudioCapture";
import { useAudioPlayback } from "@/hooks/useAudioPlayback";
import { useVideoCapture } from "@/hooks/useVideoCapture";
import { StatusBar } from "@/components/StatusBar";
import { CameraPreview } from "@/components/CameraPreview";
import { TranscriptPanel } from "@/components/TranscriptPanel";
import { ReviewNotesPanel } from "@/components/ReviewNotesPanel";
import { SessionControls } from "@/components/SessionControls";
import { SessionSummary } from "@/components/SessionSummary";
import { SnapshotGallery } from "@/components/SnapshotGallery";
import { SnapshotReviewView } from "@/components/SnapshotReviewView";
import { DiagramPanel } from "@/components/DiagramPanel";
import { WhiteboardAnalysisPanel } from "@/components/WhiteboardAnalysisPanel";
import { ImageUploadZone } from "@/components/ImageUploadZone";
import { ServerMessage, SessionMode, TranscriptEntry, Snapshot, ReviewNote, Annotation, AgentMood, AgentActivity, ErrorMessage, WhiteboardAnalysisMessage } from "@/lib/types";
import { ANNOTATION_EXPIRE_MS, TOAST_DISPLAY_MS, TRANSCRIPT_MERGE_WINDOW_MS, BARGE_IN_RESET_MS, MOOD_RESET_MS } from "@/lib/constants";

// Debounce must exceed TRANSCRIPT_MERGE_WINDOW_MS (2000ms) so that the
// "sealed" check (Date.now() - timestamp > mergeWindow) passes even for the
// last transcript entry.  Otherwise the final agent message is never translated.
const TRANSLATION_DEBOUNCE_MS = TRANSCRIPT_MERGE_WINDOW_MS + 500;

function generateId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

function buildWsUrl(userId: string, sessionId: string): string {
  if (typeof window === "undefined") return "";
  const baseWsUrl =
    process.env.NEXT_PUBLIC_WS_URL || `ws://${window.location.hostname}:8080/ws`;
  return `${baseWsUrl}/${userId}/${sessionId}`;
}

function getBackendBase(): string {
  if (typeof window === "undefined") return "";
  return process.env.NEXT_PUBLIC_BACKEND_URL || `http://${window.location.hostname}:8080`;
}

const SESSION_STORAGE_KEY = "wa_session_id";
const AGENT_OUTPUT_STALE_MS = 4000;

interface Toast {
  id: string;
  message: string;
  icon: "snapshot" | "note" | "info";
}

export function SessionApp() {
  const [isSessionActive, setIsSessionActive] = useState(false);
  const [transcripts, setTranscripts] = useState<TranscriptEntry[]>([]);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [reviewNotes, setReviewNotes] = useState<ReviewNote[]>([]);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [activeAnnotationId, setActiveAnnotationId] = useState<string | null>(null);
  const [agentMood, setAgentMood] = useState<AgentMood>("neutral");
  const [bargeInActive, setBargeInActive] = useState(false);
  const [showSummary, setShowSummary] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [apiNotice, setApiNotice] = useState<ErrorMessage | null>(null);
  const [apiError, setApiError] = useState<ErrorMessage | null>(null);
  const [isAgentThinking, setIsAgentThinking] = useState(false);
  const [isStartingSession, setIsStartingSession] = useState(false);
  const [sessionMode, setSessionMode] = useState<SessionMode>("live");
  const [viewMode, setViewMode] = useState<"live" | "snapshot-review">("live");
  const [selectedSnapshot, setSelectedSnapshot] = useState<Snapshot | null>(null);
  const [isGeneratingDiagram, setIsGeneratingDiagram] = useState(false);
  const [diagramUrl, setDiagramUrl] = useState<string | null>(null);
  const [diagramDescription, setDiagramDescription] = useState<string | null>(null);
  const [diagramError, setDiagramError] = useState<string | null>(null);
  const [whiteboardAnalysis, setWhiteboardAnalysis] = useState<WhiteboardAnalysisMessage | null>(null);
  const [userId] = useState(() => generateId());
  const [sessionId, setSessionId] = useState(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem(SESSION_STORAGE_KEY);
      if (stored) return stored;
    }
    const id = generateId();
    if (typeof window !== "undefined") {
      localStorage.setItem(SESSION_STORAGE_KEY, id);
    }
    return id;
  });
  const [wsUrl, setWsUrl] = useState("");

  const prevIsUserSpeakingRef = useRef(false);
  const reviewNotesRef = useRef(reviewNotes);
  const toastTimersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  const annotationTimersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  const bargeInTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const moodTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const agentOutputTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const viewModeRef = useRef<"live" | "snapshot-review">("live");
  const selectedSnapshotRef = useRef<Snapshot | null>(null);
  const prevConnectionStateRef = useRef<"disconnected" | "connecting" | "connected">("disconnected");

  // Persist sessionId to localStorage
  useEffect(() => {
    localStorage.setItem(SESSION_STORAGE_KEY, sessionId);
  }, [sessionId]);

  // Restore persisted snapshots from backend on mount / sessionId change
  useEffect(() => {
    const base = getBackendBase();
    if (!base) return;
    let cancelled = false;
    fetch(`${base}/api/sessions/${sessionId}/snapshots`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        if (cancelled) return;
        const loaded: Snapshot[] = ((data.snapshots as Record<string, unknown>[]) || []).map(
          (s) => ({
            id: String(s.snapshot_id ?? ""),
            url: `${base}${s.image_url}`,
            timestamp:
              typeof s.timestamp === "number"
                ? s.timestamp < 1e12
                  ? s.timestamp * 1000 // seconds → ms
                  : s.timestamp
                : Date.now(),
            label: (s.description as string) || undefined,
            origin: (s.origin as "camera" | "upload") || "camera",
          }),
        );
        if (loaded.length > 0) {
          setSnapshots(loaded);
        }
      })
      .catch(() => {
        // Backend may not be running yet — silently ignore
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  // Keep refs in sync for callback closures
  useEffect(() => {
    reviewNotesRef.current = reviewNotes;
  }, [reviewNotes]);
  useEffect(() => {
    viewModeRef.current = viewMode;
  }, [viewMode]);
  useEffect(() => {
    selectedSnapshotRef.current = selectedSnapshot;
  }, [selectedSnapshot]);

  // Cleanup all timers on unmount
  useEffect(() => {
    const toastTimers = toastTimersRef.current;
    const annotationTimers = annotationTimersRef.current;
    return () => {
      toastTimers.forEach(clearTimeout);
      annotationTimers.forEach(clearTimeout);
      if (bargeInTimerRef.current) clearTimeout(bargeInTimerRef.current);
      if (moodTimerRef.current) clearTimeout(moodTimerRef.current);
      if (agentOutputTimerRef.current) clearTimeout(agentOutputTimerRef.current);
    };
  }, []);

  const { isPlaying, playAudio, preparePlayback, stopPlayback, resetForNewTurn } = useAudioPlayback();

  // Ref mirror of isPlaying for use in AudioCapture's adaptive VAD.
  const isPlayingRef = useRef(false);
  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);
  const isAgentOutputActiveRef = useRef(false);

  const clearAgentOutputLock = useCallback(() => {
    isAgentOutputActiveRef.current = false;
    if (agentOutputTimerRef.current) {
      clearTimeout(agentOutputTimerRef.current);
      agentOutputTimerRef.current = null;
    }
  }, []);

  const markAgentOutputActive = useCallback(() => {
    isAgentOutputActiveRef.current = true;
    if (agentOutputTimerRef.current) {
      clearTimeout(agentOutputTimerRef.current);
    }
    agentOutputTimerRef.current = setTimeout(() => {
      if (!isPlayingRef.current) {
        isAgentOutputActiveRef.current = false;
      }
      agentOutputTimerRef.current = null;
    }, AGENT_OUTPUT_STALE_MS);
  }, []);

  // Track which agent turn is allowed to feed the playback queue.
  const activeAgentTurnIdRef = useRef<string | null>(null);
  const retiredTurnIdsRef = useRef<string[]>([]);
  const retiredTurnIdSetRef = useRef(new Set<string>());

  const retireTurn = useCallback((turnId?: string) => {
    if (!turnId || retiredTurnIdSetRef.current.has(turnId)) return;

    retiredTurnIdSetRef.current.add(turnId);
    retiredTurnIdsRef.current.push(turnId);
    if (retiredTurnIdsRef.current.length > 128) {
      const oldestTurnId = retiredTurnIdsRef.current.shift();
      if (oldestTurnId) {
        retiredTurnIdSetRef.current.delete(oldestTurnId);
      }
    }

    if (activeAgentTurnIdRef.current === turnId) {
      activeAgentTurnIdRef.current = null;
    }
  }, []);

  const resetTurnTracking = useCallback(() => {
    activeAgentTurnIdRef.current = null;
    retiredTurnIdsRef.current = [];
    retiredTurnIdSetRef.current.clear();
  }, []);

  const showToast = useCallback((message: string, icon: Toast["icon"] = "info") => {
    const id = generateId();
    setToasts((prev) => [...prev, { id, message, icon }]);
    const timer = setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
      toastTimersRef.current.delete(timer);
    }, TOAST_DISPLAY_MS);
    toastTimersRef.current.add(timer);
  }, []);

  const handleUiError = useCallback((error: ErrorMessage) => {
    clearAgentOutputLock();
    if (error.retryable) {
      setApiNotice(error);
      setIsStartingSession(false);
      showToast(error.message, "info");
      return;
    }
    setApiNotice(null);
    setApiError(error);
    setIsAgentThinking(false);
    setIsStartingSession(false);
  }, [clearAgentOutputLock, showToast]);

  const handleServerEvent = useCallback(
    (event: ServerMessage) => {
      if (event.type !== "error") {
        setApiNotice(null);
      }
      switch (event.type) {
        case "audio":
          markAgentOutputActive();
          if (event.turnId && retiredTurnIdSetRef.current.has(event.turnId)) {
            break;
          }

          if (event.turnId && event.turnId !== activeAgentTurnIdRef.current) {
            resetForNewTurn();
            activeAgentTurnIdRef.current = event.turnId;
          }
          playAudio(event.data);
          setIsAgentThinking(false);
          setIsStartingSession(false);
          break;

        case "transcript": {
          if (event.role === "agent") {
            markAgentOutputActive();
            setIsAgentThinking(false);
            setIsStartingSession(false);
          } else if (event.role === "user") {
            setIsAgentThinking(true);
          }
          const entry: TranscriptEntry = {
            id: generateId(),
            role: event.role,
            text: event.text,
            timestamp: Date.now(),
          };
          setTranscripts((prev) => {
            const last = prev[prev.length - 1];
            if (last && last.role === event.role && Date.now() - last.timestamp < TRANSCRIPT_MERGE_WINDOW_MS) {
              const updated = [...prev];
              updated[updated.length - 1] = {
                ...last,
                text: last.text + event.text,
                timestamp: Date.now(),
              };
              return updated;
            }
            return [...prev, entry];
          });
          break;
        }

        case "interrupted":
          clearAgentOutputLock();
          retireTurn(event.turnId);
          activeAgentTurnIdRef.current = null;
          stopPlayback();
          // Block any late-arriving chunks from the interrupted turn.
          setBargeInActive(true);
          if (bargeInTimerRef.current) clearTimeout(bargeInTimerRef.current);
          bargeInTimerRef.current = setTimeout(() => setBargeInActive(false), BARGE_IN_RESET_MS);
          break;

        case "turn_complete":
          clearAgentOutputLock();
          // We DO NOT call retireTurn() or clear activeAgentTurnIdRef here.
          // Gemini sometimes completes the turn on the backend but audio chunks
          // are still arriving. Retiring it here would drop the remainder of
          // Archie's speech, causing it to randomly cut off.
          setIsAgentThinking(false);
          break;

        case "tool_call":
          markAgentOutputActive();
          if (event.name === "save_whiteboard_snapshot") {
            showToast("スナップショットを保存しました", "snapshot");
          } else if (event.name === "save_review_note") {
            const r = event.result as {
              status: string;
              note_id: string;
              category: string;
              severity: string;
              finding: string;
              recommendation?: string;
            };
            if (r.status === "saved") {
              setReviewNotes((prev) => [
                ...prev,
                {
                  id: r.note_id,
                  category: r.category as ReviewNote["category"],
                  severity: r.severity as ReviewNote["severity"],
                  finding: r.finding,
                  recommendation: r.recommendation,
                  timestamp: Date.now(),
                },
              ]);
              showToast("レビューノートを記録しました", "note");
            }
          }
          break;

        case "annotation": {
          const ann: Annotation = {
            id: event.id,
            x: event.x,
            y: event.y,
            label: event.label,
            annotationType: event.annotationType,
            severity: event.severity,
            width: event.width,
            height: event.height,
            isSpeechLinked: event.isSpeechLinked,
            timestamp: Date.now(),
          };
          setAnnotations((prev) => {
            const filtered = prev.filter((a) => a.id !== ann.id);
            return [...filtered, ann];
          });
          if (ann.isSpeechLinked) {
            setActiveAnnotationId(ann.id);
          }
          const annTimer = setTimeout(() => {
            setAnnotations((prev) => prev.filter((a) => a.id !== ann.id));
            setActiveAnnotationId((prev) => (prev === ann.id ? null : prev));
            annotationTimersRef.current.delete(annTimer);
          }, ANNOTATION_EXPIRE_MS);
          annotationTimersRef.current.add(annTimer);
          break;
        }

        case "agent_state": {
          setAgentMood(event.mood);
          if (moodTimerRef.current) clearTimeout(moodTimerRef.current);
          moodTimerRef.current = setTimeout(() => setAgentMood("neutral"), MOOD_RESET_MS);
          break;
        }

        case "snapshot_saved": {
          const fullUrl = `${getBackendBase()}${event.url}`;

          setSnapshots((prev) => {
            // If a recent manual snapshot exists (no url yet), update it.
            // Sync the id to the backend-generated snapshot_id so that
            // review_snapshot can locate the file on disk.
            for (let i = prev.length - 1; i >= 0; i--) {
              if (!prev[i].url && Date.now() - prev[i].timestamp < 10000) {
                const updated = [...prev];
                updated[i] = { ...updated[i], id: event.id, url: fullUrl, label: event.description };
                return updated;
              }
            }
            // Agent-initiated snapshot — add new entry
            return [
              ...prev,
              {
                id: event.id,
                url: fullUrl,
                timestamp: Date.now(),
                label: event.description,
              },
            ];
          });

          // Sync selectedSnapshot if it references the same unsaved snapshot
          // (user clicked the snapshot before snapshot_saved arrived).
          // Uses the same heuristic: recent + no URL = the snapshot we just saved.
          setSelectedSnapshot((sel) =>
            sel && !sel.url && Date.now() - sel.timestamp < 10000
              ? { ...sel, id: event.id, url: fullUrl, label: event.description }
              : sel
          );
          break;
        }

        case "diagram_generating":
          setIsGeneratingDiagram(true);
          setDiagramUrl(null);
          setDiagramDescription(null);
          setDiagramError(null);
          showToast("図解を生成中です...", "info");
          break;

        case "diagram_generated": {
          const fullDiagramUrl = `${getBackendBase()}${event.url}`;
          setIsGeneratingDiagram(false);
          setDiagramUrl(fullDiagramUrl);
          setDiagramDescription(event.description || null);
          setDiagramError(null);
          showToast("図解を生成しました", "info");
          break;
        }

        case "diagram_error":
          setIsGeneratingDiagram(false);
          setDiagramError(event.message);
          break;

        case "whiteboard_analysis":
          if (event.error) {
            showToast(`分析エラー: ${event.error}`, "info");
          } else {
            setWhiteboardAnalysis(event);
          }
          break;

        case "error": {
          handleUiError(event);
          break;
        }
      }
    },
    [clearAgentOutputLock, handleUiError, markAgentOutputActive, playAudio, resetForNewTurn, retireTurn, showToast, stopPlayback]
  );

  // Fetch Japanese translations for finalized agent entries.
  // Uses a retry counter so that failed translations are re-attempted
  // even when `transcripts` itself hasn't changed.
  const translatingIdsRef = useRef<Set<string>>(new Set());
  const [translationRetry, setTranslationRetry] = useState(0);
  useEffect(() => {
    const timer = setTimeout(() => {
      const untranslated = transcripts.filter(
        (e) =>
          e.role === "agent" &&
          !e.translation &&
          !translatingIdsRef.current.has(e.id)
      );
      // Only translate entries that are "sealed" (not the last entry if it may still be merged)
      const last = transcripts[transcripts.length - 1];
      const toTranslate = untranslated.filter(
        (e) => e.id !== last?.id || (Date.now() - e.timestamp > TRANSCRIPT_MERGE_WINDOW_MS)
      );
      for (const entry of toTranslate) {
        translatingIdsRef.current.add(entry.id);
        const base = getBackendBase();
        fetch(`${base}/api/translate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: entry.text }),
        })
          .then((res) => (res.ok ? res.json() : null))
          .then((data) => {
            if (data?.translation) {
              setTranscripts((prev) =>
                prev.map((t) =>
                  t.id === entry.id ? { ...t, translation: data.translation } : t
                )
              );
            } else {
              setTranslationRetry((n) => n + 1);
            }
          })
          .catch(() => {
            setTranslationRetry((n) => n + 1);
          })
          .finally(() => {
            translatingIdsRef.current.delete(entry.id);
          });
      }
    }, TRANSLATION_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [transcripts, translationRetry]);

  const { connectionState, sendJson, connect, disconnect } = useWebSocket({
    url: wsUrl,
    onEvent: handleServerEvent,
    onConnectionIssue: handleUiError,
    onOpen: () => {
      setApiNotice(null);
      setIsStartingSession(false);
    },
  });

  useEffect(() => {
    const wasConnected = prevConnectionStateRef.current === "connected";
    prevConnectionStateRef.current = connectionState;

    if (connectionState !== "connected" || !isSessionActive) {
      return;
    }

    if (!wasConnected && viewModeRef.current === "snapshot-review" && selectedSnapshotRef.current) {
      const snapshot = selectedSnapshotRef.current;
      sendJson({
        type: "control",
        action: "review_snapshot",
        snapshotId: snapshot.id,
        origin: snapshot.origin ?? "camera",
      });
    }
  }, [connectionState, isSessionActive, sendJson]);

  // Gate video frames: skip sending to Gemini while in snapshot-review mode
  const sendJsonWithVideoGate = useCallback((data: object) => {
    if (viewModeRef.current === "snapshot-review" && (data as { type?: string }).type === "video") {
      return;
    }
    sendJson(data);
  }, [sendJson]);

  const {
    isUserSpeaking,
    startCapture: startAudio,
    stopCapture: stopAudio,
  } = useAudioCapture({
    sendJson,
    isAgentPlayingRef: isPlayingRef,
    isAgentTurnActiveRef: isAgentOutputActiveRef,
  });

  const {
    videoRef,
    isCapturing: isVideoCapturing,
    startCapture: startVideo,
    stopCapture: stopVideo,
    pauseCapture: pauseVideo,
    resumeCapture: resumeVideo,
    takeSnapshot,
  } = useVideoCapture({ sendJson: sendJsonWithVideoGate });

  // Barge-in: playback is still stopped only after the server sends an
  // "interrupted" event. Local VAD is used upstream only to suppress echo
  // leakage while the agent is talking, not to hard-stop playback on-device.
  useEffect(() => {
    prevIsUserSpeakingRef.current = isUserSpeaking;
  }, [isUserSpeaking]);

  const agentActivity: AgentActivity = useMemo(() => {
    if (!isSessionActive || connectionState !== "connected") return "idle";
    if (isPlaying) return "speaking";
    if (isAgentThinking) return "analyzing";
    if (isUserSpeaking) return "listening";
    return "idle";
  }, [isSessionActive, connectionState, isPlaying, isAgentThinking, isUserSpeaking]);

  const handleToggleSession = useCallback(async () => {
    if (isSessionActive) {
      clearAgentOutputLock();
      resetTurnTracking();
      stopAudio();
      stopVideo();
      disconnect();
      setIsSessionActive(false);
      setIsAgentThinking(false);
      setIsStartingSession(false);
      setIsGeneratingDiagram(false);
      setViewMode("live");
      setSelectedSnapshot(null);
      setMediaError(null);
      setApiNotice(null);
      setApiError(null);
      if (reviewNotesRef.current.length > 0) {
        setShowSummary(true);
      }
    } else {
      clearAgentOutputLock();
      resetTurnTracking();
      // Reuse persisted sessionId — snapshots accumulate across start/stop cycles
      setTranscripts([]);
      setReviewNotes([]);
      setAnnotations([]);
      // NOTE: snapshots are NOT cleared — they persist
      setShowSummary(false);
      setViewMode("live");
      setSelectedSnapshot(null);
      setMediaError(null);
      setApiNotice(null);
      setApiError(null);
      setIsStartingSession(true);

      const url = buildWsUrl(userId, sessionId);
      setWsUrl(url);

      try {
        await preparePlayback();
        if (sessionMode === "live") {
          await startVideo();
        }
        await startAudio();
        setIsSessionActive(true);
      } catch (err) {
        const message =
          err instanceof DOMException && err.name === "NotAllowedError"
            ? sessionMode === "live"
              ? "カメラ・マイクのアクセスが拒否されました。ブラウザの設定から許可してください。"
              : "マイクのアクセスが拒否されました。ブラウザの設定から許可してください。"
            : sessionMode === "live"
              ? "カメラ・マイクの起動に失敗しました。デバイスが接続されているか確認してください。"
              : "マイクの起動に失敗しました。デバイスが接続されているか確認してください。";
        setMediaError(message);
        setIsStartingSession(false);
      }
    }
  }, [clearAgentOutputLock, disconnect, isSessionActive, preparePlayback, resetTurnTracking, sessionId, sessionMode, startAudio, startVideo, stopAudio, stopVideo, userId]);

  // Connect WebSocket when URL changes
  useEffect(() => {
    if (wsUrl && isSessionActive) {
      connect();
    }
  }, [wsUrl, isSessionActive, connect]);

  const handleNewSession = useCallback(() => {
    clearAgentOutputLock();
    resetTurnTracking();
    const newId = generateId();
    setSessionId(newId);
    setSnapshots([]);
    setTranscripts([]);
    setReviewNotes([]);
    setAnnotations([]);
    setShowSummary(false);
    setViewMode("live");
    setSelectedSnapshot(null);
    setApiNotice(null);
    setApiError(null);
  }, [clearAgentOutputLock, resetTurnTracking]);

  const handleSnapshot = useCallback(() => {
    const dataUrl = takeSnapshot();
    if (dataUrl) {
      const snap: Snapshot = {
        id: generateId(),
        dataUrl,
        timestamp: Date.now(),
      };
      setSnapshots((prev) => [...prev, snap]);
      sendJson({ type: "control", action: "save_snapshot" });
    }
  }, [takeSnapshot, sendJson]);

  const handleDeleteSnapshot = useCallback((id: string) => {
    setSnapshots((prev) => prev.filter((s) => s.id !== id));

    const base = getBackendBase();
    if (base) {
      fetch(`${base}/api/snapshots/${sessionId}/${id}`, { method: "DELETE" }).catch(() => {
        // Backend may not be running — silently ignore
      });
    }

    // If the deleted snapshot is currently being reviewed, go back
    if (selectedSnapshot?.id === id) {
      setViewMode("live");
      setSelectedSnapshot(null);
      setAnnotations([]);
      if (isSessionActive) {
        if (sessionMode === "live") {
          resumeVideo();
        }
        sendJson({ type: "control", action: "back_to_live" });
      }
    }
  }, [sessionId, selectedSnapshot?.id, isSessionActive, sessionMode, resumeVideo, sendJson]);

  const handleSelectSnapshot = useCallback((snapshot: Snapshot) => {
    setSelectedSnapshot(snapshot);
    setViewMode("snapshot-review");
    setAnnotations([]);
    if (sessionMode === "live") {
      pauseVideo();
    }
    if (isSessionActive) {
      sendJson({
        type: "control",
        action: "review_snapshot",
        snapshotId: snapshot.id,
        origin: snapshot.origin ?? "camera",
      });
    }
  }, [isSessionActive, sessionMode, pauseVideo, sendJson]);

  const handleUploadImage = useCallback(async (file: File) => {
    const base = getBackendBase();
    if (!base) return;

    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch(`${base}/api/sessions/${sessionId}/upload`, {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        const detail = await res.text();
        showToast(`アップロード失敗: ${detail}`, "info");
        return;
      }
      const data = await res.json();
      const snap: Snapshot = {
        id: String(data.snapshot_id),
        url: `${base}${data.image_url}`,
        timestamp: Date.now(),
        label: "アップロード画像",
        origin: "upload",
      };
      setSnapshots((prev) => [...prev, snap]);
      showToast("画像をアップロードしました", "snapshot");

      // Auto-select for review if session is active
      if (isSessionActive) {
        setSelectedSnapshot(snap);
        setViewMode("snapshot-review");
        setAnnotations([]);
        if (sessionMode === "live") {
          pauseVideo();
        }
        sendJson({
          type: "control",
          action: "review_snapshot",
          snapshotId: snap.id,
          origin: "upload",
        });
      }
    } catch {
      showToast("アップロードに失敗しました", "info");
    }
  }, [isSessionActive, sessionMode, pauseVideo, sendJson, sessionId, showToast]);

  const handleBackToLive = useCallback(() => {
    setViewMode("live");
    setSelectedSnapshot(null);
    setAnnotations([]);
    if (isSessionActive) {
      if (sessionMode === "live") {
        resumeVideo();
      }
      sendJson({ type: "control", action: "back_to_live" });
    }
  }, [isSessionActive, sessionMode, resumeVideo, sendJson]);

  const handleGenerateDiagram = useCallback(() => {
    setIsGeneratingDiagram(true);
    setDiagramUrl(null);
    setDiagramDescription(null);
    setDiagramError(null);
    sendJson({ type: "control", action: "generate_diagram" });
  }, [sendJson]);

  const handleCloseDiagram = useCallback(() => {
    setIsGeneratingDiagram(false);
    setDiagramUrl(null);
    setDiagramDescription(null);
    setDiagramError(null);
  }, []);

  return (
    <div className="flex flex-col h-screen bg-[var(--background)] text-[var(--foreground)]">
      <StatusBar
        connectionState={connectionState}
        isAgentSpeaking={isPlaying}
        isUserSpeaking={isUserSpeaking}
        sessionId={isSessionActive ? sessionId : null}
        agentMood={agentMood}
        bargeInActive={bargeInActive}
        annotationCount={annotations.length}
        analysisComponentCount={whiteboardAnalysis?.components?.length ?? 0}
        agentActivity={agentActivity}
      />

      <main className="flex flex-col lg:flex-row flex-1 overflow-hidden">
        {/* Left panel: Camera / Snapshot Review / Upload Zone */}
        <div className="relative w-full lg:w-3/5 p-3 flex items-center justify-center lg:border-r border-b lg:border-b-0 border-[var(--border-subtle)] shrink-0 lg:shrink">
          {viewMode === "snapshot-review" && selectedSnapshot ? (
            <SnapshotReviewView
              snapshot={selectedSnapshot}
              annotations={annotations}
              activeAnnotationId={activeAnnotationId}
              sessionMode={sessionMode}
              onClose={sessionMode === "live" ? handleBackToLive : () => {
                setSelectedSnapshot(null);
                setViewMode("live");
                setAnnotations([]);
              }}
            />
          ) : sessionMode === "snapshot" ? (
            <ImageUploadZone
              onUpload={handleUploadImage}
              isSessionActive={isSessionActive}
            />
          ) : (
            <CameraPreview
              videoRef={videoRef}
              isActive={isSessionActive && isVideoCapturing}
              annotations={annotations}
              activeAnnotationId={activeAnnotationId}
              bargeInActive={bargeInActive}
              agentActivity={agentActivity}
            />
          )}
          <DiagramPanel
            diagramUrl={diagramUrl}
            diagramDescription={diagramDescription}
            errorMessage={diagramError}
            isGenerating={isGeneratingDiagram}
            onClose={handleCloseDiagram}
          />
        </div>

        {/* Right panel: Transcript + ReviewNotes */}
        <div className="w-full lg:w-2/5 flex flex-col bg-[var(--background-secondary)] min-h-0 flex-1 lg:flex-auto">
          <TranscriptPanel
            transcripts={transcripts}
            activeAnnotationId={activeAnnotationId}
            isSessionActive={isSessionActive}
            connectionState={connectionState}
            isAgentThinking={isAgentThinking}
            viewMode={viewMode}
          />
          <WhiteboardAnalysisPanel analysis={whiteboardAnalysis} />
          <ReviewNotesPanel notes={reviewNotes} />
        </div>
      </main>

      {/* Media error banner */}
      {mediaError && (
        <div
          className="flex items-center gap-3 px-4 py-3 bg-[var(--destructive)]/10 border-t border-[var(--destructive)]/20"
          role="alert"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--destructive)] flex-shrink-0" aria-hidden="true">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" x2="12" y1="8" y2="12"/>
            <line x1="12" x2="12.01" y1="16" y2="16"/>
          </svg>
          <p className="text-sm text-[var(--destructive)]">{mediaError}</p>
          <button
            onClick={() => setMediaError(null)}
            className="ml-auto text-[var(--foreground-subtle)] hover:text-[var(--foreground)] transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
            aria-label="エラーメッセージを閉じる"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="18" x2="6" y1="6" y2="18"/>
              <line x1="6" x2="18" y1="6" y2="18"/>
            </svg>
          </button>
        </div>
      )}

      {apiNotice && !apiError && (
        <div
          className="flex items-center gap-3 px-4 py-3 bg-amber-500/10 border-t border-amber-500/20"
          role="alert"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-amber-600 flex-shrink-0" aria-hidden="true">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
            <line x1="12" x2="12" y1="9" y2="13"/>
            <line x1="12" x2="12.01" y1="17" y2="17"/>
          </svg>
          <div className="min-w-0">
            <p className="text-sm text-amber-700 dark:text-amber-300 break-words">
              {apiNotice.message}
            </p>
            <p className="text-xs text-amber-700/80 dark:text-amber-300/80 mt-0.5">
              自動復旧を試みています。復旧しない場合は再接続してください。
            </p>
          </div>
          <button
            onClick={() => setApiNotice(null)}
            className="ml-auto text-[var(--foreground-subtle)] hover:text-[var(--foreground)] transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
            aria-label="接続エラー通知を閉じる"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <line x1="18" x2="6" y1="6" y2="18"/>
              <line x1="6" x2="18" y1="6" y2="18"/>
            </svg>
          </button>
        </div>
      )}

      {/* Toast notifications */}
      <div
        className="fixed bottom-20 sm:bottom-24 right-3 sm:right-4 flex flex-col gap-2 z-50 pointer-events-none"
        aria-live="polite"
        aria-atomic="false"
        role="status"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className="flex items-center gap-2.5 glass border border-[var(--border)] rounded-xl px-4 py-2.5 text-sm text-[var(--foreground)] shadow-lg animate-slide-in-right"
          >
            {t.icon === "snapshot" && (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--accent)] flex-shrink-0" aria-hidden="true">
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                <circle cx="12" cy="13" r="4"/>
              </svg>
            )}
            {t.icon === "note" && (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--info)] flex-shrink-0" aria-hidden="true">
                <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/>
                <polyline points="14 2 14 8 20 8"/>
              </svg>
            )}
            {t.icon === "info" && (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--foreground-muted)] flex-shrink-0" aria-hidden="true">
                <circle cx="12" cy="12" r="10"/>
                <path d="M12 16v-4"/><path d="M12 8h.01"/>
              </svg>
            )}
            {t.message}
          </div>
        ))}
      </div>

      <SessionControls
        isSessionActive={isSessionActive}
        isStartingSession={isStartingSession}
        connectionState={connectionState}
        hasSnapshots={snapshots.length > 0}
        viewMode={viewMode}
        sessionMode={sessionMode}
        isGeneratingDiagram={isGeneratingDiagram}
        onToggleSession={handleToggleSession}
        onSnapshot={handleSnapshot}
        onNewSession={handleNewSession}
        onBackToLive={handleBackToLive}
        onGenerateDiagram={handleGenerateDiagram}
        onSessionModeChange={setSessionMode}
      />

      <SnapshotGallery snapshots={snapshots} onDelete={handleDeleteSnapshot} onSelect={handleSelectSnapshot} onUpload={handleUploadImage} selectedId={selectedSnapshot?.id} />

      {/* API Error Dialog */}
      {apiError && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="接続エラー"
          className="fixed inset-0 z-[100] flex items-center justify-center bg-[var(--overlay)] backdrop-blur-sm animate-fade-in"
        >
          <article className="relative bg-[var(--surface)] border border-[var(--border)] rounded-2xl shadow-2xl max-w-md w-[calc(100%-2rem)] p-6">
            <header className="flex items-start gap-3 mb-4">
              <div className="flex-shrink-0 w-10 h-10 rounded-full bg-[var(--surface-hover)] flex items-center justify-center">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--destructive)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                  <line x1="12" x2="12" y1="9" y2="13"/>
                  <line x1="12" x2="12.01" y1="17" y2="17"/>
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="text-base font-semibold text-[var(--foreground)]">
                  接続エラー
                </h2>
                {apiError.code && apiError.code !== "UNKNOWN" && (
                  <span className="inline-block mt-1 px-2 py-0.5 text-xs font-mono rounded bg-[var(--surface-hover)] text-[var(--destructive)] border border-[var(--border)]">
                    Error {apiError.code}
                  </span>
                )}
              </div>
            </header>
            <p className="text-sm text-[var(--foreground-muted)] leading-relaxed mb-5 break-words">
              {apiError.message}
            </p>
            <footer className="flex gap-3 justify-end">
              <button
                onClick={() => {
                  setApiError(null);
                  handleToggleSession();
                }}
                className="px-4 py-2 text-sm rounded-[var(--radius-md)] bg-[var(--surface-hover)] text-[var(--foreground)] hover:bg-[var(--surface-active)] transition-colors"
              >
                セッションを終了
              </button>
              <button
                onClick={() => {
                  setApiError(null);
                  disconnect();
                  setTimeout(() => connect(), 500);
                }}
                className="px-4 py-2 text-sm rounded-[var(--radius-md)] bg-[var(--accent)] text-[var(--on-accent)] hover:bg-[var(--accent-hover)] transition-colors"
              >
                再接続
              </button>
            </footer>
          </article>
        </div>
      )}

      {showSummary && (
        <SessionSummary
          notes={reviewNotes}
          snapshots={snapshots}
          onDeleteSnapshot={handleDeleteSnapshot}
          onClose={() => setShowSummary(false)}
        />
      )}
    </div>
  );
}
