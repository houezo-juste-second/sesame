import { describe, it, expect, beforeEach } from 'vitest';
import { generateSesame, xofToMsat } from '@sesame/core';
import { EscrowEngine, EscrowError, type EngineEvent } from '../src/escrow/engine.js';
import { MemoryOrderStore } from '../src/escrow/store.js';
import { MemoryHoldWallet, MemoryPayoutSender } from '../src/wallet/memory.js';

const RATE = 60_000_000; // FCFA par BTC
const HOUR = 3_600_000;

function setup(opts: { cltvExpiryBlocks?: number } = {}) {
  let now = new Date('2026-11-18T10:00:00Z').getTime();
  const clock = { now: () => new Date(now), advance: (ms: number) => { now += ms; } };
  const wallet = new MemoryHoldWallet();
  const payouts = new MemoryPayoutSender();
  const store = new MemoryOrderStore();
  const events: EngineEvent[] = [];
  const engine = new EscrowEngine({
    walletFor: () => wallet, payouts, store, clock: clock.now, onEvent: (e) => events.push(e), ...opts,
  });
  wallet.onAccepted((hash, amount) => engine.handleInvoiceAccepted(hash, amount));
  return { engine, wallet, payouts, store, clock, events };
}

async function paidOrder(ctx: ReturnType<typeof setup>, overrides: Partial<{ deliveryHours: number }> = {}) {
  const order = await ctx.engine.createOrder({
    shopId: 'shop_fifame',
    itemLabel: '2 pagnes wax 6 yards',
    itemXof: 18_000,
    deliveryFeeXof: 1_500,
    deliveryHours: overrides.deliveryHours ?? 6,
    xofPerBtc: RATE,
  });
  const sesame = generateSesame();
  const locked = await ctx.engine.lock(order.id, sesame.paymentHash);
  await ctx.wallet.simulatePayment(sesame.paymentHash, locked.amountMsat);
  return { order: (await ctx.store.get(order.id))!, sesame };
}

describe('création et verrouillage', () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => { ctx = setup(); });

  it('fige le montant client = article + livraison, au taux du moment', async () => {
    const o = await ctx.engine.createOrder({
      shopId: 's', itemLabel: 'Sac', itemXof: 10_000, deliveryFeeXof: 1_000, deliveryHours: 6, xofPerBtc: RATE,
    });
    expect(o.state).toBe('DRAFT');
    expect(o.amountMsat).toBe(xofToMsat(11_000, RATE));
    expect(o.courierMsat).toBe(xofToMsat(1_000, RATE));
    expect(o.feeMsat).toBe(xofToMsat(100, RATE));
  });

  it('valide les entrées de création', async () => {
    const base = { shopId: 's', itemLabel: 'Sac', itemXof: 10_000, deliveryFeeXof: 1_000, deliveryHours: 6, xofPerBtc: RATE };
    await expect(ctx.engine.createOrder({ ...base, itemLabel: '' })).rejects.toMatchObject({ code: 'INVALID_ITEM_LABEL' });
    await expect(ctx.engine.createOrder({ ...base, deliveryHours: 30 })).rejects.toMatchObject({ code: 'INVALID_DELIVERY_HOURS' });
    await expect(ctx.engine.createOrder({ ...base, deliveryFeeXof: -1 })).rejects.toMatchObject({ code: 'INVALID_DELIVERY_FEE' });
  });

  it('émet une facture hold liée au hash du client, sans jamais recevoir P', async () => {
    const o = await ctx.engine.createOrder({
      shopId: 's', itemLabel: 'Sac', itemXof: 10_000, deliveryFeeXof: 0, deliveryHours: 6, xofPerBtc: RATE,
    });
    const s = generateSesame();
    const res = await ctx.engine.lock(o.id, s.paymentHash);
    expect(res.bolt11).toMatch(/^lnbcrt/);
    expect(ctx.wallet.invoice(s.paymentHash)?.state).toBe('OPEN');
    expect((await ctx.store.get(o.id))!.state).toBe('AWAITING_PAYMENT');
    const stored = JSON.stringify(await ctx.store.get(o.id), (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
    expect(stored).not.toContain(s.preimage);
  });

  it('refuse un hash invalide ou déjà utilisé', async () => {
    const mk = () => ctx.engine.createOrder({
      shopId: 's', itemLabel: 'Sac', itemXof: 10_000, deliveryFeeXof: 0, deliveryHours: 6, xofPerBtc: RATE,
    });
    const a = await mk(); const b = await mk();
    await expect(ctx.engine.lock(a.id, 'abc')).rejects.toMatchObject({ code: 'INVALID_PAYMENT_HASH' });
    const s = generateSesame();
    await ctx.engine.lock(a.id, s.paymentHash);
    await expect(ctx.engine.lock(b.id, s.paymentHash)).rejects.toMatchObject({ code: 'PAYMENT_HASH_REUSED' });
  });

  it('passe à FONDS BLOQUÉS quand le paiement est accepté, et calcule l’échéance', async () => {
    const { order } = await paidOrder(ctx);
    expect(order.state).toBe('FUNDS_LOCKED');
    // échéance = min(maintenant + 6 h, expiration HTLC (24 h) − marge 2 h) = +6 h
    expect(order.releaseDeadlineAt!.getTime() - ctx.clock.now().getTime()).toBe(6 * HOUR);
    expect(ctx.events.map((e) => e.type)).toContain('FUNDS_LOCKED');
  });

  it('borne l’échéance par l’expiration du HTLC moins la marge de sécurité', async () => {
    ctx = setup({ cltvExpiryBlocks: 60 });
    const { order } = await paidOrder(ctx, { deliveryHours: 12 });
    // 60 blocs ≈ 10 h ; 10 h − 2 h = 8 h < 12 h
    expect(order.releaseDeadlineAt!.getTime() - ctx.clock.now().getTime()).toBe(8 * HOUR);
  });

  it('rembourse immédiatement si le montant payé ne correspond pas', async () => {
    const o = await ctx.engine.createOrder({
      shopId: 's', itemLabel: 'Sac', itemXof: 10_000, deliveryFeeXof: 0, deliveryHours: 6, xofPerBtc: RATE,
    });
    const s = generateSesame();
    const { amountMsat } = await ctx.engine.lock(o.id, s.paymentHash);
    await ctx.wallet.simulatePayment(s.paymentHash, amountMsat * 2n);
    expect((await ctx.store.get(o.id))!.state).toBe('REFUNDED');
    expect(ctx.wallet.invoice(s.paymentHash)?.state).toBe('CANCELED');
  });
});

