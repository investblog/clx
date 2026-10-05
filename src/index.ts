import { Hono } from 'hono';
import { auth } from './auth/routes';
import type { Env } from './types';

export const app = new Hono<{ Bindings: Env }>();

// Answers about a session are never cached. Without its secret the Worker refuses them: an empty
// JWT_SECRET would sign tokens anyone could forge.
app.use('/auth/*', async (c, next) => {
  if (!c.env.JWT_SECRET) return c.json({ error: 'not_configured' }, 503, { 'cache-control': 'no-store' });
  await next();
  c.header('cache-control', 'no-store');
});
app.route('/auth', auth);

export default { fetch: app.fetch } satisfies ExportedHandler<Env>;
