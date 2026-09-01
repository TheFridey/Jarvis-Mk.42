/**
 * Node Protocol contracts — how any device attaches to JARVIS (L35-L38).
 *
 * Normative prose: docs/protocols/node-protocol.md
 *
 * A new device type is DATA (a NodeDescriptor + capability manifests +
 * observation types), never a Kernel change. A node cannot self-upgrade its
 * trust tier; the operator assigns it at admission.
 */

import type { NodeId, Timestamp } from './common.ts';
import type { NodeTrustTier } from './capability.ts';

export type NodeType =
  | 'workstation'
  | 'server'
  | 'mobile'
  | 'display'
  | 'gpu'
  | 'ar'
  | 'robot'
  | string; // open set

export interface NodeDescriptor {
  nodeId: NodeId;
  nodeType: NodeType;
  protocolVersion: string;

  /** Observation types this node can emit. */
  sensors: string[];

  /** Capability manifest ids this node can host adapters for. */
  capabilities: string[];

  /** Experience surfaces this node can present. */
  surfaces: string[];

  requestedTrustTier: NodeTrustTier;

  /** Free-form node metadata (hardware, OS, location hint). */
  attributes: Record<string, string>;
}

export interface NodeAdmission {
  nodeId: NodeId;
  /** Operator-assigned; overrides requestedTrustTier. */
  grantedTrustTier: NodeTrustTier;
  /** Subjects this node may subscribe to. */
  grantedSubscriptions: string[];
  /** Capability ids this node may actually host, post-policy. */
  grantedCapabilities: string[];
  heartbeatIntervalMs: number;
  admittedAt: Timestamp;
}

export type NodeLivenessState = 'online' | 'degraded' | 'unavailable';

export interface NodeLiveness {
  nodeId: NodeId;
  state: NodeLivenessState;
  lastHeartbeatAt: Timestamp;
  rttMs?: number;
}
