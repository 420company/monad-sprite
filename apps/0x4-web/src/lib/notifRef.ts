// 通知的 ref（服务端 notify 第五个参数）→ App 内路径。通知中心和系统推送共用
import { PERP_ENABLED } from './features'
/** 通知里带的 ref → App 内路径。认不出的一律去通知中心 */
export function pathForRef(ref: string | null | undefined): string {
  if (!ref) return '/notifications'
  // 全员公告：official 或 announcement:<公告 id>，都进「0x4 官方」公告页
  if (ref === 'official') return '/official'
  const [kind, id] = [ref.slice(0, ref.indexOf(':')), ref.slice(ref.indexOf(':') + 1)]
  if (!id || ref.indexOf(':') < 0) return '/notifications'
  if (kind === 'dm') return `/dm/${encodeURIComponent(id)}`
  if (kind === 'group') return `/g/${encodeURIComponent(id)}`
  if (kind === 'user') return `/u/${encodeURIComponent(id)}`
  // 评论、点赞、关注的人发帖：post:<动态 id>（以前发帖推送是 user:<作者>，老推送照旧去主页）
  if (kind === 'post') return `/post/${encodeURIComponent(id)}`
  // 关注的人买币：token:<链>:<合约>；开仓：perp:<币种>
  if (kind === 'token') {
    const i = id.indexOf(':')
    if (i > 0 && i < id.length - 1) return `/token/${encodeURIComponent(id.slice(0, i))}/${encodeURIComponent(id.slice(i + 1))}`
    return '/notifications'
  }
  if (kind === 'perp') return PERP_ENABLED ? `/perp?coin=${encodeURIComponent(id)}` : '/notifications'
  // 客服回复 / 工单状态变化：ticket:<工单 id>
  if (kind === 'ticket') return `/support/${encodeURIComponent(id)}`
  if (kind === 'announcement') return '/official'
  // 关注的人开播了：live:<直播间 id>（2026-09-30）；平台关闭了你的会议：meet:<会议码> 去会议页（已结束会显示结束）
  if (kind === 'live') return `/room/${encodeURIComponent(id)}`
  if (kind === 'meet') return `/meet/${encodeURIComponent(id)}`
  // 小精灵的通知（开单申请、停手、到期…）：fly:<小精灵 id>，有的后面还带 :daystop 之类，只取第一段（2026-10-04 走查：以前点了不跳，确认申请会超时）
  if (kind === 'fly') { const fid = id.split(':')[0]; return fid ? `/fly/${encodeURIComponent(fid)}` : '/notifications' }
  // 新电脑扫码登录了网页版（2026-10-01）：pc:sessions，打开「已登录的电脑」
  if (kind === 'pc') return '/settings?open=pc'
  return '/notifications'
}

/** 通知点进去去哪：一般按 ref；「申请加入」通知（ref 是 group:<群 id>）直接打开那个群的入群申请列表（2026-10-03 goat：管理员找不到在哪同意） */
export function pathForNotif(n: { ref?: string | null; type?: string }): string {
  const path = pathForRef(n.ref)
  return n.type === 'join_request' && path.startsWith('/g/') ? `${path}?requests=1` : path
}
