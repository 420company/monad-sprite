// Red-packet glyph: an envelope outline + gold seal circle on red, replacing the old 🧧 emoji (system emoji looks different per platform and looked cheap)
export default function PacketGlyph({ size = 34 }: { size?: number }) {
  return (
    <svg viewBox="0 0 28 36" width={size * 28 / 36} height={size} aria-hidden="true" style={{ flexShrink: 0 }}>
      <rect x="1" y="1" width="26" height="34" rx="4.5" fill="#fff" fillOpacity=".14" stroke="#fff" strokeOpacity=".55" strokeWidth="1.4" />
      <path d="M1.7 10.5 Q14 19 26.3 10.5" fill="none" stroke="#fff" strokeOpacity=".55" strokeWidth="1.4" />
      <circle cx="14" cy="15" r="4.6" fill="#ffd166" />
    </svg>
  )
}
