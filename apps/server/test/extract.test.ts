import { describe, it, expect } from 'vitest';
import { extractOrderHeuristic, maskPhoneNumbers, extractOrder } from '../src/ai/extract.js';

describe('masquage des numéros de téléphone (avant tout envoi à un modèle)', () => {
  it.each([
    ['Appelle-moi au 97 12 34 56 svp', 'Appelle-moi au [numéro masqué] svp'],
    ['mon numéro +229 01 97 12 34 56', 'mon numéro [numéro masqué]'],
    ['Wave 77 123 45 67 ok', 'Wave [numéro masqué] ok'],
    ['+221771234567', '[numéro masqué]'],
  ])('%s', (input, expected) => {
    expect(maskPhoneNumbers(input)).toBe(expected);
  });

  it('ne masque pas les prix', () => {
    expect(maskPhoneNumbers('18 000 FCFA et 1 500 la livraison')).toBe('18 000 FCFA et 1 500 la livraison');
  });
});

describe('extraction heuristique (gratuite, hors ligne)', () => {
  it('cas de référence : pagnes à Fidjrossè', () => {
    const r = extractOrderHeuristic(
      "Bonsoir, je prends les 2 pagnes bleus 6 yards à 18 000. Livraison à Fidjrossè demain matin svp, c'est 1 500 ?",
    );
    expect(r.itemLabel).toBe('2 pagnes bleus 6 yards');
    expect(r.amountXof).toBe(18_000);
    expect(r.deliveryFeeXof).toBe(1_500);
    expect(r.deliveryArea).toBe('Fidjrossè');
    expect(r.missingFields).toEqual([]);
  });

  it('formats de montants courants : 25000f, 25.000 FCFA, 25k', () => {
    expect(extractOrderHeuristic('Je veux le sac à 25000f').amountXof).toBe(25_000);
    expect(extractOrderHeuristic('Je veux le sac à 25.000 FCFA').amountXof).toBe(25_000);
    expect(extractOrderHeuristic('Je veux le sac à 25k').amountXof).toBe(25_000);
  });

  it('frais de livraison annoncés avant le prix', () => {
    const r = extractOrderHeuristic('Le transport fait 2000 jusqu’à Calavi. Je prends la robe rouge, 15 000 F');
    expect(r.deliveryFeeXof).toBe(2_000);
    expect(r.amountXof).toBe(15_000);
    expect(r.itemLabel).toBe('robe rouge');
    expect(r.deliveryArea).toBe('Calavi');
  });

  it('signale ce qu’il ne trouve pas, sans inventer', () => {
    const r = extractOrderHeuristic('Bonjour, vous êtes disponible ?');
    expect(r.amountXof).toBeNull();
    expect(r.itemLabel).toBeNull();
    expect(r.missingFields).toEqual(['itemLabel', 'amountXof', 'deliveryFeeXof']);
  });

  it('ne confond pas un numéro de téléphone avec un prix', () => {
    const r = extractOrderHeuristic('Je prends les chaussures à 12 500. Mon numéro 97 12 34 56');
    expect(r.amountXof).toBe(12_500);
  });

  it('lit un délai explicite en heures', () => {
    expect(extractOrderHeuristic('Livre-moi dans 3h stp, le sac à 9000').deadlineHours).toBe(3);
    expect(extractOrderHeuristic('le sac à 9000').deadlineHours).toBe(6);
  });
});

