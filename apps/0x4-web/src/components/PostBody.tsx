// 信息流里的帖子正文：最多 6 行，超出显示「全文」进详情；点正文区域进详情，点里面的链接、按钮、图片不跳
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import PostImages from './PostImages'
import { postImages, type PostImage } from '@/lib/postImage'
import { t } from '@/lib/i18n'

export function ClampText({ text, to }: { text: string; to: string }) {
  const ref = useRef<HTMLParagraphElement>(null)
  const [over, setOver] = useState(false)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const check = () => setOver(el.scrollHeight > el.clientHeight + 1)
    check()
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(check) : null
    ro?.observe(el)
    return () => ro?.disconnect()
  }, [text])
  return <>
    <p ref={ref} className="mt-3 line-clamp-6 whitespace-pre-wrap break-words text-[15px] leading-relaxed">{text}</p>
    {over && <Link to={to} className="mt-1 inline-block text-[15px] font-medium text-accent">{t('全文')}</Link>}
  </>
}

export default function PostBody({ post, children }: { post: { id: string; text: string; image?: string | null; images?: PostImage[] | null }; children?: ReactNode }) {
  const nav = useNavigate()
  const to = `/post/${encodeURIComponent(post.id)}`
  return (
    <div onClick={(e) => { if (!(e.target as HTMLElement).closest('a,button,input,textarea')) nav(to) }} className="cursor-pointer">
      {children}
      {post.text && <ClampText text={post.text} to={to} />}
      <PostImages images={postImages(post)} />
    </div>
  )
}
