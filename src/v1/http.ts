// The /v1 error shape (docs/spec.md §15): { error: { code, message, details? } }, codes stable.

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export const fail = (status: number, code: string, message: string, details?: Record<string, unknown>): never => {
  throw new ApiError(status, code, message, details);
};

export const errorBody = (e: ApiError) => ({ error: { code: e.code, message: e.message, ...(e.details ? { details: e.details } : {}) } });

/** A short random id: 16 bytes, base64url. */
export function newId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/u, '');
}
