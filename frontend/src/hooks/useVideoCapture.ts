"use client";

import { useCallback, useRef, useState } from "react";
import { VIDEO_FPS, VIDEO_WIDTH, VIDEO_HEIGHT, JPEG_QUALITY } from "@/lib/constants";
import { VideoMessage } from "@/lib/types";

interface UseVideoCaptureOptions {
  sendJson: (data: object) => void;
}

export function useVideoCapture({ sendJson }: UseVideoCaptureOptions) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const streamRef = useRef<MediaStream | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const getCanvas = useCallback(() => {
    if (!canvasRef.current) {
      canvasRef.current = document.createElement("canvas");
      canvasRef.current.width = VIDEO_WIDTH;
      canvasRef.current.height = VIDEO_HEIGHT;
    }
    return canvasRef.current;
  }, []);

  const captureFrame = useCallback((): string | null => {
    const video = videoRef.current;
    if (!video || video.readyState < 2) return null;

    const canvas = getCanvas();
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    // Replicate object-cover: crop the source video to the canvas aspect ratio
    // so the JPEG sent to Gemini matches what the user sees in the browser.
    // Without this, a 16:9 camera would be stretched to 4:3, making AI
    // annotation coordinates misalign with the displayed video.
    const vw = video.videoWidth || VIDEO_WIDTH;
    const vh = video.videoHeight || VIDEO_HEIGHT;
    const canvasAspect = VIDEO_WIDTH / VIDEO_HEIGHT;
    const videoAspect = vw / vh;

    let sx: number, sy: number, sw: number, sh: number;
    if (videoAspect > canvasAspect) {
      // Video is wider — crop left/right
      sh = vh;
      sw = vh * canvasAspect;
      sx = (vw - sw) / 2;
      sy = 0;
    } else {
      // Video is taller — crop top/bottom
      sw = vw;
      sh = vw / canvasAspect;
      sx = 0;
      sy = (vh - sh) / 2;
    }

    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, VIDEO_WIDTH, VIDEO_HEIGHT);
    return canvas.toDataURL("image/jpeg", JPEG_QUALITY);
  }, [getCanvas]);

  const startCapture = useCallback(async () => {
    if (isCapturing) return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: VIDEO_WIDTH },
          height: { ideal: VIDEO_HEIGHT },
          facingMode: "environment",
        },
      });
      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      intervalRef.current = setInterval(() => {
        const dataUrl = captureFrame();
        if (dataUrl) {
          // Strip data URL prefix to get raw base64
          const base64 = dataUrl.split(",")[1];
          const message: VideoMessage = {
            type: "video",
            data: base64,
          };
          sendJson(message);
        }
      }, 1000 / VIDEO_FPS);

      setIsCapturing(true);
    } catch (err) {
      console.error("Failed to start video capture:", err);
      throw err;
    }
  }, [isCapturing, captureFrame, sendJson]);

  const stopCapture = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setIsCapturing(false);
  }, []);

  const pauseCapture = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getVideoTracks().forEach((track) => {
        track.enabled = false;
      });
    }
  }, []);

  const resumeCapture = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getVideoTracks().forEach((track) => {
        track.enabled = true;
      });
    }
    if (!intervalRef.current && streamRef.current) {
      intervalRef.current = setInterval(() => {
        const dataUrl = captureFrame();
        if (dataUrl) {
          const base64 = dataUrl.split(",")[1];
          const message: VideoMessage = {
            type: "video",
            data: base64,
          };
          sendJson(message);
        }
      }, 1000 / VIDEO_FPS);
    }
  }, [captureFrame, sendJson]);

  const takeSnapshot = useCallback((): string | null => {
    return captureFrame();
  }, [captureFrame]);

  return { videoRef, isCapturing, startCapture, stopCapture, pauseCapture, resumeCapture, takeSnapshot };
}
