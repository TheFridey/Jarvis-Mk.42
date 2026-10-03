# ScaleSmiths intelligence, Gmail, Calendar and Nova

## Implemented boundary

All operations enter Agency Ingress and the existing Executor. Adapters run in
Adapter Host workers and request a logical `integration://provider/action` over
Node IPC. The kernel transport chooses the real destination and derives input
from the approved job, not from arbitrary worker URLs or bodies. No adapters
query a ScaleSmiths database or write ATLAS. Credential Broker consumes an
authority token before the transport can use integration credentials.

Action scopes are explicit (`email.search`, `calendar.events.read`,
`scalesmiths.clients.read`, etc.). Older manifests without action scopes retain
their capability-level scope requirements. Read operations are LOW risk; all
implemented writes require a live, argument-bound approval. Sending, calendar
creation/update/cancellation and RSVP are HIGH risk. Writes are not automatically
retried, including uncertain outcomes. Inspect the provider before requesting a
new send after a timeout or failed readback.

Verification runs under a separate dry-run credential. Gmail reads the resulting
message/draft and confirms recipients, subject, body and requested thread,
archive checks the INBOX label, sending checks SENT, and Calendar
reads the event and checks the requested fields/status/self-attendee response.
The Executor compares that provider readback to the execution result. A changing
read may fail verification rather than be presented as established knowledge.
There is no automatic rollback of communications or calendar notifications.

## Operator configuration

Set `JARVIS_INTEGRATIONS_CONFIG` to a protected JSON file outside the repository,
then start the existing core process. Never put real secrets in chat, agent
instructions, Git, logs or diagnostics. Grant filesystem access only to the core
service account. Refresh tokens are used only by the kernel transport to obtain
short-lived access tokens. Neither kind of token crosses worker IPC or enters
Knowledge Ingestion.

Configuration shape (placeholders only):

```json
{
  "email": {
    "principalId": "principal-operator",
    "clientId": "OPERATOR_CONFIGURED",
    "clientSecret": "OPERATOR_CONFIGURED",
    "refreshToken": "OPERATOR_CONFIGURED"
  },
  "calendar": {
    "principalId": "principal-operator",
    "clientId": "OPERATOR_CONFIGURED",
    "clientSecret": "OPERATOR_CONFIGURED",
    "refreshToken": "OPERATOR_CONFIGURED",
    "calendars": ["primary"]
  },
  "scalesmiths": {
    "principalId": "principal-operator",
    "baseUrl": "https://OPERATOR-CONFIGURED-SERVICE.example/jarvis/",
    "token": "OPERATOR_CONFIGURED",
    "contractVersion": 1,
    "mutations": []
  },
  "writeScopes": []
}
```

The configured principal must match the bootstrap principal. Google requests
always use Gmail `users/me`; Calendar IDs must be in the configured allowlist.
OAuth grants must include the provider scopes needed by the requested operations.
Gmail read requires `gmail.readonly`; drafting needs `gmail.compose`; sending
needs `gmail.send` or an applicable broader scope; archive needs `gmail.modify`.
Calendar read needs `calendar.readonly`, availability an applicable free/busy
scope, and writes `calendar.events` or an applicable broader scope. These Google
scopes are separate from Jarvis action grants. OAuth app registration and consent
are operator setup; this phase does not implement a browser authorization flow.

Configuration installs read grants. List selected action scopes in `writeScopes`
to make them eligible for approval, e.g. `email.send`, `email.draft.create`,
`calendar.event.create`. These scopes do not bypass approval. ScaleSmiths update
actions are omitted from registration unless their upstream support is explicitly
listed in `mutations`. Integration bootstrap grants are installed once; restarts
preserve their versions and revocations. Amend existing scopes through Permission
Manager. Removing configuration does not revoke a previously issued grant; use
Permission Manager revocation. Keep the credentials unavailable when
decommissioning an integration.

## ScaleSmiths service contract v1

The ScaleSmiths checkout inspected for this phase has session-authenticated admin
routes and a Venture Lab-specific MCP service. Neither is an authenticated general
operations boundary for the requested client/finance areas. This adapter therefore
does **not** assume that an existing `/api/jarvis` endpoint exists, reuse admin
cookies, invent business records, or activate unsupported mutations. A deployed
service implementing this contract remains an upstream dependency.

The fixed HTTPS `baseUrl` receives:

* `GET v1/{area}.read?id=...&clientId=...&cursor=...&limit=...`
* `PATCH v1/leads.update` / `PATCH v1/tasks.update`, body `{id, patch}`,
  only after upstream support is declared and Jarvis approval is recorded.

Read areas: clients, leads, projects, tasks, invoices, payments, retainers,
proposals, analytics, deployments, infrastructure, caseStudies. Authentication
uses a service Bearer token; the upstream must enforce its own tenant/principal
permissions, allowed fields and mutation schemas. Unsupported actions return an
error, not an empty successful dataset.

Responses have this exact envelope:

```json
{
  "records": [{
    "id": "UPSTREAM_ID",
    "entityType": "client",
    "attributes": {"status": "active"},
    "sourceRef": "UPSTREAM_EVIDENCE_REFERENCE",
    "observedAt": "2026-10-02T08:00:00Z",
    "confidence": 1,
    "privacy": "RESTRICTED"
  }],
  "complete": true
}
```

Optional fields: record `validTo`, response `cursor` and `signals`.
An incomplete page must supply a cursor. Empty results mean a real, successful
empty query. Single-entity mutation responses and subsequent single-entity reads
must return the same canonical envelope with stable source timestamps. Update
results must contain the changed entity and requested attributes.

## Operating Picture and knowledge

