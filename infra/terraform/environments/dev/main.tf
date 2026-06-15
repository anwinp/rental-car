terraform {
  required_version = ">= 1.8.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = "us-east-1"
  default_tags {
    tags = {
      Project     = "rcm"
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}

variable "environment" {
  type    = string
  default = "dev"
}

# ── Module calls — stub (Wave B will populate) ──────────────────────────────

# module "vpc" {
#   source              = "../../modules/vpc"
#   environment         = var.environment
#   single_nat_gateway  = true
#   enable_nat_gateway  = false  # dev: save cost
# }
#
# module "rds" {
#   source              = "../../modules/rds"
#   environment         = var.environment
#   db_instance_class   = "db.t4g.medium"
#   multi_az            = false
#   backup_retention_period = 7
#   deletion_protection = false
#   data_subnet_ids     = module.vpc.data_subnet_ids
#   security_group_ids  = []
#   kms_key_id          = ""
# }
