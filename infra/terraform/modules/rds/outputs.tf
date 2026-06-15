output "db_endpoint" { value = ""; description = "RDS primary endpoint (PgBouncer upstream)" }
output "db_read_replica_endpoint" { value = ""; description = "Read replica for reports queries" }
output "db_port" { value = 5432; description = "Always 5432" }
output "db_security_group_id" { value = ""; description = "For output to other modules" }
