// 空页面。iOS 上架版打包时（VITE_NO_PERP=1）vite.config.ts 把合约页换成它，合约页的文件就不进安装包；
// 路由本身在 App.tsx 里已经改成回首页，这个组件不会真的被显示。
export default function NoPage() { return null }