describe('extractOrder : fournisseur LLM optionnel avec repli gratuit', () => {
  it('sans configuration, utilise l’heuristique', async () => {
    const r = await extractOrder('je prends le sac à 9000', {});
    expect(r.source).toBe('heuristic');
    expect(r.amountXof).toBe(9_000);
  });

  it('si le LLM échoue ou répond n’importe quoi, retombe sur l’heuristique', async () => {
    const failing = async () => new Response('oops', { status: 500 });
    const r = await extractOrder('je prends le sac à 9000', {
      baseUrl: 'http://llm.local/v1', model: 'm', fetchImpl: failing,
    });
    expect(r.source).toBe('heuristic');
  });

  it('utilise la réponse du LLM si elle est valide, et lui envoie le texte masqué', async () => {
    let sentBody = '';
    const ok = async (_url: string | URL | Request, init?: RequestInit) => {
      sentBody = String(init?.body);
      return Response.json({
        choices: [{ message: { content: JSON.stringify({
          itemLabel: 'Sac en raphia', amountXof: 9000, deliveryFeeXof: 1000, deliveryArea: 'Akpakpa', deadlineHours: 4,
        }) } }],
      });
    };
    const r = await extractOrder('je prends le sac à 9000, appelle 97 12 34 56', {
      baseUrl: 'http://llm.local/v1', model: 'm', fetchImpl: ok,
    });
    expect(r.source).toBe('llm');
    expect(r.itemLabel).toBe('Sac en raphia');
    expect(r.deliveryFeeXof).toBe(1_000);
    expect(sentBody).not.toContain('97 12 34 56');
  });

  it('rejette des montants aberrants renvoyés par le LLM', async () => {
    const bad = async () => Response.json({
      choices: [{ message: { content: JSON.stringify({ itemLabel: 'x', amountXof: -5, deliveryFeeXof: 0 }) } }],
    });
    const r = await extractOrder('je prends le sac à 9000', { baseUrl: 'http://llm.local/v1', model: 'm', fetchImpl: bad });
    expect(r.source).toBe('heuristic');
  });
});

describe('extractOrder : réponses réelles des fournisseurs (Gemini, Groq…)', () => {
  const cfg = (fetchImpl: (u: string, i?: RequestInit) => Promise<Response>, onError?: (r: string) => void) =>
    ({ baseUrl: 'https://llm.example/v1beta/openai', model: 'gemini-2.5-flash', apiKey: 'k', fetchImpl, onError });
  const answer = (content: string) => async () => Response.json({ choices: [{ message: { content } }] });

  it('accepte un JSON entouré de balises ```json et des montants écrits en texte', async () => {
    const r = await extractOrder('2 sacs à 12 500 l’unité, livraison Parcelles 1000', cfg(answer(
      '```json\n{"itemLabel":"2 sacs à main noirs","amountXof":"25 000","deliveryFeeXof":"1 000 FCFA","deliveryArea":"Parcelles","deadlineHours":24}\n```',
    )));
    expect(r).toMatchObject({ source: 'llm', itemLabel: '2 sacs à main noirs', amountXof: 25_000, deliveryFeeXof: 1_000, deadlineHours: 12 });
  });

  it('réessaie sans le mode JSON forcé si le fournisseur répond 400', async () => {
    const bodies: string[] = [];
    const f = async (_u: string, i?: RequestInit) => {
      bodies.push(String(i?.body));
      if (bodies.length === 1) return Response.json({ error: { message: 'response_format not supported' } }, { status: 400 });
      return Response.json({ choices: [{ message: { content: '{"itemLabel":"Pagne","amountXof":15000,"deliveryFeeXof":1500}' } }] });
    };
    const r = await extractOrder('pagne à 15000', cfg(f));
    expect(r.source).toBe('llm');
    expect(bodies[0]).toContain('response_format');
    expect(bodies[1]).not.toContain('response_format');
  });

  it('signale la raison de l’échec (sans la clé) puis utilise les règles locales', async () => {
    const reasons: string[] = [];
    const f = async () => Response.json([{ error: { code: 400, message: 'API key not valid. Please pass a valid API key.', status: 'INVALID_ARGUMENT' } }], { status: 401 });
    const r = await extractOrder('je prends le sac à 9000', cfg(f, (x) => reasons.push(x)));
    expect(r.source).toBe('heuristic');
    expect(reasons[0]).toContain('LLM_HTTP_401');
    expect(reasons[0]).toContain('API key not valid');
    expect(reasons.join(' ')).not.toContain('Bearer');
  });
});