describe('libération (le client remet son sésame)', () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => { ctx = setup(); });

  it('A1 — bon sésame : la vendeuse est payée, puis le livreur et les frais', async () => {
    const { order, sesame } = await paidOrder(ctx);
    await ctx.engine.assignCourier(order.id, 'moussa@walletofsatoshi.com');
    const res = await ctx.engine.release(order.id, sesame.preimage);
    expect(res.state).toBe('RELEASED');
    expect(ctx.wallet.invoice(sesame.paymentHash)?.state).toBe('SETTLED');
    expect(ctx.payouts.sent).toEqual([
      { destination: 'moussa@walletofsatoshi.com', amountMsat: xofToMsat(1_500, RATE), kind: 'courier' },
      { destination: 'fees@sesame.local', amountMsat: xofToMsat(180, RATE), kind: 'service_fee' },
    ]);
    const types = ctx.events.map((e) => e.type);
    expect(types.indexOf('RELEASED')).toBeLessThan(types.indexOf('PAYOUT_SENT'));
  });

  it('le client peut libérer lui-même (« J’ai reçu ») sans livreur assigné', async () => {
    const { order, sesame } = await paidOrder(ctx);
    const res = await ctx.engine.release(order.id, sesame.preimage);
    expect(res.state).toBe('RELEASED');
    expect(ctx.payouts.sent.map((p) => p.kind)).toEqual(['service_fee']);
  });

  it('A3 — mauvais sésame : refus, aucun mouvement de fonds', async () => {
    const { order, sesame } = await paidOrder(ctx);
    await expect(ctx.engine.release(order.id, generateSesame().preimage)).rejects.toMatchObject({ code: 'PREIMAGE_MISMATCH' });
    expect(ctx.wallet.invoice(sesame.paymentHash)?.state).toBe('ACCEPTED');
    expect(ctx.payouts.sent).toHaveLength(0);
  });

  it('A4 — rejouer le sésame après libération est refusé', async () => {
    const { order, sesame } = await paidOrder(ctx);
    await ctx.engine.release(order.id, sesame.preimage);
    await expect(ctx.engine.release(order.id, sesame.preimage)).rejects.toMatchObject({ code: 'ORDER_NOT_RELEASABLE' });
    expect(ctx.payouts.sent).toHaveLength(1);
  });

  it('refuse la libération avant paiement', async () => {
    const o = await ctx.engine.createOrder({
      shopId: 's', itemLabel: 'Sac', itemXof: 10_000, deliveryFeeXof: 0, deliveryHours: 6, xofPerBtc: RATE,
    });
    const s = generateSesame();
    await ctx.engine.lock(o.id, s.paymentHash);
    await expect(ctx.engine.release(o.id, s.preimage)).rejects.toMatchObject({ code: 'ORDER_NOT_RELEASABLE' });
  });

  it('refuse la libération après l’échéance', async () => {
    const { order, sesame } = await paidOrder(ctx);
    ctx.clock.advance(6 * HOUR + 1);
    await expect(ctx.engine.release(order.id, sesame.preimage)).rejects.toMatchObject({ code: 'DEADLINE_PASSED' });
  });

  it('wallet vendeuse injoignable : le sésame est conservé et le règlement réessayé', async () => {
    const { order, sesame } = await paidOrder(ctx);
    ctx.wallet.failNextSettle = true;
    await expect(ctx.engine.release(order.id, sesame.preimage)).rejects.toMatchObject({ code: 'SETTLE_PENDING' });
    expect((await ctx.store.get(order.id))!.state).toBe('FUNDS_LOCKED');
    await ctx.engine.tick();
    expect((await ctx.store.get(order.id))!.state).toBe('RELEASED');
  });

  it('un paiement livreur en échec est réessayé, puis abandonné après 3 essais', async () => {
    const { order, sesame } = await paidOrder(ctx);
    await ctx.engine.assignCourier(order.id, 'moussa@walletofsatoshi.com');
    ctx.payouts.failDestinations.add('moussa@walletofsatoshi.com');
    await ctx.engine.release(order.id, sesame.preimage);
    await ctx.engine.tick();
    await ctx.engine.tick();
    await ctx.engine.tick();
    const o = (await ctx.store.get(order.id))!;
    const courier = o.payouts.find((p) => p.kind === 'courier')!;
    expect(courier.status).toBe('failed');
    expect(courier.attempts).toBe(3);
    expect(ctx.events.some((e) => e.type === 'PAYOUT_ABANDONED')).toBe(true);
  });
});

