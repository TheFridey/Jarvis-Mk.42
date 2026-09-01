# Security

The **security model** is `docs/architecture/SECURITY_MODEL.md` (subordinate to
`PRINCIPLES.md`). This directory holds operational security material.

| File | Contents |
|---|---|
| [`threat-model.md`](threat-model.md) | Enumerated threats, assets, and the structural mitigation for each. |

## The one thing to internalise

Security in JARVIS is **architectural, not prompt-based** (L30). No control is a
sentence in a prompt. Controls are: process isolation, credential
partitioning, the Validator on every untrusted→Kernel path, the deterministic
Policy Engine, the Permission Engine, the single Capability Executor, and the
append-only audit trail. A fully adversarial AI model, or a page full of
injection, reaches an Executor that does not care what the model "decided".
