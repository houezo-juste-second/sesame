/**
 * Lecteur de QR par la caméra arrière.
 * Utilise le détecteur natif du navigateur (BarcodeDetector) s'il existe, sinon jsQR.
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import jsQRModule from 'jsqr';

interface Detector { detect(source: CanvasImageSource): Promise<Array<{ rawValue: string }>> }
type JsQr = (data: Uint8ClampedArray, w: number, h: number, o?: { inversionAttempts?: string }) => { data: string } | null;
// jsqr est publié en CommonJS : selon l'outil, la fonction est l'export par défaut ou sa propriété `default`.
const jsQR = ((jsQRModule as unknown as { default?: JsQr }).default ?? jsQRModule) as unknown as JsQr;

export function Scanner({ onResult, onError }: { onResult: (text: string) => void; onError: (msg: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const canvas = document.createElement('canvas');
    const g = canvas.getContext('2d', { willReadFrequently: true });
    const BD = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => Detector }).BarcodeDetector;
    const native = BD ? new BD({ formats: ['qr_code'] }) : null;

    const tick = async () => {
      if (stopped) return;
      const v = video.current;
      if (v && v.readyState >= 2) {
        try {
          let text: string | null = null;
          if (native) {
            const codes = await native.detect(v);
            text = codes[0]?.rawValue ?? null;
          } else if (g) {
            canvas.width = v.videoWidth;
            canvas.height = v.videoHeight;
            g.drawImage(v, 0, 0);
            const img = g.getImageData(0, 0, canvas.width, canvas.height);
            text = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' })?.data ?? null;
          }
          if (text) {
            onResult(text);
            return;
          }
        } catch {
          /* image suivante */
        }
      }
      timer = setTimeout(tick, 250);
    };

    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
      .then((s) => {
        if (stopped) { s.getTracks().forEach((t) => t.stop()); return; }
        stream = s;
        if (video.current) {
          video.current.srcObject = s;
          void video.current.play();
        }
        setReady(true);
        void tick();
      })
      .catch(() => onError("Impossible d'ouvrir la caméra. Autorisez l'accès à la caméra, ou demandez au client de confirmer depuis son téléphone."));

    if (!navigator.mediaDevices) onError('Ce navigateur ne permet pas d’utiliser la caméra.');

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return (
    <div class="viewfinder">
      <video ref={video} playsInline muted aria-label="Aperçu de la caméra" />
      <span class="corner tl" /><span class="corner tr" /><span class="corner bl" /><span class="corner br" />
      {!ready && <div style="position:absolute;inset:0;display:grid;place-items:center;color:#A9ABC6;font-size:13px">Ouverture de la caméra…</div>}
    </div>
  );
}
