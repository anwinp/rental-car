/**
 * All TypeScript enums for the Rental Car Manager system.
 *
 * Key GAP fixes applied:
 * - GAP-003: VehicleStatus has 13 states; CHARGING is a VehicleBlockType, not a status
 * - GAP-004: ReservationStatus uses CHECKED_OUT (not ACTIVE) per ARCH_DATABASE.md ground truth
 * - GAP-002: DNRScope uses REGIONAL (not BRAND)
 */

// ── User roles — 12 roles total ─────────────────────────────────────────────
export enum UserRole {
  SUPER_ADMIN        = 'SUPER_ADMIN',        // platform-level, cross-tenant
  SYSTEM_ADMIN       = 'SYSTEM_ADMIN',       // tenant-level admin
  REGIONAL_MANAGER   = 'REGIONAL_MANAGER',
  BRANCH_MANAGER     = 'BRANCH_MANAGER',
  COUNTER_AGENT      = 'COUNTER_AGENT',
  FLEET_MANAGER      = 'FLEET_MANAGER',
  MAINTENANCE_TECH   = 'MAINTENANCE_TECH',
  CLAIMS_COORDINATOR = 'CLAIMS_COORDINATOR',
  FINANCE_ANALYST    = 'FINANCE_ANALYST',
  READONLY_AUDITOR   = 'READONLY_AUDITOR',
  API_PARTNER        = 'API_PARTNER',
  CUSTOMER           = 'CUSTOMER',
}

// ── Tenant subscription tiers ────────────────────────────────────────────────
export enum TenantTier {
  STARTER      = 'STARTER',      // <= 25 vehicles, 1 location
  PROFESSIONAL = 'PROFESSIONAL', // <= 150 vehicles, 5 locations
  ENTERPRISE   = 'ENTERPRISE',   // unlimited
  TRIAL        = 'TRIAL',        // Enterprise-level access, 14-day limit
}

// ── Reservation lifecycle states ─────────────────────────────────────────────
// GAP-004: CHECKED_OUT is canonical (not ACTIVE)
export enum ReservationStatus {
  QUOTE       = 'QUOTE',        // rate quote, not yet confirmed
  PENDING     = 'PENDING',      // awaiting pre-auth
  CONFIRMED   = 'CONFIRMED',    // pre-auth success, vehicle block created
  CHECKED_OUT = 'CHECKED_OUT',  // vehicle handed to customer (GAP-004: not ACTIVE)
  EXTENDED    = 'EXTENDED',     // return date extended while on rent
  RETURNED    = 'RETURNED',     // vehicle returned, pending final inspection
  CLOSED      = 'CLOSED',       // payment captured, RA finalized
  CANCELLED   = 'CANCELLED',    // cancelled before pickup
  NO_SHOW     = 'NO_SHOW',      // grace period expired, no checkout
  MODIFIED    = 'MODIFIED',     // parent record after modification (child created)
  DISPUTED    = 'DISPUTED',     // dispute opened on closed reservation
}

// ── Vehicle operational states — 13 states (GAP-003: not 14) ────────────────
// CHARGING is a VehicleBlockType, not a vehicle status.
// When a vehicle is charging it remains in its current status with
// a VehicleBlock of type CHARGING.
export enum VehicleStatus {
  STAGING              = 'STAGING',               // newly acquired, not yet in service
  AVAILABLE            = 'AVAILABLE',             // ready to rent
  ON_RENT              = 'ON_RENT',               // currently rented
  RETURNING            = 'RETURNING',             // checked in, pending inspection
  READY_FOR_INSPECTION = 'READY_FOR_INSPECTION',  // returned, awaiting inspector
  CLEANING             = 'CLEANING',              // in cleaning/preparation
  MAINTENANCE          = 'MAINTENANCE',           // scheduled maintenance
  IN_REPAIR            = 'IN_REPAIR',             // unscheduled repair
  DAMAGE_HOLD          = 'DAMAGE_HOLD',           // blocked due to damage claim
  ADMIN_HOLD           = 'ADMIN_HOLD',            // manually blocked by manager
  PENDING_DISPOSAL     = 'PENDING_DISPOSAL',      // flagged for disposal
  DISPOSED             = 'DISPOSED',              // sold/retired
  PENDING_DELIVERY     = 'PENDING_DELIVERY',      // in transit to location
}

// ── Vehicle block types (calendar blocks) ───────────────────────────────────
// GAP-003: CHARGING belongs here, not in VehicleStatus
export enum VehicleBlockType {
  RESERVATION  = 'RESERVATION',
  TURNAROUND   = 'TURNAROUND',
  MAINTENANCE  = 'MAINTENANCE',
  RECALL_HOLD  = 'RECALL_HOLD',
  IN_TRANSIT   = 'IN_TRANSIT',
  HOLD         = 'HOLD',
  INSPECTION   = 'INSPECTION',
  STAGING      = 'STAGING',
  CHARGING     = 'CHARGING',   // EV charging block (GAP-003: not a vehicle status)
}

