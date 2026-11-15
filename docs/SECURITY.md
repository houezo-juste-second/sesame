# Security and threat model

*[Version française](SECURITE.md)*

## What we protect

| Asset | Where it lives | Protection |
|---|---|---|
| The buyer's money during delivery | Lightning hold invoice | Can only be settled with the sésame P; cancelled automatically at the deadline |
| The sésame P | Buyer's phone (local storage); server only at release | Generated on the phone (32 random bytes); encrypted at rest while a settlement is pending |
| Access tokens (seller, buyer, courier) | WhatsApp links, local storage | 128 random bits; only their SHA-256 is stored |
| Seller's PIN | Database | scrypt + salt; 5 attempts per minute |
| Mobile Money numbers | Database | Encrypted (AES-256-GCM); only the last 2 digits are shown |
| Shops' Nostr keys | Database | Encrypted (AES-256-GCM) |
| Seller's wallet connection code (NWC) | Database | Encrypted (AES-256-GCM), never returned by the API nor logged; 5 connection attempts per minute |
| History integrity | Audit log | Hash-chained; any change is detected and flagged in the admin dashboard |

## Who could attack, and how

| Threat | Mitigation |
|---|---|
| **Fake payment screenshot** | There is no screenshot: the seller sees the real state, confirmed by the network. |
| **Seller takes the money without delivering** | Impossible without the sésame, which only the buyer holds. Deadline: refund. |
| **Buyer denies receiving** | They showed their sésame: the release is the proof. They must check the parcel before showing it. |
| **Courier keeps the parcel** | He is only paid when the buyer's sésame is scanned. |
| **Sésame (or an attacker on the server) wants to steal** | The server does not know P before release and holds no key able to spend the locked money. At worst it can block a release: the buyer is then refunded. |
| **Sésame replay** | A hash H is only accepted once; a sésame only releases its own order. |
| **Guessing a sésame** | 2^256 possibilities; 5 attempts per minute per order. |
| **Forwarded WhatsApp link** | A buyer link only grants access to its own order; it cannot cancel or redirect funds (refunds go back to the payer). |
| **PIN brute force** | 5 attempts per minute per shop; hashed PIN. |
| **Stolen wallet connection code (NWC)** | Encrypted at rest. It only allows the actions the seller authorised in her wallet, **within the budget** she sets there (recommended in the UI). She can revoke it at any time from her wallet. |
| **Fraudulent shop** | The admin suspends it: no login, no new order, no payment. Already-paid orders stay protected. |
| **Injection, malformed input** | All inputs validated (Zod), parameterised SQL, 16 KB body limit. Lightning addresses: HTTPS only, local and IP-literal domains refused. |
| **Injected script (XSS)** | Strict CSP: no external script, no inline script; Preact escapes content. |
| **Personal data leaks** | No phone number, token or secret in logs (authorization header redacted, URL parameters stripped). Numbers masked before anything is sent to the AI. Nostr receipts carry no personal data. |
| **Malicious admin** | No route can release, refund or move money; no secret is visible. Admin actions (suspension) are written to the audit log. |

## Principles

- **Least privilege:** each link only grants its role's rights, on a single order.
- **Safe by default:** every failure ends in a refund, never a loss.
- **Proven libraries:** `@noble/hashes` (SHA-256), `nostr-tools` (signatures, NIP-04/NIP-44 encryption), Node.js crypto (AES-GCM, scrypt).
- **Verifiable by anyone:** a shop's reputation is verified in the browser, without trusting the server.

## Residual risks

- **Mobile Money:** the exchange partner briefly holds the funds on the way in and out; it must be licensed.
- **Who receives the sats at release:** with a connected wallet (NWC), the seller herself. With Mobile Money, if a Sésame node receives them rather than the partner, Sésame holds them for a few seconds before the payout.
- **NWC connection:** if the seller authorises payments (to pay the courier), the server can spend from her wallet within the budget she set. Without a budget, that risk is wider: the UI recommends setting one.
- **Buyer's phone lost:** the sésame is lost; the order is refunded at the deadline (the buyer can also copy the sésame as a backup).
