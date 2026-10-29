import { AsyncLocalStorage } from 'node:async_hooks';

// Only AuthGuard populates this from the persisted account. Never accept a
// tenant header, query parameter or client-selected organization as authority.
export const tenantContext = new AsyncLocalStorage<{
  organizationId?: string;
}>();
