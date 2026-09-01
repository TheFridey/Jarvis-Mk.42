/**
 * World Model entities and relationships.
 *
 * Governance: docs/architecture/WORLD_MODEL.md
 * Writers: Kernel World Model ingestion ONLY. Never perception, agents, or
 * interfaces directly (SYSTEM_BOUNDARIES.md §7.1).
 */

import type { Confidence, PrincipalId, Timestamp, Ulid } from './common.ts';
import type { Provenance } from './provenance.ts';

export type EntityType =
  | 'person'
  | 'location'
  | 'project'
  | 'device'
  | 'software'
  | 'infrastructure'
  | 'business' // ScaleSmiths is modelled here as a first-class business
  | 'app_window'
  | 'document'
  | string; // open set; new types are data, not code

export interface Entity {
  id: Ulid;
  type: EntityType;
  canonicalName: string;
  principalId: PrincipalId;

  /** Optional link into the Scene Graph coordinate hierarchy (ADR-0015). */
  spatialExtent?: {
    coordinateSpaceId: string;
    /** Opaque bounding-volume / anchor descriptor; shaped by packages/scene. */
    volume: unknown;
  };

  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export type RelationshipType =
  | 'works_on'
  | 'located_in'
  | 'depends_on'
  | 'owns'
  | 'member_of'
  | 'part_of'
  | 'related_to'
  | string;

export interface EntityRelationship {
  id: Ulid;
  fromEntityId: Ulid;
  toEntityId: Ulid;
  type: RelationshipType;
  provenance: Provenance;
  confidence: Confidence;
  validFrom: Timestamp;
  validTo?: Timestamp;
}
