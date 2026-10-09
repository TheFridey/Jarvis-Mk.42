import type { DomainOwned } from './domain.ts';
/**
 * ATLAS entities and relationships (docs/architecture/ATLAS_MODEL.md).
 *
 * Writers: the Kernel Knowledge Ingestion mediator ONLY. Never perception,
 * agents, or interfaces directly (SYSTEM_BOUNDARIES.md §7.1, ADR-0020).
 *
 * ADDITIVE CHANGE (MK.46): `aliases`, `metadata`, `privacyClass` on Entity and
 * `observedAt` on EntityRelationship. These are always-present for every
 * producer (Knowledge Ingestion fills defaults: `aliases: []`, `metadata: {}`,
 * `privacyClass: 'INTERNAL'`, `observedAt = provenance.producedAt`), so they are
 * required, not optional. Rationale: a partially-populated belief row is an
 * epistemics defect, not a valid state (L11).
 */

import type { Confidence, PrincipalId, Timestamp, Ulid } from './common.ts';
import type { Provenance } from './provenance.ts';
import type { PrivacyClass } from './event.ts';

export type { PrivacyClass };

/**
 * Canonical entity vocabulary (ATLAS_MODEL.md §Entities). Open set — a new
 * type is data, not code — but new values SHOULD be added here for discoverability.
 */
export type EntityType =
  | 'person'
  | 'organisation'
  | 'business' // ScaleSmiths is modelled here as a first-class business
  | 'project'
  | 'device'
  | 'node'
  | 'location'
  | 'room'
  | 'repository'
  | 'software'
  | 'service'
  | 'document'
  | 'infrastructure'
  | 'account'
  | 'objective' // reference shell; authoritative record is projections.objectives
  | 'asset'
  | 'physical_object'
  | 'concept'
  | 'event'
  | 'app_window'
  | (string & {}); // open set

export interface Entity extends DomainOwned {
  id: Ulid;
  type: EntityType;
  canonicalName: string;

  /** Assembled on read from atlas.entity_aliases. Empty array, never null. */
  aliases: string[];

  /** Free-form structured attributes that are not first-class Facts. */
  metadata: Record<string, unknown>;

  privacyClass: PrivacyClass;
  principalId: PrincipalId;

  /** Optional link into the Scene Graph coordinate hierarchy (ADR-0015). */
  spatialExtent?: {
    coordinateSpaceId: string;
    volume: unknown;
  };

  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/**
 * Relationship vocabulary (ATLAS_MODEL.md §Relationships). Open set. Examples:
 * founded, serves, uses, located_in, hosts, deployed_to, belongs_to,
 * currently_in, owns, member_of, depends_on, part_of, related_to.
 */
export type RelationshipType =
  | 'works_on'
  | 'located_in'
  | 'depends_on'
  | 'owns'
  | 'member_of'
  | 'part_of'
  | 'related_to'
  | 'founded'
  | 'serves'
  | 'uses'
  | 'hosts'
  | 'deployed_to'
  | 'belongs_to'
  | 'currently_in'
  | (string & {});

export interface EntityRelationship extends DomainOwned {
  id: Ulid;
  fromEntityId: Ulid;
  toEntityId: Ulid;
  type: RelationshipType;
  provenance: Provenance;
  confidence: Confidence;
  validFrom: Timestamp;
  /** null / undefined => still believed current. Relationships are NOT eternal. */
  validTo?: Timestamp;
  /** When the supporting evidence was seen — distinct from when it became true. */
  observedAt: Timestamp;
}
