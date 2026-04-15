---
name: investigate-security
license: Apache-2.0
description: Investigate security events and manage protection rules using the Arcjet MCP server. Analyze traffic patterns, inspect individual requests, explain allow/deny decisions, investigate suspicious IPs, and create or promote remote rules. Use this skill when the user asks to "check security," "investigate traffic," "why was this blocked," "analyze requests," "block an IP," or "review security posture" for an Arcjet-protected application.
compatibility: Requires connection to the Arcjet MCP server at https://api.arcjet.com/mcp
metadata:
  author: arcjet
---

# Investigate Security with Arcjet MCP

Use Arcjet MCP tools to investigate security events, analyze traffic, and manage
remote rules for Arcjet-protected applications. This skill provides a structured
workflow for security investigation and incident response.

## Prerequisites

The Arcjet MCP server must be connected. Add it to your MCP configuration:

```json
{
  "Arcjet": {
    "url": "https://api.arcjet.com/mcp",
    "type": "http"
  }
}
```

Authentication happens via OAuth when the connection is first established.

## Setup: Identify the Site

Before investigating, identify which site you're working with:

1. Call `list-teams` to find the team
2. Call `list-sites` to find the site (each site has a unique SDK key)
3. Call `get-site-key` if the user needs their `ARCJET_KEY`

## Workflow 1: Traffic Overview

Use when the user wants a general security posture check.

1. **Get a security briefing**: Call `get-security-briefing` for a high-level
   summary of recent activity, top threats, and recommendations.

2. **Analyze traffic patterns**: Call `analyze-traffic` to review request
   volumes, denial rates, and patterns over time.

3. **Check for anomalies**: Call `get-anomalies` to detect unusual patterns —
   traffic spikes, new attack vectors, or geographic shifts.

4. **Report findings**: Summarize with:
   - Total requests and denial rate
   - Top denial reasons (RATE_LIMIT, BOT, SHIELD, etc.)
   - Any anomalies detected
   - Recommended actions

## Workflow 2: Investigate a Specific Request

Use when the user asks "why was this request blocked/allowed?"

1. **Find the request**: Call `list-requests` with filters (conclusion, time
   range, IP, path) to locate the request.

2. **Get details**: Call `get-request-details` with the request ID for full
   context — headers, IP metadata, rule results.

3. **Explain the decision**: Call `explain-decision` with the request ID for a
   human-readable breakdown of why each rule allowed or denied the request.

4. **Report**: Explain the decision in plain language. If the user disagrees
   with the outcome, suggest rule adjustments (see Workflow 4).

## Workflow 3: Investigate a Suspicious IP

Use when the user wants to know about a specific IP address.

1. **Investigate the IP**: Call `investigate-ip` with the IP address. This
   returns geolocation, ASN, threat intelligence, VPN/proxy/Tor status, and
   hosting provider detection.

2. **Check request history**: Call `list-requests` filtered to that IP to see
   what it has been doing — request volume, paths hit, decisions made.

3. **Report and recommend**:
   - If the IP is malicious: suggest creating a filter rule to block it
   - If the IP is a known bot: check if the bot category should be allowed
   - If the IP is a VPN/proxy: suggest a filter rule if policy requires it

## Workflow 4: Manage Remote Rules

Use when the user wants to add, modify, or remove protection rules without
code changes. Remote rules apply globally to all requests for a site.

Supported remote rule types: `rate_limit`, `bot`, `shield`, `filter`.

**Important**: Rules that need parsed request body content (`email`,
`sensitive_info`, `prompt_injection`) require the SDK and cannot be managed
remotely.

### Create a new rule (safe workflow)

1. **Create in DRY_RUN**: Call `create-rule` with `mode: "DRY_RUN"`. This logs
   decisions without blocking any traffic.

2. **Assess impact**: Call `get-dry-run-impact` to see what the rule *would*
   have blocked. Review the results — check for false positives.

3. **Promote to LIVE**: Once satisfied, call `promote-rule` to switch from
   `DRY_RUN` to `LIVE`. The rule now actively blocks matching traffic.

### Update or delete rules

- Call `list-rules` to see current remote rules
- Call `update-rule` to modify a rule (full replacement — include all fields)
- Call `delete-rule` to remove a rule

Maximum 10 remote rules per site.

## Understanding Decisions

| Conclusion | Meaning |
| ---------- | ------- |
| **ALLOW**  | All rules passed |
| **DENY**   | A LIVE-mode rule rejected the request |
| **ERROR**  | Rule evaluation failed; Arcjet defaults to ALLOW (fail-open) |

| Reason              | What triggered it |
| ------------------- | ----------------- |
| **RATE_LIMIT**      | Too many requests in the configured window |
| **BOT_V2**          | Automated traffic detected (fingerprinting, headers, or IP reputation) |
| **SHIELD**          | Suspicious request pattern (potential attack payload) |
| **EMAIL**           | Email validation failed |
| **SENSITIVE_INFO**  | PII detected in request or response body |
| **FILTER**          | Geo-IP or attribute filter matched |
| **PROMPT_INJECTION**| AI prompt injection attempt detected |
| **ERROR**           | Internal evaluation error |

## Tips

- Use `explain-decision` for the most human-readable output — it breaks down
  exactly which rules fired and why.
- DRY_RUN rules appear in `ruleTypesDryRun` in request details — they log but
  never block. Always use `get-dry-run-impact` before promoting.
- When creating filter rules to block IPs, use expressions like
  `ip.src == "1.2.3.4"` or `ip.src.country == "XX"`.
- The Arcjet dashboard at https://app.arcjet.com provides visual inspection
  alongside these MCP tools.
