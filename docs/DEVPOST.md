# Devpost submission

Copy each block into the matching field of the Devpost form.

## Project name

Sésame

## Elevator pitch (max. 200 characters)

Cash on delivery without the cash: the buyer pays first, the money stays locked on Lightning until the rider scans her sésame. No delivery, automatic refund. Try a real payment in one click.

## Links ("Try it out")

- Live demo: https://sesame-1j54.onrender.com
- Real Lightning demo (three real test wallets, one click): https://sesame-1j54.onrender.com/demo/real
- Source code: https://github.com/houezo-juste-second/sesame

## Video demo link

https://youtu.be/0LJA9di9rKQ (live demo on the real app, 2 min 44)

## Built with

`bitcoin`, `lightning-network`, `nostr`, `nostr-wallet-connect`, `alby`, `lnurl`, `groq`, `gemini`, `typescript`, `node.js`, `fastify`, `preact`, `vite`, `sqlite`, `zod`, `pwa`

## About the project (Markdown)

```markdown
> ⚡ **Try a real Lightning payment in one click: https://sesame-1j54.onrender.com/demo/real**
> Three real Lightning test wallets are created for you (seller, buyer, rider). The seller's own wallet issues a hold invoice, the buyer pays, the money stays locked, and the buyer's sésame releases it. You watch the real balances move. No regtest, no mock.

## Inspiration

Awa sells shoes on WhatsApp in Dakar. Mariama wants a pair, but she will not pay first: last time, the seller vanished. So it is cash on delivery. The rider crosses the city, Mariama has changed her mind, and Awa loses the delivery fee. Other days, Awa ships against a Mobile Money screenshot that turns out to be fake. And the rider carries cash all day.

This is how a huge share of retail works across West Africa, on WhatsApp, Instagram and TikTok: **zero trust on both sides**. Mobile Money cannot hold a payment. An escrow company can, but then everyone must trust that company, it needs a licence, and it can freeze or lose the money.

We asked one question: **can a payment be locked so that nobody holds it, not even us?** On Bitcoin Lightning, it can.

## What it does

**Sésame is cash on delivery without the cash.** The buyer pays first, the money stays locked until the parcel is in her hands, and nothing delivered means an automatic refund.

1. **The seller pastes the chat or imports a WhatsApp screenshot.** AI fills in the order (item, price, delivery fee, area). She checks it and sends a payment link on WhatsApp.
2. **The buyer opens the link and pays.** No app, no account. The money is **locked in a Lightning hold invoice issued by the seller's own wallet**: she can see it but cannot take it, and neither can Sésame. The buyer's phone keeps a secret QR code: her **sésame**.
3. **The rider receives his mission on WhatsApp.** He sees that the payment is locked and exactly how much he will earn.
4. **At the door**, the buyer checks the parcel and shows her sésame. **The rider scans it: the seller and the rider are paid in the same second**, straight into their own wallets. No cash.
5. **No delivery before the deadline?** The invoice is cancelled and the buyer gets everything back, automatically.
6. **Verifiable reputation:** every delivery produces a Nostr receipt signed by the shop, carrying the Lightning proof of payment. Anyone can verify it in the browser, so fake reviews are impossible.

**Only the seller has an account.** The app installs on a phone like a native app (one tap on Android, "Add to Home Screen" on iPhone). **Pricing is simple: 1% of the item price, only when the sale is delivered** (minimum 25 FCFA, capped at 1,000 FCFA). No delivery, no fee. Nothing for the buyer or the rider.

## Why Sésame stands out

| | Cash on delivery | Mobile Money | Escrow company | **Sésame** |
|---|---|---|---|---|
| Seller sees proof of funds before shipping | ❌ | ❌ (fake screenshots) | ✅ | ✅ |
| Seller cannot take the money before delivery | ✅ | ❌ | trust the company | ✅ **enforced by cryptography** |
| Automatic refund | ❌ | ❌ | ❌ | ✅ |
| No custodian, no licence | ✅ | ❌ | ❌ | ✅ |
| Rider carries no cash, paid instantly | ❌ | partly | ❌ | ✅ |

And unlike a lab demo, **Sésame runs on real wallets**: the seller connects her own Lightning wallet with Nostr Wallet Connect, and judges can run a real Lightning payment from the live site in one click.

## How we built it

- **Lightning hold invoices, keys on the buyer's phone.** The buyer's browser generates a 256-bit secret *P* and only sends *H = SHA-256(P)*. The seller's wallet creates a hold invoice on *H*: it can only be settled by revealing *P*, which only the buyer's sésame contains. A watchdog cancels it at the deadline, long before the HTLC timeout, so every failure ends in a refund.
- **The seller's own wallet, through Nostr Wallet Connect (NIP-47):** `make_hold_invoice`, `settle_hold_invoice`, `cancel_hold_invoice`, `hold_invoice_accepted` notifications, with a `lookup_invoice` fallback; NIP-44 and NIP-04 encryption. The rider is paid to his own Lightning address via LNURL-pay. Verified live on a real Alby Hub.
- **One-click real demo:** three test wallets are created on the free NWC faucet, and the whole flow runs on real Lightning payments in about 15 seconds.
- **AI that never touches money:** an OpenAI-compatible LLM (Groq `gpt-oss` for text, Gemini for screenshots) turns informal French or English chats into an order, with automatic model fallback and offline rules if the AI is down. The AI only proposes; the seller confirms.
- **Nostr (NIP-78):** delivery receipts signed by the shop, verified client-side.
- **Stack, 100% free and open source:** TypeScript, Preact PWA (~40 KB gzipped, built for 3G and entry-level phones), Fastify, Node's built-in SQLite, Zod. Bilingual English / French.
- **Security by design:** documented threat model; the server never sees the sésame until delivery; tokens hashed; wallet links, phone numbers and secrets encrypted (AES-256-GCM); scrypt PINs; rate limits; strict CSP; hash-chained audit log that rejects secrets; no personal data in logs. **144 automated tests.**
- **Admin dashboard:** active sellers, sales per day, order funnel, AI usage, alerts, audit-chain check and shop suspension, with **no power over funds**.

## Challenges we ran into

- **Safe by default:** a lost phone, a server crash or a no-show rider must always end in a refund, never in a loss.
- **Making Bitcoin invisible:** sellers live on WhatsApp and Mobile Money. The Mobile Money flow is designed around a licensed exchange partner and is simulated (and labelled) until a partner API is available.
- **Hold invoices over NWC are new:** few wallets support them. We built a protocol-level test wallet, then validated everything against a real Alby Hub.
- **Free AI tiers are fragile:** quotas and overloads forced us to build model fallback chains and offline rules, so the seller is never blocked.

## Accomplishments that we're proud of

- A real Lightning hold-invoice escrow running end to end **in the seller's own wallet**, testable by anyone in one click.
- A server that **cannot steal locked funds**, even if compromised.
- A rider who is paid at the door by scanning a QR code, with no cash.
- A WhatsApp screenshot that becomes a ready-to-send order in seconds.

## What we learned

- The barrier is habit, not technology: users should only see WhatsApp, a link and a QR code.
- Lightning hold invoices are a remarkable, under-used escrow primitive, and NWC makes them usable from any app.

## What's next for Sésame

1. **Mobile Money in and out** through a licensed exchange partner (such as Banxaas), so buyers pay in FCFA and sellers get paid in FCFA.
2. **A pilot with 20 sellers in Dakar and Cotonou**, measuring payment rate, delivery success and release time.
3. **Persistent hosting** for production data, and a direct LND adapter for sellers running their own node.
4. **The diaspora:** pay from abroad for a delivery back home.

## What is real and what is simulated

- **Real:** Lightning hold invoices in the seller's own wallet (Nostr Wallet Connect, test sats), the sésame cryptography, the escrow engine, rider payouts via LNURL, signed Nostr receipts, AI order extraction, the one-click real demo.
- **Simulated (labelled on screen):** Mobile Money payments, pending a partner API.
```

## Image gallery

Upload the images from `C:\Users\Juste13\Videos\Sesame\devpost\` (thumbnail first).
