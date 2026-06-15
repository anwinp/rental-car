variable "environment" { type = string }
variable "cluster_arn" { type = string }
variable "worker_image_uri" { type = string }
variable "private_subnet_ids" { type = list(string) }
variable "security_group_ids" { type = list(string) }
variable "execution_role_arn" { type = string }
variable "task_role_arn" { type = string }
variable "secrets_map" { type = map(string) }
variable "notifications_cpu" { type = number; default = 512 }
variable "notifications_memory" { type = number; default = 1024 }
variable "notifications_concurrency" { type = number; default = 8 }
variable "notifications_min_tasks" { type = number; default = 1 }
variable "rate_filing_cpu" { type = number; default = 1024 }
variable "rate_filing_memory" { type = number; default = 2048 }
variable "rate_filing_concurrency" { type = number; default = 4 }
variable "rate_filing_min_tasks" { type = number; default = 1 }
variable "reports_cpu" { type = number; default = 2048 }
variable "reports_memory" { type = number; default = 4096 }
variable "reports_concurrency" { type = number; default = 2 }
variable "reports_min_tasks" { type = number; default = 1 }
variable "beat_cpu" { type = number; default = 256 }
variable "beat_memory" { type = number; default = 512 }
