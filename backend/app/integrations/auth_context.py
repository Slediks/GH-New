"""Opaque, authenticated context for the existing LAN authentication API."""

import base64
import ipaddress
import json
import os
import re
import secrets
import time

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

AAD = b"gamehub-auth-context-v1"
DEFAULT_HEADER = "X-Request-Context"
HEADER_PATTERN = re.compile(r"X-[A-Za-z0-9-]{1,62}\Z", re.IGNORECASE)


def seal_context(
    login: str, client_ip: str | None, key_hex: str, header_name: str
) -> tuple[str, str]:
    """Return a neutral header name and an opaque value for one login attempt.

    The caller must obtain client_ip from the trusted ingress, not from a
    browser-supplied forwarding header. The receiver checks time and request_id.
    """
    if not HEADER_PATTERN.fullmatch(header_name) or header_name.lower() == "x-edge-context":
        raise ValueError("Invalid auth context header name")
    if not re.fullmatch(r"[0-9a-fA-F]{64}", key_hex):
        raise ValueError("AUTH_CONTEXT_KEY must be 32 bytes encoded as hex")
    if not client_ip:
        raise ValueError("Trusted client address is unavailable")
    address = str(ipaddress.ip_address(client_ip))
    payload = {
        "version": 1,
        "login": login,
        "peer": address,
        "issued_at": int(time.time()),
        "request_id": secrets.token_hex(16),
    }
    nonce = os.urandom(12)
    plaintext = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    ciphertext = AESGCM(bytes.fromhex(key_hex)).encrypt(nonce, plaintext, AAD)
    encoded = base64.urlsafe_b64encode(nonce + ciphertext).rstrip(b"=").decode("ascii")
    return header_name, f"v1.{encoded}"
