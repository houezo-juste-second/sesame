/**
 * Point d'entrée du serveur Sésame.
 *   npm run dev:server   → API sur http://localhost:8080 (mode simulation)
 * Sert aussi l'application web compilée (apps/web/dist) si elle existe.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fastifyStatic from '@fastify/static';
import { buildApp } from './app.js';
import { hashPin } from './auth.js';
import { createServerContext } from './context.js';

const env = process.env;
const here = path.dirname(fileURLToPath(import.meta.url));

const ctx = createServerContext({
  mode: 'simulation',
  fixedXofPerBtc: env.SESAME_FIXED_RATE ? Number(env.SESAME_FIXED_RATE) : undefined,
  llm: { baseUrl: env.SESAME_AI_BASE_URL, apiKey: env.SESAME_AI_API_KEY, model: env.SESAME_AI_MODEL },
});
const app = buildApp(ctx, { logger: true });

// Boutique de démonstration (simulation uniquement).
const demoPin = env.SESAME_DEMO_PIN ?? '2026';
ctx.shops.create({ name: 'Pagnes de Fifamè', city: 'Cotonou', pinHash: await hashPin(demoPin) });

const webDist = path.resolve(here, '../../web/dist');
if (existsSync(webDist)) {
  await app.register(fastifyStatic, { root: webDist, wildcard: false });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api')) return reply.status(404).send({ error: 'NOT_FOUND', message: 'Introuvable.' });
    return reply.sendFile('index.html');
  });
}

// Planificateur : échéances, remboursements, règlements et paiements à réessayer.
const tickMs = Number(env.SESAME_TICK_MS ?? 5_000);
setInterval(() => {
  ctx.engine.tick().catch((err: unknown) => app.log.error(err));
}, tickMs).unref();

const port = Number(env.PORT ?? 8080);
await app.listen({ port, host: env.HOST ?? '127.0.0.1' });
app.log.info(`Mode SIMULATION — aucun argent réel. Boutique démo « pagnes-de-fifame », PIN ${demoPin}.`);
