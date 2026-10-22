import { AsyncLocalStorage } from "node:async_hooks";
import type { DataStore } from "@/lib/store";

type StoreScope = { store?: Promise<DataStore> };
const requestStores = new AsyncLocalStorage<StoreScope>();

export function getRequestStoreScope() {
  return requestStores.getStore();
}

/** Keep snapshot reuse within one request, never across runtime instances. */
export function withRequestStoreScope<T>(work: () => Promise<T>): Promise<T> {
  return requestStores.getStore() ? work() : requestStores.run({}, work);
}
