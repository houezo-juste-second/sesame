/** Icônes en trait (SVG inline), décoratives par défaut. */
type P = { size?: number; color?: string };
const base = (size: number, color: string) => ({
  width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: color,
  'stroke-width': 2.2, 'stroke-linecap': 'round' as const, 'stroke-linejoin': 'round' as const, 'aria-hidden': true,
});

export const Lock = ({ size = 18, color = '#fff' }: P) => (
  <svg {...base(size, color)}><rect x="4" y="11" width="16" height="10" rx="2.5" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>
);
export const Shield = ({ size = 18, color = '#fff' }: P) => (
  <svg {...base(size, color)}><path d="M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6l7-3z" /><path d="M9 12l2 2 4-4" /></svg>
);
export const Check = ({ size = 16, color = '#fff' }: P) => (
  <svg {...base(size, color)} stroke-width={2.6}><path d="M5 12l5 5L20 7" /></svg>
);
export const Back = ({ size = 18, color = 'currentColor' }: P) => (
  <svg {...base(size, color)}><path d="M15 18l-6-6 6-6" /></svg>
);
export const Key = ({ size = 18, color = '#F5B53F' }: P) => (
  <svg {...base(size, color)}><circle cx="8" cy="15" r="4" /><path d="M11 12l9-9M17 6l3 3M15 8l2 2" /></svg>
);
export const Eye = ({ size = 20, color = '#F5B53F' }: P) => (
  <svg {...base(size, color)}><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></svg>
);
export const Clock = ({ size = 22, color = '#B4500A' }: P) => (
  <svg {...base(size, color)} stroke-width={2}><circle cx="12" cy="13" r="8" /><path d="M12 9v4l2.5 2.5M9 2h6" /></svg>
);
export const Scan = ({ size = 20, color = 'currentColor' }: P) => (
  <svg {...base(size, color)}><path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2M7 12h10" /></svg>
);
export const Sparkle = ({ size = 18, color = '#3730A3' }: P) => (
  <svg {...base(size, color)} stroke-width={2}><path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8L12 3z" /><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15z" /></svg>
);
export const WhatsApp = ({ size = 20, color = '#fff' }: P) => (
  <svg {...base(size, color)} stroke-width={2}><path d="M21 12a9 9 0 0 1-13.4 7.9L3 21l1.1-4.6A9 9 0 1 1 21 12z" /></svg>
);
export const Plus = ({ size = 20, color = '#fff' }: P) => (
  <svg {...base(size, color)} stroke-width={2.4}><path d="M12 5v14M5 12h14" /></svg>
);
export const Logout = ({ size = 18, color = 'currentColor' }: P) => (
  <svg {...base(size, color)} stroke-width={2}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" /></svg>
);
export const Copy = ({ size = 18, color = 'currentColor' }: P) => (
  <svg {...base(size, color)} stroke-width={2}><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></svg>
);
export const KeyHole = ({ size = 18, color = '#F3AA3C' }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="9.5" r="4.5" fill={color} /><path d="M9.6 12.5h4.8L15.6 21H8.4z" fill={color} /></svg>
);
/** Logo : graine de sésame avec le trou de serrure taillé dedans. */
export const Seed = ({ size = 20, color = '#F3AA3C', hole = '#283593' }: P & { hole?: string }) => (
  <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
    <path d="M50 4C69 19 80 41 78 61c-2 18-13 33-28 33S24 79 22 61C20 41 31 19 50 4z" fill={color} />
    <circle cx="50" cy="50" r="10" fill={hole} />
    <path d="M44.8 56.5h10.4l3.6 18.5H41.2z" fill={hole} />
  </svg>
);
export const Phone = ({ size = 18, color = 'currentColor' }: P) => (
  <svg {...base(size, color)} stroke-width={2}><rect x="6" y="2.5" width="12" height="19" rx="2.5" /><path d="M10.5 18h3" /></svg>
);
export const Bolt = ({ size = 18, color = 'currentColor' }: P) => (
  <svg {...base(size, color)} stroke-width={2}><path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z" /></svg>
);
export const Camera = ({ size = 18, color = 'currentColor' }: P) => (
  <svg {...base(size, color)} stroke-width={2}><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></svg>
);
export const Chevron = ({ size = 18, color = 'currentColor' }: P) => (
  <svg {...base(size, color)}><path d="M9 6l6 6-6 6" /></svg>
);
export const Store = ({ size = 18, color = 'currentColor' }: P) => (
  <svg {...base(size, color)} stroke-width={2}><path d="M4 10v10h16V10M3 10l2-6h14l2 6M3 10c0 1.7 1.3 3 3 3s3-1.3 3-3c0 1.7 1.3 3 3 3s3-1.3 3-3c0 1.7 1.3 3 3 3s3-1.3 3-3M10 20v-5h4v5" /></svg>
);
export const Bag = ({ size = 18, color = 'currentColor' }: P) => (
  <svg {...base(size, color)} stroke-width={2}><path d="M5 8h14l-1 12H6L5 8z" /><path d="M9 8V6a3 3 0 0 1 6 0v2" /></svg>
);
export const Bike = ({ size = 18, color = 'currentColor' }: P) => (
  <svg {...base(size, color)} stroke-width={2}><circle cx="5.5" cy="17" r="3" /><circle cx="18.5" cy="17" r="3" /><path d="M5.5 17l4-7h5l4 7M14.5 10l-2-4h3M9.5 10L8 7H6" /></svg>
);
export const Play = ({ size = 18, color = 'currentColor' }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z" fill={color} /></svg>
);
export const Download = ({ size = 18, color = 'currentColor' }: P) => (
  <svg {...base(size, color)} stroke-width={2}><path d="M12 4v11M7 10l5 5 5-5M5 20h14" /></svg>
);
