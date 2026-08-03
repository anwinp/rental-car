"""
Integration clients for third-party APIs.

Import convenience — all clients exported from this package.

Usage:
    from app.integrations import AvalaraClient, NHTSAClient, StripeMerchantApi
    from app.integrations import TwilioClient, SendGridClient
"""
from app.integrations.avalara_client import (
    AvalaraAddress,
    AvalaraClient,
    AvalaraLineItem,
    TaxCode,
    TaxLine,
    TaxTransactionResult,
)
from app.integrations.nhtsa_client import (
    NHTSAClient,
    RecallResult,
    VinDecodeResult,
)
from app.integrations.sendgrid_client import SendGridClient
from app.integrations.stripe_merchant import StripeMerchantApi
from app.integrations.twilio_client import TwilioClient

__all__ = [
    # Avalara AvaTax
    "AvalaraClient",
    "AvalaraLineItem",
    "AvalaraAddress",
    "TaxCode",
    "TaxLine",
    "TaxTransactionResult",
    # NHTSA
    "NHTSAClient",
    "VinDecodeResult",
    "RecallResult",
    # Notifications
    "SendGridClient",
    "TwilioClient",
    # Payments
    "StripeMerchantApi",
]
