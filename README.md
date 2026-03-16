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
| **Background Analysis** | Periodic deep analysis of the whiteboard via Gemini 3 Flash for proactive insights |
| **Auto Diagram Generation** | Converts hand-drawn whiteboard sketches into clean, professional technical diagrams |
| **Review Notes** | Findings are automatically recorded with severity levels and actionable recommendations |
| **Snapshot History** | Key whiteboard states are saved as timestamped snapshots |
| **Session Summary** | Radar chart visualization + Markdown export of the full review |

---

## Architecture

![Architecture Diagram](./docs/architecture-diagram.svg)

<details>
<summary>Text-based architecture overview</summary>

```
Frontend (Next.js :3000)
  +-- useWebSocket      --> ws://backend/ws/{userId}/{sessionId}
  +-- useAudioCapture   --> PCM16 16kHz --> base64 --> WS
  +-- useVideoCapture   --> JPEG 1fps --> base64 --> WS
  +-- useAudioPlayback  <-- PCM 24kHz <-- WS

Backend (FastAPI + Google ADK :8080)
  +-- WS /ws/{user_id}/{session_id}
  |     +-- upstream_task   : WS --> LiveRequestQueue --> Gemini Live API
  |     +-- downstream_task : Gemini Live API --> WS
  |     +-- WhiteboardAnalyzer : Periodic deep analysis (Gemini 3 Flash)
  +-- ADK Runner
  |     +-- agent.py: architect_agent ("Archie")
  |           +-- tools: save_whiteboard_snapshot, save_review_note,
  |                      add_annotation, generate_diagram
  +-- GET /health
  +-- GET /api/sessions/{id}/notes
  +-- GET /api/sessions/{id}/snapshots

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
| Frontend | Next.js 15 (React 19), Tailwind CSS v4 |
| Backend | Python 3.11+ (FastAPI, Uvicorn) |
| AI Agent Framework | Google ADK (Agent Development Kit) |
| AI Model | Gemini 2.5 Flash Native Audio (Live API) |
| Background Analysis | Gemini 3 Flash Preview |
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
5. **Visual annotations** -- Archie highlights specific areas on your whiteboard with visual markers.
6. **Generate diagrams** -- Ask Archie to "clean up" or "diagram" your whiteboard sketch into a professional technical diagram.
7. **Review notes** -- Check the Review Notes panel for structured findings with severity levels.
8. **Export** -- End the session to get a summary with radar chart and Markdown export.

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
|   |   +-- components/          # React components
|   |   |   +-- SessionApp.tsx   #   Main orchestrator
|   |   |   +-- CameraPreview.tsx#   Camera + annotation overlay
|   |   |   +-- TranscriptPanel  #   Conversation transcript
|   |   |   +-- ReviewNotesPanel #   Categorized review notes
|   |   |   +-- DiagramPanel.tsx #   Generated diagram display
|   |   |   +-- SessionSummary   #   Radar chart + export
|   |   +-- hooks/               # Custom React hooks
|   |   |   +-- useWebSocket     #   WS + exponential backoff
|   |   |   +-- useAudioCapture  #   AudioWorklet PCM16 16kHz
|   |   |   +-- useAudioPlayback #   Gapless PCM + barge-in
|   |   |   +-- useVideoCapture  #   JPEG capture @ 1fps
|   |   +-- lib/                 # Utilities and types
|   +-- public/
|   +-- Dockerfile
|
+-- backend/                     # Python backend service
|   +-- main.py                  # FastAPI + WebSocket server
|   +-- agent.py                 # ADK agent definition (Archie)
|   +-- config.py                # Environment configuration
|   +-- tools/
|   |   +-- architect_tools.py   # 4 ADK tools
|   +-- services/
|   |   +-- firestore_service.py # Firestore persistence
|   |   +-- storage_service.py   # GCS snapshot storage
|   |   +-- diagram_service.py   # Diagram generation
|   |   +-- whiteboard_analyzer.py # Background analysis
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
```

---

## WebSocket Protocol

### Client --> Server (`ClientMessage`)

| Type | Payload | Description |
|---|---|---|
| `audio` | `{type: "audio", data: "<base64>"}` | PCM16 16kHz microphone audio |
| `video` | `{type: "video", data: "<base64>"}` | JPEG camera frame (1fps) |
| `text` | `{type: "text", text: "..."}` | Text input |
| `control` | `{type: "control", action: "save_snapshot"}` | Control commands |

### Server --> Client (`ServerMessage`)

| Type | Payload | Description |
|---|---|---|
| `audio` | `{type: "audio", data: "<base64>"}` | PCM 24kHz AI voice |
| `transcript` | `{type: "transcript", role, text}` | Speech-to-text |
| `interrupted` | `{type: "interrupted"}` | Barge-in detected |
| `turn_complete` | `{type: "turn_complete"}` | AI finished speaking |
| `tool_call` | `{type: "tool_call", name, result}` | Tool execution result |
| `annotation` | `{type: "annotation", id, x, y, ...}` | Visual marker (30s auto-expire) |
| `agent_state` | `{type: "agent_state", mood, trigger}` | Agent emotional state |
| `diagram` | `{type: "diagram", svg, title}` | Generated diagram |
| `analysis` | `{type: "analysis", ...}` | Background analysis result |

---

## Lessons Learned

- **Bidirectional streaming with Gemini Live API** -- Implementing bidi-streaming of audio, video, and text over WebSocket required careful design with two parallel async tasks: upstream (client --> Gemini) and downstream (Gemini --> client). Using `LiveRequestQueue` was key to seamlessly multiplexing audio and video frames while receiving AI responses in real-time.

- **Native barge-in with ADK** -- The combination of Google ADK and Live API provides native barge-in support without custom code. When the user starts speaking, the AI's audio output is automatically interrupted and an `interrupted` event is sent to the client. On the frontend, immediately clearing the AudioContext buffer delivers a natural interruption experience.

- **Native audio model language handling** -- `gemini-2.5-flash-native-audio-preview` supports Japanese voice I/O, but tends to respond in English unless the system prompt explicitly enforces the target language. Voice recognition accuracy is also affected by speaking speed and ambient noise.

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
