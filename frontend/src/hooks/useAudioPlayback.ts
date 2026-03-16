"use client";

import { useCallback, useRef, useState } from "react";
import { PLAYBACK_SAMPLE_RATE } from "@/lib/constants";
import { base64ToArrayBuffer, int16ToFloat32 } from "@/lib/audio-utils";

// If the scheduled playback head (`nextStartTimeRef`) is more than this many
// seconds ahead of `ctx.currentTime`, we assume the queue built up while the
// tab was backgrounded (AudioContext suspended → currentTime frozen) and reset
// the timeline to avoid a burst of catch-up audio on tab return.
const MAX_SCHEDULE_AHEAD_S = 5;

// Grace period (ms) before declaring playback ended.  Bridges small gaps
// between consecutive audio chunks so `isPlaying` doesn't oscillate
// true→false→true and cause UI flicker / VAD threshold instability.
// 400ms is sufficient to bridge normal inter-chunk gaps while allowing
// the user to speak sooner after the agent finishes (shorter blackout).
const PLAYBACK_END_GRACE_MS = 400;

export function useAudioPlayback() {
  const [isPlaying, setIsPlaying] = useState(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef(0);
  const activeSourcesRef = useRef(new Set<AudioBufferSourceNode>());
  const generationRef = useRef(0);
  const isPlayingRef = useRef(false);
  const playbackEndTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasPrimedContextRef = useRef(false);

  const getOrCreateAudioContext = useCallback(() => {
    let ctx = audioContextRef.current;
    if (!ctx || ctx.state === "closed") {
      ctx = new AudioContext({ sampleRate: PLAYBACK_SAMPLE_RATE });
      audioContextRef.current = ctx;
      hasPrimedContextRef.current = false;
    }
    return ctx;
  }, []);

  const preparePlayback = useCallback(async () => {
    const ctx = getOrCreateAudioContext();

    if (ctx.state === "suspended") {
      await ctx.resume();
    }

    if (!hasPrimedContextRef.current) {
      // Prime the output graph during a user gesture so later streaming
      // chunks are not blocked by browser autoplay policies.
      const silentBuffer = ctx.createBuffer(1, 1, PLAYBACK_SAMPLE_RATE);
      const source = ctx.createBufferSource();
      source.buffer = silentBuffer;
      source.connect(ctx.destination);
      source.start();
      hasPrimedContextRef.current = true;
    }

    return ctx;
  }, [getOrCreateAudioContext]);

  /** Return (or lazily create) an AudioContext, resuming it if suspended. */
  const ensureAudioContext = useCallback(() => {
    const ctx = getOrCreateAudioContext();
    // Browsers may suspend a context created outside a user-gesture or when
    // the tab is backgrounded.  Calling resume() is safe even if already
    // running and returns a resolved promise in that case.
    if (ctx.state === "suspended") {
      void ctx.resume().catch((err) => {
        console.warn("useAudioPlayback: failed to resume AudioContext", err);
      });
    }
    return ctx;
  }, [getOrCreateAudioContext]);

  /**
   * Decode incoming base64 PCM16 data and schedule it for gapless playback.
   *
   * Each chunk is turned into an AudioBufferSourceNode and scheduled to start
   * exactly when the previous chunk ends (`nextStartTimeRef`).  If the
   * previous chunk already finished (the ref is in the past), the new chunk
   * starts at `ctx.currentTime` so there is no unnecessary silence.
   */
  const playAudio = useCallback(
    (base64Data: string) => {
      try {
        const ctx = ensureAudioContext();

        const arrayBuffer = base64ToArrayBuffer(base64Data);
        // PCM16 = 2 bytes per sample.  Reject buffers that are too small or
        // have an odd byte count (which would crash the Int16Array constructor).
        if (arrayBuffer.byteLength < 2 || arrayBuffer.byteLength % 2 !== 0) {
          return;
        }

        const int16Array = new Int16Array(arrayBuffer);
        const float32Array = int16ToFloat32(int16Array);
        if (float32Array.length === 0) return;

        const audioBuffer = ctx.createBuffer(
          1,
          float32Array.length,
          PLAYBACK_SAMPLE_RATE,
        );
        audioBuffer.copyToChannel(
          float32Array as Float32Array<ArrayBuffer>,
          0,
        );

        const source = ctx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(ctx.destination);

        // Schedule seamlessly after the last scheduled chunk.
        const now = ctx.currentTime;

        // Guard: if the tab was backgrounded the scheduling head may have
        // drifted far into the future (audio kept arriving while currentTime
        // was frozen).  Reset to "now" to avoid a burst of catch-up audio.
        if (nextStartTimeRef.current - now > MAX_SCHEDULE_AHEAD_S) {
          nextStartTimeRef.current = now;
        }

        const startTime = Math.max(now, nextStartTimeRef.current);
        source.start(startTime);
        nextStartTimeRef.current = startTime + audioBuffer.duration;

        const gen = generationRef.current;
        activeSourcesRef.current.add(source);

        if (!isPlayingRef.current) {
          // Cancel any pending "end of playback" timer — a new chunk arrived.
          if (playbackEndTimerRef.current) {
            clearTimeout(playbackEndTimerRef.current);
            playbackEndTimerRef.current = null;
          }
          isPlayingRef.current = true;
          setIsPlaying(true);
        }

        source.onended = () => {
          activeSourcesRef.current.delete(source);
          // Only flip the flag if this generation is still current (guards
          // against stale onended callbacks firing after a stopPlayback).
          if (
            gen === generationRef.current &&
            activeSourcesRef.current.size === 0
          ) {
            // Debounce: wait a short grace period before declaring playback
            // ended, so brief gaps between streaming chunks don't cause
            // isPlaying to oscillate and trigger UI flicker / VAD instability.
            playbackEndTimerRef.current = setTimeout(() => {
              playbackEndTimerRef.current = null;
              if (
                activeSourcesRef.current.size === 0 &&
                gen === generationRef.current
              ) {
                isPlayingRef.current = false;
                setIsPlaying(false);
              }
            }, PLAYBACK_END_GRACE_MS);
          }
        };
      } catch (err) {
        // Catch decoding / Web Audio errors so a single corrupt chunk does not
        // break the WebSocket message loop and kill the entire session.
        console.warn("useAudioPlayback: failed to play chunk", err);
      }
    },
    [ensureAudioContext],
  );

  /** Immediately stop all scheduled audio (barge-in). */
  const stopPlayback = useCallback(() => {
    generationRef.current++;

    if (playbackEndTimerRef.current) {
      clearTimeout(playbackEndTimerRef.current);
      playbackEndTimerRef.current = null;
    }

    for (const source of activeSourcesRef.current) {
      try {
        source.stop();
      } catch {
        // source may have already ended naturally
      }
    }
    activeSourcesRef.current.clear();
    nextStartTimeRef.current = 0;
    isPlayingRef.current = false;
    setIsPlaying(false);
  }, []);

  /**
   * Reset playback for a new turn.  Stops all currently scheduled audio
   * and resets the timeline so the very next chunk (belonging to the new
   * turn) starts immediately.
   *
   * Use this when the first audio chunk of a new turn arrives while audio
   * from the previous turn may still be queued / playing.
   */
  const resetForNewTurn = useCallback(() => {
    generationRef.current++;
    if (playbackEndTimerRef.current) {
      clearTimeout(playbackEndTimerRef.current);
      playbackEndTimerRef.current = null;
    }
    for (const source of activeSourcesRef.current) {
      try {
        source.stop();
      } catch {
        // source may have already ended naturally
      }
    }
    activeSourcesRef.current.clear();
    nextStartTimeRef.current = 0;
    isPlayingRef.current = false;
    setIsPlaying(false);
  }, []);

  return { isPlaying, playAudio, preparePlayback, stopPlayback, resetForNewTurn };
}
