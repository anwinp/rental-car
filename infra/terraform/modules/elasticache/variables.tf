variable "environment" { type = string }
variable "data_subnet_ids" { type = list(string) }
variable "security_group_ids" { type = list(string) }
variable "kms_key_id" { type = string }
variable "avail_node_type" { type = string; default = "cache.r7g.large" }
variable "avail_num_shards" { type = number; default = 3 }
variable "avail_replicas_per_shard" { type = number; default = 1 }
variable "broker_node_type" { type = string; default = "cache.r7g.large" }
variable "broker_num_replicas" { type = number; default = 1 }
variable "sessions_node_type" { type = string; default = "cache.r7g.large" }
variable "sessions_num_replicas" { type = number; default = 1 }
variable "transit_encryption" { type = bool; default = true }
variable "auth_token_secret_arn" { type = string }
