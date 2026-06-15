output "db_credentials_arn" { value = ""; description = "rcm/{env}/db-credentials secret ARN" }
output "redis_url_arn" { value = ""; description = "rcm/{env}/redis-url secret ARN" }
output "stripe_arn" { value = ""; description = "rcm/{env}/stripe secret ARN" }
output "jwt_arn" { value = ""; description = "rcm/{env}/jwt secret ARN" }
output "smtp_arn" { value = ""; description = "rcm/{env}/smtp secret ARN" }
output "ota_api_keys_arn" { value = ""; description = "rcm/{env}/ota-api-keys secret ARN" }
output "twilio_arn" { value = ""; description = "rcm/{env}/twilio secret ARN" }
output "all_secret_arns" { value = []; description = "All secret ARNs for IAM policies" }
