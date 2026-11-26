import { eq } from 'drizzle-orm';
import {
  stores,
  merchantUsers,
  storeMemberships,
  customers,
} from '../schema/identity.js';
import { createArgon2Hash } from '../auth/passwords.js';
import type { DbHandle } from '../db/client.js';

/**
 * Seed two independent synthetic stores. Each gets an owner merchant user,
 * a membership, and a sample customer. Deterministic: re-running is idempotent
 * (skips stores that already exist by slug).
 */
export async function seedSyntheticStores(handle: DbHandle): Promise<{
  storesCreated: string[];
  skipped: string[];
}> {
  const created: string[] = [];
  const skipped: string[] = [];

  const definitions = [
    {
      slug: 'synthetic-store-alpha',
      name: 'Synthetic Store Alpha',
      ownerEmail: 'owner-alpha@synthetic.example',
      ownerName: 'Alpha Owner',
      customerEmail: 'alpha-customer@synthetic.example',
      customerExternalId: 'alpha-cust-001',
    },
    {
      slug: 'synthetic-store-bravo',
      name: 'Synthetic Store Bravo',
      ownerEmail: 'owner-bravo@synthetic.example',
      ownerName: 'Bravo Owner',
      customerEmail: 'bravo-customer@synthetic.example',
      customerExternalId: 'bravo-cust-001',
    },
  ];

  for (const def of definitions) {
    const existing = await handle.db.query.stores.findFirst({
      where: eq(stores.slug, def.slug),
    });
    if (existing) {
      skipped.push(def.slug);
      continue;
    }

    // This is a maintenance-only synthetic seed; the store and its children
    // are committed together and never run through the runtime-role boundary.
    const storeId = await handle.db.transaction(async (tx) => {
      const [store] = await tx.insert(stores).values({ slug: def.slug, name: def.name }).returning();
      if (!store) throw new Error(`Failed to create store ${def.slug}`);
      const passwordHash = await createArgon2Hash('SyntheticOwner!2026');
      const [owner] = await tx.insert(merchantUsers).values({
        storeId: store.storeId, email: def.ownerEmail, passwordHash, displayName: def.ownerName,
      }).returning();
      if (!owner) throw new Error(`Failed to create owner for ${def.slug}`);
      await tx.insert(storeMemberships).values({ storeId: store.storeId, merchantUserId: owner.merchantUserId, role: 'owner' });
      await tx.insert(customers).values({ storeId: store.storeId, externalId: def.customerExternalId, email: def.customerEmail });
      return store.storeId;
    });
    created.push(storeId);
  }

  return { storesCreated: created, skipped };
}
