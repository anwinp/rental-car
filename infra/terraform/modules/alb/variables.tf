variable "environment" { type = string }
variable "vpc_id" { type = string }
variable "public_subnet_ids" { type = list(string) }
variable "certificate_arn" { type = string }
variable "health_check_path" { type = string; default = "/health" }
variable "health_check_interval" { type = number; default = 30 }
variable "health_check_threshold" { type = number; default = 3 }
variable "idle_timeout" { type = number; default = 60 }
variable "waf_acl_arn" { type = string; default = "" }
variable "cloudfront_prefix_list_id" { type = string; default = "" }
