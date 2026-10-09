import type { PrivacyClass } from './event.ts';

export const DomainKinds = ['PERSONAL', 'BUSINESS', 'PROJECT', 'FINANCIAL', 'SYSTEM'] as const;
export type DomainKind = typeof DomainKinds[number];
export interface DomainInstance {
  id: string;
  principalId: string;
  kind: DomainKind;
  name: string;
  status: 'active' | 'archived';
  version: number;
}
/** Metadata is assigned by the Kernel, never inferred from a business name. */
export interface DomainOwned { domainId?: string; }
export type DomainPurpose = 'general' | 'research' | 'coding' | 'financial' | 'system';
export interface DomainScope {
  principalId: string;
  domainId: string;
  kind: DomainKind;
  purpose: DomainPurpose;
  readableDomainIds: string[];
  /** Explicit cross-domain reads are limited to PUBLIC/INTERNAL material. */
  crossDomainPrivacyCeiling: PrivacyClass;
  selectionVersion?: number;
  nodeId?: string;
}
export interface DomainRequest extends DomainOwned {
  domainPurpose?: DomainPurpose;
  sourceDomainIds?: string[];
  fusionGrantIds?: string[];
  domainSelectionVersion?: number;
  nodeId?: string;
}
export class DomainAccessError extends Error {
  readonly code = 'DOMAIN_ACCESS_DENIED';
  constructor(message = 'domain access denied') { super(message); this.name = 'DomainAccessError'; }
}
