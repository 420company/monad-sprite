// UI form factor (2026-09-29 goat: web = full-featured, same codebase as the mobile app).
// Built with VITE_SURFACE=web → desktop web (420.meme/app): centered top nav + wide content area; all other business logic identical to phones.
// Default (unset) = phone app / app.420.meme: bottom tab bar.
export const WEB_SURFACE = import.meta.env.VITE_SURFACE === 'web'
