import { isXPixelHost, readConsent } from "@/lib/consent"

export const X_REGISTRATION_EVENT_ID = "tw-rf63m-rf6dm"
export const X_REGISTRATION_COOKIE = "resender_x_registration"
export const CLEAR_X_REGISTRATION_COOKIE = `${X_REGISTRATION_COOKIE}=; path=/; max-age=0; samesite=lax; secure`

export function readXRegistration(cookie: string): string | null {
  const value = cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${X_REGISTRATION_COOKIE}=`))
    ?.slice(X_REGISTRATION_COOKIE.length + 1)
  return value && /^[a-f0-9-]{36}$/.test(value) ? value : null
}

type RegistrationContext = {
  headers?: Headers | null
  request?: Request | null
  context: { baseURL: string }
  setCookie: (
    name: string,
    value: string,
    options: {
      path: string
      maxAge: number
      sameSite: "lax"
      secure: boolean
      httpOnly: boolean
    }
  ) => unknown
}

// Only user.create.after calls this: existing logins and account linking do
// not create receipts. No user id, email or other account data enters the cookie.
export function markXRegistration(ctx: RegistrationContext | null | undefined) {
  if (!ctx) return
  try {
    if (!isXPixelHost(new URL(ctx.context.baseURL).hostname)) return
    const cookie = (ctx.headers ?? ctx.request?.headers)?.get("cookie") ?? ""
    if (readConsent(cookie) !== "granted") return
    ctx.setCookie(X_REGISTRATION_COOKIE, crypto.randomUUID(), {
      path: "/",
      maxAge: 60 * 10,
      sameSite: "lax",
      secure: true,
      httpOnly: false,
    })
  } catch {
    // Measurement must never break account creation.
  }
}

type XQueue = ((
  command: "event",
  id: string,
  data: { conversion_id: string }
) => void) & {
  exe?: unknown
}

declare global {
  interface Window {
    twq?: XQueue
  }
}

// Wait for the actual SDK, not just the queue installed by the base snippet.
// A blocked script leaves the short-lived receipt available for a reload.
export function sendXRegistration(): boolean {
  const id = readXRegistration(document.cookie)
  if (!id || !isXPixelHost(window.location.hostname)) return false
  if (readConsent(document.cookie) !== "granted") {
    document.cookie = CLEAR_X_REGISTRATION_COOKIE
    return false
  }
  if (typeof window.twq !== "function" || typeof window.twq.exe !== "function")
    return false
  window.twq("event", X_REGISTRATION_EVENT_ID, { conversion_id: id })
  document.cookie = CLEAR_X_REGISTRATION_COOKIE
  return true
}
