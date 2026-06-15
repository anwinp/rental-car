terraform {
  required_version = ">= 1.8.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

# VPC, 6 subnets (2 public, 2 private, 2 data) across 2 AZs,
# IGW, up to 2 NAT Gateways (1 if single_nat_gateway=true), VPC Flow Logs.
# Placeholder — full implementation in Wave B (infra build-out).
