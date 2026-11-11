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

if (!env.SESAME_MASTER_KEY) {
  console.warn('[sesame] SESAME_MASTER_KEY absente : clé éphémère. Les sésames en attente ne survivront pas à un redémarrage (→ remboursement automatique).');
}

const ctx = createServerContext({
  mode: 'simulation',
  dbPath: env.SESAME_DB_PATH ?? 'data/sesame.sqlite',
  masterKey: env.SESAME_MASTER_KEY || undefined,
  nostrRelays: env.SESAME_NOSTR_RELAYS ? env.SESAME_NOSTR_RELAYS.split(',').map((r) => r.trim()).filter(Boolean) : [],
  onError: (e) => console.error('[sesame] reçu Nostr non émis :', e instanceof Error ? e.message : e),
  fixedXofPerBtc: env.SESAME_FIXED_RATE ? Number(env.SESAME_FIXED_RATE) : undefined,
  llm: { baseUrl: env.SESAME_AI_BASE_URL, apiKey: env.SESAME_AI_API_KEY, model: env.SESAME_AI_MODEL },
});
const app = buildApp(ctx, { logger: true });

// Boutique de démonstration (simulation uniquement), créée une seule fois.
const demoPin = env.SESAME_DEMO_PIN ?? '2026';
if (!ctx.shops.bySlug('pagnes-de-fifame')) {
  ctx.shops.create({ name: 'Pagnes de Fifamè', city: 'Cotonou', pinHash: await hashPin(demoPin) });
}

const webDist = path.resolve(here, '../../web/dist');
if (existsSync(webDist)) {
  // wildcard (par défaut) : les fichiers d'une nouvelle compilation sont servis sans redémarrage.
  await app.register(fastifyStatic, { root: webDist });
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
