variable "environment" { type = string }
variable "db_instance_class" { type = string }
variable "db_name" { type = string; default = "rcm" }
variable "allocated_storage" { type = number; default = 100 }
variable "max_allocated_storage" { type = number; default = 1000 }
variable "multi_az" { type = bool; default = true }
variable "backup_retention_period" { type = number; default = 35 }
variable "data_subnet_ids" { type = list(string) }
variable "security_group_ids" { type = list(string) }
variable "parameter_group_family" { type = string; default = "postgres16" }
variable "create_read_replica" { type = bool; default = false }
variable "deletion_protection" { type = bool; default = true }
variable "performance_insights_enabled" { type = bool; default = true }
variable "monitoring_interval" { type = number; default = 60 }
variable "kms_key_id" { type = string }
