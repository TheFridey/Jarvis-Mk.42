# Mobile and wall companion nodes

The Kernel remains authoritative. Android keeps a disposable filtered projection, a selected conversation reference, and non-secret connection preferences. Android KeyChain owns the client private-key handle. No transcripts, objectives, approvals, workflow state, or access tokens are persisted by the app. The wall renderer receives a reduced projection through its mTLS node runtime; browser code has no device credentials.

## Security and transport

Use the existing operator enrollment workflow in `NODE_PROTOCOL_V1_OPERATIONS.md`. Issue a unique device certificate and a short-lived single-use enrollment token. Apply migration `0017_companion_continuity.sql` through the normal migrator before starting the new clients. Mobile enrollment is capped at `owned-mobile` even if a descriptor asks for `owned-secure`. A guest token still admits only a guest. Mobile scopes are `companion.read`, `companion.converse`, and `companion.present` in addition to node lifecycle scopes. Display nodes receive `companion.read` only. Neither receives desktop, approvals, executor, vision, workstation observation, or node management scopes. Bootstrap session exchange rejects mobile/display nodes.

Ingress remains loopback-only, TLS 1.3, certificate-bound, session-bound, sequence-fenced and epoch-fenced. Reach it through an operator-managed private tunnel; do not expose it publicly or turn off certificate/hostname verification. Android can use a private tunnel endpoint whose hostname matches the issued server certificate. The display NodeClient currently requires a loopback HTTPS endpoint on the display host, forwarded privately to the Kernel's loopback listener.

Every remote command passes credential freshness/revocation checks. Inference runs outside the peer mutex so heartbeat and emergency self-revocation remain available. `REVOKE_SELF` revokes the current device only; the existing local operator `/nodes/revoke` control revokes lost devices. Disconnect ends the attached session. Normal credential lifetime still applies: reconnect from the app when the session expires. There is no indefinite background auto-reconnect.

Mobile conversation requests are deliberately **analysis-only** and use a local model with cloud routing disabled. Continuing an existing thread also requires local inference, since previous answers may contain confidential information. They cannot execute capability proposals or approve HIGH/CRITICAL actions. Effects remain available through existing trusted desktop/security flows. This is a conservative restricted mobile command experience, not workstation-equivalent capability control.

## Continuity

`experience.conversation_turns` stores Kernel-owned conversation identifiers, original user input, immutable inference input, results, source node, and status. Desktop cognition records turns through the same service as mobile. Desktop returns a conversation identifier and reuses it for subsequent turns. Mobile selects an existing thread and passes its identifier; the Kernel verifies ownership and includes bounded prior turns as conversation context. A mobile command identifier is namespaced to its node. Replays return the stored result instead of invoking the model again. A conflicting identifier is rejected. Cross-principal reads and continuations fail closed. Conversation projections are byte-bounded; displayed long messages may be truncated. Full context remains in the Kernel tables.

`PRESENT` selects an existing Scene object and a connected display belonging to the same principal. A stale Scene version or unknown object fails closed. `experience.wall_presentations` stores only the node, principal, Scene object reference, version, and expiry, never a copy of the Scene. Each wall projection resolves that reference against the current authoritative Scene. The selection expires after 60 seconds. Mobile provides an explicit **Put that on the wall** control. On desktop, select a Scene object and type that phrase into the normal command entry. When multiple displays are available, use mobile's explicit display selector.

Wall agent/workflow status comes from the existing operating picture, including confirmed worker activity; an unconfirmed RUNNING row is labelled UNCONFIRMED. No synthetic orchestration is presented as active work.

## Wall composition and privacy

The default view shows time, Mark 42 Core, JARVIS mode/interaction, system health, active objective, business-source availability, and next-meeting availability. Alerts, orchestration, active workflows, and selected Scene references expand for meaningful changes, then return to ambient after 20 seconds (a deliberately presented resource remains visible until its 60-second expiry). Offline displays clear live data and show unavailable state. Reduced motion is supported.

