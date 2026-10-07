/**
 * Whether the browser says the user just interacted (within seconds of a click / keypress). Browsers without this API always count as "no" — better not to pop.
 * The web uses it to judge "did the user click this extension popup open themselves?": background-initiated signs / logins by the page must not pop the extension window
 * (desktop/walletGate.ts needSocialLogin, store/social.ts login-while-locked)
 */
export function userActing(): boolean {
  const ua = typeof navigator !== 'undefined' ? (navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation : undefined
  return !!ua?.isActive
}
