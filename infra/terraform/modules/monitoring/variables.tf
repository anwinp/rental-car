variable "environment" { type = string }
variable "api_service_name" { type = string }
variable "cluster_name" { type = string }
variable "alb_arn_suffix" { type = string }
variable "target_group_arn_suffix" { type = string }
variable "rds_instance_id" { type = string }
variable "avail_cache_cluster_id" { type = string }
variable "sqs_notification_queue_name" { type = string; default = "" }
variable "pagerduty_sns_endpoint" { type = string; default = "" }
variable "ops_slack_sns_endpoint" { type = string; default = "" }
variable "finance_slack_sns_endpoint" { type = string; default = "" }
variable "log_retention_days" { type = number; default = 90 }
