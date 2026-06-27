"""seed agent notification templates

Revision ID: 044_agent_notification_templates
Revises: 20260624_043
Create Date: 2026-06-23
"""
from __future__ import annotations
from alembic import op

revision: str = '044_agent_notification_templates'
down_revision: str | None = '20260624_043'
branch_labels = None
depends_on = None

# System-wide templates (tenant_id IS NULL) for agent-dispatched events.
# render_and_send() checks tenant-specific first, falls back to system.

_TEMPLATES = [
    (
        "BOOKING_REMINDER_24H", "EMAIL",
        "Your rental pickup is tomorrow",
        "<p>Hi {{ first_name }},</p><p>This is a reminder that your <strong>{{ vehicle_class }}</strong> pickup "
        "is scheduled for <strong>{{ pickup_datetime }}</strong> at {{ pickup_location }}.</p>"
        "<p>Confirmation: <strong>{{ confirmation_number }}</strong></p>",
        "Hi {{ first_name }}, your rental pickup is tomorrow at {{ pickup_datetime }}. "
        "Confirmation: {{ confirmation_number }}. See you then!",
    ),
    (
        "BOOKING_REMINDER_24H", "SMS",
        "",
        "",
        "Hi {{ first_name }}, your {{ vehicle_class }} pickup is tomorrow at {{ pickup_datetime }} "
        "from {{ pickup_location }}. Confirmation: {{ confirmation_number }}.",
    ),
    (
        "EV_LOW_SOC_ALERT", "SMS",
        "",
        "",
        "Alert: Vehicle {{ license_plate }} battery is at {{ soc_pct }}%. "
        "Please plug in at the nearest charging point.",
    ),
    (
        "RENTAL_OVERDUE_SOFT", "SMS",
        "",
        "",
        "Hi {{ first_name }}, your rental was due back at {{ return_time }}. "
        "Are you on your way? Reply YES to confirm or EXTEND if you need more time.",
    ),
    (
        "RENTAL_OVERDUE_HARD", "SMS",
        "",
        "",
        "Hi {{ first_name }}, your rental is now {{ hours_overdue }}h overdue. "
        "Please contact us immediately at {{ support_phone }}.",
    ),
]


def upgrade() -> None:
    for event_code, channel, subject, body_html, body_text in _TEMPLATES:
        op.execute(f"""
            INSERT INTO public.notification_templates
                (event_code, channel, subject, body_html, body_text, is_active)
            VALUES (
                '{event_code}', '{channel}',
                '{subject.replace("'", "''")}',
                '{body_html.replace("'", "''")}',
                '{body_text.replace("'", "''")}',
                true
            )
            ON CONFLICT DO NOTHING
        """)


def downgrade() -> None:
    for event_code, channel, *_ in _TEMPLATES:
        op.execute(f"""
            DELETE FROM public.notification_templates
            WHERE event_code = '{event_code}' AND channel = '{channel}' AND tenant_id IS NULL
        """)
