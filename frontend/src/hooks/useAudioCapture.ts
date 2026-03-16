"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MIC_SAMPLE_RATE } from "@/lib/constants";
import { float32ToInt16, arrayBufferToBase64, computeRms } from "@/lib/audio-utils";
import { AudioMessage } from "@/lib/types";

const VAD_RMS_THRESHOLD = 0.015;
// During agent playback, use a higher threshold to reject residual echo
// that survives the browser's built-in echo cancellation.
const VAD_RMS_THRESHOLD_DURING_PLAYBACK = 0.04;
// Consecutive frames above threshold to declare speech onset (~384ms at 2048 samples / 16kHz)
const VAD_ONSET_FRAMES = 3;
// During playback, require 6 consecutive frames (~768ms) above threshold to
// confirm real user speech vs echo.  This is stricter than idle (3 frames)
// to prevent false barge-in from residual echo, while still allowing natural
// interruption — the preroll buffer captures audio from before confirmation.
const VAD_ONSET_FRAMES_DURING_PLAYBACK = 6;
// Consecutive frames below threshold to declare speech offset (~768ms hangover)
const VAD_OFFSET_FRAMES = 6;
// Rolling buffer during agent playback: captures audio preceding barge-in
// confirmation so Gemini receives the full beginning of the user's
// interruption.  10 frames ≈ 1280ms of context before onset.
const PLAYBACK_PREROLL_FRAMES = 10;

interface UseAudioCaptureOptions {
  sendJson: (data: object) => void;
  /** When true, VAD uses stricter thresholds to prevent echo from
   *  triggering false speech detection during agent audio playback. */
  isAgentPlayingRef?: { readonly current: boolean };
  /** When true, the agent is still in an active response turn (even if
   *  audio is temporarily paused for thinking).  VAD keeps strict
   *  thresholds as long as this is true to prevent ambient noise from
   *  triggering Gemini's barge-in during thinking pauses. */
  isAgentTurnActiveRef?: { readonly current: boolean };
}

