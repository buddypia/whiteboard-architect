/**
 * Severity → CSS custom property color mapping.
 * Shared by AnnotationOverlay and CameraPreview annotation badges.
 */
export const SEVERITY_COLORS: Record<string, string> = {
  critical: "var(--destructive)",
  warning: "var(--warning)",
  info: "var(--info)",
  positive: "var(--positive)",
};

export function getSeverityColor(severity: string): string {
  return SEVERITY_COLORS[severity] ?? SEVERITY_COLORS.info;
}
