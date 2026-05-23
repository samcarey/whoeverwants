"""Transactional email — Resend wrapper with logging fallback.

Resend (resend.com) is the chosen provider for Phase B magic-link emails.
Picked for: generous free tier, simple REST API (no SDK dep needed —
plain httpx works), one-time DNS-records-only setup, decent default
deliverability.

Configuration via environment variables (set on each tier's API droplet
via `.env.api`):
  RESEND_API_KEY       — required to actually send.
  RESEND_FROM_EMAIL    — defaults to noreply@whoeverwants.com. Must be on
                         a Resend-verified domain. Per-tier overrides
                         (e.g. `noreply@latest.whoeverwants.com`) only
                         work if that domain is verified separately.
  RESEND_FROM_NAME     — defaults to "WhoeverWants".

When `RESEND_API_KEY` is missing the helper logs the email contents to
stdout (`[email]` prefix at WARNING level — surfaced through the
existing API log stream so devs can copy-paste magic links during local
testing) and returns success. This keeps the dev path zero-config and
the prod path failure-loud.
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass

import httpx

log = logging.getLogger("email")

_RESEND_API_KEY = os.environ.get("RESEND_API_KEY")
_RESEND_FROM_EMAIL = os.environ.get("RESEND_FROM_EMAIL", "noreply@whoeverwants.com")
_RESEND_FROM_NAME = os.environ.get("RESEND_FROM_NAME", "WhoeverWants")
_RESEND_API_URL = "https://api.resend.com/emails"


@dataclass
class EmailMessage:
    to: str
    subject: str
    html: str
    text: str


def email_configured() -> bool:
    """Whether real email sending is wired up. The `/api/auth/me` payload
    surfaces this so the FE can show a "magic links won't actually be
    delivered on this tier" warning in dev."""
    return bool(_RESEND_API_KEY)


def send_email(msg: EmailMessage) -> bool:
    """Send a transactional email. Returns True on success (including
    the dev logging fallback), False on send failure. Never raises —
    the auth endpoints rely on this and they want to return 200 to the
    user regardless of email delivery state (to avoid leaking 'is this
    address registered' via response shape)."""

    if not _RESEND_API_KEY:
        log.warning(
            "[email] RESEND_API_KEY not configured; logging instead of sending. "
            "To: %s | Subject: %s | Text:\n%s",
            msg.to,
            msg.subject,
            msg.text,
        )
        return True

    from_field = f"{_RESEND_FROM_NAME} <{_RESEND_FROM_EMAIL}>"
    payload = {
        "from": from_field,
        "to": [msg.to],
        "subject": msg.subject,
        "html": msg.html,
        "text": msg.text,
    }
    try:
        with httpx.Client(timeout=10.0) as client:
            response = client.post(
                _RESEND_API_URL,
                headers={
                    "Authorization": f"Bearer {_RESEND_API_KEY}",
                    "Content-Type": "application/json",
                },
                json=payload,
            )
        if response.status_code >= 400:
            log.error(
                "[email] Resend rejected %s: status=%s body=%s",
                msg.to,
                response.status_code,
                response.text[:500],
            )
            return False
        return True
    except httpx.RequestError as exc:
        log.error("[email] Resend network error for %s: %s", msg.to, exc)
        return False


def send_magic_link(*, to_email: str, magic_url: str) -> bool:
    """Send the sign-in magic-link email. `magic_url` is the full FE URL
    the user clicks (e.g. `https://whoeverwants.com/auth/verify?token=...`).
    """
    subject = "Sign in to WhoeverWants"
    text = (
        "Tap the link below to sign in. It expires in 15 minutes and can "
        "only be used once.\n\n"
        f"{magic_url}\n\n"
        "If you didn't request this, you can ignore this email — your "
        "account is unchanged."
    )
    html = f"""<!doctype html>
<html><body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #111; line-height: 1.5;">
  <p>Tap the link below to sign in. It expires in 15 minutes and can only be used once.</p>
  <p style="margin: 24px 0;">
    <a href="{magic_url}" style="background: #2563eb; color: white; padding: 12px 20px; text-decoration: none; border-radius: 8px; display: inline-block; font-weight: 500;">Sign in to WhoeverWants</a>
  </p>
  <p style="font-size: 12px; color: #6b7280;">Or copy this URL: <br/><span style="word-break: break-all;">{magic_url}</span></p>
  <p style="font-size: 12px; color: #6b7280; margin-top: 24px;">If you didn't request this, you can ignore this email — your account is unchanged.</p>
</body></html>
"""
    return send_email(EmailMessage(to=to_email, subject=subject, html=html, text=text))


def send_recovery_email(*, to_email: str, verify_url: str) -> bool:
    """Send the Phase I "confirm this recovery email" link. `verify_url`
    is the full FE URL (e.g.
    `https://whoeverwants.com/auth/recovery-email?token=...`). Copy
    differs from the sign-in link: this CONFIRMS an email the user is
    adding to an existing account, so the "if you didn't request this"
    line is reassuring rather than a security warning."""
    subject = "Confirm your WhoeverWants recovery email"
    text = (
        "Tap the link below to confirm this email as a way to sign in to "
        "your WhoeverWants account. It expires in 15 minutes and can only "
        "be used once.\n\n"
        f"{verify_url}\n\n"
        "If you didn't request this, you can ignore this email — nothing "
        "will be added to any account."
    )
    html = f"""<!doctype html>
<html><body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #111; line-height: 1.5;">
  <p>Tap the link below to confirm this email as a way to sign in to your WhoeverWants account. It expires in 15 minutes and can only be used once.</p>
  <p style="margin: 24px 0;">
    <a href="{verify_url}" style="background: #2563eb; color: white; padding: 12px 20px; text-decoration: none; border-radius: 8px; display: inline-block; font-weight: 500;">Confirm recovery email</a>
  </p>
  <p style="font-size: 12px; color: #6b7280;">Or copy this URL: <br/><span style="word-break: break-all;">{verify_url}</span></p>
  <p style="font-size: 12px; color: #6b7280; margin-top: 24px;">If you didn't request this, you can ignore this email — nothing will be added to any account.</p>
</body></html>
"""
    return send_email(EmailMessage(to=to_email, subject=subject, html=html, text=text))
