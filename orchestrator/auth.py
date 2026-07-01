"""
Authentication helpers and /auth/* endpoints for UndosaTech.
"""
import logging
from typing import Optional

from fastapi import APIRouter, HTTPException, Header, Body

from orchestrator.state import (
    supabase_admin, ADMIN_EMAILS, RESEND_API_KEY, APP_URL,
)

logger = logging.getLogger("undosatech")
router = APIRouter()

# ── Institutional domain patterns ─────────────────────────────────────────────
_INSTITUTIONAL_PATTERNS = [
    # UK / Ireland
    ".ac.uk", ".nhs.uk", ".nhs.net", ".gov.uk", ".hse.ie",
    # USA / global .edu
    ".edu",
    # Australia / NZ / Pacific
    ".edu.au", ".ac.nz", ".ac.fj", ".ac.pg",
    # Europe — countries using .ac.XX
    ".ac.at", ".ac.be", ".ac.cy",
    # European institutional prefixes (domain starts with)
    "uni-", "tu-", "fh-", "hs-", "univ-",
    # Switzerland
    "eth.ch", "epfl.ch", "uzh.ch", "unibe.ch", "unil.ch", "unige.ch", "unibas.ch",
    # Germany
    "rwth-aachen.de", "fu-berlin.de", "hu-berlin.de", "lmu.de", "tum.de",
    "charite.de", "dkfz.de", "embl.de", "mpg.de",
    # France
    "inserm.fr", "cnrs.fr", "inria.fr", "pasteur.fr",
    "sorbonne-universite.fr", "u-paris.fr", "ens.fr",
    # Netherlands
    "uva.nl", "vu.nl", "tudelft.nl", "leiden.nl", "rug.nl", "uu.nl",
    "utwente.nl", "tue.nl", "radboudumc.nl", "erasmusmc.nl",
    "umcutrecht.nl", "lumc.nl", "nki.nl", "umcg.nl",
    # Scandinavia
    "uio.no", "ntnu.no", "uib.no", "ku.dk", "dtu.dk", "au.dk",
    "su.se", "kth.se", "ki.se", "chalmers.se", "gu.se",
    "aalto.fi", "helsinki.fi", "oulu.fi",
    # Belgium
    "kuleuven.be", "ugent.be", "vub.be", "uliege.be", "ulb.be",
    # Spain
    "upm.es", "uam.es", "ucm.es", "upv.es",
    # Italy
    "unibo.it", "polimi.it", "polito.it", "uniroma1.it",
    # Canada
    "utoronto.ca", "ubc.ca", "mcgill.ca", "ualberta.ca", "uwaterloo.ca",
    "queensu.ca", "dal.ca", "uottawa.ca", "umontreal.ca", "laval.ca",
    "ucalgary.ca", "usask.ca", "umanitoba.ca", "unb.ca", "mun.ca",
    "yorku.ca", "carleton.ca", "sfu.ca", "uvic.ca", "concordia.ca",
    "torontomu.ca", "uqam.ca", "gc.ca",
    # Asia
    ".ac.jp", ".ac.in", ".ac.id", ".ac.il", ".ac.ir",
    ".ac.kr", ".ac.th", ".ac.ae", ".ac.lk",
    # Africa
    ".ac.za", ".ac.ke", ".ac.ug", ".ac.tz", ".ac.rw", ".ac.zw",
    ".ac.zm", ".ac.mw", ".ac.gh", ".ac.bw", ".ac.na", ".ac.mu",
    # Global health & research orgs
    ".nih.gov", ".cdc.gov", "who.int", "wellcome.org",
]


def _is_institutional_domain(domain: str) -> bool:
    """Return True if domain belongs to an academic, healthcare, or research institution."""
    d = domain.lower().lstrip("@")
    return any(d.endswith(p) or d == p.lstrip(".") or p in d for p in _INSTITUTIONAL_PATTERNS)


# ── Auth helpers ──────────────────────────────────────────────────────────────
def _require_user(authorization: Optional[str]):
    if not supabase_admin:
        return type("User", (), {"id": "local", "email": "local@dev"})()
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing Authorization header")
    token = authorization.split(" ", 1)[1]
    try:
        result = supabase_admin.auth.get_user(token)
        if not result or not result.user:
            raise HTTPException(status_code=401, detail="Invalid token")
        return result.user
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=401, detail="Token validation failed")


