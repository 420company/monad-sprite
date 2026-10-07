// 显示某个具体用户的名字。
// 2026-09-27 goat：管理员和客服的名字不再上色（原来是黄字蓝描边），和普通用户一样的颜色。
// 工作人员身份仍由头像发光边框和 StaffTag 标出，名字本身不区分。
// address / size 参数保留，调用方不用改。
export default function UserName({ name, className }: { address?: string | null; name: string; className?: string; size?: 'sm' | 'lg' }) {
  return className ? <span className={className}>{name}</span> : <>{name}</>
}