This first projection exposes business **availability**, not confidential financial values. Wall/mobile show the next verified upcoming meeting time; titles, attendees and meeting bodies remain on the trusted desktop. Missing, partial or stale calendar evidence yields unavailable rather than a fabricated meeting. A richer meeting/business pulse requires a separate explicit field-level sharing policy. Raw state, private business records, proposal arguments, approval nonces, diagnostic details, model context, and conversation text are excluded from wall snapshots. Wall notifications use generic text; mobile notifications are private on the lock screen.

## Notification Manager

The interruption gate still owns mode, focus suppression, severity, urgency, and deduplication. Eligible delivery surfaces must match principal, availability, and the notification's minimum trust. Selection considers presence, mode, urgency, and surface kind. Connections do not imply physical presence; per-surface presence remains UNKNOWN until evidence exists. Mobile is preferred while away/unknown, wall can be preferred while present and ambient, and desktop while focused. A notification can require `minimumSurfaceTrust: 'owned-secure'` or `'kernel-local'` to exclude mobile/wall. Queued notifications retry when a companion subscribes. Batch digests preserve principal boundaries and the strongest trust requirement. Queue/batch storage remains process-local, as in the existing Notification Manager; it does not survive a Kernel restart.

## Run the wall node

Store a private profile outside source control. Example (values are placeholders):

```json
{
  "nodeId": "wall-office",
  "endpoint": "https://127.0.0.1:7443",
  "caFile": "C:/private/jarvis/ca.crt",
  "certFile": "C:/private/jarvis/wall-office.crt",
  "keyFile": "C:/private/jarvis/wall-office.key",
  "port": 7423
}
```

For first enrollment only, add the operator's `enrollmentToken`, then remove it from the profile after enrollment. Protect the profile and key files with host permissions. Do not paste credentials into chat or logs.

```powershell
$env:JARVIS_DISPLAY_PROFILE_FILE = 'C:\private\jarvis\wall-profile.json'
pnpm display:dev
```

Open the printed loopback address in the wall host's browser. The local browser endpoint is read-only, checks its Host/Origin, sends no-store headers and has no command endpoint. Restart the runtime to reconnect after an outage. `node apps/display/scripts/preview.mjs` is an explicitly labelled presentation fixture for layout inspection, not a live Kernel demonstration.

## Android build and setup

Open `apps/mobile/android` in Android Studio with JDK 17, Android SDK 35 and Gradle 8.11.1 (AGP 8.9.2 / Kotlin 2.1.20). Build the `app` module. Android 10 / API 29 is the minimum supported version. An isolated Linux Docker toolchain builds the debug APK and runs Android lint; see `COMPANION_VERIFICATION.md` for the recorded result and artifacts. No physical-device installation has been verified.

Install the operator-issued client certificate/private key into Android KeyChain using the device's credential settings. Import the public JARVIS CA through the app, choose the KeyChain alias, enter the private HTTPS tunnel endpoint and mobile node ID, and enter the enrollment token for the first connect. The token is cleared from the form and is not saved. Notification permission is requested for Android 13+. The persistent connection notification provides a disconnect action.

Background support is a user-started `remoteMessaging` foreground service, with no boot receiver, wake lock, camera permission, or background microphone capture. It stops on transport failure, disconnect, or revocation and does not automatically restart. Push-to-talk launches the installed Android speech provider with an offline preference; provider/device behavior and Bluetooth routing need device qualification. Manual foreground answer playback requires an installed local TTS voice and stops when the activity leaves the foreground. Android's OS audio routing and sound settings are used; there is no custom privileged Bluetooth controller. Wake word is explicitly unavailable until a local Android detector and its permission/foreground-service lifecycle are qualified. Android foreground-service restrictions are respected rather than bypassed. App backup and device transfer are disabled, including explicit extraction exclusions.

## Verification boundary

Unit tests cover filtered projections, mobile/display scope separation, trust ceilings, interruption policy and routing. The PostgreSQL/mTLS integration suite exercises shared conversation storage and mobile analysis-only dispatch, idempotent replay, Scene presentation, targeted mobile alerts, wall command rejection, and self-revocation. The model provider is a fixture; the real Kernel cognition/worker/storage pipeline runs. This proves transport/storage/dispatch boundaries, not live model performance. Browser fixtures cover ambient/event/offline rendering; they do not prove physical hardware, Android permission behavior, battery consumption, Bluetooth, or deployment.