def _require_admin(authorization: Optional[str]):
    user = _require_user(authorization)
    if not hasattr(user, "email") or user.email not in ADMIN_EMAILS:
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


# ── Email helpers ─────────────────────────────────────────────────────────────
def _send_approval_email(to_email: str, full_name: str, login_url: str) -> Optional[str]:
    """Send acceptance email via Resend. Returns error string or None on success."""
    if not RESEND_API_KEY:
        logger.warning("RESEND_API_KEY not set — skipping approval email")
        return "RESEND_API_KEY not configured"
    try:
        import resend
        resend.api_key = RESEND_API_KEY
        first_name = full_name.split()[0] if full_name else "Researcher"
        resend.Emails.send({
            "from": "UndosaTech <admin@undosatech.com>",
            "to": [to_email],
            "subject": "Your UndosaTech application has been approved",
            "html": f"""
<!DOCTYPE html>
<html>
<body style="font-family:Arial,sans-serif;background:#f9fafb;margin:0;padding:32px;">
  <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;
              padding:40px;border:1px solid #e5e7eb;">
    <div style="font-size:22px;font-weight:800;color:#1d4ed8;margin-bottom:4px;">
      UndosaTech
    </div>
    <div style="font-size:12px;color:#9ca3af;margin-bottom:32px;">
      Federated Research Platform
    </div>
    <p style="font-size:16px;color:#111827;margin:0 0 16px;">
      Dear {first_name},
    </p>
    <p style="font-size:15px;color:#374151;line-height:1.6;margin:0 0 16px;">
      Congratulations! Your application to join the UndosaTech Federated Research
      Platform has been <strong>accepted</strong> and your account has been created.
    </p>
    <p style="font-size:15px;color:#374151;line-height:1.6;margin:0 0 20px;">
      Click the button below to set your password. This link expires in 24 hours.
    </p>
    <div style="text-align:center;margin-bottom:16px;">
      <a href="{login_url}"
         style="display:inline-block;background:#1d4ed8;color:#fff;font-weight:700;
                font-size:15px;padding:13px 32px;border-radius:8px;
                text-decoration:none;">
        Set Your Password
      </a>
    </div>
    <p style="font-size:13px;color:#6b7280;text-align:center;margin:0 0 20px;">
      Alternatively, use <strong>Continue with Google</strong> on the login page
      if this email is linked to your Google account.
    </p>
    <p style="font-size:13px;color:#9ca3af;margin:0;">
      If you have any questions, reply to this email or contact us at
      <a href="mailto:admin@undosatech.com" style="color:#1d4ed8;">admin@undosatech.com</a>.
    </p>
    <hr style="border:none;border-top:1px solid #f3f4f6;margin:24px 0 16px;">
    <p style="font-size:11px;color:#d1d5db;margin:0;">
      © UndosaTech · This link expires in 24 hours.
    </p>
  </div>
</body>
</html>""",
        })
        return None
    except Exception as e:
        logger.warning(f"Approval email failed for {to_email}: {e}")
        return str(e)


def _send_invitation_email(
    to_email: str, node_name: str, study_name: str,
    invited_by_email: str, message: str = "",
) -> Optional[str]:
    """Send study invitation email to a node operator via Resend."""
    if not RESEND_API_KEY:
        logger.warning("RESEND_API_KEY not set — skipping invitation email")
        return "RESEND_API_KEY not configured"
    try:
        import resend
        resend.api_key = RESEND_API_KEY
        portal_url = "https://app.undosatech.com"
        msg_block = (
            f"<p style='font-size:14px;color:#374151;line-height:1.5;margin:0 0 16px;'>"
            f"Message from researcher: <em>{message}</em></p>"
            if message else ""
        )
        resend.Emails.send({
            "from": "UndosaTech <admin@undosatech.com>",
            "to": [to_email],
            "subject": f"Study invitation: {study_name}",
            "html": f"""<!DOCTYPE html>
<html>
<body style="font-family:Arial,sans-serif;background:#f9fafb;margin:0;padding:32px;">
  <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;padding:40px;border:1px solid #e5e7eb;">
    <div style="font-size:22px;font-weight:800;color:#1d4ed8;margin-bottom:4px;">UndosaTech</div>
    <div style="font-size:12px;color:#9ca3af;margin-bottom:32px;">Federated Research Platform</div>
    <p style="font-size:16px;color:#111827;margin:0 0 16px;">Dear {node_name},</p>
    <p style="font-size:15px;color:#374151;line-height:1.6;margin:0 0 16px;">
      You have been invited to participate in the federated learning study
      <strong>"{study_name}"</strong> by <strong>{invited_by_email}</strong>.
    </p>
    {msg_block}
    <p style="font-size:15px;color:#374151;line-height:1.6;margin:0 0 24px;">
      Log in to the portal to review and accept or decline this invitation.
    </p>
    <div style="text-align:center;margin:0 0 32px;">
      <a href="{portal_url}" style="background:#1d4ed8;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;">View Invitation</a>
    </div>
    <p style="font-size:12px;color:#9ca3af;">UndosaTech · Federated Learning Platform · app.undosatech.com</p>
  </div>
</body>
</html>""",
        })
        return None
    except Exception as e:
        logger.warning(f"Invitation email to {to_email} failed: {e}")
        return str(e)


