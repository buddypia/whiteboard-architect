"""Image context tracking for WebSocket sessions.

Provides a unified image pipeline: whether the image comes from a live camera
feed, a stored snapshot, or a user upload, the same recognition/analysis logic
applies.  The only difference is *timing* — live frames are analysed
periodically, while static images (snapshots/uploads) are analysed once when
they arrive.
"""

from __future__ import annotations

from enum import Enum, auto


class ImageSource(Enum):
    """How the current active image was obtained."""

    CAMERA = auto()    # Real-time camera feed (1 fps)
    SNAPSHOT = auto()  # Previously stored snapshot
    UPLOAD = auto()    # User-uploaded image file


class ImageContext:
    """Single source of truth for the current image state of a session.

    Attributes:
        source: How the active image was obtained.
        active_image: The image the user is currently viewing/discussing.
            In CAMERA mode this is the latest camera frame; in SNAPSHOT/UPLOAD
            mode this is the selected static image.
        last_camera_frame: The most recent raw camera frame, regardless of
            source mode.  Kept so that ``back_to_live`` can restore instantly.
        source_id: The snapshot/upload ID being viewed, or empty string.
    """

    __slots__ = (
        "source",
        "active_image",
        "last_camera_frame",
        "source_id",
        "_image_version",
        "_analyzed_version",
    )

    def __init__(self) -> None:
        self.source: ImageSource = ImageSource.CAMERA
        self.active_image: bytes | None = None
        self.last_camera_frame: bytes | None = None
        self.source_id: str = ""
        self._image_version: int = 0
        self._analyzed_version: int = 0

    # ------------------------------------------------------------------
    # State transitions
    # ------------------------------------------------------------------

    def on_camera_frame(self, image_bytes: bytes) -> None:
        """A new camera frame arrived from the frontend."""
        self.last_camera_frame = image_bytes
        if self.source is ImageSource.CAMERA:
            self.active_image = image_bytes

    def set_static_image(
        self, source: ImageSource, source_id: str, image_data: bytes,
    ) -> None:
        """Switch to a static image (snapshot or upload).

        The perception layer will automatically detect the pending analysis
        and run the whiteboard analyser on this image.
        """
        self.source = source
        self.source_id = source_id
        self.active_image = image_data
        self._image_version += 1

    def back_to_live(self) -> None:
        """User returned to the live camera view."""
        self.source = ImageSource.CAMERA
        self.source_id = ""
        if self.last_camera_frame is not None:
            self.active_image = self.last_camera_frame

    # ------------------------------------------------------------------
    # Perception Layer helpers
    # ------------------------------------------------------------------

    @property
    def image_version(self) -> int:
        """Monotonically increasing counter for static image changes."""
        return self._image_version

    def has_pending_analysis(self) -> bool:
        """True when a static image has been set but not yet analysed."""
        return self.is_static and self._image_version != self._analyzed_version

    def mark_version_analyzed(self, version: int) -> None:
        """Record that a specific image version has been analysed.

        Only advances the watermark — never goes backwards.  This prevents
        a slow analysis from accidentally marking a *newer* image as done.
        """
        if version > self._analyzed_version:
            self._analyzed_version = version

    # ------------------------------------------------------------------
    # Queries
    # ------------------------------------------------------------------

    @property
    def is_static(self) -> bool:
        """True when viewing a snapshot or uploaded image."""
        return self.source is not ImageSource.CAMERA

    @property
    def is_live(self) -> bool:
        """True when viewing the live camera feed."""
        return self.source is ImageSource.CAMERA

    @property
    def is_reviewing(self) -> bool:
        """Alias for ``is_static`` — backward compatibility."""
        return self.is_static

    @property
    def has_image(self) -> bool:
        return self.active_image is not None