export function useAudioCapture({
  sendJson,
  isAgentPlayingRef,
  isAgentTurnActiveRef,
}: UseAudioCaptureOptions) {
  const [isCapturing, setIsCapturing] = useState(false);
  const [isUserSpeaking, setIsUserSpeaking] = useState(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const vadOnsetCountRef = useRef(0);
  const vadOffsetCountRef = useRef(0);
  const isUserSpeakingRef = useRef(false);
  const wasAgentPlayingRef = useRef(false);
  const agentPlayingStoppedAtRef = useRef(0);
  const wasEffectiveAgentPlayingRef = useRef(false);
  const playbackPrerollRef = useRef<string[]>([]);
  const isForwardingDuringPlaybackRef = useRef(false);
  const sendJsonRef = useRef(sendJson);

  useEffect(() => {
    sendJsonRef.current = sendJson;
  }, [sendJson]);

  const startCapture = useCallback(async () => {
    if (isCapturing) return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: MIC_SAMPLE_RATE,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      streamRef.current = stream;

      const audioContext = new AudioContext({ sampleRate: MIC_SAMPLE_RATE });
      audioContextRef.current = audioContext;

      await audioContext.audioWorklet.addModule("/pcm-capture-processor.js");

      const source = audioContext.createMediaStreamSource(stream);
      sourceRef.current = source;

      const workletNode = new AudioWorkletNode(audioContext, "pcm-capture-processor");
      workletNodeRef.current = workletNode;

      workletNode.port.onmessage = (event: MessageEvent<Float32Array>) => {
        const float32Data = event.data;

        const rms = computeRms(float32Data);

        // Adaptive VAD: use stricter thresholds during agent audio playback
        // to prevent speaker echo from being misdetected as user speech.
        const currentlyPlaying = isAgentPlayingRef?.current ?? false;
        if (!currentlyPlaying && wasAgentPlayingRef.current) {
          agentPlayingStoppedAtRef.current = Date.now();
        }
        wasAgentPlayingRef.current = currentlyPlaying;

        // Keep strict VAD thresholds when:
        // 1. Audio is currently playing (echo rejection), OR
        // 2. Agent is in an active turn but paused for thinking (prevents
        //    ambient noise from triggering Gemini's barge-in during pauses), OR
        // 3. Within 300ms after playback stops (residual echo decay)
        const agentTurnActive = isAgentTurnActiveRef?.current ?? false;
        const effectiveAgentPlaying = currentlyPlaying || agentTurnActive || (Date.now() - agentPlayingStoppedAtRef.current < 300);

        if (effectiveAgentPlaying !== wasEffectiveAgentPlayingRef.current) {
          wasEffectiveAgentPlayingRef.current = effectiveAgentPlaying;
          vadOnsetCountRef.current = 0;
          if (effectiveAgentPlaying) {
            playbackPrerollRef.current = [];
            isForwardingDuringPlaybackRef.current = false;
          }
        }
        
        const rmsThreshold = effectiveAgentPlaying ? VAD_RMS_THRESHOLD_DURING_PLAYBACK : VAD_RMS_THRESHOLD;
        const onsetFrames = effectiveAgentPlaying ? VAD_ONSET_FRAMES_DURING_PLAYBACK : VAD_ONSET_FRAMES;
        let speechStartedThisFrame = false;
        let speechEndedThisFrame = false;

        if (rms > rmsThreshold) {
          vadOnsetCountRef.current++;
          vadOffsetCountRef.current = 0;
          if (!isUserSpeakingRef.current && vadOnsetCountRef.current >= onsetFrames) {
            isUserSpeakingRef.current = true;
            speechStartedThisFrame = true;
            setIsUserSpeaking(true);
          }
        } else {
          vadOffsetCountRef.current++;
          vadOnsetCountRef.current = 0;
          if (isUserSpeakingRef.current && vadOffsetCountRef.current >= VAD_OFFSET_FRAMES) {
            isUserSpeakingRef.current = false;
            speechEndedThisFrame = true;
            setIsUserSpeaking(false);
          }
        }

        const int16Data = float32ToInt16(float32Data);
        const base64 = arrayBufferToBase64(int16Data.buffer as ArrayBuffer);

        const message: AudioMessage = {
          type: "audio",
          data: base64,
        };

        // When agent is not playing, send audio directly
        if (!effectiveAgentPlaying) {
          playbackPrerollRef.current = [];
          isForwardingDuringPlaybackRef.current = false;
          sendJsonRef.current(message);
          return;
        }

        // During agent playback: buffer frames and forward on barge-in
        if (isForwardingDuringPlaybackRef.current) {
          sendJsonRef.current(message);
          if (speechEndedThisFrame) {
            isForwardingDuringPlaybackRef.current = false;
            playbackPrerollRef.current = [];
          }
          return;
        }

        playbackPrerollRef.current.push(base64);
        if (playbackPrerollRef.current.length > PLAYBACK_PREROLL_FRAMES) {
          playbackPrerollRef.current.shift();
        }

        if (!speechStartedThisFrame) {
          return;
        }

        // Notify the backend that a real barge-in is starting so it
        // opens the audio gate (it blocks ambient noise by default
        // during agent response to prevent Gemini's false interrupts).
        sendJsonRef.current({ type: "control", action: "barge_in" });

        isForwardingDuringPlaybackRef.current = true;
        const prerollFrames = playbackPrerollRef.current;
        playbackPrerollRef.current = [];
        for (const frame of prerollFrames) {
          sendJsonRef.current({
            type: "audio",
            data: frame,
          } satisfies AudioMessage);
        }
      };

      source.connect(workletNode);
      workletNode.connect(audioContext.destination);

      setIsCapturing(true);
    } catch (err) {
      console.error("Failed to start audio capture:", err);
      throw err;
    }
  }, [isAgentPlayingRef, isAgentTurnActiveRef, isCapturing]);

  const stopCapture = useCallback(() => {
    if (workletNodeRef.current) {
      workletNodeRef.current.disconnect();
      workletNodeRef.current = null;
    }
    if (sourceRef.current) {
      sourceRef.current.disconnect();
      sourceRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    vadOnsetCountRef.current = 0;
    vadOffsetCountRef.current = 0;
    isUserSpeakingRef.current = false;
    wasAgentPlayingRef.current = false;
    wasEffectiveAgentPlayingRef.current = false;
    playbackPrerollRef.current = [];
    isForwardingDuringPlaybackRef.current = false;
    setIsCapturing(false);
    setIsUserSpeaking(false);
  }, []);

  return { isCapturing, isUserSpeaking, startCapture, stopCapture };
}
