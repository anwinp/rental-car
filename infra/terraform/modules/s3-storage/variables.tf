variable "environment" { type = string }
variable "kms_key_id" { type = string }
variable "documents_glacier_days" { type = number; default = 365 }
variable "photos_glacier_days" { type = number; default = 365 }
variable "reports_expiry_days" { type = number; default = 90 }
