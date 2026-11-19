# Devpost submission

Copy each block into the matching field of the Devpost form.

## Project name

Sésame

## Elevator pitch (max. 200 characters)

Cash on delivery without the cash: buyers pay first, the money stays locked in a Lightning hold invoice, and is released only when they get the parcel. No delivery, automatic refund.

## Links ("Try it out")

- Live demo: https://sesame-1j54.onrender.com
- Real Lightning demo (three real test wallets, one click): https://sesame-1j54.onrender.com/demo/real
- Source code: https://github.com/houezo-juste-second/sesame

## Video demo link

*Your unlisted YouTube link for `sesame-demo-en-final.mp4`.*

## Built with

`bitcoin`, `lightning-network`, `nostr`, `nostr-wallet-connect`, `alby`, `typescript`, `node.js`, `fastify`, `preact`, `vite`, `sqlite`, `zod`, `pwa`

## About the project (Markdown)

```markdown
## Inspiration

In Senegal and Benin, a huge share of retail happens on WhatsApp, Instagram and TikTok. But trust is missing on both sides: buyers won't pay upfront for fear of receiving nothing, sellers receive fake Mobile Money screenshots and orders cancelled at the door, and delivery riders carry cash. So everyone falls back to cash on delivery, with all its risks.

## What it does

Sésame is cash on delivery without the cash.

- **Seller:** pastes the WhatsApp conversation (the order fills itself in) and sends the buyer a payment link. She connects **her own Lightning wallet** with Nostr Wallet Connect.
- **Buyer:** opens the link and pays. The money is **locked**: the seller can see it but cannot take it. On delivery, the buyer checks the parcel and shows their **sésame**, a secret QR code.
- **Rider:** scans the sésame. The seller is paid instantly, and the rider gets his fee from her wallet. No cash.
- **No delivery before the deadline?** The buyer is refunded automatically.
- **Reputation:** every delivery produces a signed Nostr receipt containing the Lightning proof of payment, verifiable by anyone in the browser.

Only the seller has an account; buyer and rider just receive a WhatsApp link. A guided demo lets anyone play the three roles in two minutes.

## How we built it

- **Lightning hold invoices:** the buyer's phone generates a secret P and only sends its hash H = SHA-256(P). The invoice is tied to H, so it can only be settled with P, and it is cancelled automatically at the deadline. During delivery, nobody can take the money, not even Sésame.
- **Real wallet integration with Nostr Wallet Connect (NIP-47):** hold invoices are created, settled and cancelled **in the seller's own wallet** (`make_hold_invoice`, `settle_hold_invoice`, `cancel_hold_invoice`, `hold_invoice_accepted` notifications). The rider is paid to his Lightning address via LNURL-pay. NIP-44 and NIP-04 encryption are supported. **We verified it live** on a real Alby Hub with free test wallets: payment locked, settled with the sésame, and fully refunded on cancel.
- **Nostr (NIP-78):** delivery receipts signed by the shop and verified in the browser.
- **Stack (100% free and open source):** TypeScript, Preact PWA (about 38 KB of gzipped JS, built for 3G), Fastify, Node's built-in SQLite, Zod.
- **Security by design:** documented threat model, hashed tokens, encrypted secrets, phone numbers and wallet codes (AES-256-GCM), scrypt PINs, rate limits, strict CSP, hash-chained audit log that rejects secrets, no personal data in logs. 122 automated tests.
- **Admin dashboard:** volume, fees, alerts, audit-log verification and shop suspension, with no power over funds.

## Challenges we ran into

- Making the protocol **safe by default**: any failure (lost phone, server down, no-show rider) must end in a refund, never a loss.
- Combining **Mobile Money**, which everyone uses, with **Lightning**, which almost nobody uses yet: Bitcoin must be invisible to the user. We designed the Mobile Money flow through a licensed exchange partner; it is simulated in the demo until a partner API is available.
- Hold invoices over NWC are new: few wallets support them, so we built a protocol-level test wallet (real signatures and encryption) and then verified against a real Alby Hub.

## Accomplishments that we're proud of

- A real Lightning hold-invoice escrow running end to end in the seller's own wallet.
- A server that cannot steal locked funds, even if compromised.
- Seller reputation that anyone can verify without trusting us.
- A clean, light mobile interface for entry-level phones.

## What we learned

- The main barrier is habit, not technology: the user should only see WhatsApp and Mobile Money.
- Lightning hold invoices are a remarkable, under-used escrow primitive, and NWC makes them usable from any app.

## What's next for Sésame

1. Mobile Money through a licensed exchange partner (such as Banxaas), then Benin with a local partner.
2. A pilot with 20 sellers in Dakar and Cotonou, tracking payment rate, successful-delivery rate and release time.
3. A direct LND adapter for sellers running their own node.
4. Diaspora: pay from abroad for a delivery back home.

## What is real and what is simulated

- **Real:** Lightning hold invoices in the seller's wallet via Nostr Wallet Connect (verified on Alby Hub with test sats), the sésame cryptography, the escrow engine, signed Nostr receipts.
- **Simulated (labelled on screen):** Mobile Money payments (pending a partner API), and the wallet used by the guided demo and by shops that have not connected a wallet.
- The app is bilingual (English / French), following the browser language with an EN/FR switch on every screen.
```

## Image gallery

Upload the images from `C:\Users\Juste13\Videos\Sesame\devpost\` (thumbnail first).
