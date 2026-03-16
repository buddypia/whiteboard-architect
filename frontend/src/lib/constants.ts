export const MIC_SAMPLE_RATE = 16000;
export const PLAYBACK_SAMPLE_RATE = 24000;
export const VIDEO_FPS = 1;
export const VIDEO_WIDTH = 640;
export const VIDEO_HEIGHT = 480;
export const JPEG_QUALITY = 0.7;
export const WS_RECONNECT_MAX_DELAY = 30000;
export const AUDIO_WORKLET_BUFFER_SIZE = 2048;
export const BACKPRESSURE_THRESHOLD = 262144; // 256KB — allows ~2.4s of buffering
export const ANNOTATION_EXPIRE_MS = 30000;

// UI timing constants (extracted from SessionApp.tsx for long-term maintainability)
export const TOAST_DISPLAY_MS = 5000;
export const TRANSCRIPT_MERGE_WINDOW_MS = 2000;
export const BARGE_IN_RESET_MS = 1500;
export const MOOD_RESET_MS = 8000;
