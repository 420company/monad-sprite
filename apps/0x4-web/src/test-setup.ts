// 测试统一用简体中文：Node 自带的 navigator.language 是 en-US，不设的话界面文字和报错会变成英文，断言全对不上
import { useLang } from '@/lib/i18n'
useLang.setState({ lang: 'zh-Hans' })
