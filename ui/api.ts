// Talking to the Worker, as the 301.st UI does: the access
// token lives in memory only; the refresh id is an HttpOnly cookie the page never sees. A 401 gets
// one refresh and one retry; if that fails too, the reader signs in again.
let token: string | null = null;
let refreshing: Promise<boolean> | null = null;

export class SignedOut extends Error {}

/** One refresh at a time: concurrent callers share it (the refresh id rotates on every use). */
export function refresh(): Promise<boolean> {
  refreshing ??= fetch('/auth/refresh', { method: 'POST' })
    .then(async (res) => {
      token = res.ok ? ((await res.json()) as { access_token: string }).access_token : null;
      return res.ok;
    })
    .catch(() => false)
    .finally(() => (refreshing = null));
  return refreshing;
}

export async function login(email: string, password: string): Promise<string | null> {
  const res = await fetch('/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
  const body = (await res.json().catch(() => ({}))) as { access_token?: string; error?: string; retryAfter?: number };
  if (res.ok && body.access_token) {
    token = body.access_token;
    return null;
  }
  if (res.status === 429) return `Слишком много попыток. Попробуйте через ${Math.ceil((body.retryAfter ?? 60) / 60)} мин.`;
  if (body.error === 'invalid_login') return 'Неверный email или пароль.';
  return 'Не удалось войти. Попробуйте ещё раз.';
}

export async function logout(): Promise<void> {
  token = null;
  await fetch('/auth/logout', { method: 'POST' }).catch(() => undefined);
}

export async function get<T>(path: string): Promise<T> {
  for (let attempt = 0; attempt < 2; attempt++) {
    if (!token && !(await refresh())) throw new SignedOut();
    const res = await fetch(path, { headers: { authorization: `Bearer ${token}` } });
    if (res.status === 401) {
      token = null;
      continue;
    }
    if (!res.ok) throw new Error(`${res.status}`);
    return (await res.json()) as T;
  }
  throw new SignedOut();
}

// The answer of /auth/me (src/auth/routes.ts).
export interface Me {
  user: { id: number; email: string };
}
