/**
 * Messages WhatsApp envoyés par la vendeuse.
 * Format WhatsApp : *gras*, retours à la ligne, lien seul sur sa dernière ligne (aperçu cliquable).
 * Court, lisible d'un coup d'œil, et la garantie dite en une phrase.
 */
import { xof } from '../api.js';
import { t } from '../i18n.js';

export interface MessageOrder {
  itemLabel: string;
  shopName: string;
  totalXof: number;
  deliveryFeeXof: number;
  deliveryHours: number;
}

export function clientMessage(o: MessageOrder, link: string): string {
  return [
    t('Bonjour 👋 Voici votre commande chez *{shop}* :', { shop: o.shopName }),
    '',
    `🛍️ ${o.itemLabel}`,
    `💰 *${xof(o.totalXof)}*${o.deliveryFeeXof > 0 ? t(' livraison comprise') : ''}`,
    '',
    t("🔒 Vous payez maintenant, mais l'argent reste *bloqué jusqu'à la livraison*."),
    t('Pas livré dans les {h} h ? Vous êtes *remboursé automatiquement*.', { h: o.deliveryHours }),
    '',
    t('👉 Payer en sécurité :'),
    link,
  ].join('\n');
}

export function courierMessage(o: MessageOrder, link: string): string {
  return [
    t('🛵 *Mission de livraison* pour *{shop}*', { shop: o.shopName }),
    '',
    `📦 ${o.itemLabel}`,
    t('💵 Votre course : *{fee}*, payée dès le scan', { fee: xof(o.deliveryFeeXof) }),
    '',
    t('✅ Le client a déjà payé. Chez lui, scannez son sésame *avant* de remettre le colis.'),
    '',
    t('👉 Ouvrir la mission :'),
    link,
  ].join('\n');
}
