output "alb_arn" { value = ""; description = "ALB ARN for CodeDeploy" }
output "alb_dns_name" { value = ""; description = "ALB DNS for CloudFront origin" }
output "target_group_arn" { value = ""; description = "Blue target group ARN for ECS" }
output "alb_security_group_id" { value = ""; description = "For API service security group ingress rule" }
output "listener_arn" { value = ""; description = "HTTPS listener ARN for CodeDeploy" }
