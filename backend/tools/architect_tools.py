"""ADK tool functions for the Whiteboard Architect agent.

These functions are registered as tools on the LlmAgent. The ToolContext
parameter is automatically injected by ADK at invocation time and provides
access to session state.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from google.adk.tools import ToolContext

VALID_ANNOTATION_TYPES = frozenset({"circle", "arrow", "label", "rectangle"})
VALID_SEVERITIES = frozenset({"critical", "warning", "info", "positive"})


def save_whiteboard_snapshot(
    description: str,
    tool_context: ToolContext,
) -> dict:
    """Save a snapshot of the current whiteboard state with a description.

    Call when the user asks to save, or at an important milestone in the discussion.

    Args:
        description: Brief description of the whiteboard contents at this moment.
        tool_context: ADK-injected context for session state access.

    Returns:
        Confirmation with snapshot ID and description.
    """
    snapshot_id = str(uuid.uuid4())[:8]
    timestamp = datetime.now(timezone.utc).isoformat()

    snapshots = tool_context.state.get("snapshots", [])
    snapshots.append(
        {
            "snapshot_id": snapshot_id,
            "description": description,
            "timestamp": timestamp,
        }
    )
    tool_context.state["snapshots"] = snapshots
    tool_context.state["last_snapshot_id"] = snapshot_id

    return {
        "status": "saved",
        "snapshot_id": snapshot_id,
        "description": description,
        "total_snapshots": len(snapshots),
    }


def save_review_note(
    category: str,
    finding: str,
    severity: str,
    recommendation: str,
    tool_context: ToolContext,
) -> dict:
    """Save a structured architecture review note.

    Call when you find a notable issue, concern, or good pattern worth documenting.

    Args:
        category: One of: security, scalability, reliability, cost, operations.
        finding: Clear description of the architectural finding.
        severity: One of: critical, warning, info, positive.
        recommendation: Actionable recommendation to address the finding.
        tool_context: ADK-injected context for session state access.

    Returns:
        Confirmation with note ID and details.
    """
    note_id = str(uuid.uuid4())[:8]
    timestamp = datetime.now(timezone.utc).isoformat()

    notes = tool_context.state.get("review_notes", [])
    notes.append(
        {
            "note_id": note_id,
            "category": category,
            "finding": finding,
            "severity": severity,
            "recommendation": recommendation,
            "timestamp": timestamp,
        }
    )
    tool_context.state["review_notes"] = notes

    return {
        "status": "saved",
        "note_id": note_id,
        "category": category,
        "severity": severity,
        "finding": finding,
        "recommendation": recommendation,
    }


def add_annotation(
    x: float,
    y: float,
    label: str,
    annotation_type: str,
    severity: str,
    tool_context: ToolContext,
    width: float = 0.0,
    height: float = 0.0,
) -> dict:
    """Add a visual annotation marker on the whiteboard camera preview overlay.

    Call to highlight a specific area before commenting on it verbally.

    Args:
        x: Horizontal position (0.0=left, 1.0=right).
        y: Vertical position (0.0=top, 1.0=bottom).
        label: Short text label for the annotation.
        annotation_type: One of: circle, arrow, label, rectangle.
        severity: One of: critical, warning, info, positive.
        tool_context: ADK-injected context for session state access.
        width: Width of the annotation area (0.0–1.0). Used for rectangle type.
        height: Height of the annotation area (0.0–1.0). Used for rectangle type.

    Returns:
        Confirmation with annotation details.
    """
    annotation_id = str(uuid.uuid4())[:8]

    # Validate enum values — fall back to safe defaults for hallucinated values
    if annotation_type not in VALID_ANNOTATION_TYPES:
        annotation_type = "circle"
    if severity not in VALID_SEVERITIES:
        severity = "info"

    # Clamp coordinates and dimensions to [0, 1]
    x = max(0.0, min(1.0, x))
    y = max(0.0, min(1.0, y))
    width = max(0.0, min(1.0, width))
    height = max(0.0, min(1.0, height))

    # Ensure rectangles have visible dimensions
    if annotation_type == "rectangle":
        if width <= 0:
            width = 0.1
        if height <= 0:
            height = 0.1

    annotation = {
        "id": annotation_id,
        "x": x,
        "y": y,
        "label": label,
        "annotation_type": annotation_type,
        "severity": severity,
        "width": width,
        "height": height,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }

    annotations = tool_context.state.get("annotations", [])
    annotations.append(annotation)
    tool_context.state["annotations"] = annotations

    return {
        "status": "created",
        "annotation_id": annotation_id,
        "x": x,
        "y": y,
        "label": label,
        "annotation_type": annotation_type,
        "severity": severity,
        "width": width,
        "height": height,
    }


def generate_diagram(
    description: str,
    tool_context: ToolContext,
) -> dict:
    """Generate a clean professional diagram from the current whiteboard drawing.

    Call when the user asks to create a diagram or clean up their whiteboard sketch.
    Image generation is asynchronous and takes a few seconds.

    Args:
        description: Brief description of the diagram content or purpose.
        tool_context: ADK-injected context for session state access.

    Returns:
        Confirmation with diagram ID. Actual image generation is handled asynchronously.
    """
    diagram_id = str(uuid.uuid4())[:8]
    timestamp = datetime.now(timezone.utc).isoformat()

    diagrams = tool_context.state.get("diagrams", [])
    diagrams.append(
        {
            "diagram_id": diagram_id,
            "description": description,
            "timestamp": timestamp,
        }
    )
    tool_context.state["diagrams"] = diagrams

    return {
        "status": "generating",
        "diagram_id": diagram_id,
        "description": description,
    }
