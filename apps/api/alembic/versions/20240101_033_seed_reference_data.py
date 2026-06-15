"""seed reference data: 9 extras, CA tax template, 13 staff roles, 30 notification templates

Revision ID: 033_seed_reference_data
Revises: 032_seed_vehicle_classes
Create Date: 2024-01-01

Phase: backfill
Lock risk: low (INSERT with ON CONFLICT DO NOTHING)
Reversible: yes
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision: str = '033_seed_reference_data'
down_revision: str | None = '032_seed_vehicle_classes'
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None


def upgrade() -> None:
    # 9 extras catalog (tenant_id NULL = system reference)
    op.execute("""
        INSERT INTO public.extras_catalog (extra_id, tenant_id, code, name, extra_type, pricing_type, tax_treatment) VALUES
          ('00000000-0000-0000-0002-000000000001', NULL, 'CDW',  'Collision Damage Waiver',          'INSURANCE', 'PER_DAY',    'TAXABLE'),
          ('00000000-0000-0000-0002-000000000002', NULL, 'LDW',  'Loss Damage Waiver',               'INSURANCE', 'PER_DAY',    'TAXABLE'),
          ('00000000-0000-0000-0002-000000000003', NULL, 'SLI',  'Supplemental Liability Insurance', 'INSURANCE', 'PER_DAY',    'TAXABLE'),
          ('00000000-0000-0000-0002-000000000004', NULL, 'PAI',  'Personal Accident Insurance',      'INSURANCE', 'PER_RENTAL', 'TAXABLE'),
          ('00000000-0000-0000-0002-000000000005', NULL, 'RSA',  'Roadside Assistance',              'INSURANCE', 'PER_DAY',    'TAXABLE'),
          ('00000000-0000-0000-0002-000000000006', NULL, 'GPS',  'GPS Navigation Unit',              'EQUIPMENT', 'PER_DAY',    'TAXABLE'),
          ('00000000-0000-0000-0002-000000000007', NULL, 'CSS',  'Child Safety Seat',                'EQUIPMENT', 'PER_DAY',    'TAXABLE'),
          ('00000000-0000-0000-0002-000000000008', NULL, 'TOLL', 'Toll Pass',                        'TOLL',      'PER_DAY',    'TAXABLE'),
          ('00000000-0000-0000-0002-000000000009', NULL, 'PPFP', 'Pre-Purchase Fuel Plan',           'FUEL',      'PER_RENTAL', 'TAXABLE')
        ON CONFLICT (tenant_id, code) DO NOTHING
    """)

    # California Airport tax template (1 seed)
    op.execute("""
        INSERT INTO public.tax_templates (template_id, tenant_id, name, is_seed, jurisdictions) VALUES
          ('00000000-0000-0000-0003-000000000001', NULL, 'US-CA-Airport', true, '[
            {"name":"CA State Sales Tax",      "type":"SALES_TAX",        "rate":0.0725, "base":"RENTAL",  "taxable":true},
            {"name":"CA Tourism Surcharge",    "type":"STATE_SURCHARGE",  "rate":0.035,  "base":"RENTAL",  "taxable":true},
            {"name":"Airport Concession Fee",  "type":"CONCESSION",       "rate":0.1111, "base":"RENTAL",  "taxable":false},
            {"name":"Customer Facility Charge","type":"FLAT_PER_DAY",     "amount":5.99, "taxable":false}
          ]'::JSONB)
        ON CONFLICT (tenant_id, name) DO NOTHING
    """)

    # 13 staff roles with permissions_json
    op.execute("""
        INSERT INTO public.staff_roles (role_key, display_name, permissions_json) VALUES
          ('CUSTOMER',          'Customer (Self-Service)', '{"self":["read","update"]}'::JSONB),
          ('CORPORATE_BOOKER',  'Corporate Booker',        '{"reservations":["read","create"],"customers":["read"]}'::JSONB),
          ('COUNTER_AGENT',     'Counter Agent',           '{"reservations":["read","create","update"],"customers":["read","create","update"],"payments":["create"],"vehicles":["read"]}'::JSONB),
          ('SENIOR_AGENT',      'Senior Agent',            '{"reservations":["*"],"customers":["*"],"payments":["create","refund"],"vehicles":["read","update"],"damage_claims":["read","create"]}'::JSONB),
          ('BRANCH_MANAGER',    'Branch Manager',          '{"reservations":["*"],"customers":["*"],"payments":["*"],"vehicles":["read","update"],"damage_claims":["*"],"reports":["location"],"rate_codes":["read"]}'::JSONB),
          ('REGIONAL_MANAGER',  'Regional Manager',        '{"reservations":["*"],"customers":["*"],"payments":["*"],"vehicles":["*"],"damage_claims":["*"],"reports":["regional"],"rate_codes":["*"]}'::JSONB),
          ('FLEET_MANAGER',     'Fleet Manager',           '{"vehicles":["*"],"vehicle_blocks":["*"],"maintenance":["*"],"reports":["fleet"]}'::JSONB),
          ('MAINTENANCE_TECH',  'Maintenance Technician',  '{"vehicles":["read","update"],"maintenance":["read","create","update"],"vehicle_blocks":["create","update"]}'::JSONB),
          ('CLAIMS_COORDINATOR','Claims Coordinator',      '{"damage_claims":["*"],"customers":["read"],"rental_agreements":["read"],"payments":["read"]}'::JSONB),
          ('FINANCE',           'Finance',                 '{"payments":["*"],"invoices":["*"],"reports":["financial"],"damage_claims":["read"]}'::JSONB),
          ('SYSTEM_ADMIN',      'System Admin',            '{"*":["*"]}'::JSONB),
          ('SUPER_ADMIN',       'Super Admin',             '{"*":"*"}'::JSONB),
          ('API_PARTNER',       'API Partner',             '{"reservations":["read","create"],"vehicles":["read"],"rate_codes":["read"]}'::JSONB)
        ON CONFLICT (role_key) DO NOTHING
    """)

    # 30 notification templates
    op.execute("""
        INSERT INTO public.notification_templates (template_id, tenant_id, event_code, channel, subject, body_html) VALUES
          ('00000000-0000-0000-0004-000000000001', NULL, 'booking.confirmed',           'EMAIL', 'Your booking is confirmed — {{confirmation_number}}', '<p>Hi {{first_name}}, reservation {{confirmation_number}} is confirmed for {{pickup_datetime}}.</p>'),
          ('00000000-0000-0000-0004-000000000002', NULL, 'booking.confirmed',           'SMS',   NULL, 'Rental {{confirmation_number}} confirmed. Pick up: {{pickup_location}} at {{pickup_datetime}}.'),
          ('00000000-0000-0000-0004-000000000003', NULL, 'booking.modified',            'EMAIL', 'Your reservation has been updated — {{confirmation_number}}', '<p>Hi {{first_name}}, reservation {{confirmation_number}} has been updated.</p>'),
          ('00000000-0000-0000-0004-000000000004', NULL, 'booking.cancelled',           'EMAIL', 'Reservation cancelled — {{confirmation_number}}', '<p>Your reservation {{confirmation_number}} has been cancelled.</p>'),
          ('00000000-0000-0000-0004-000000000005', NULL, 'booking.cancelled',           'SMS',   NULL, 'Reservation {{confirmation_number}} cancelled. Reply HELP for support.'),
          ('00000000-0000-0000-0004-000000000006', NULL, 'booking.reminder_24h',        'EMAIL', 'Reminder: your rental starts tomorrow', '<p>Hi {{first_name}}, your rental starts tomorrow at {{pickup_datetime}}.</p>'),
          ('00000000-0000-0000-0004-000000000007', NULL, 'booking.reminder_24h',        'SMS',   NULL, 'Reminder: rental {{confirmation_number}} starts tomorrow at {{pickup_time}}.'),
          ('00000000-0000-0000-0004-000000000008', NULL, 'checkout.receipt',            'EMAIL', 'Your rental agreement — {{ra_number}}', '<p>Thank you, {{first_name}}. Rental agreement {{ra_number}} is attached.</p>'),
          ('00000000-0000-0000-0004-000000000009', NULL, 'return.receipt',              'EMAIL', 'Your rental receipt — {{ra_number}}', '<p>Thanks for returning. Receipt for {{ra_number}} is attached.</p>'),
          ('00000000-0000-0000-0004-000000000010', NULL, 'return.receipt',              'SMS',   NULL, 'Return complete for {{ra_number}}. Charged: {{currency}} {{grand_total}}. Thank you!'),
          ('00000000-0000-0000-0004-000000000011', NULL, 'damage.initial_notice',       'EMAIL', 'Important: damage notice regarding your rental {{ra_number}}', '<p>Dear {{first_name}}, damage recorded on return of {{ra_number}}. Reference: {{claim_reference}}.</p>'),
          ('00000000-0000-0000-0004-000000000012', NULL, 'damage.estimate_sent',        'EMAIL', 'Damage estimate — {{claim_reference}}', '<p>Estimate of {{currency}} {{repair_estimate}} prepared for {{claim_reference}}.</p>'),
          ('00000000-0000-0000-0004-000000000013', NULL, 'damage.invoiced',             'EMAIL', 'Damage invoice — {{claim_reference}}', '<p>Invoice for {{currency}} {{total_claim_amount}} issued for {{claim_reference}}.</p>'),
          ('00000000-0000-0000-0004-000000000014', NULL, 'payment.preauth_placed',      'EMAIL', 'Pre-authorization placed on your card', '<p>Pre-auth of {{currency}} {{preauth_amount}} placed for {{ra_number}}.</p>'),
          ('00000000-0000-0000-0004-000000000015', NULL, 'payment.captured',            'EMAIL', 'Payment confirmed — {{ra_number}}', '<p>Payment of {{currency}} {{amount}} for {{ra_number}} processed.</p>'),
          ('00000000-0000-0000-0004-000000000016', NULL, 'payment.refund_issued',       'EMAIL', 'Refund issued — {{ra_number}}', '<p>Refund of {{currency}} {{refunded_amount}} issued for {{ra_number}}.</p>'),
          ('00000000-0000-0000-0004-000000000017', NULL, 'payment.preauth_expiring',    'EMAIL', 'Action required: please return your vehicle', '<p>Pre-auth for {{ra_number}} expires soon. Please return or contact us.</p>'),
          ('00000000-0000-0000-0004-000000000018', NULL, 'preauth.expiring',            'SMS',   NULL, 'Rental {{ra_number}}: pre-auth expires soon. Return vehicle or call us.'),
          ('00000000-0000-0000-0004-000000000019', NULL, 'loyalty.points_earned',       'EMAIL', 'You earned {{points}} loyalty points', '<p>Hi {{first_name}}, you earned {{points}} points on {{ra_number}}. Total: {{loyalty_points}}.</p>'),
          ('00000000-0000-0000-0004-000000000020', NULL, 'loyalty.tier_upgrade',        'EMAIL', 'Congratulations — you''ve reached {{new_tier}}!', '<p>Hi {{first_name}}, you''ve been upgraded to {{new_tier}} status!</p>'),
          ('00000000-0000-0000-0004-000000000021', NULL, 'loyalty.tier_expiry_warning', 'EMAIL', 'Your loyalty tier expires soon', '<p>Hi {{first_name}}, your {{loyalty_tier}} status expires on {{tier_expiry_date}}.</p>'),
          ('00000000-0000-0000-0004-000000000022', NULL, 'account.kyc_approved',        'EMAIL', 'Identity verification approved', '<p>Hi {{first_name}}, your identity has been verified.</p>'),
          ('00000000-0000-0000-0004-000000000023', NULL, 'account.kyc_rejected',        'EMAIL', 'Identity verification — action required', '<p>Hi {{first_name}}, we could not verify your identity. Please contact support.</p>'),
          ('00000000-0000-0000-0004-000000000024', NULL, 'account.password_reset',      'EMAIL', 'Password reset request', '<p>Click <a href="{{reset_url}}">here</a> to reset your password. Expires in 1 hour.</p>'),
          ('00000000-0000-0000-0004-000000000025', NULL, 'account.dnr_flagged',         'EMAIL', 'Account status notice', '<p>Your account has been flagged. Contact {{support_email}} for details.</p>'),
          ('00000000-0000-0000-0004-000000000026', NULL, 'vehicle.overdue',             'EMAIL', 'Your rental is overdue — {{ra_number}}', '<p>Hi {{first_name}}, rental {{ra_number}} was due at {{return_datetime}}. Please return immediately.</p>'),
          ('00000000-0000-0000-0004-000000000027', NULL, 'vehicle.overdue',             'SMS',   NULL, 'OVERDUE: Rental {{ra_number}} due at {{return_time}}. Call {{branch_phone}} immediately.'),
          ('00000000-0000-0000-0004-000000000028', NULL, 'document.license_expiring',   'EMAIL', 'Your driver''s license expires soon', '<p>Hi {{first_name}}, your license expires on {{license_expiry}}. Update before your next rental.</p>'),
          ('00000000-0000-0000-0004-000000000029', NULL, 'fleet.recall_detected',       'EMAIL', 'Safety recall notice — vehicle {{unit_number}}', '<p>NHTSA recall ({{recall_campaign}}) detected for {{unit_number}} (VIN: {{vin}}).</p>'),
          ('00000000-0000-0000-0004-000000000030', NULL, 'extension.approved',          'EMAIL', 'Rental extension confirmed — {{ra_number}}', '<p>Hi {{first_name}}, rental {{ra_number}} extended to {{new_return_datetime}}.</p>')
        ON CONFLICT (tenant_id, event_code, channel) DO NOTHING
    """)


def downgrade() -> None:
    op.execute("""
        DELETE FROM public.notification_templates
         WHERE template_id::TEXT LIKE '00000000-0000-0000-0004-%'
    """)
    op.execute("""
        DELETE FROM public.staff_roles
         WHERE role_key IN (
           'CUSTOMER','CORPORATE_BOOKER','COUNTER_AGENT','SENIOR_AGENT',
           'BRANCH_MANAGER','REGIONAL_MANAGER','FLEET_MANAGER','MAINTENANCE_TECH',
           'CLAIMS_COORDINATOR','FINANCE','SYSTEM_ADMIN','SUPER_ADMIN','API_PARTNER'
         )
    """)
    op.execute("""
        DELETE FROM public.tax_templates
         WHERE template_id = '00000000-0000-0000-0003-000000000001'
    """)
    op.execute("""
        DELETE FROM public.extras_catalog
         WHERE extra_id::TEXT LIKE '00000000-0000-0000-0002-%'
    """)
