# Whiteboard Architect

> Real-time AI architecture reviewer powered by Gemini Live API

**Category**: Live Agents | **Hackathon**: [Gemini Live Agent Challenge](https://geminiliveagentchallenge.devpost.com/)

---

## The Problem

Whiteboard architecture sessions are foundational to software development, but they often lack immediate expert review. Design flaws, security gaps, and scalability issues may go unnoticed until much later in the development cycle -- when fixing them is far more expensive.

## The Solution

**Whiteboard Architect** brings an AI senior architect named **Archie** to every whiteboard session. It **sees** your diagrams through the camera, **listens** to your explanations, and **responds** with real-time voice feedback -- like having an expert colleague looking over your shoulder.

---

## Key Features

| Feature | Description |
|---|---|
| **Real-time Vision Analysis** | Continuously monitors the whiteboard through the camera, understanding diagrams as they are drawn |
| **Natural Voice Conversation** | Talk naturally about your architectural decisions -- no typing required |
| **Barge-in Support** | Interrupt the AI mid-sentence, just like talking to a real person |
| **5-Axis Architecture Review** | Instant feedback on Security, Scalability, Reliability, Cost, and Operations |
| **Visual Annotations** | AI highlights specific areas on the whiteboard with circles, arrows, rectangles, and labels |
| **Background Analysis** | Periodic deep analysis of the whiteboard via Gemini 3.1 Flash Lite for proactive insights |
| **Auto Diagram Generation** | Converts hand-drawn whiteboard sketches into clean, professional SVG diagrams |
| **Bilingual Transcript** | Agent speaks English; transcripts displayed in both English and Japanese |
| **Review Notes** | Findings are automatically recorded with severity levels and actionable recommendations |
| **Snapshot History** | Key whiteboard states are saved as timestamped snapshots with image upload support |
| **Session Summary** | Radar chart visualization + Markdown export of the full review |

---

## Architecture

![Architecture Diagram](./docs/architecture-diagram.svg)

<details>
<summary>Text-based architecture overview</summary>

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
  |     +-- recovery_task   : Session health monitoring
  |     +-- perception_task : WhiteboardAnalyzer (Gemini 3.1 Flash Lite)
  +-- ADK Runner
  |     +-- agent.py: architect_agent ("Archie")
  |           +-- tools: save_whiteboard_snapshot, save_review_note,
  |                      generate_diagram
  +-- DiagramService    : SVG generation (Gemini 2.0 Flash)
  +-- TranslationService: English --> Japanese translation
  +-- GET /health
  +-- GET /api/sessions/{id}/notes
  +-- GET /api/sessions/{id}/snapshots
  +-- GET /api/snapshots/{session_id}/{snapshot_id}.jpg
  +-- POST /api/sessions/{id}/upload
  +-- DELETE /api/snapshots/{session_id}/{snapshot_id}

Google Cloud
  +-- Cloud Run     : Backend + Frontend hosting (session affinity)
  +-- Firestore     : sessions/{id}/snapshots, sessions/{id}/notes
  +-- Cloud Storage : {bucket}/{session_id}/snapshots/{timestamp}.jpg
```
</details>

Additional diagrams are available in the [`docs/`](./docs/) directory:

- [Data Flow Diagram](./docs/data-flow.svg) -- End-to-end data flow with format details
- [Sequence Diagram](./docs/data-flow-sequence.svg) -- Message-level interaction flow (session start, conversation, barge-in, tool calls, change detection)
- [Deployment Pipeline](./docs/deployment-pipeline.svg) -- 6-phase deploy.sh pipeline with Terraform resources

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 16 (React 19), Tailwind CSS v4 |
| Backend | Python 3.11+ (FastAPI, Uvicorn) |
| AI Agent Framework | Google ADK (Agent Development Kit) |
| AI Model (Live) | Gemini 2.5 Flash Native Audio (Live API) |
| AI Model (Analysis) | Gemini 3.1 Flash Lite (Standard API) |
| AI Model (Diagrams) | Gemini 2.0 Flash (Text) |
| AI Model (Translation) | Gemini 3.1 Flash Lite |
| Database | Google Cloud Firestore |
| Object Storage | Google Cloud Storage |
| Streaming Protocol | WebSocket (bidirectional) |
| Hosting | Google Cloud Run |
| Infrastructure | Terraform (IaC) |
| Containerization | Docker, Docker Compose |

---

## Prerequisites

- **Python** 3.11+
- **Node.js** 18+
- **Docker** and **Docker Compose** (recommended)
- A **Gemini API key** from [Google AI Studio](https://aistudio.google.com/)
- (Optional for cloud features) A **Google Cloud Project** with billing enabled

---

## Quick Start

### 1. Clone the repository

```bash
git clone https://github.com/buddypia/whiteboard-architect.git
cd whiteboard-architect
```

### 2. Set up environment variables

```bash
cp .env.example .env
# Edit .env -- at minimum, set GOOGLE_API_KEY
```

### 3. Start with Docker Compose (recommended)

```bash
docker-compose up --build
```

### 4. Or start services individually

**Option A: Both services from root**

```bash
npm install && npm run dev
```

**Option B: Start each service separately**

```bash
# Terminal 1 - Backend
cd backend
pip install -r requirements.txt
python main.py
# --> http://localhost:8080

# Terminal 2 - Frontend
cd frontend
npm install
npm run dev
# --> http://localhost:3000
```

### 5. Open the app

Navigate to `http://localhost:3000` in your browser. Allow camera and microphone access when prompted. Point your camera at a whiteboard and start talking about your architecture!

---

## Runtime Notes

- This project uses the Gemini API via `GOOGLE_API_KEY`; Vertex AI is not required.
- The live audio model is pinned to `gemini-2.5-flash-native-audio-preview-09-2025`.
- On startup, the backend probes configured model candidates and automatically excludes variants that fail the Live API + tool-calling path.
- Firestore and Cloud Storage are optional -- the app degrades gracefully without them (snapshots and notes are stored in-memory only).
- The agent speaks English; a translation service provides Japanese translations for bilingual transcript display.

---

## Cloud Deployment

### Automated deployment with Terraform (recommended)

```bash
cd infra/terraform
cp terraform.tfvars.example terraform.tfvars  # Set your project_id and region
terraform init
terraform apply
```

### Automated deployment with deploy.sh

```bash
./deploy.sh --project YOUR_PROJECT_ID --region us-central1
```

This runs a 6-phase pipeline: Setup --> Infrastructure --> Backend Build --> Backend Deploy --> Frontend Build --> Frontend Deploy.

### Manual deployment

```bash
# Deploy backend to Cloud Run
cd backend
gcloud run deploy whiteboard-architect-backend \
  --source . \
  --region us-central1 \
  --allow-unauthenticated
```

---

## Usage

1. **Set up your whiteboard** -- Place a physical whiteboard, paper, or tablet in front of your camera.
2. **Start a session** -- Click "Start Session" to begin camera and microphone capture.
3. **Draw and talk** -- Sketch your system architecture while explaining your design decisions.
4. **Get feedback** -- Archie analyzes your diagram in real-time and provides voice feedback on:
   - Security vulnerabilities
   - Scalability concerns
   - Single points of failure
   - Cost optimization opportunities
   - Operational best practices
5. **Visual annotations** -- The system automatically highlights specific areas on your whiteboard with visual markers based on background analysis.
6. **Generate diagrams** -- Ask Archie to generate a clean diagram from your whiteboard sketch into a professional SVG.
7. **Upload images** -- Upload existing architecture diagrams for review instead of using the camera.
8. **Review notes** -- Check the Review Notes panel for structured findings with severity levels.
9. **Export** -- End the session to get a summary with radar chart and Markdown export.

---

## Project Structure

```
whiteboard-architect/
+-- README.md                    # This file (English)
+-- README.ja.md                 # Japanese README
+-- CLAUDE.md                    # AI development context
+-- docker-compose.yml           # Local development setup
+-- package.json                 # Root scripts (concurrent dev)
+-- deploy.sh                    # 6-phase deployment script
|
+-- frontend/                    # Next.js frontend application
|   +-- src/
|   |   +-- app/                 # Next.js App Router
|   |   +-- components/          # React components (14 files)
|   |   |   +-- SessionApp.tsx   #   Main orchestrator
|   |   |   +-- CameraPreview.tsx#   Camera + annotation overlay
|   |   |   +-- TranscriptPanel  #   Bilingual conversation transcript
|   |   |   +-- ReviewNotesPanel #   Categorized review notes
|   |   |   +-- DiagramPanel.tsx #   Generated diagram display (PiP + modal)
|   |   |   +-- WhiteboardAnalysisPanel  # Structured analysis display
|   |   |   +-- SessionSummary   #   Radar chart + export
|   |   |   +-- SnapshotGallery  #   Snapshot thumbnails
|   |   |   +-- SnapshotReviewView #  Single snapshot detailed review
|   |   |   +-- AnnotationOverlay#   SVG annotation rendering
|   |   |   +-- ImageUploadZone  #   Image upload UI
|   |   |   +-- RadarChart       #   Review summary radar chart
|   |   +-- hooks/               # Custom React hooks (5 files)
|   |   |   +-- useWebSocket     #   WS + exponential backoff
|   |   |   +-- useAudioCapture  #   AudioWorklet PCM16 16kHz
|   |   |   +-- useAudioPlayback #   Gapless PCM + barge-in
|   |   |   +-- useVideoCapture  #   JPEG capture @ 1fps
|   |   |   +-- useReducedMotion #   prefers-reduced-motion
|   |   +-- lib/                 # Utilities and types
|   +-- public/
|   +-- Dockerfile
|
+-- backend/                     # Python backend service
|   +-- main.py                  # FastAPI + WebSocket server
|   +-- agent.py                 # ADK agent definition (Archie)
|   +-- config.py                # Environment configuration
|   +-- whiteboard_state.py      # Structured analysis data models
|   +-- image_context.py         # Image state management
|   +-- tools/
|   |   +-- architect_tools.py   # 3 ADK tools (+ 1 auto-generated)
|   +-- services/
|   |   +-- firestore_service.py # Firestore persistence
|   |   +-- storage_service.py   # GCS snapshot storage
|   |   +-- diagram_service.py   # SVG diagram generation
|   |   +-- whiteboard_analyzer.py # Background analysis (Perception Layer)
|   |   +-- translation_service.py # English to Japanese translation
|   |   +-- live_model_service.py  # Model availability probing
|   +-- Dockerfile
|
+-- infra/                       # Infrastructure as Code
|   +-- terraform/
|       +-- main.tf              # All GCP resources
|       +-- variables.tf
|       +-- outputs.tf
|
+-- docs/                        # Documentation and diagrams
    +-- architecture-diagram.svg # System architecture
    +-- data-flow.svg            # Data flow diagram
    +-- data-flow-sequence.svg   # Sequence diagram
    +-- deployment-pipeline.svg  # Deployment pipeline
    +-- specification.md         # Technical specification
    +-- developer-guide.md       # Developer onboarding guide
    +-- feature-definition.md    # Feature definitions
    +-- submission.md            # Devpost submission text
```

---

## WebSocket Protocol

### Client --> Server (`ClientMessage`)

| Type | Payload | Description |
|---|---|---|
| `audio` | `{type: "audio", data: "<base64>"}` | PCM16 16kHz microphone audio |
| `video` | `{type: "video", data: "<base64>"}` | JPEG camera frame (1fps) |
| `text` | `{type: "text", text: "..."}` | Text input |
| `control` | `{type: "control", action: "..."}` | Control commands: `save_snapshot`, `generate_diagram`, `review_snapshot`, `back_to_live` |

### Server --> Client (`ServerMessage`)

| Type | Payload | Description |
|---|---|---|
| `audio` | `{type: "audio", data: "<base64>"}` | PCM 24kHz AI voice |
| `transcript` | `{type: "transcript", role, text}` | Speech-to-text (role: user/agent/thought) |
| `interrupted` | `{type: "interrupted"}` | Barge-in detected |
| `turn_complete` | `{type: "turn_complete"}` | AI finished speaking |
| `tool_call` | `{type: "tool_call", name, result}` | Tool execution result |
| `annotation` | `{type: "annotation", id, x, y, ...}` | Visual marker (30s auto-expire) |
| `agent_state` | `{type: "agent_state", mood, trigger}` | Agent emotional state |
| `snapshot_saved` | `{type: "snapshot_saved", ...}` | Snapshot save confirmation |
| `diagram_generating` | `{type: "diagram_generating", diagram_id}` | Diagram generation started |
| `diagram_generated` | `{type: "diagram_generated", diagram_id, url}` | Diagram ready |
| `diagram_error` | `{type: "diagram_error", ...}` | Diagram generation failed |
| `whiteboard_analysis` | `{type: "whiteboard_analysis", ...}` | Structured analysis result |
| `error` | `{type: "error", message}` | Error notification |

---

## Reproducible Testing (for Judges)

Follow these steps to test Whiteboard Architect end-to-end on your local machine.

### Prerequisites

| Requirement | Version | Check command |
|---|---|---|
| Docker + Docker Compose | Any recent version | `docker --version && docker compose version` |
| Gemini API Key | -- | Get one free at [Google AI Studio](https://aistudio.google.com/) |
| Webcam + Microphone | -- | Built-in or external; browser will request permission |
| Modern browser | Chrome/Edge recommended | Required for AudioWorklet + WebSocket |

> **Note**: No Google Cloud project is required for local testing. Firestore and Cloud Storage degrade gracefully -- the app works fully with just a Gemini API key.

### Step-by-step setup

```bash
# 1. Clone the repository
git clone https://github.com/buddypia/whiteboard-architect.git
cd whiteboard-architect

# 2. Configure environment
cp .env.example .env
# Edit .env and set GOOGLE_API_KEY to your Gemini API key:
#   GOOGLE_API_KEY=AIza...

# 3. Start both services (backend :8080, frontend :3000)
docker-compose up --build
```

Wait until you see logs like:
```
backend-1   | INFO: Uvicorn running on http://0.0.0.0:8080
frontend-1  | Ready in Xs
```

### Verify the backend is running

```bash
curl http://localhost:8080/health
# Expected: {"status":"healthy","model":"gemini-2.5-flash-native-audio-preview-09-2025",...}
```

### Test the full experience

1. Open **http://localhost:3000** in Chrome/Edge.
2. **Allow camera and microphone** when prompted by the browser.
3. Click **"Start Session"** to begin.
4. **Point your camera at a whiteboard** (or any architecture diagram on paper/screen).
5. **Talk to Archie**: Describe your architecture. For example:
   - *"This is a three-tier web application with a React frontend, Node.js API, and PostgreSQL database."*
   - *"Can you review the security of this design?"*
6. **Observe real-time behavior**:
   - Archie responds with voice feedback (audio plays through your speaker).
   - Transcripts appear in the right panel (English + Japanese translation).
   - Visual annotations (circles, arrows, labels) appear on the camera overlay.
   - The Whiteboard Analysis panel shows detected components and connections.
7. **Test barge-in**: Start speaking while Archie is talking -- the AI immediately stops and listens.
8. **Test tools**:
   - Say *"Save a snapshot of the current whiteboard"* -- a snapshot appears in the gallery.
   - Say *"Generate a clean diagram from this"* -- an SVG diagram is generated (takes 3-7s).
   - Review notes are automatically created and shown in the Review Notes panel.
9. **Upload an image**: Use the upload zone to review a pre-existing architecture diagram instead of using the camera.
10. **End the session**: Click "Stop" to see the Session Summary with radar chart and Markdown export.

### Alternative: run without Docker

```bash
# Terminal 1 - Backend
cd backend
pip install -r requirements.txt
python main.py        # --> http://localhost:8080

# Terminal 2 - Frontend
cd frontend
npm install
npm run dev           # --> http://localhost:3000
```

### What to expect

| Feature | What you'll see |
|---|---|
| Voice conversation | Real-time audio responses from Archie (English) |
| Camera analysis | Annotations overlaid on the camera preview |
| Barge-in | Interrupting Archie mid-sentence works naturally |
| Transcript | Bilingual (English original + Japanese translation) in the right panel |
| Review Notes | Structured findings with severity badges (critical/warning/info/positive) |
| Diagram generation | Clean SVG diagram in a floating PiP thumbnail (click to expand) |
| Whiteboard Analysis | Component/connection/issue detection in the analysis panel |
| Snapshot gallery | Saved whiteboard states as thumbnails |
| Session summary | Radar chart + Markdown export at session end |

### Troubleshooting

| Issue | Solution |
|---|---|
| No audio from Archie | Check browser audio permissions; ensure speakers/headphones are connected |
| Camera not detected | Check browser camera permissions; try a different browser |
| WebSocket disconnects | Refresh the page; the app auto-reconnects with exponential backoff |
| `health` endpoint shows error | Verify `GOOGLE_API_KEY` is set correctly in `.env` |
| Docker build fails | Ensure Docker daemon is running; try `docker-compose down && docker-compose up --build` |

---

## Lessons Learned

- **Bidirectional streaming with Gemini Live API** -- Implementing bidi-streaming of audio, video, and text over WebSocket required careful design with four parallel async tasks: upstream (client --> Gemini), downstream (Gemini --> client), recovery (session health monitoring), and perception (background analysis). Using `LiveRequestQueue` was key to seamlessly multiplexing audio and video frames while receiving AI responses in real-time.

- **Native barge-in with ADK** -- The combination of Google ADK and Live API provides native barge-in support without custom code. When the user starts speaking, the AI's audio output is automatically interrupted and an `interrupted` event is sent to the client. On the frontend, immediately clearing the AudioContext buffer delivers a natural interruption experience.

- **Multi-model architecture** -- Using different Gemini models for different tasks (Live API for conversation, 3.1 Flash Lite for analysis/translation, 2.0 Flash for diagram generation) provided the best balance of capability, speed, and cost.

- **English-first with translation** -- The native audio model produces more reliable and natural responses in English. A translation service provides Japanese translations for bilingual display, offering better quality than forcing Japanese in the system prompt.

- **Graceful degradation** -- Cloud services (Firestore, GCS) are designed to be optional. The app checks availability at startup and falls back to in-memory storage, enabling fully functional local development without any cloud credentials beyond the Gemini API key.

---

## Built With

- **[Gemini Live API](https://ai.google.dev/gemini-api/docs/live)** -- Real-time bidirectional streaming with vision, audio, and function calling
- **[Google ADK](https://google.github.io/adk-docs)** -- Agent Development Kit for building AI agents with tools
- **[Google Cloud Run](https://cloud.google.com/run)** -- Serverless container hosting with session affinity
- **[Cloud Firestore](https://cloud.google.com/firestore)** -- NoSQL database for session history
- **[Cloud Storage](https://cloud.google.com/storage)** -- Object storage for whiteboard snapshots
- **[Next.js](https://nextjs.org/)** -- React framework for the frontend
- **[Terraform](https://www.terraform.io/)** -- Infrastructure as Code for automated provisioning

---

## License

MIT

---

Built for the [Gemini Live Agent Challenge](https://geminiliveagentchallenge.devpost.com/). #GeminiLiveAgentChallenge
