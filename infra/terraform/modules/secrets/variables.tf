variable "environment" { type = string }
variable "rds_kms_key_arn" { type = string }
variable "app_kms_key_arn" { type = string }
variable "rotation_lambda_arn" { type = string; default = "" }
