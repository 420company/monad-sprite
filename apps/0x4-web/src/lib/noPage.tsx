// Empty page. When building the iOS store version (VITE_NO_PERP=1), vite.config.ts swaps the perp page for it, so perp files stay out of the bundle;
// the route itself already bounces to home in App.tsx — this component is never actually shown.
export default function NoPage() { return null }
