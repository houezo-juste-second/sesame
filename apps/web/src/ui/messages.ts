/**
 * Messages WhatsApp envoyés par la vendeuse.
 * Format WhatsApp : *gras*, retours à la ligne, lien seul sur sa dernière ligne (aperçu cliquable).
 * Court, lisible d'un coup d'œil, et la garantie dite en une phrase.
 */
import { xof } from '../api.js';

export interface MessageOrder {
  itemLabel: string;
  shopName: string;
  totalXof: number;
  deliveryFeeXof: number;
  deliveryHours: number;
}

export function clientMessage(o: MessageOrder, link: string): string {
  return [
    `Bonjour 👋 Voici votre commande chez *${o.shopName}* :`,
    '',
    `🛍️ ${o.itemLabel}`,
    `💰 *${xof(o.totalXof)}*${o.deliveryFeeXof > 0 ? ' livraison comprise' : ''}`,
    '',
    "🔒 Vous payez maintenant, mais l'argent reste *bloqué jusqu'à la livraison*.",
    `Pas livré dans les ${o.deliveryHours} h ? Vous êtes *remboursé automatiquement*.`,
    '',
    '👉 Payer en sécurité :',
    link,
  ].join('\n');
}

export function courierMessage(o: MessageOrder, link: string): string {
  return [
    `🛵 *Mission de livraison* pour *${o.shopName}*`,
    '',
    `📦 ${o.itemLabel}`,
    `💵 Votre course : *${xof(o.deliveryFeeXof)}*, payée dès le scan`,
    '',
    '✅ Le client a déjà payé. Chez lui, scannez son sésame *avant* de remettre le colis.',
    '',
    '👉 Ouvrir la mission :',
    link,
  ].join('\n');
}
