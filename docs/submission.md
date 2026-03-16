# Whiteboard Architect — Devpost Submission

## What it does

Whiteboard Architect is an AI-powered real-time architecture reviewer. Point your camera at a whiteboard (or paper, or upload an image), and the AI — "Archie," a senior cloud architect persona — watches your system design, listens to your explanations via microphone, and provides instant voice feedback on security vulnerabilities, scalability concerns, single points of failure, and best practices. You can interrupt Archie mid-sentence (barge-in) just like a real conversation.

The system also runs background structural analysis of your whiteboard using a separate Gemini model, automatically generates visual annotations highlighting issues and components, produces clean SVG diagrams from hand-drawn sketches, and provides bilingual transcripts (English + Japanese).

## How we built it

- **Gemini Live API** for bidirectional audio/video streaming — the backend maintains four parallel async tasks: upstream (client audio/video → Gemini), downstream (Gemini responses → client), recovery (session health monitoring), and perception (background whiteboard analysis).
- **Google ADK (Agent Development Kit)** to define the AI agent with tools (`save_whiteboard_snapshot`, `save_review_note`, `generate_diagram`) that persist findings to Firestore and whiteboard images to Cloud Storage.
- **Multi-model architecture** — Gemini 2.5 Flash Native Audio for live conversation, Gemini 3.1 Flash Lite for background analysis and English-to-Japanese translation, and Gemini 2.0 Flash for SVG diagram generation.
- **FastAPI + WebSocket** backend deployed on **Google Cloud Run**, handling real-time message routing between the Next.js frontend and Gemini Live API.
- **Next.js 16** frontend with custom React hooks for audio capture (AudioWorklet → PCM16 16kHz), audio playback (PCM 24kHz queue), and video capture (canvas → JPEG at 1fps).
- **Terraform** for infrastructure-as-code deployment of Cloud Run, Firestore, and Cloud Storage.

## Challenges we ran into

- **Live API tool/function calling bug** — The `-12-2025` variant of the native audio model triggers a 1008 WebSocket error when tools are invoked. We discovered and documented this, falling back to the `-09-2025` variant that supports tools reliably.
- **Audio synchronization** — Coordinating upstream audio/video with downstream AI audio required careful buffer management and backpressure control (skipping frames when WebSocket `bufferedAmount` exceeds 64KB).
- **Barge-in responsiveness** — Achieving sub-100ms interruption required a dual approach: server-side automatic activity detection (Gemini Live API) plus client-side RMS-based VAD to immediately stop AudioBufferSourceNodes.
- **Language quality** — The native audio model defaults to English and produces more natural responses that way. Rather than forcing Japanese (which degraded quality), we adopted an English-first approach with a translation service for bilingual display.
- **Background analysis coordination** — Running a separate perception model alongside the live conversation required careful state management to avoid interference while injecting analysis context naturally into the conversation.

## Accomplishments that we're proud of

- **Truly real-time multimodal interaction** — Audio, video, and text all stream bidirectionally with minimal latency, creating a natural conversation experience with an AI that can see.
- **Native barge-in** — Users can interrupt the AI mid-sentence and it immediately stops and listens, just like talking to a real person. No custom interruption logic was needed — ADK + Live API handle this natively.
- **Multi-model perception layer** — A separate analysis model continuously understands the whiteboard structure (components, connections, issues) and auto-generates visual annotations, while the conversation model handles natural dialogue.
- **Auto diagram generation** — Hand-drawn whiteboard sketches are converted to clean, professional SVG diagrams using a dedicated text model in 3-7 seconds.
- **Graceful degradation** — The app works without Firestore or Cloud Storage configured. Cloud services enhance persistence but are not required for the core voice + vision experience.
- **Structured review output** — Beyond voice feedback, Archie records findings as categorized, severity-rated review notes that users can reference after the session.

## What we learned

- **Bidirectional streaming architecture** — `LiveRequestQueue` is the key abstraction for sending mixed audio/video to Gemini while receiving responses simultaneously. Four async tasks (upstream + downstream + recovery + perception) running in parallel is the production-ready pattern.
- **ADK simplifies agent development** — The Agent Development Kit handles session management, tool execution, and Live API integration, letting us focus on the domain-specific agent persona and tools.
- **Multi-model is better than one** — Using different Gemini models for different tasks (conversation, analysis, translation, diagrams) provides better results than trying to do everything with a single model.
- **English-first with translation** — Native audio models produce more reliable responses in English. A translation layer provides better quality than forcing a non-English language in the system prompt.

## What's next

- **Multi-language support** — Extend beyond English/Japanese to support Korean, Chinese, and other languages with automatic detection.
- **Collaborative sessions** — Allow multiple users to join the same review session.
- **Export to documentation** — Generate architecture decision records (ADRs) from review notes.
- **Historical comparison** — Compare snapshots across sessions to track architectural evolution.
- **Voice selection** — Let users choose Archie's voice and persona characteristics.

## Built With

- Gemini Live API
- Gemini 3.1 Flash Lite
- Gemini 2.0 Flash
- Google ADK (Agent Development Kit)
- Google Cloud Run
- Google Cloud Firestore
- Google Cloud Storage
- Terraform
- FastAPI
- Next.js 16
- React 19
- TypeScript
- Tailwind CSS v4
- WebSocket
- AudioWorklet API
