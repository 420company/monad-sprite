// Tests uniformly use Simplified Chinese: Node's built-in navigator.language is en-US — without this, UI copy and errors turn English and every assertion mismatches
import { useLang } from '@/lib/i18n'
useLang.setState({ lang: 'zh-Hans' })
