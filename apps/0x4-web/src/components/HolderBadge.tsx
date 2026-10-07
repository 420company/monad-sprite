// Holder 勋章（2026-09-28 goat）：小精灵头像旁，表示主人现在持有领养它的那张 Zalien。
// 样子和群里的 Owner / MOD 勋章一套（药丸形、渐变、左边小图标），颜色用 Zalien 的外星绿，图标是一个小外星人头。
export default function HolderBadge({ size = 'sm' }: { size?: 'sm' | 'md' }) {
  const cls = size === 'md' ? 'gap-1 px-2 py-0.5 text-[11px]' : 'gap-0.5 px-1.5 py-px text-[10px]'
  const icon = size === 'md' ? 12 : 10
  return (
    <span className={`holder-badge inline-flex shrink-0 items-center rounded-full font-bold leading-4 ${cls}`}>
      <svg width={icon} height={icon} viewBox="0 0 24 24" aria-hidden="true">
        {/* 外星人头：椭圆头 + 两只斜眼 */}
        <path fill="currentColor" d="M12 2C6.9 2 3.5 5.6 3.5 10.2c0 5 4.4 10.1 8.5 11.8 4.1-1.7 8.5-6.8 8.5-11.8C20.5 5.6 17.1 2 12 2Z" />
        <path fill="var(--holder-eye, #b8ffd9)" d="M6.6 10.4c1.9-.4 3.6.3 4.1 1.9-1.9.5-3.7-.2-4.1-1.9Zm10.8 0c-.4 1.7-2.2 2.4-4.1 1.9.5-1.6 2.2-2.3 4.1-1.9Z" />
      </svg>
      Holder
    </span>
  )
}
