variable "project_id" {
  description = "GCP project ID"
  type        = string
}

variable "region" {
  description = "GCP region for resource deployment"
  type        = string
  default     = "us-central1"
}

variable "backend_image" {
  description = "Backend Docker image URI"
  type        = string
}

variable "frontend_image" {
  description = "Frontend Docker image URI"
  type        = string
}

variable "gemini_api_key" {
  description = "Gemini API key for AI model access (stored in Secret Manager)"
  type        = string
  sensitive   = true
}

variable "gemini_model_name" {
  description = "Gemini model name for the live agent"
  type        = string
  default     = "gemini-2.5-flash-native-audio-preview-09-2025"
}

variable "analysis_enabled" {
  description = "Enable background whiteboard analysis"
  type        = bool
  default     = true
}

variable "analysis_interval_s" {
  description = "Background analysis interval in seconds"
  type        = number
  default     = 30
}

variable "analysis_model_name" {
  description = "Gemini model for background whiteboard analysis"
  type        = string
  default     = "gemini-3-flash-preview"
}

variable "analysis_thinking_budget" {
  description = "Thinking budget for background analysis model"
  type        = number
  default     = 2048
}

variable "analysis_media_resolution" {
  description = "Media resolution for background analysis (low, medium, high)"
  type        = string
  default     = "medium"

  validation {
    condition     = contains(["low", "medium", "high"], var.analysis_media_resolution)
    error_message = "analysis_media_resolution must be one of: low, medium, high"
  }
}

variable "cors_origins" {
  description = "Comma-separated allowed CORS origins. Set to frontend Cloud Run URL after first deploy."
  type        = string
  default     = "*"
}
