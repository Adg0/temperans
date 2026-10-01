export type IntegrationStatus = "ready" | "planned";

export interface IntegrationDescriptor {
  id: string;
  name: string;
  status: IntegrationStatus;
  description: string;
}
