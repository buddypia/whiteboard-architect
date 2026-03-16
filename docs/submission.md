# Whiteboard Architect — Devpost Submission

## What it does

Whiteboard Architect is an AI-powered real-time architecture reviewer. Point your camera at a whiteboard (or paper), and the AI — "Archie," a senior cloud architect persona — watches your system design, listens to your explanations via microphone, and provides instant voice feedback on security vulnerabilities, scalability concerns, single points of failure, and best practices. You can interrupt Archie mid-sentence (barge-in) just like a real conversation.

## How we built it

- **Gemini Live API** for bidirectional audio/video streaming — the backend maintains two parallel async tasks: an upstream task (client audio/video → Gemini) and a downstream task (Gemini responses → client).
- **Google ADK (Agent Development Kit)** to define the AI agent with tools (`save_whiteboard_snapshot`, `save_review_note`) that persist findings to Firestore and whiteboard images to Cloud Storage.
- **FastAPI + WebSocket** backend deployed on **Google Cloud Run**, handling real-time message routing between the Next.js frontend and Gemini Live API.
- **Next.js** frontend with custom React hooks for audio capture (AudioWorklet → PCM16 16kHz), audio playback (PCM 24kHz queue), and video capture (canvas → JPEG at 1fps).
- **Terraform** for infrastructure-as-code deployment of Cloud Run, Firestore, and Cloud Storage.

## Challenges we ran into

- **Live API tool/function calling bug** — The `-12-2025` variant of the native audio model triggers a 1008 WebSocket error when tools are invoked. We discovered and documented this, falling back to the `-09-2025` variant that supports tools reliably.
- **Audio synchronization** — Coordinating upstream audio/video with downstream AI audio required careful buffer management and backpressure control (skipping frames when WebSocket `bufferedAmount` exceeds 64KB).
- **Barge-in responsiveness** — Achieving sub-100ms interruption required a dual approach: server-side automatic activity detection (Gemini Live API) plus client-side RMS-based VAD to immediately stop AudioBufferSourceNodes.
- **Language control** — The native audio model defaults to English even with Japanese audio input; explicit system prompt instructions were needed to maintain consistent Japanese responses.

## Accomplishments that we're proud of

- **Truly real-time multimodal interaction** — Audio, video, and text all stream bidirectionally with minimal latency, creating a natural conversation experience with an AI that can see.
- **Native barge-in** — Users can interrupt the AI mid-sentence and it immediately stops and listens, just like talking to a real person. No custom interruption logic was needed — ADK + Live API handle this natively.
- **Graceful degradation** — The app works without Firestore or Cloud Storage configured. Cloud services enhance persistence but are not required for the core voice + vision experience.
- **Structured review output** — Beyond voice feedback, Archie records findings as categorized, severity-rated review notes that users can reference after the session.

## What we learned

- **Bidirectional streaming architecture** — `LiveRequestQueue` is the key abstraction for sending mixed audio/video to Gemini while receiving responses simultaneously. Two async tasks (upstream + downstream) running in parallel is the canonical pattern.
- **ADK simplifies agent development** — The Agent Development Kit handles session management, tool execution, and Live API integration, letting us focus on the domain-specific agent persona and tools.
- **Native audio models need explicit language guidance** — Even when the user speaks Japanese, the model may respond in English without explicit language instructions in the system prompt.

## What's next

- **Multi-language support** — Extend beyond Japanese to support English, Korean, and other languages with automatic detection.
- **Collaborative sessions** — Allow multiple users to join the same review session.
- **Export to documentation** — Generate architecture decision records (ADRs) from review notes.
- **Diagram digitization** — Convert whiteboard sketches into structured diagram formats (Mermaid, draw.io).
- **Historical comparison** — Compare snapshots across sessions to track architectural evolution.

## Built With

- Gemini Live API
- Google ADK (Agent Development Kit)
- Google Cloud Run
- Google Cloud Firestore
- Google Cloud Storage
- Terraform
- FastAPI
- Next.js
- React
- TypeScript
- WebSocket
- AudioWorklet API