describe('remboursement automatique et annulation', () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => { ctx = setup(); });

  it('A2 — sans libération avant l’échéance, le client est remboursé', async () => {
    const { order, sesame } = await paidOrder(ctx);
    ctx.clock.advance(6 * HOUR);
    await ctx.engine.tick();
    expect((await ctx.store.get(order.id))!.state).toBe('REFUNDED');
    expect(ctx.wallet.invoice(sesame.paymentHash)?.state).toBe('CANCELED');
    expect(ctx.payouts.sent).toHaveLength(0);
  });

  it('une facture jamais payée expire sans mouvement de fonds', async () => {
    const o = await ctx.engine.createOrder({
      shopId: 's', itemLabel: 'Sac', itemXof: 10_000, deliveryFeeXof: 0, deliveryHours: 6, xofPerBtc: RATE,
    });
    await ctx.engine.lock(o.id, generateSesame().paymentHash);
    ctx.clock.advance(31 * 60_000);
    await ctx.engine.tick();
    expect((await ctx.store.get(o.id))!.state).toBe('EXPIRED');
  });

  it('la vendeuse peut annuler (rupture de stock) : remboursement immédiat', async () => {
    const { order, sesame } = await paidOrder(ctx);
    const res = await ctx.engine.cancel(order.id);
    expect(res.state).toBe('REFUNDED');
    expect(ctx.wallet.invoice(sesame.paymentHash)?.state).toBe('CANCELED');
  });

  it('A5 — redémarrage : un nouveau moteur reprend les échéances depuis le stockage', async () => {
    const { order } = await paidOrder(ctx);
    const restarted = new EscrowEngine({ walletFor: () => ctx.wallet, payouts: ctx.payouts, store: ctx.store, clock: ctx.clock.now });
    ctx.clock.advance(6 * HOUR);
    await restarted.tick();
    expect((await ctx.store.get(order.id))!.state).toBe('REFUNDED');
  });

  it('les erreurs portent un code et un message lisible en français', async () => {
    const { order } = await paidOrder(ctx);
    try {
      await ctx.engine.release(order.id, generateSesame().preimage);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(EscrowError);
      expect((e as EscrowError).code).toBe('PREIMAGE_MISMATCH');
      expect((e as EscrowError).message).toBe('Ce sésame ne correspond pas à cette commande.');
    }
  });
});
