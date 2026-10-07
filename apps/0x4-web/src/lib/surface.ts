// 界面形态（2026-09-29 goat：网页版 = 全功能，和手机 App 同一套代码）。
// 构建时 VITE_SURFACE=web → 电脑端网页版（420.meme/app）：顶部居中导航 + 宽内容区，其余业务逻辑和手机完全相同。
// 默认（不设）= 手机 App / app.420.meme：底部 Tab 栏。
export const WEB_SURFACE = import.meta.env.VITE_SURFACE === 'web'