describe('règles locales : vraies conversations WhatsApp', () => {
  it('prix à l’unité × quantité, et la livraison est le montant à côté de « livraison »', () => {
    const r = extractOrderHeuristic("Salam, ma sœur je prends les 2 sacs à main noirs, combien? / Vendeuse: 12 500 l'unité, livraison Parcelles 1000 / Client: ok c'est bon");
    expect(r).toMatchObject({ itemLabel: '2 sacs à main noirs', amountXof: 25_000, deliveryFeeXof: 1_000, deliveryArea: 'Parcelles' });
  });
  it('« chacun » vaut prix unitaire', () => {
    const r = extractOrderHeuristic('Je prends les 3 pagnes à 5000 chacun, livraison 1000 à Cocody');
    expect(r).toMatchObject({ amountXof: 15_000, deliveryFeeXof: 1_000 });
  });
});

describe('extractOrder : surcharge du fournisseur et modèles de repli', () => {
  const ok = Response.json({ choices: [{ message: { content: '{"itemLabel":"Robe en bazin","amountXof":35000,"deliveryFeeXof":2000,"deliveryArea":"Calavi"}' } }] });
  const busy = () => Response.json({ error: { message: 'This model is currently experiencing high demand.' } }, { status: 503 });

  it('réessaie une fois quand le modèle est surchargé (503)', async () => {
    let n = 0;
    const r = await extractOrder('la robe à 35 mille, 2000 pour Calavi', {
      baseUrl: 'https://llm.example/v1', model: 'gemini-3.8-flash', apiKey: 'k', retryDelayMs: 0,
      fetchImpl: async () => (++n === 1 ? busy() : ok.clone()),
    });
    expect(r).toMatchObject({ source: 'llm', amountXof: 35_000, deliveryFeeXof: 2_000 });
    expect(n).toBe(2);
  });

  it('passe au modèle suivant si le premier est retiré (404) ou reste surchargé', async () => {
    const asked: string[] = [];
    const r = await extractOrder('la robe à 35 mille', {
      baseUrl: 'https://llm.example/v1', model: 'ancien-modele, modele-surcharge, modele-ok', apiKey: 'k', retryDelayMs: 0,
      fetchImpl: async (_u, init) => {
        const m = JSON.parse(String(init?.body)).model as string;
        asked.push(m);
        if (m === 'ancien-modele') return Response.json({ error: { message: 'no longer available' } }, { status: 404 });
        if (m === 'modele-surcharge') return busy();
        return ok.clone();
      },
    });
    expect(r.source).toBe('llm');
    expect(asked).toEqual(['ancien-modele', 'modele-surcharge', 'modele-surcharge', 'modele-ok']);
  });

  it('si tous les modèles échouent : règles locales, avec la raison de chaque modèle', async () => {
    const reasons: string[] = [];
    const r = await extractOrder('je prends le sac à 9000', {
      baseUrl: 'https://llm.example/v1', model: 'a,b', apiKey: 'k', retryDelayMs: 0, fetchImpl: async () => busy(), onError: (x) => reasons.push(x),
    });
    expect(r.source).toBe('heuristic');
    expect(reasons[0]).toMatch(/a → LLM_HTTP_503.*\| b → LLM_HTTP_503/);
  });
});

describe('règles locales : conversations collées avec « / »', () => {
  it('article dans une question, prix seul, livraison donnée en réponse à « vous livrez ? »', () => {
    const r = extractOrderHeuristic("Bonsoir madame, la robe en bazin brodé rouge elle est à combien ? / 35 mille / D'accord je la prends, vous livrez à Calavi ? / Oui 2000 pour Calavi, vous l'aurez demain avant midi");
    expect(r).toMatchObject({ itemLabel: 'robe en bazin brodé rouge', amountXof: 35_000, deliveryFeeXof: 2_000 });
  });
  it('« 100ml » n’est pas un prix ; « dispo le … ? » donne l’article', () => {
    const r = extractOrderHeuristic("Bjr, dispo le parfum Dior Sauvage 100ml ? / Oui 45 000 / Ok livrez moi à Ouakam ce soir stp / La livraison c'est 1500");
    expect(r).toMatchObject({ itemLabel: 'parfum Dior Sauvage 100ml', amountXof: 45_000, deliveryFeeXof: 1_500 });
  });
});

