output "vpc_id" {
  description = "VPC ID"
  value       = "" # placeholder — set after resource creation
}

output "public_subnet_ids" {
  description = "Public subnet IDs (one per AZ)"
  value       = [] # placeholder
}

output "private_subnet_ids" {
  description = "Private subnet IDs for ECS tasks (one per AZ)"
  value       = [] # placeholder
}

output "data_subnet_ids" {
  description = "Data subnet IDs for RDS and ElastiCache (one per AZ)"
  value       = [] # placeholder
}

output "nat_gateway_ids" {
  description = "NAT Gateway IDs"
  value       = [] # placeholder
}

output "vpc_cidr_block" {
  description = "VPC CIDR block (for security group rules)"
  value       = "" # placeholder
}
