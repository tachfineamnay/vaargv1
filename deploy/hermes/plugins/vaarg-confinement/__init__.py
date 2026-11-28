"""VAARG V1 Confinement & ToolBroker Bridge Plugin for NousResearch/hermes-agent v0.23.4.

Provides:
1. Preventive LLM call reservation (`pre_api_request`) and post-call usage reconciliation
   (`post_api_request`) against VAARG's PostgreSQL shared parent+child budget authority.
2. Child specialist registration (`subagent_start` / `subagent_stop`) enforcing max depth 1,
   max 3 concurrent children, specialist role binding, and verified run provider/model policy
   with zero hardcoded provider or model fallbacks (FL07 T00.2).
3. Defense-in-depth tool denylist (`pre_tool_call`) blocking shell, filesystem, code execution,
   browsing, web, SQL, Docker, autonomous memory, and admin tools.
4. Cryptographic HMAC-SHA256 confinement attestation (`POST /internal/v1/hermes-bridge/guard/runtime-attest`)
   proving preventive hooks and ToolBroker confinement are active (FL07 T00.4).
5. Authenticated forwarding of the 10 VAARG ToolBroker capabilities over the private internal
   network (`POST /internal/v1/hermes-bridge/tools/invoke`).
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import re
import threading
import time
import urllib.error
import urllib.request
import uuid
from typing import Any

PLUGIN_VERSION = "1.1.0"
HERMES_PINNED_VERSION = "0.23.4"
RUNTIME_INSTANCE_ID = str(uuid.uuid4())
REGISTERED_HOOKS = (
    "pre_tool_call",
    "pre_api_request",
    "post_api_request",
    "subagent_start",
    "subagent_stop",
)

FORBIDDEN_TOOLS = frozenset({
    "terminal",
    "process_manage",
    "shell",
    "bash",
    "sh",
    "read_file",
    "write_file",
    "patch",
    "search_files",
    "execute_code",
    "browser_exec",
    "browser_cdp",
    "browser_navigate",
    "web_search",
    "web_extract",
    "sql",
    "docker",
    "cronjob_manage",
    "memory",
    "session_search",
    "manage_connections",
})

ROLE_TAG_RE = re.compile(r"\[ROLE:(discovery|experience|commerce|memory|marketing|support)\]")

_LOCK = threading.Lock()
_SESSION_TICKETS: dict[str, str] = {}
_SESSION_POLICIES: dict[str, tuple[str, str]] = {}
_PENDING_RESERVATIONS: dict[str, str] = {}
_LAST_ATTESTATION_TS: float = 0.0

VAARG_CAPABILITY_SPECS: list[tuple[str, str, dict[str, Any]]] = [
    (
        "search_catalog",
        "Search store catalog in current verified market with lexical, hybrid, or contextual retrieval.",
        {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "q": {"type": "string"},
                "mode": {"type": "string", "enum": ["lexical", "hybrid", "contextual"]},
                "limit": {"type": "integer", "minimum": 1, "maximum": 24},
                "constraints": {"type": "object"},
            },
        },
    ),
    (
        "get_product",
        "Retrieve verified Shopify product details, variants, options, and market pricing.",
        {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "shopifyGid": {"type": "string"},
                "handle": {"type": "string"},
            },
        },
    ),
    (
        "get_variant",
        "Retrieve a verified Shopify product variant by ProductVariant GID.",
        {
            "type": "object",
            "additionalProperties": False,
            "required": ["variantGid"],
            "properties": {"variantGid": {"type": "string"}},
        },
    ),
    (
        "compare_products",
        "Compare 2 to 4 verified catalog products side by side.",
        {
            "type": "object",
            "additionalProperties": False,
            "required": ["products"],
            "properties": {"products": {"type": "array", "minItems": 2, "maxItems": 4}},
        },
    ),
    (
        "get_compatible_options",
        "Inspect declared options and personalization fields for a product (compatibility is UNKNOWN unless declared).",
        {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "shopifyGid": {"type": "string"},
                "handle": {"type": "string"},
            },
        },
    ),
    (
        "get_related_products",
        "Find verified products in the same collection or product type.",
        {
            "type": "object",
            "additionalProperties": False,
            "required": ["product"],
            "properties": {
                "product": {"type": "object"},
                "limit": {"type": "integer", "minimum": 1, "maximum": 12},
            },
        },
    ),
    (
        "get_experience_context",
        "Read the active visitor session ExperienceContext and contextVersion.",
        {"type": "object", "additionalProperties": False, "properties": {}},
    ),
    (
        "get_recommendations",
        "Retrieve consent-aware, market-scoped product recommendations.",
        {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "seedProductRef": {"type": ["string", "null"]},
                "constraints": {"type": "object"},
                "limit": {"type": "integer", "minimum": 1, "maximum": 24},
            },
        },
    ),
    (
        "propose_experience_composition",
        "Create a validated non-mutating AdaptiveComposition proposal bound to contextVersion.",
        {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "reason": {"type": "string"},
                "limit": {"type": "integer", "minimum": 1, "maximum": 24},
                "idempotencyKey": {"type": "string"},
            },
        },
    ),
    (
        "update_explicit_criteria",
        "Record explicit visitor-declared exploration criteria on the active session (Master role only).",
        {
            "type": "object",
            "additionalProperties": False,
            "required": ["criteria"],
            "properties": {
                "criteria": {"type": "object"},
                "idempotencyKey": {"type": "string"},
            },
        },
    ),
]


def _bridge_post(path: str, payload: dict[str, Any], timeout: float = 15.0) -> dict[str, Any]:
    base_url = (os.environ.get("VAARG_INTERNAL_API_URL") or "").rstrip("/")
    secret = (os.environ.get("HERMES_TOOL_BRIDGE_SECRET") or "").strip()
    if not base_url or len(secret) < 32:
        raise RuntimeError("VAARG internal ToolBroker bridge is not configured")

    req = urllib.request.Request(
        f"{base_url}{path}",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {secret}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"VAARG bridge HTTP {exc.code}: {detail[:300]}") from exc


def _attest_runtime_confinement(force: bool = False) -> None:
    global _LAST_ATTESTATION_TS
    now_sec = time.time()
    if not force and (now_sec - _LAST_ATTESTATION_TS) < 120.0:
        return
    secret = (os.environ.get("HERMES_TOOL_BRIDGE_SECRET") or "").strip()
    base_url = (os.environ.get("VAARG_INTERNAL_API_URL") or "").rstrip("/")
    if not base_url or len(secret) < 32:
        return

    timestamp_ms = int(now_sec * 1000)
    cap_names = [spec[0] for spec in VAARG_CAPABILITY_SPECS]
    canonical = "|".join([
        "vaarg-runtime-attest:v1",
        RUNTIME_INSTANCE_ID,
        HERMES_PINNED_VERSION,
        PLUGIN_VERSION,
        ",".join(sorted(REGISTERED_HOOKS)),
        ",".join(sorted(cap_names)),
        "1",
        str(timestamp_ms),
    ])
    signature = hmac.new(
        secret.encode("utf-8"),
        canonical.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    try:
        _bridge_post(
            "/internal/v1/hermes-bridge/guard/runtime-attest",
            {
                "runtimeInstanceId": RUNTIME_INSTANCE_ID,
                "hermesVersion": HERMES_PINNED_VERSION,
                "pluginVersion": PLUGIN_VERSION,
                "activeHooks": list(REGISTERED_HOOKS),
                "registeredCapabilities": cap_names,
                "forbiddenToolsBlocked": True,
                "timestampMs": timestamp_ms,
                "signature": signature,
            },
            timeout=5.0,
        )
        _LAST_ATTESTATION_TS = now_sec
    except Exception:
        pass


def _resolve_session_context(
    session_id: str, extra: dict[str, Any] | None = None
) -> tuple[str, tuple[str, str] | None]:
    headers = (extra or {}).get("headers") or {}
    header_ticket = headers.get("X-Vaarg-Bridge-Ticket") or headers.get("x-vaarg-bridge-ticket")
    header_provider = (
        headers.get("X-Vaarg-Run-Provider") or headers.get("x-vaarg-run-provider") or ""
    ).strip().lower()
    header_model = (
        headers.get("X-Vaarg-Run-Model") or headers.get("x-vaarg-run-model") or ""
    ).strip()

    with _LOCK:
        if header_ticket and session_id:
            _SESSION_TICKETS[session_id] = str(header_ticket)
            if header_provider and header_model:
                _SESSION_POLICIES[session_id] = (header_provider, header_model)
        return _SESSION_TICKETS.get(session_id, ""), _SESSION_POLICIES.get(session_id)


def _resolve_verified_model_policy(
    event: dict[str, Any], verified_policy: tuple[str, str] | None
) -> tuple[str, str] | None:
    raw_provider = str(event.get("provider") or "").strip().lower()
    raw_model = str(event.get("model") or "").strip()

    if verified_policy is not None:
        expected_provider, expected_model = verified_policy
        if raw_provider and raw_provider != expected_provider:
            return None
        if raw_model and raw_model != expected_model:
            return None
        return expected_provider, expected_model

    if raw_provider and raw_model:
        return raw_provider, raw_model
    return None


def _on_pre_tool_call(event: dict[str, Any]) -> dict[str, Any] | None:
    _attest_runtime_confinement(False)
    tool_name = str(event.get("tool_name") or event.get("name") or "")
    if tool_name in FORBIDDEN_TOOLS:
        return {
            "action": "block",
            "message": f"FORBIDDEN_RUNTIME_TOOL: {tool_name} is disabled by VAARG confinement policy.",
        }
    return None


def _on_pre_api_request(event: dict[str, Any]) -> dict[str, Any] | None:
    _attest_runtime_confinement(False)
    session_id = str(event.get("session_id") or "")
    ticket, session_policy = _resolve_session_context(session_id, event)
    if not ticket:
        return {
            "action": "block",
            "message": "MISSING_BRIDGE_TICKET: Unauthenticated Hermes LLM call blocked.",
        }

    resolved = _resolve_verified_model_policy(event, session_policy)
    if resolved is None:
        return {
            "action": "block",
            "message": "UNVERIFIED_MODEL_POLICY: Provider and model must match verified VAARG run policy (implicit fallbacks forbidden).",
        }
    provider, model = resolved

    try:
        res = _bridge_post(
            "/internal/v1/hermes-bridge/guard/llm-reserve",
            {
                "bridgeTicket": ticket,
                "hermesSessionId": session_id,
                "provider": provider,
                "model": model,
                "estimatedInputTokens": int(event.get("estimated_input_tokens") or 2048),
                "maxOutputTokens": int(event.get("max_tokens") or 2048),
            },
        )
        reservation_id = str(res.get("reservationId") or "")
        with _LOCK:
            _SESSION_POLICIES[session_id] = (provider, model)
            if reservation_id:
                _PENDING_RESERVATIONS[session_id] = reservation_id
        return None
    except Exception as exc:
        return {"action": "block", "message": str(exc)}


def _on_post_api_request(event: dict[str, Any]) -> None:
    session_id = str(event.get("session_id") or "")
    with _LOCK:
        ticket = _SESSION_TICKETS.get(session_id, "")
        session_policy = _SESSION_POLICIES.get(session_id)
        reservation_id = _PENDING_RESERVATIONS.pop(session_id, "")
    if not ticket or not reservation_id:
        return

    resolved = _resolve_verified_model_policy(event, session_policy)
    if resolved is None:
        return
    provider, model = resolved
    usage = event.get("usage") or {}
    try:
        _bridge_post(
            "/internal/v1/hermes-bridge/guard/llm-reconcile",
            {
                "bridgeTicket": ticket,
                "reservationId": reservation_id,
                "hermesSessionId": session_id,
                "provider": provider,
                "model": model,
                "inputTokens": int(usage.get("input_tokens") or 0),
                "outputTokens": int(usage.get("output_tokens") or 0),
                "cacheReadTokens": int(usage.get("cache_read_tokens") or 0),
                "cacheWriteTokens": int(usage.get("cache_write_tokens") or 0),
            },
        )
    except Exception:
        pass


def _on_subagent_start(event: dict[str, Any]) -> dict[str, Any] | None:
    _attest_runtime_confinement(False)
    parent_session = str(event.get("parent_session_id") or "")
    child_session = str(event.get("child_session_id") or "")
    if not parent_session or not child_session:
        return {"action": "block", "message": "INVALID_SUBAGENT_SESSION_IDS"}
    depth = int(event.get("depth") or 1)
    goal = str(event.get("goal") or "")
    match = ROLE_TAG_RE.search(goal)
    if not match:
        return {
            "action": "block",
            "message": "MISSING_SPECIALIST_ROLE_TAG: Child delegation requires an explicit [ROLE:<specialist>] tag.",
        }
    role = match.group(1)

    with _LOCK:
        ticket = _SESSION_TICKETS.get(parent_session, "")
    if not ticket:
        return {"action": "block", "message": "MISSING_PARENT_BRIDGE_TICKET"}

    explicit_provider = str(event.get("provider") or "").strip().lower()
    explicit_model = str(event.get("model") or "").strip()

    payload: dict[str, Any] = {
        "bridgeTicket": ticket,
        "parentHermesSessionId": parent_session,
        "childHermesSessionId": child_session,
        "delegationId": str(event.get("delegation_id") or child_session),
        "role": role,
        "depth": depth,
    }
    if explicit_provider:
        payload["provider"] = explicit_provider
    if explicit_model:
        payload["model"] = explicit_model

    try:
        res = _bridge_post("/internal/v1/hermes-bridge/guard/subagent-start", payload)
        verified_provider = str(res.get("provider") or "").strip().lower()
        verified_model = str(res.get("model") or "").strip()
        if not verified_provider or not verified_model:
            return {
                "action": "block",
                "message": "UNVERIFIED_CHILD_MODEL_POLICY: VAARG bridge did not return verified child provider/model.",
            }
        with _LOCK:
            _SESSION_TICKETS[child_session] = ticket
            _SESSION_POLICIES[child_session] = (verified_provider, verified_model)
        return None
    except Exception as exc:
        return {"action": "block", "message": str(exc)}


def _on_subagent_stop(event: dict[str, Any]) -> None:
    child_session = str(event.get("child_session_id") or "")
    with _LOCK:
        ticket = _SESSION_TICKETS.pop(child_session, "")
        _SESSION_POLICIES.pop(child_session, None)
    if not ticket or not child_session:
        return
    raw_status = str(event.get("status") or "completed").lower()
    mapped = raw_status if raw_status in ("completed", "failed", "cancelled", "timed_out") else "completed"
    try:
        _bridge_post(
            "/internal/v1/hermes-bridge/guard/subagent-stop",
            {
                "bridgeTicket": ticket,
                "childHermesSessionId": child_session,
                "status": mapped,
            },
        )
    except Exception:
        pass


def _make_broker_handler(capability_name: str):
    def _handler(args: dict[str, Any], **kwargs: Any) -> str:
        session_id = str(kwargs.get("session_id") or kwargs.get("task_id") or "")
        tool_call_id = str(kwargs.get("tool_call_id") or "")
        with _LOCK:
            ticket = _SESSION_TICKETS.get(session_id, "")
        if not ticket:
            return json.dumps({"error": "MISSING_BRIDGE_TICKET", "capability": capability_name})
        try:
            payload: dict[str, Any] = {
                "bridgeTicket": ticket,
                "hermesSessionId": session_id,
                "capability": capability_name,
                "arguments": dict(args or {}),
            }
            if tool_call_id:
                payload["toolCallId"] = tool_call_id
            resp = _bridge_post("/internal/v1/hermes-bridge/tools/invoke", payload)
            return json.dumps(resp.get("result", {}))
        except Exception as exc:
            return json.dumps({"error": str(exc), "capability": capability_name})

    return _handler


def register(ctx: Any) -> None:
    ctx.register_hook("pre_tool_call", _on_pre_tool_call)
    ctx.register_hook("pre_api_request", _on_pre_api_request)
    ctx.register_hook("post_api_request", _on_post_api_request)
    ctx.register_hook("subagent_start", _on_subagent_start)
    ctx.register_hook("subagent_stop", _on_subagent_stop)

    for cap_name, description, parameters_schema in VAARG_CAPABILITY_SPECS:
        ctx.register_tool(
            name=cap_name,
            toolset="vaarg_confinement",
            schema={
                "name": cap_name,
                "description": description,
                "parameters": parameters_schema,
            },
            handler=_make_broker_handler(cap_name),
            requires_env=["VAARG_INTERNAL_API_URL", "HERMES_TOOL_BRIDGE_SECRET"],
            description=description,
            override=False,
        )

    threading.Thread(target=_attest_runtime_confinement, args=(True,), daemon=True).start()
