# Devpost submission

Copy each block into the matching field of the Devpost form.

## Project name

Sésame

## Elevator pitch (max. 200 characters)

Cash on delivery without the cash: the buyer pays first, the money stays locked on Lightning until the rider scans her sésame. No delivery, automatic refund. Try a real payment in one click.

## Links ("Try it out")

- Live demo: https://sesame-1j54.onrender.com
- Source code: https://github.com/houezo-juste-second/sesame

## Video demo link

https://youtu.be/0LJA9di9rKQ (live demo on the real app, 2 min 44)

## Built with

`bitcoin`, `lightning-network`, `nostr`, `nostr-wallet-connect`, `alby`, `lnurl`, `groq`, `gemini`, `typescript`, `node.js`, `fastify`, `preact`, `vite`, `sqlite`, `zod`, `pwa`

## About the project (Markdown)

```markdown
> ⚡ **Try a real Lightning payment in one click: https://sesame-1j54.onrender.com** → tap **“Try it with real Lightning payments”**.
> Three real Lightning test wallets are created for you (seller, buyer, rider). The seller's own wallet issues a hold invoice, the buyer pays, the money stays locked, and the buyer's sésame releases it. You watch the real balances move. **No regtest, no mock-up.**

## Inspiration

Awa sells shoes on WhatsApp in Dakar. Mariama wants a pair, but she will not pay first: last time, the seller vanished. So it is cash on delivery. The rider crosses the city, Mariama has changed her mind, and Awa loses the delivery fee. Other days, Awa ships against a Mobile Money screenshot that turns out to be fake. And the rider carries cash all day.

This is how a huge share of retail works across West Africa, on WhatsApp, Instagram and TikTok: **zero trust on both sides**. Mobile Money cannot hold a payment. An escrow company can, but then everyone must trust that company, it needs a licence, and it can freeze or lose the money.

We asked one question: **can a payment be locked so that nobody holds it, not even us?** On Bitcoin Lightning, it can.

## What it does

**Sésame is cash on delivery without the cash.** The buyer pays first, the money stays locked until the parcel is in her hands, and nothing delivered means an automatic refund.

1. **The seller imports a WhatsApp screenshot** (or pastes the chat). AI fills in the order: item, price, delivery fee, area. She checks it and sends a payment link on WhatsApp.
2. **The buyer opens the link and pays.** No app, no account. The money is **locked in a Lightning hold invoice issued by the seller's own wallet**: she can see it but cannot take it, and neither can Sésame. The buyer's phone keeps a secret QR code: her **sésame**.
3. **The rider receives his mission on WhatsApp.** He sees that the payment is locked and exactly how much he will earn.
4. **At the door**, the buyer checks the parcel and shows her sésame. **The rider scans it with his phone camera: the seller and the rider are paid in the same second**, straight into their own wallets. No cash.
5. **No delivery before the deadline?** The invoice is cancelled and the buyer gets everything back, automatically.
6. **Verifiable reputation:** every delivery produces a Nostr receipt signed by the shop, carrying the Lightning proof of payment. Anyone can verify it in the browser, so fake reviews are impossible.

**Only the seller has an account.** Sésame installs on a phone like a native app (one tap on Android, “Add to Home Screen” on iPhone), and the whole interface is bilingual English / French.

## Judge's guide: test it yourself in 60 seconds

1. Open **https://sesame-1j54.onrender.com** (free hosting: the very first load can take a few seconds).
2. Tap **“Try it with real Lightning payments”**. Three real test wallets are created; the bar at the top shows their **real balances**.
3. **Buyer** tab → *Pay* → *Pay with the buyer's test wallet*: the hold invoice is paid and the money is **locked**.
4. **Courier** tab → scan (or “simulate the scan”): the invoice is settled with the buyer's secret, and the balances move: seller paid, rider paid.
5. Want to see the AI? Open **Seller space**, create a shop, then *New order* → *Import a screenshot* of any WhatsApp order.

## Proof, not promises

Our demo video was recorded **on the live app**, with a shop created on camera and real Lightning payments on test wallets. Final balances, read from the wallets themselves:

| Wallet | Balance change |
|---|---|
| Awa, seller | **+32,542 sats** |
| Moussa, rider | **+2,711 sats** |
| Mariama, buyer | **−35,254 sats** (the difference is 1 sat of routing fee) |

The seller and the rider were paid **in the same second the rider scanned the QR code**. The AI read the WhatsApp screenshot (item, 12,000 FCFA, delivery 1,000 FCFA, area) in about 3 seconds.

## Why Sésame stands out

| | Cash on delivery | Mobile Money | Escrow company | **Sésame** |
|---|---|---|---|---|
| Seller sees proof of funds before shipping | ❌ | ❌ (fake screenshots) | ✅ | ✅ |
| Seller cannot take the money before delivery | ✅ | ❌ | trust the company | ✅ **enforced by cryptography** |
| Automatic refund | ❌ | ❌ | ❌ | ✅ |
| No custodian, no licence | ✅ | ❌ | ❌ | ✅ |
| Rider carries no cash, paid instantly | ❌ | partly | ❌ | ✅ |
| Money lands in the seller's own wallet | ✅ | ✅ | ❌ | ✅ |

Sésame does not ask anyone to trust a new company or install a new wallet: **the guarantee comes from the Lightning protocol, and the money lives in the seller's own wallet.**

## How we built it

**The lock.** The buyer's browser generates a 256-bit secret \( P \) and only ever sends its hash:

$$H = \mathrm{SHA256}(P)$$

The seller's wallet creates a hold invoice on \( H \). The buyer's payment is then *accepted but not settled*: the funds sit in the HTLC. The invoice can only be settled by revealing \( P \), and \( P \) only exists on the buyer's phone, inside her sésame QR code. At the door, the rider scans it, Sésame settles the invoice with \( P \), and pays the rider from the seller's wallet. A watchdog cancels unpaid or undelivered invoices at the deadline, long before the HTLC timeout.

- **The seller's own wallet, through Nostr Wallet Connect (NIP-47):** `make_hold_invoice`, `settle_hold_invoice`, `cancel_hold_invoice` and `hold_invoice_accepted` notifications, with NIP-44 / NIP-04 encryption. Verified live on a real Alby Hub.
- **The rider is paid to his own Lightning address** via LNURL-pay, with a retry queue and admin alerts if a payout fails.
- **One-click real demo:** three wallets are created on the free NWC faucet, and the whole flow runs on real Lightning payments in about 15 seconds.
- **AI that never touches money:** OpenAI-compatible models (Groq `gpt-oss` for text, Gemini for screenshots) turn informal French or English chats into an order. The AI only proposes; the seller confirms.
- **Nostr (NIP-78):** delivery receipts signed by the shop, verified client-side.
- **Stack, 100% free and open source:** TypeScript, Preact PWA (~40 KB gzipped, built for 3G and entry-level phones), Fastify, Node's built-in SQLite, Zod.

## Security by design: what an attacker can and cannot do

| Attack | What happens |
|---|---|
| The Sésame server is fully compromised | Locked funds **cannot** be settled: that needs the buyer's secret \( P \), which the server never sees before delivery. The worst an attacker can do is cancel, **which refunds the buyer**. |
| A fake payment screenshot | Useless: the seller and the rider see the payment status from the seller's own wallet, not from a picture. |
| The buyer takes the parcel without showing her sésame | The rider hands over the parcel **only after a successful scan**; the app says so on every mission. |
| A rider's phone is stolen | It holds no money and no key, only a mission link. |
| Someone tries to guess a sésame | A 256-bit secret, and at most 5 attempts per minute per order. |
| The buyer loses her phone, or the server goes down | The invoice expires and the payment **returns to the buyer**: by our watchdog, or by the Lightning protocol itself. |

Also: hashed access tokens; wallet links, phone numbers and secrets encrypted at rest (AES-256-GCM); scrypt PINs; strict Content Security Policy; validated inputs; a hash-chained audit log that refuses to store secrets; no personal data in logs. An **admin dashboard** shows activity and alerts and can suspend a shop, but has **no power over funds**.

## Testing

- **144 automated tests:** escrow state machine, hold-invoice paths (settle, cancel, refund), NWC protocol and encryption, rider payouts, rider-share rules, AI extraction on real WhatsApp conversations, image import, admin and audit log.
- **Live end-to-end scripts against real wallets** (Alby faucet): lock → settle with the sésame → seller and rider paid; lock → cancel → full refund.
- **Production checks** on the deployed app: one-click real demo, AI text extraction, AI screenshot extraction.

## Challenges we ran into

- **Notifications can get lost.** NWC notifications travel through Nostr relays, and a relay can drop one. A buyer who has paid must never be stuck, so Sésame also polls `lookup_invoice` for every pending order: the payment is detected even if the notification never arrives.
- **Who pays the rider, and how much?** The delivery fee paid by the buyer must reach the rider in full: the seller must never keep part of it. Sésame enforces it (rider share ≥ delivery fee) and lets the seller add more from her side to offer free delivery.
- **Free AI tiers are fragile.** In production we hit retired models, overloaded models (503) and exhausted quotas (429). We built per-provider model chains, no retries on quota errors, a hard time budget so the seller never waits more than a few seconds, and offline rules tuned on real chats (“100ml” is not a price; “2000 for Calavi” answers “do you deliver to Calavi?”).
- **A real demo that anyone can run.** The test-wallet faucet refuses bursts, so wallets are created one by one with backoff, and the app falls back to a clearly labelled simulated demo if the faucet is down.
- **Making Bitcoin invisible.** Sellers live on WhatsApp and Mobile Money. They see FCFA, a link and a QR code, never “HTLC”.

## Accomplishments that we're proud of

- A real Lightning hold-invoice escrow running end to end **in the seller's own wallet**, that any judge can run in one click.
- A server that **cannot steal locked funds**, even if compromised.
- **One scan pays two people in the same second**, with no cash in anyone's pocket.
- A WhatsApp screenshot that becomes a ready-to-send order in seconds.

## Business model

**1% of the item price, only when the sale is delivered** (minimum 25 FCFA, capped at 1,000 FCFA). Nothing on delivery fees, nothing for the buyer or the rider, no subscription. Example: a 35,000 FCFA dress delivered = **350 FCFA**. No delivery, no fee. A reduced rate for high-volume sellers is already supported by the fee engine.

## What we learned

- The barrier is habit, not technology: users should only see WhatsApp, a link and a QR code.
- Lightning hold invoices are a remarkable, under-used escrow primitive, and NWC makes them usable from any app, with any compatible wallet.

## What's next for Sésame

1. **Mobile Money in and out** through a licensed exchange partner (such as Banxaas), so buyers pay in FCFA and sellers get paid in FCFA.
2. **A pilot with 20 sellers in Dakar and Cotonou**, measuring payment rate, delivery success and release time.
3. **Persistent hosting** for production data, and a direct LND adapter for sellers running their own node.
4. **The diaspora:** pay from abroad for a delivery back home.

## What is real and what is simulated

- **Real:** Lightning hold invoices in the seller's own wallet (Nostr Wallet Connect, test sats), the sésame cryptography, the escrow engine, rider payouts via LNURL, signed Nostr receipts, AI order extraction (text and screenshots), the one-click real demo.
- **Simulated (labelled on screen):** Mobile Money payments, pending a partner API. In the video, the WhatsApp screens are a faithful reproduction (we cannot send real WhatsApp messages on camera), and the rider's camera is a virtual camera filming the buyer's phone: the QR it reads is the order's real sésame, and that scan is what releases the money.
```

## Image gallery

Upload the images from `C:\Users\Juste13\Videos\Sesame\devpost-v2\` (frames of the real demo video), in this order, with these captions:

1. Live app: installs like a mobile app, and one tap starts a real Lightning payment demo
2. A real order arrives on WhatsApp: the seller just takes a screenshot
3. AI reads the WhatsApp screenshot and fills in the order: item, price, delivery fee, area
4. One tap: the order and its WhatsApp message with a secure payment link
5. A real Lightning hold invoice, issued by the seller’s own wallet (Nostr Wallet Connect)
6. Money locked: nobody can take it, not even Sésame. The buyer keeps her secret sésame
7. The rider gets his mission on WhatsApp: payment locked, his fee shown
8. At the door, the rider scans the buyer’s sésame with his phone camera
9. Everyone paid in the same second: real wallet balances after delivery
