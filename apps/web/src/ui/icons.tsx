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
