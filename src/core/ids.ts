import { randomUUID } from "node:crypto";

/** Short, prefixed, collision-resistant id. e.g. `task_1a2b3c4d`. */
export const newId = (prefix: string): string => `${prefix}_${randomUUID().slice(0, 8)}`;

export const nowIso = (): string => new Date().toISOString();
