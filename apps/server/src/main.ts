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
import { listProviderModels } from './ai/extract.js';
import { createServerContext } from './context.js';

const env = process.env;
const here = path.dirname(fileURLToPath(import.meta.url));

if (!env.SESAME_MASTER_KEY) {
  console.warn('[sesame] SESAME_MASTER_KEY absente : clé éphémère. Les sésames en attente ne survivront pas à un redémarrage (→ remboursement automatique).');
}

/** Code d'administration : 8 caractères minimum, sinon l'administration reste désactivée. */
function adminCode(): string | undefined {
  const code = env.SESAME_ADMIN_CODE?.trim();
  if (!code) return undefined;
  if (code.length < 8) {
    console.warn('[sesame] SESAME_ADMIN_CODE trop court (8 caractères minimum) : administration désactivée.');
    return undefined;
  }
  return code;
}

/**
 * IA : LLM seulement avec une clé (ou un serveur local type Ollama) ; sinon règles locales.
 * Les valeurs sont nettoyées des espaces et retours à la ligne collés par erreur.
 */
function aiConfig() {
  const baseUrl = env.SESAME_AI_BASE_URL?.trim() || undefined;
  const apiKey = env.SESAME_AI_API_KEY?.trim() || undefined;
  const model = env.SESAME_AI_MODEL?.trim() || undefined;
  const local = /^https?:\/\/(localhost|127\.0\.0\.1)/.test(baseUrl ?? '');
  if (!(apiKey || local) || !baseUrl || !model) {
    console.warn(`[sesame] IA : règles locales (manquant : ${[!baseUrl && 'SESAME_AI_BASE_URL', !model && 'SESAME_AI_MODEL', !(apiKey || local) && 'SESAME_AI_API_KEY'].filter(Boolean).join(', ') || 'aucun'})`);
    return {};
  }
  console.log(`[sesame] IA : ${model.split(',').map((m) => m.trim()).join(' → repli ')} via ${new URL(baseUrl).host}`);
  // Diagnostic : modèles « flash » disponibles pour cette clé (noms seulement, jamais la clé).
  void listProviderModels({ baseUrl, apiKey }).then((ids) => {
    const flash = ids.filter((id) => /flash|lite|llama|scout|vision/i.test(id) && !/tts|image|embed/i.test(id)).slice(0, 25);
    if (flash.length) console.log(`[sesame] IA : modèles disponibles : ${flash.join(', ')}`);
  }).catch(() => undefined);
  return { baseUrl, apiKey, model, onError: (reason: string) => console.warn('[sesame] IA indisponible, règles locales utilisées :', reason) };
}

const ctx = createServerContext({
  mode: 'simulation',
  dbPath: env.SESAME_DB_PATH ?? 'data/sesame.sqlite',
  masterKey: env.SESAME_MASTER_KEY || undefined,
  adminCode: adminCode(),
  nostrRelays: env.SESAME_NOSTR_RELAYS ? env.SESAME_NOSTR_RELAYS.split(',').map((r) => r.trim()).filter(Boolean) : [],
  onError: (e) => console.error('[sesame] reçu Nostr non émis :', e instanceof Error ? e.message : e),
  fixedXofPerBtc: env.SESAME_FIXED_RATE ? Number(env.SESAME_FIXED_RATE) : undefined,
  llm: aiConfig(),
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
  ctx.wallets.pollPending(ctx.store).catch((err: unknown) => app.log.error(err));
}, tickMs).unref();

const port = Number(env.PORT ?? 8080);
// Hébergeurs (Render, etc.) : PORT fourni → écouter sur toutes les interfaces.
const host = env.HOST ?? (env.PORT || env.RENDER ? '0.0.0.0' : '127.0.0.1');
await app.listen({ port, host });
app.log.info(`Mode SIMULATION — aucun argent réel. Boutique démo « pagnes-de-fifame »${env.SESAME_DEMO_PIN ? '' : ', PIN par défaut 2026'}.`);