describe('extractOrder : temps d’attente limité', () => {
  it('la vendeuse n’attend pas au-delà du budget : règles locales ensuite', async () => {
    const t0 = Date.now();
    const r = await extractOrder('je prends le sac à 9000', {
      baseUrl: 'https://llm.example/v1', model: 'a,b,c', apiKey: 'k', retryDelayMs: 0, budgetMs: 1_200,
      fetchImpl: () => new Promise<Response>(() => {}),
    });
    expect(r.source).toBe('heuristic');
    expect(Date.now() - t0).toBeLessThan(3_000);
  });
});

describe('extractOrder : Gemini en mode rapide', () => {
  it('désactive la réflexion longue pour Gemini, et passe au modèle suivant après un délai dépassé', async () => {
    const asked: Array<{ model: string; reasoning?: string }> = [];
    const r = await extractOrder('la robe à 35 mille', {
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'lent,rapide', apiKey: 'k', retryDelayMs: 0, timeoutMs: 200,
      fetchImpl: (_u, init) => {
        const b = JSON.parse(String(init?.body));
        asked.push({ model: b.model, reasoning: b.reasoning_effort });
        if (b.model === 'lent') {
          return new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('timeout'), { name: 'TimeoutError' }))));
        }
        return Promise.resolve(Response.json({ choices: [{ message: { content: '{"itemLabel":"Robe","amountXof":35000,"deliveryFeeXof":null}' } }] }));
      },
    });
    expect(r.source).toBe('llm');
    expect(asked.map((a) => a.model)).toEqual(['lent', 'rapide']);
    expect(asked[0]!.reasoning).toBe('none');
  });
});

describe('extractOrder : quota épuisé', () => {
  it('ne réessaie pas un modèle dont le quota est épuisé (429 quota) et passe au suivant', async () => {
    const asked: string[] = [];
    const r = await extractOrder('la robe à 35 mille', {
      baseUrl: 'https://llm.example/v1', model: 'sans-quota,lite', apiKey: 'k', retryDelayMs: 0,
      fetchImpl: async (_u, init) => {
        const m = JSON.parse(String(init?.body)).model as string;
        asked.push(m);
        if (m === 'sans-quota') return Response.json({ error: { message: 'You exceeded your current quota, please check your plan.' } }, { status: 429 });
        return Response.json({ choices: [{ message: { content: '{"itemLabel":"Robe","amountXof":35000,"deliveryFeeXof":null}' } }] });
      },
    });
    expect(r.source).toBe('llm');
    expect(asked).toEqual(['sans-quota', 'lite']);
  });
});

describe('extractOrder : réglage de réflexion selon le modèle', () => {
  it('gpt-oss (Groq) : reasoning_effort « low » ; autre modèle hors Gemini : aucun réglage', async () => {
    const seen: Array<string | undefined> = [];
    const fetchImpl = async (_u: string, init?: RequestInit) => {
      seen.push(JSON.parse(String(init?.body)).reasoning_effort);
      return Response.json({ choices: [{ message: { content: '{"itemLabel":"Robe","amountXof":35000,"deliveryFeeXof":null}' } }] });
    };
    await extractOrder('la robe à 35 mille', { baseUrl: 'https://api.groq.com/openai/v1', model: 'openai/gpt-oss-120b', apiKey: 'k', fetchImpl });
    await extractOrder('la robe à 35 mille', { baseUrl: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile', apiKey: 'k', fetchImpl });
    expect(seen).toEqual(['low', undefined]);
  });
});
