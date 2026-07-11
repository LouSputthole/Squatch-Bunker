/**
 * Next 16 reads globalThis.AsyncLocalStorage at module load; under `tsx`
 * on newer Node (observed on 24.x) that global isn't set, so `npm run host`
 * dies with "Invariant: AsyncLocalStorage accessed in runtime where it is
 * not available". Import this BEFORE anything that imports `next`.
 */
import { AsyncLocalStorage } from "node:async_hooks";

const g = globalThis as { AsyncLocalStorage?: typeof AsyncLocalStorage };
if (!g.AsyncLocalStorage) g.AsyncLocalStorage = AsyncLocalStorage;
