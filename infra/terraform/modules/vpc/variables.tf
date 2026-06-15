variable "environment" {
  type        = string
  description = "Environment name: dev / staging / prod"
}

variable "vpc_cidr" {
  type        = string
  default     = "10.0.0.0/16"
  description = "VPC CIDR block"
}

variable "public_subnet_cidrs" {
  type        = list(string)
  default     = ["10.0.0.0/24", "10.0.2.0/24"]
  description = "Public subnet CIDRs (one per AZ)"
}

variable "private_subnet_cidrs" {
  type        = list(string)
  default     = ["10.0.1.0/24", "10.0.3.0/24"]
  description = "Private subnet CIDRs for ECS tasks (one per AZ)"
}

variable "data_subnet_cidrs" {
  type        = list(string)
  default     = ["10.0.4.0/24", "10.0.5.0/24"]
  description = "Data subnet CIDRs for RDS and ElastiCache (one per AZ)"
}

variable "availability_zones" {
  type        = list(string)
  default     = ["us-east-1a", "us-east-1b"]
  description = "Availability zones to deploy into"
}

variable "flow_log_retention_days" {
  type        = number
  default     = 90
  description = "CloudWatch log group retention for VPC Flow Logs (days)"
}

variable "enable_nat_gateway" {
  type        = bool
  default     = true
  description = "Set false in dev to reduce cost"
}

variable "single_nat_gateway" {
  type        = bool
  default     = false
  description = "Set true in dev/staging for cost savings; false in prod for HA"
}
