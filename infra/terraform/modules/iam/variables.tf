variable "environment" { type = string }
variable "documents_bucket_arn" { type = string }
variable "photos_bucket_arn" { type = string }
variable "reports_bucket_arn" { type = string }
variable "secrets_arns" { type = list(string) }
variable "kms_key_arns" { type = list(string) }
variable "sqs_queue_arns" { type = list(string); default = [] }
