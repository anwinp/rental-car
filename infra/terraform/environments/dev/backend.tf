terraform {
  backend "s3" {
    bucket         = "rcm-terraform-state-dev"
    key            = "dev/terraform.tfstate"
    region         = "us-east-1"
    encrypt        = true
    dynamodb_table = "rcm-terraform-locks"
  }
}
