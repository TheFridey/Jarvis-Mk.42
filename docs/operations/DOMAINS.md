# Domain operation and migration

Apply migrations through the existing deployment migration command before restarting the Kernel. Back up PostgreSQL first using the documented backup/restore process. Migration 0018 retains legacy rows under `<principal>:system`; it does not delete them or guess which business owns them. Review legacy records before reclassification. Re-fetch known integration records through governed capabilities in their configured domain; do not bulk relabel mixed personal/business history.

Authenticated management endpoints require desktop read/write scope, strong authentication, an owned secure workstation or Kernel-local node, and principal/node ownership. Mobile/display nodes cannot administer domains.

| Endpoint | Request / result |
| --- | --- |
| `GET /domains` | Owned instances and this node's selection/version |
| `POST /domains` | `{ "kind":"PROJECT", "name":"VeteranFinder" }` |
| `POST /domains/select` | `{ "domainId":"<owned-id>", "expectedVersion":0 }`; returns incremented version |
| `GET /domains/objectives` | Objectives for the selected node domain |
| `POST /domains/objectives` | Statement, optional owned domain ID and selection version |
| `POST /domains/fusion` | Source/target IDs, exact purpose and future ISO expiry; returns grant ID |
| `POST /domains/fusion/revoke` | `{ "id":"<grant-id>" }` |

Cognition and conversation command contracts accept `domainId`, `domainPurpose`, `domainSelectionVersion`, `sourceDomainIds` and `fusionGrantIds`. The authenticated ingress supplies the node and principal. Without a selection or explicit domain, requests use PERSONAL. Mixed-domain requests without valid fusion authority fail closed; they do not search every memory store. A switched domain starts a new conversation rather than importing the previous conversation. Jobs already accepted retain their original correlation domain; stale selection versions are rejected on admission.

The protected integration configuration accepts an optional `domains` map. Each provider value contains `id`, `kind`, and `name`. For a business Gmail/calendar account used in ScaleSmiths briefings, explicitly assign those providers to the same owned BUSINESS instance as `scalesmiths`. Leave personal accounts in PERSONAL. Keep credential material in the existing protected file/Credential Broker, never in this document or domain metadata. Integration grants and opaque secret references receive the configured domain on Kernel startup. Existing permissions and approval requirements still apply.

Live qualification still requires real provider authorisation, local/cloud model availability, microphone/playback and screen-capture hardware checks, and a rehearsal against a backed-up production database. Integration fixtures do not certify those scenarios. The current interface is unchanged; management is through the authenticated Kernel API.
