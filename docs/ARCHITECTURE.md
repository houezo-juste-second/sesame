# Sésame architecture

*[Version française](ARCHITECTURE.fr.md)*

## Overview

```mermaid
flowchart TB
  subgraph Phones["Phones (PWA web app)"]
    V["Seller<br/>create · track · assign"]
    C["Buyer<br/>pay · sésame P"]
    L["Courier<br/>scan P"]
    PV["Public /verify page<br/>checks receipts"]
  end

  subgraph Server["Sésame server (Node.js · Fastify)"]
    API["HTTP API + real time (SSE)<br/>Zod validation · per-role tokens"]
    ENG["Escrow engine<br/>state machine · deadlines"]
    WR["Wallet registry<br/>NWC per shop · simulation"]
    AI["Order extraction<br/>local rules / free LLM"]
    REC["Signed Nostr receipts"]
    DB[("SQLite<br/>AES-256-GCM secrets<br/>hash-chained audit")]
  end

  subgraph External["Networks"]
    SW["Seller's own wallet<br/>(e.g. Alby Hub) via NWC relays"]
    LN["Lightning network<br/>hold invoice"]
    NOSTR["Nostr relays"]
    RATE["mempool.space<br/>BTC/EUR → CFA franc"]
  end

  V & C & L --> API
  API --> ENG --> WR
  API --> AI
  ENG --> DB
  WR -- "NIP-47 requests (encrypted)" --> SW --> LN
  ENG --> REC --> DB
  REC -. "optional" .-> NOSTR
  PV -- "receipts" --> API
  PV -. "direct read" .-> NOSTR
  API --> RATE
```

## The protocol in one figure

```mermaid
sequenceDiagram
  autonumber
  participant B as Buyer (phone)
  participant S as Sésame server
  participant W as Seller's wallet (NWC)
  participant L as Courier
  B->>B: generates P (32 bytes) and H = SHA-256(P)
  B->>S: H only
  S->>W: make_hold_invoice(H, amount)
  W-->>B: Lightning invoice (QR)
  B->>W: pays: funds are LOCKED (nobody can take them without P)
  W-->>S: notification hold_invoice_accepted
  Note over B,L: delivery, the buyer checks the parcel
  B->>L: shows the sésame QR (P)
  L->>S: P
  S->>S: checks SHA-256(P) = H
  S->>W: settle_hold_invoice(P): the seller is paid
  S->>W: pay_invoice to the courier's Lightning address
  Note over S,W: no P before the deadline: cancel_hold_invoice, buyer refunded automatically
```

## Wallets

Each shop gets a `WalletAdapter` with four operations: create, settle, cancel and look up a hold invoice.

| Implementation | When | Notes |
|---|---|---|
| `NwcHoldWallet` (Nostr Wallet Connect, NIP-47) | The seller connected her wallet ("Mon wallet Lightning") | Requests signed with the connection key, encrypted with NIP-44 (or NIP-04). `hold_invoice_accepted` notifications, plus polling with `lookup_invoice` as a fallback. Courier paid via LNURL-pay + `pay_invoice`. Verified live on Alby Hub. |
| `MemoryHoldWallet` (simulation) | Guided demo, shops without a wallet | Reproduces the hold invoice lifecycle; labelled "Démonstration" on screen. |

Each order records which wallet holds its invoice (`walletKind`), so a simulated payment can never be applied to a real order.

## Mobile Money on the front, Lightning underneath

Almost no buyer or seller in West Africa has a Lightning wallet; everyone has Mobile Money. The plan is to go through a **licensed exchange partner** (target: Banxaas):

```mermaid
flowchart LR
  C["Buyer<br/>pays in Mobile Money"] --> P["Partner<br/>CFA → sats"]
  P -- "pays the hold invoice" --> H["Hold invoice<br/>funds LOCKED"]
  H -- "sésame P at delivery" --> R["Receiving<br/>wallet"]
  R --> P2["Partner<br/>sats → CFA"] --> V["Seller<br/>Mobile Money"]
  H -. "deadline, no P:<br/>cancel" .-> P
  P -. "refund" .-> C
```

In the demo, the partner is simulated (`POST /api/orders/:id/pay/momo`, to be replaced by the partner's webhook). The seller's Mobile Money number is encrypted; an order only keeps "operator + last 2 digits".

### Who receives the sats

During delivery, the sats are in nobody's wallet: they are locked in transit on the network, between the paying wallet and the wallet that created the invoice. The latter can be:

| Option | Custody | Status |
|---|---|---|
| **A. The exchange partner** creates the hold invoice on behalf of the seller's number | Sésame never touches the money | To confirm with Banxaas |
| **B. A Sésame Lightning node**, then an immediate Mobile Money payout | Sésame holds the sats for a few seconds at release | Feasible now, needs a regulatory framework |
| **C. The seller's own Lightning wallet** (hold invoices via Nostr Wallet Connect) | Nobody: the money lands in her wallet | **Implemented** ("Mon wallet Lightning") |

In every case, **during delivery nobody can take the locked money, not even Sésame.**

## Choices and constraints

| Topic | Choice | Why |
|---|---|---|
| Custody | None during delivery | The server holds no key able to spend the locked money; it only learns P at release. |
| Safe by default | Every failure ends in a refund | Lost sésame, server down, unreachable wallet: the deadline refunds the buyer. |
| Front end | Preact + Vite, PWA | About 36 KB of gzipped JavaScript for the main bundle: suited to 3G and entry-level phones. |
| Back end | Node.js + Fastify + Zod | One language (TypeScript) everywhere; strict validation of every input. |
| Database | SQLite built into Node (`node:sqlite`) | Free, no native dependency, no administration. |
| Secrets at rest | AES-256-GCM | Pending sésames, Nostr keys, NWC codes and phone numbers encrypted; access tokens only stored hashed; PINs with scrypt. |
| Reputation | Nostr receipts (NIP-78) signed by the shop | Verifiable by anyone, in the browser, without trusting the server. |
| AI | Local rules + optional free LLM | Works with no key and no cost; phone numbers masked before anything is sent. |

## Known limits (current state)

- **Mobile Money is simulated** pending Banxaas's partner API; Benin is not covered by Banxaas yet.
- **Shops without a connected wallet** and the guided demo use the simulated wallet.
- No arbitration for disputes after delivery (faulty product): planned for V2.
