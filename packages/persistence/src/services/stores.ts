import { eq } from 'drizzle-orm';
import { stores, type NewStore } from '../schema/identity.js';
import type { AppDb } from '../db/client.js';

export interface StoreRecord {
  storeId: string;
  slug: string;
  name: string;
  status: string;
  createdAt: Date;
}

/** Create a store within the current (RLS-scoped) transaction. */
export async function createStore(
  db: AppDb,
  input: Pick<NewStore, 'slug' | 'name'>,
): Promise<StoreRecord | null> {
  const rows = await db.insert(stores).values({ ...input }).returning();
  return rows[0] ?? null;
}

export async function getStoreBySlug(
  db: AppDb,
  slug: string,
): Promise<StoreRecord | null> {
  const rows = await db.query.stores.findFirst({ where: eq(stores.slug, slug) });
  return rows ?? null;
}

export async function getStoreById(
  db: AppDb,
  storeId: string,
): Promise<StoreRecord | null> {
  const rows = await db.query.stores.findFirst({ where: eq(stores.storeId, storeId) });
  return rows ?? null;
}

export async function listStores(db: AppDb): Promise<StoreRecord[]> {
  return db.query.stores.findMany();
}

export async function setStoreStatus(
  db: AppDb,
  storeId: string,
  status: 'active' | 'suspended' | 'archived',
): Promise<StoreRecord | null> {
  const rows = await db
    .update(stores)
    .set({ status })
    .where(eq(stores.storeId, storeId))
    .returning();
  return rows[0] ?? null;
}
