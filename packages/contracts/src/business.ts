export interface BusinessReading {
  status: 'available' | 'partial' | 'stale' | 'unavailable';
  value?: unknown;
  observedAt?: string;
  sourceRefs: string[];
  privacy: 'RESTRICTED';
}
export interface ScaleSmithsOperatingPicture {
  principalId: string;
  generatedAt: string;
  readings: Record<string, BusinessReading>;
}
export interface NovaBriefing {
  objectiveId: string;
  status: 'complete' | 'partial';
  generatedAt: string;
  sections: Record<string, unknown>;
  unavailable: string[];
  privacy: 'RESTRICTED';
  sourceRefs: string[];
}