// ── Payment transaction statuses ─────────────────────────────────────────────
export enum PaymentStatus {
  PENDING             = 'PENDING',
  AUTHORIZED          = 'AUTHORIZED',         // pre-auth captured, not settled
  CAPTURED            = 'CAPTURED',           // settled
  REFUNDED            = 'REFUNDED',           // full refund
  PARTIALLY_REFUNDED  = 'PARTIALLY_REFUNDED',
  VOIDED              = 'VOIDED',             // auth voided before capture
  DECLINED            = 'DECLINED',           // payment declined
  EXPIRED             = 'EXPIRED',            // pre-auth expired
  DISPUTED            = 'DISPUTED',           // chargeback opened
  FAILED              = 'FAILED',             // processing error
}

// ── Damage claim lifecycle ───────────────────────────────────────────────────
export enum DamageClaimStatus {
  OPEN                  = 'OPEN',
  ESTIMATE_SENT         = 'ESTIMATE_SENT',
  CUSTOMER_ACKNOWLEDGED = 'CUSTOMER_ACKNOWLEDGED',
  REPAIR_IN_PROGRESS    = 'REPAIR_IN_PROGRESS',
  REPAIR_COMPLETE       = 'REPAIR_COMPLETE',
  INVOICED              = 'INVOICED',
  PAID                  = 'PAID',
  DISPUTED              = 'DISPUTED',
  IN_LITIGATION         = 'IN_LITIGATION',
  WRITTEN_OFF           = 'WRITTEN_OFF',
}

// ── DNR (Do Not Rent) scope ──────────────────────────────────────────────────
// GAP-002: REGIONAL (not BRAND) is the canonical value
export enum DNRScope {
  LOCATION = 'LOCATION',   // blocked at one specific location
  REGIONAL = 'REGIONAL',   // blocked across a region (GAP-002: not BRAND)
  NETWORK  = 'NETWORK',    // blocked system-wide across all locations
}

// ── Rate types ───────────────────────────────────────────────────────────────
export enum RateType {
  RACK                 = 'RACK',
  CORPORATE            = 'CORPORATE',
  GOVERNMENT           = 'GOVERNMENT',
  INSURANCE_REPLACEMENT = 'INSURANCE_REPLACEMENT',
  PROMOTIONAL          = 'PROMOTIONAL',
  OTA_NET              = 'OTA_NET',
  WHOLESALE            = 'WHOLESALE',
  MEMBERSHIP           = 'MEMBERSHIP',
  TOUR_OPERATOR        = 'TOUR_OPERATOR',
  LOYALTY_REDEMPTION   = 'LOYALTY_REDEMPTION',
  WEEKEND_SPECIAL      = 'WEEKEND_SPECIAL',
}

// ── Fleet / acquisition type ─────────────────────────────────────────────────
export enum FleetType {
  OWNED      = 'OWNED',
  LEASED     = 'LEASED',
  PROGRAM_CAR = 'PROGRAM_CAR',
  COURTESY   = 'COURTESY',
}

// ── KYC verification status ──────────────────────────────────────────────────
export enum KYCStatus {
  UNVERIFIED      = 'UNVERIFIED',
  TIER_1_PENDING  = 'TIER_1_PENDING',
  TIER_1_COMPLETE = 'TIER_1_COMPLETE',
  TIER_2_PENDING  = 'TIER_2_PENDING',
  TIER_2_COMPLETE = 'TIER_2_COMPLETE',
  FAILED          = 'FAILED',
  FLAGGED         = 'FLAGGED',
}

// ── Fuel types ───────────────────────────────────────────────────────────────
export enum FuelType {
  GASOLINE = 'GASOLINE',
  DIESEL   = 'DIESEL',
  HYBRID   = 'HYBRID',
  PHEV     = 'PHEV',
  BEV      = 'BEV',
  HYDROGEN = 'HYDROGEN',
  LPG      = 'LPG',
}

// ── Damage severity grades ───────────────────────────────────────────────────
export enum DamageSeverity {
  GRADE_1_COSMETIC = 'GRADE_1_COSMETIC',
  GRADE_2_MINOR    = 'GRADE_2_MINOR',
  GRADE_3_MODERATE = 'GRADE_3_MODERATE',
  GRADE_4_SEVERE   = 'GRADE_4_SEVERE',
  GRADE_5_TOTAL_LOSS = 'GRADE_5_TOTAL_LOSS',
}

// ── Notification channels ────────────────────────────────────────────────────
export enum NotificationChannel {
  EMAIL = 'EMAIL',
  SMS   = 'SMS',
  PUSH  = 'PUSH',
}

// ── Audit action types ───────────────────────────────────────────────────────
export enum AuditAction {
  INSERT          = 'INSERT',
  UPDATE          = 'UPDATE',
  DELETE          = 'DELETE',
  LOGIN           = 'LOGIN',
  LOGOUT          = 'LOGOUT',
  EXPORT          = 'EXPORT',
  CONFIG_CHANGE   = 'CONFIG_CHANGE',
  STATE_TRANSITION = 'STATE_TRANSITION',
}
