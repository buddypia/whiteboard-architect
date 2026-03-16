"""Data models for structured whiteboard analysis results.

These models represent the perception layer's understanding of the whiteboard,
built up incrementally through periodic background analysis.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone


@dataclass
class Component:
    """A single architectural component detected on the whiteboard."""

    name: str
    component_type: str  # e.g. "database", "service", "queue", "storage", "client", "load_balancer", "cache", "api_gateway"
    x: float  # Normalised position (0.0-1.0)
    y: float
    confidence: float = 1.0  # 0.0-1.0

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict) -> Component:
        return cls(
            name=d.get("name", ""),
            component_type=d.get("component_type", "unknown"),
            x=float(d.get("x", 0.0)),
            y=float(d.get("y", 0.0)),
            confidence=float(d.get("confidence", 1.0)),
        )


@dataclass
class Connection:
    """A directed connection between two components."""

    source: str  # Component name
    target: str  # Component name
    label: str = ""  # e.g. "HTTP", "gRPC", "async"
    connection_type: str = "arrow"  # "arrow", "bidirectional", "dashed"

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict) -> Connection:
        return cls(
            source=d.get("source", ""),
            target=d.get("target", ""),
            label=d.get("label", ""),
            connection_type=d.get("connection_type", "arrow"),
        )


@dataclass
class DetectedIssue:
    """A potential architecture issue detected during analysis."""

    category: str  # "security", "scalability", "reliability", "cost", "operations"
    severity: str  # "critical", "warning", "info"
    description: str
    affected_components: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict) -> DetectedIssue:
        return cls(
            category=d.get("category", ""),
            severity=d.get("severity", "info"),
            description=d.get("description", ""),
            affected_components=d.get("affected_components", []),
        )


@dataclass
class WhiteboardState:
    """Complete structured representation of the whiteboard at a point in time."""

    components: list[Component] = field(default_factory=list)
    connections: list[Connection] = field(default_factory=list)
    issues: list[DetectedIssue] = field(default_factory=list)
    summary: str = ""
    raw_description: str = ""  # Free-form description of what's visible
    change_summary: str = ""  # What changed since the last analysis
    has_meaningful_content: bool = False
    error: str = ""  # 分析失敗時のエラーメッセージ（空 = 正常）
    timestamp: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

    def to_dict(self) -> dict:
        return {
            "components": [c.to_dict() for c in self.components],
            "connections": [c.to_dict() for c in self.connections],
            "issues": [i.to_dict() for i in self.issues],
            "summary": self.summary,
            "raw_description": self.raw_description,
            "change_summary": self.change_summary,
            "has_meaningful_content": self.has_meaningful_content,
            "error": self.error,
            "timestamp": self.timestamp,
        }

    @classmethod
    def from_dict(cls, d: dict) -> WhiteboardState:
        return cls(
            components=[Component.from_dict(c) for c in d.get("components", [])],
            connections=[Connection.from_dict(c) for c in d.get("connections", [])],
            issues=[DetectedIssue.from_dict(i) for i in d.get("issues", [])],
            summary=d.get("summary", ""),
            raw_description=d.get("raw_description", ""),
            change_summary=d.get("change_summary", ""),
            has_meaningful_content=d.get("has_meaningful_content", False),
            error=d.get("error", ""),
            timestamp=d.get("timestamp", ""),
        )

    @classmethod
    def empty(cls, *, error: str = "") -> WhiteboardState:
        return cls(error=error)

    def is_significantly_different(self, other: WhiteboardState | None) -> bool:
        """Determine if this state represents a meaningful change from another."""
        if other is None:
            return self.has_meaningful_content

        # Component names changed
        my_names = {c.name for c in self.components}
        other_names = {c.name for c in other.components}
        if my_names != other_names:
            return True

        # Connection topology changed
        my_conns = {(c.source, c.target) for c in self.connections}
        other_conns = {(c.source, c.target) for c in other.connections}
        if my_conns != other_conns:
            return True

        # New issues detected
        my_issues = {(i.category, i.severity, i.description) for i in self.issues}
        other_issues = {(i.category, i.severity, i.description) for i in other.issues}
        if my_issues != other_issues:
            return True

        return False

    def to_context_summary(self) -> str:
        """Generate a concise text summary for injecting into the live agent context."""
        if not self.has_meaningful_content:
            return "ホワイトボードにアーキテクチャ的な内容はまだ検出されていません。"

        lines = []
        if self.components:
            comp_list = ", ".join(f"{c.name}({c.component_type})" for c in self.components)
            lines.append(f"検出コンポーネント: {comp_list}")
        if self.connections:
            conn_list = ", ".join(f"{c.source}→{c.target}" for c in self.connections)
            lines.append(f"接続: {conn_list}")
        if self.issues:
            for issue in self.issues:
                lines.append(f"[{issue.severity.upper()}] {issue.category}: {issue.description}")
        if self.change_summary:
            lines.append(f"変更点: {self.change_summary}")
        return "\n".join(lines)
