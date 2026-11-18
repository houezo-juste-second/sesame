import { describe, it, expect } from 'vitest';
import { createServerContext } from '../src/context.js';
import { buildApp } from '../src/app.js';

const auth = (t: string) => ({ authorization: `Bearer ${t}` });
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

async function setup(llm: Parameters<typeof createServerContext>[0]['llm']) {
  const ctx = createServerContext({ mode: 'simulation', fixedXofPerBtc: 60_000_000, llm });
  const app = buildApp(ctx);
  await app.ready();
  const s = (await app.inject({ method: 'POST', url: '/api/shops', payload: { name: 'Boutique', city: 'Dakar', pin: '4821' } })).json() as { sellerToken: string };
  return { app, token: s.sellerToken };
}

describe('Commande depuis une capture d’écran', () => {
  it('lit la capture avec un modèle « vision » et envoie bien l’image', async () => {
    let sent: { messages: Array<{ content: unknown }> } | null = null;
    const { app, token } = await setup({
      baseUrl: 'https://llm.example/v1', model: 'gemini-2.5-flash', apiKey: 'k',
      fetchImpl: async (_u, init) => {
        sent = JSON.parse(String(init?.body));
        return Response.json({ choices: [{ message: { content: '{"itemLabel":"2 sacs à main noirs","amountXof":25000,"deliveryFeeXof":1000,"deliveryArea":"Parcelles","deadlineHours":6}' } }] });
      },
    });
    const r = await app.inject({ method: 'POST', url: '/api/ai/extract-order-image', headers: auth(token), payload: { image: PNG } });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ source: 'llm', itemLabel: '2 sacs à main noirs', amountXof: 25_000, deliveryFeeXof: 1_000 });
    expect(JSON.stringify(sent!.messages[1]!.content)).toContain('"image_url"');
    await app.close();
  });

  it('sans IA configurée : 503 avec un message clair (coller le texte)', async () => {
    const { app, token } = await setup(undefined);
    const r = await app.inject({ method: 'POST', url: '/api/ai/extract-order-image', headers: auth(token), payload: { image: PNG } });
    expect(r.statusCode).toBe(503);
    expect(r.json()).toMatchObject({ error: 'AI_UNAVAILABLE' });
    await app.close();
  });

  it('si l’IA échoue : 503, sans planter', async () => {
    const { app, token } = await setup({ baseUrl: 'https://llm.example/v1', model: 'm', apiKey: 'k', fetchImpl: async () => new Response('x', { status: 500 }) });
    const r = await app.inject({ method: 'POST', url: '/api/ai/extract-order-image', headers: auth(token), payload: { image: PNG } });
    expect(r.statusCode).toBe(503);
    await app.close();
  });

  it('refuse ce qui n’est pas une image, les images trop lourdes et les visiteurs non connectés', async () => {
    const { app, token } = await setup(undefined);
    expect((await app.inject({ method: 'POST', url: '/api/ai/extract-order-image', headers: auth(token), payload: { image: 'data:text/html;base64,PGgxPg==' } })).statusCode).toBe(400);
    const huge = 'data:image/jpeg;base64,' + 'A'.repeat(2_100_000);
    expect((await app.inject({ method: 'POST', url: '/api/ai/extract-order-image', headers: auth(token), payload: { image: huge } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/ai/extract-order-image', payload: { image: PNG } })).statusCode).toBe(401);
    await app.close();
  });
});
