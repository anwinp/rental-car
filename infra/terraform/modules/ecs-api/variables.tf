variable "environment" { type = string }
variable "cluster_name" { type = string; default = "" }
variable "api_image_uri" { type = string }
variable "cpu" { type = number; default = 1024 }
variable "memory" { type = number; default = 2048 }
variable "min_tasks" { type = number; default = 3 }
variable "max_tasks" { type = number; default = 20 }
variable "cpu_scaling_target" { type = number; default = 60 }
variable "request_count_target" { type = number; default = 500 }
variable "private_subnet_ids" { type = list(string) }
variable "security_group_ids" { type = list(string) }
variable "target_group_arn" { type = string }
variable "execution_role_arn" { type = string }
variable "task_role_arn" { type = string }
variable "secrets_map" { type = map(string) }
variable "environment_vars" { type = map(string); default = {} }
variable "pgbouncer_image_uri" { type = string; default = "pgbouncer/pgbouncer:1.22" }
