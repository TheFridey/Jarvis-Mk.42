export interface CredentialMaterialStore { get(provider: string): Promise<string | undefined>; }
export class MemoryCredentialMaterialStore implements CredentialMaterialStore { constructor(private readonly values: Record<string, string>) {} async get(provider: string) { return this.values[provider]; } }