def _get_node_contact(node_id: str) -> tuple:
    """Return (contact_email, institution_name) for a node, or ('', node_id) if unknown."""
    if not supabase_admin:
        return ("", node_id)
    try:
        result = (
            supabase_admin.table("fl_nodes")
            .select("contact_email,institution_name")
            .eq("node_id", node_id)
            .maybe_single()
            .execute()
        )
        data = result.data or {}
        return (data.get("contact_email", ""), data.get("institution_name", node_id))
    except Exception as e:
        logger.warning(f"_get_node_contact failed for {node_id}: {e}")
        return ("", node_id)


# ── /auth/* endpoints ─────────────────────────────────────────────────────────
@router.post("/auth/forgot-password")
async def forgot_password(body: dict = Body(...)):
    """Send a password-reset email from admin@undosatech.com via Resend."""
    email = (body.get("email") or "").strip().lower()
    if not email:
        raise HTTPException(400, "Email is required")
    if not supabase_admin:
        raise HTTPException(503, "Requires Supabase")

    try:
        link_resp = supabase_admin.auth.admin.generate_link({
            "type": "recovery",
            "email": email,
            "options": {"redirect_to": f"{APP_URL}/#reset-password"},
        })
        reset_url = getattr(getattr(link_resp, "properties", None), "action_link", None)
    except Exception as e:
        logger.warning(f"generate_link(recovery) failed for {email}: {e}")
        return {"sent": True}

    if not reset_url:
        return {"sent": True}

    if not RESEND_API_KEY:
        logger.warning("RESEND_API_KEY not set — skipping reset email")
        return {"sent": False, "error": "RESEND_API_KEY not configured"}

    try:
        import resend
        resend.api_key = RESEND_API_KEY
        resend.Emails.send({
            "from": "UndosaTech <admin@undosatech.com>",
            "to": [email],
            "subject": "Reset your UndosaTech password",
            "html": f"""
<!DOCTYPE html>
<html>
<body style="font-family:Arial,sans-serif;background:#f9fafb;margin:0;padding:32px;">
  <div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;
              padding:40px;border:1px solid #e5e7eb;">
    <div style="font-size:22px;font-weight:800;color:#1d4ed8;margin-bottom:4px;">UndosaTech</div>
    <div style="font-size:12px;color:#9ca3af;margin-bottom:32px;">Federated Research Platform</div>
    <p style="font-size:16px;color:#111827;margin:0 0 16px;">Password reset requested</p>
    <p style="font-size:15px;color:#374151;line-height:1.6;margin:0 0 28px;">
      Click the button below to set a new password. This link expires in 1 hour.
      If you didn't request this, you can safely ignore this email.
    </p>
    <div style="text-align:center;margin-bottom:28px;">
      <a href="{reset_url}"
         style="display:inline-block;background:#1d4ed8;color:#fff;font-weight:700;
                font-size:15px;padding:13px 32px;border-radius:8px;text-decoration:none;">
        Set New Password
      </a>
    </div>
    <hr style="border:none;border-top:1px solid #f3f4f6;margin:24px 0 16px;">
    <p style="font-size:11px;color:#d1d5db;margin:0;">© UndosaTech</p>
  </div>
</body>
</html>""",
        })
    except Exception as e:
        logger.warning(f"Reset email send failed for {email}: {e}")

    return {"sent": True}
