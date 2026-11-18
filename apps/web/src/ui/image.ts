/**
 * Prépare une capture d'écran pour l'IA : réduite sur le téléphone (rapide en 3G),
 * convertie en JPEG, 1,5 Mo au plus. Rien n'est conservé.
 */
const MAX_SIDE = 1600;
const MAX_BYTES = 1_400_000;

export async function shrinkImage(file: Blob): Promise<string> {
  if (!/^image\//.test(file.type)) throw new Error('NOT_AN_IMAGE');
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const g = canvas.getContext('2d');
  if (!g) throw new Error('NO_CANVAS');
  g.fillStyle = '#fff';
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  for (const quality of [0.8, 0.65, 0.5, 0.35]) {
    const url = canvas.toDataURL('image/jpeg', quality);
    if (url.length * 0.75 <= MAX_BYTES) return url;
  }
  throw new Error('IMAGE_TOO_LARGE');
}

/** Première image d'un collage (Ctrl+V, appui long « Coller »), s'il y en a une. */
export function imageFromClipboard(e: ClipboardEvent): File | null {
  for (const item of Array.from(e.clipboardData?.items ?? [])) {
    if (item.kind === 'file' && item.type.startsWith('image/')) return item.getAsFile();
  }
  return null;
}