`DesktopKernelSnapshot.scalesmiths` exposes MRR, active retainers/projects,
pipeline, proposal value, unpaid invoices, recent payments, follow-ups, meetings,
production incidents, client alerts, reviews and SEO/analytics signals. Each
reading has availability, source references, observation time and RESTRICTED
privacy. Unknown is not zero. Incomplete pages cannot establish monetary totals;
filtered client pages cannot replace whole-business totals. MRR requires explicit
active monthly retainers with integer minor-unit amounts and currencies. Proposal
value includes explicitly open/pending/sent proposals and separates currencies.
No exchange rates or annual-to-monthly assumptions are introduced.

The bridge should normalize operational fields:
`status`, `amountMinor`, `currency`, `period`, `nextFollowUpAt`, `lastContactAt`.
Invoices use `unpaid`, `overdue`, `part_paid`; active projects/retainers use
`active`. Unknown field mappings remain unavailable or do not qualify for a
filtered list. The cold-lead answer explicitly uses a 14-day contact threshold
and excludes leads without a recorded contact date. Incident/review/SEO readings
require real upstream `signals` named like the Operating Picture fields.

Refreshes query a bounded first page per area and mark incomplete datasets partial.
More pages are explicitly identified in meeting briefings. Snapshots older than
15 minutes, or whose latest refresh fails, are stale. The cache is principal-bound
and volatile: a restart shows unknown until new verified retrieval. Durable facts
remain in ATLAS through Knowledge Ingestion, with retrieval provenance, confidence,
entity type, privacy and source temporal validity (15-minute fallback expiry).
Stable external IDs never merge merely because their embeddings resemble each
other. Email metadata and meeting facts are ingested; raw mailbox bodies are not
copied into global business context.

## Nova and workflows

Nova is a manifest and presentation group over the existing runtime. Its group
contains Hermes, Scout, Prometheus, Atlas and Mnemosyne. It has no independent
authority or capability invocation proposal scope. Business evidence gathering
is a kernel workflow and uses existing action grants, Executor, Objective Engine,
Context Compiler and Knowledge Ingestion.

Authenticated desktop routes use the existing node/session access credentials:

* `GET /desktop/nova/picture`: last observed picture (`desktop.read`).
* `POST /desktop/nova/refresh`: retrieve current situation (`desktop.write`).
* `POST /desktop/nova/meeting`: `{calendarId,eventId,clientId?,contactEmail?,threadId?}`.
* `POST /desktop/nova/resume`: `{objectiveId}`.
* `POST /desktop/nova/client`: `{clientId}`, current data and recorded context.
* `POST /desktop/nova/specialists`: `{objectiveId,agentId,instruction}` delegates
  an analysis to Hermes, Scout, Prometheus, Atlas or Mnemosyne under that
  principal's Nova objective. Uses the existing durable cognition/agent runtime,
  local-only model routing and analysis-only output; specialist proposals cannot
  execute effects through this endpoint. A configured local model is required.

Meeting preparation creates an Objective Engine record **before** gathering data.
It checkpoints successful/failed reads, preserves evidence references, and uses
a database advisory lock to serialize concurrent resumptions. A reconstructed
kernel resumes missing reads and reuses successful checkpoints for up to 15 minutes;
older checkpoints are refreshed. Sources include
the event, client/project state, tasks, analytics, proposals/invoices, deployments,
case studies, contact search, explicit or discovered email threads, and relevant
Context Compiler memory. Discovered contact threads are bounded to five. Missing
client links and incomplete pages remain explicit; partial objectives are blocked,
not claimed achieved. A complete briefing is retained in the objective and can be
retrieved again. Briefing storage is RESTRICTED and includes source checkpoints.

“Jarvis, morning. Give me the situation.” and follow-up/invoice/meeting questions
take the deterministic Operating Picture path, without a model inventing business
facts. Voice uses the same cognition path. “Prepare me for this meeting” selects
an event only when exactly one upcoming event is available; otherwise it asks for
a meeting ID. An explicit `meeting id: ...` and `client id: ...` can disambiguate.
Client-change questions request a stable client ID instead of guessing a join.

## Verification boundary

Automated tests use controlled provider fixtures, the real Adapter Host process,
and ephemeral PostgreSQL for grants, approval, ingestion and workflow recovery.
They do not demonstrate live Google authorization, live ScaleSmiths records,
production deployment or delivery of a real email/calendar invitation.

Local verification on 2026-10-02:

* Type checking and lint passed; 75 unit files / 333 tests passed.
* Contract: 16 passed; security: 30 passed; fitness: 17 passed.
* Desktop production build passed. Generated export artifacts were restored.
* New focused tests: 18 passed, including real worker IPC.
* Business workflow integration: 5 passed with controlled provider fixtures and
  a separate fresh PostgreSQL database on tmpfs. This proves approval, principal
  isolation, ingestion, send deduplication, restart/resume and morning-brief paths;
  it does not certify normal disk-backed infrastructure.
* The normal full run is **not green**. Node revocation returned HTTP 500, the
  NATS outage/recovery audit observed two unexpected dead letters, and later
  database setups exceeded readiness limits. The run was stopped after those
  recorded failures rather than completing all integration files.
* Infrastructure chaos: 12 passed / 1 failed (container restart remained exited).
  Backup/restore drill failed its restored-kernel boot timeout. These release
  gates require diagnosis and successful fresh runs before release certification.

Provider references: [Gmail REST API](https://developers.google.com/workspace/gmail/api/reference/rest),
[Calendar REST API](https://developers.google.com/workspace/calendar/api/v3/reference),
[Freebusy query](https://developers.google.com/workspace/calendar/api/v3/reference/freebusy/query).
