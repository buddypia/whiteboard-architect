export type ConnectionState = "disconnected" | "connecting" | "connected";

export type SessionMode = "live" | "snapshot";

export interface TranscriptEntry {
  id: string;
  role: "user" | "agent" | "thought";
  text: string;
  translation?: string;
  timestamp: number;
}

export interface Snapshot {
  id: string;
  dataUrl?: string;
  url?: string;
  timestamp: number;
  label?: string;
  origin?: "camera" | "upload";
}

export interface SessionState {
  userId: string;
  sessionId: string;
  isActive: boolean;
  connectionState: ConnectionState;
  isUserSpeaking: boolean;
  isAgentSpeaking: boolean;
  transcripts: TranscriptEntry[];
  snapshots: Snapshot[];
}

// WebSocket message types sent from client to server
// Must match backend/main.py upstream_task parsing

export interface AudioMessage {
  type: "audio";
  data: string; // base64 encoded PCM16 16kHz
}

export interface VideoMessage {
  type: "video";
  data: string; // base64 encoded JPEG
}

export interface TextMessage {
  type: "text";
  text: string;
}

export interface ControlMessage {
  type: "control";
  action: string;
  snapshotId?: string;
}

export type ClientMessage = AudioMessage | VideoMessage | TextMessage | ControlMessage;

// WebSocket message types received from server
// Must match backend/main.py downstream_task sending

export interface AudioOutMessage {
  type: "audio";
  data: string; // base64 encoded PCM audio
  turnId?: string;
}

export interface TranscriptMessage {
  type: "transcript";
  role: "user" | "agent" | "thought";
  text: string;
}

export interface InterruptedMessage {
  type: "interrupted";
  turnId?: string;
}

export interface TurnCompleteMessage {
  type: "turn_complete";
  turnId?: string;
}

export interface ToolCallMessage {
  type: "tool_call";
  name: string;
  result: unknown;
}

export type ServerMessage =
  | AudioOutMessage
  | TranscriptMessage
  | InterruptedMessage
  | TurnCompleteMessage
  | ToolCallMessage
  | AnnotationMessage
  | AgentStateMessage
  | SnapshotSavedMessage
  | DiagramGeneratingMessage
  | DiagramGeneratedMessage
  | DiagramErrorMessage
  | WhiteboardAnalysisMessage
  | ErrorMessage;

export type WebSocketMessage = ClientMessage | ServerMessage;

export interface ReviewNote {
  id: string;
  category: "security" | "scalability" | "reliability" | "cost" | "operations";
  severity: "critical" | "warning" | "info" | "positive";
  finding: string;
  recommendation?: string;
  timestamp: number;
}

export interface Annotation {
  id: string;
  x: number;
  y: number;
  label: string;
  annotationType: "circle" | "arrow" | "label" | "rectangle";
  severity: "critical" | "warning" | "info" | "positive";
  width?: number;
  height?: number;
  isSpeechLinked?: boolean;
  timestamp: number;
}

export interface AnnotationMessage {
  type: "annotation";
  id: string;
  x: number;
  y: number;
  label: string;
  annotationType: "circle" | "arrow" | "label" | "rectangle";
  severity: "critical" | "warning" | "info" | "positive";
  width?: number;
  height?: number;
  isSpeechLinked?: boolean;
}

export type AgentMood = "neutral" | "impressed" | "concerned" | "surprised" | "thinking";

export type AgentActivity = "idle" | "listening" | "analyzing" | "speaking";

export interface AgentStateMessage {
  type: "agent_state";
  mood: AgentMood;
  trigger: string;
}

export interface SnapshotSavedMessage {
  type: "snapshot_saved";
  id: string;
  url: string;
  description: string;
}

export interface DiagramGeneratingMessage {
  type: "diagram_generating";
}

export interface DiagramGeneratedMessage {
  type: "diagram_generated";
  id: string;
  url: string;
  description: string;
}

export interface DiagramErrorMessage {
  type: "diagram_error";
  message: string;
}

export interface ErrorMessage {
  type: "error";
  code: string;
  message: string;
  retryable: boolean;
}

// Background whiteboard analysis results (Perception Layer)

export interface AnalysisComponent {
  name: string;
  component_type: string;
  x: number;
  y: number;
  confidence: number;
}

export interface AnalysisConnection {
  source: string;
  target: string;
  label: string;
  connection_type: string;
}

export interface AnalysisIssue {
  category: string;
  severity: "critical" | "warning" | "info";
  description: string;
  affected_components: string[];
}

export interface WhiteboardAnalysisMessage {
  type: "whiteboard_analysis";
  components: AnalysisComponent[];
  connections: AnalysisConnection[];
  issues: AnalysisIssue[];
  summary: string;
  raw_description: string;
  change_summary: string;
  has_meaningful_content: boolean;
  error: string;
  timestamp: string;
}
