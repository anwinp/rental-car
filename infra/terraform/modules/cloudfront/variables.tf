variable "environment" { type = string }
variable "alb_dns_name" { type = string }
variable "frontend_bucket_id" { type = string }
variable "frontend_bucket_arn" { type = string }
variable "certificate_arn" { type = string }
variable "domain_names" { type = list(string) }
variable "price_class" { type = string; default = "PriceClass_100" }
variable "min_ttl" { type = number; default = 0 }
variable "default_ttl" { type = number; default = 86400 }
variable "max_ttl" { type = number; default = 31536000 }
variable "waf_acl_arn" { type = string; default = "" }
