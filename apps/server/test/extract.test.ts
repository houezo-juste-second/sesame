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
