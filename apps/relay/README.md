# apps/relay — edge node termination (EMPTY IN MK.42)

This directory is a **documented extraction seam**, not a running process in
MK.42.

## Purpose (future)

When nodes live **off the LAN** (a phone on mobile data, a remote display, an
edge sensor site), they should not open a raw connection to the Kernel across
the internet. `apps/relay` will terminate Node Protocol connections at the
edge: TLS/mTLS termination, auth pre-check against the node registry,
subscription scoping, backpressure, and spooling — then forward to the Kernel
over the trusted link.

## Why it exists now as an empty folder

So the seam is explicit. Perception already emits **observations, not media**,
and nodes already speak a versioned Node Protocol — so adding `relay` later is
additive infrastructure, not a Kernel change (`ROADMAP.md` MK.51+, ADR-0012).

## MK.42 behaviour

Workstation ↔ local server communicate directly over mTLS on the LAN. No relay.
