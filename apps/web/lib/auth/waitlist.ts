import { getSql } from "@/lib/db"

// Access gate for the waitlist launch: a user only reaches the product once
// `users.waitlisted` is explicitly false. New signups default to true, so the
// product stays closed until someone flips the flag for that account.
export type WaitlistAccessRow = { waitlisted: boolean }

type MaybeRow = WaitlistAccessRow | null | undefined

// Fail closed: a missing row (deleted account with a still-valid session) or an
// unreadable flag is treated as "no access", never as an open door.
export function hasProductAccess(row: MaybeRow): boolean {
  return row?.waitlisted === false
}

// Read live from the database instead of the JWT, so removing someone from the
// waitlist takes effect on their next request without forcing a re-login.
export async function isUserWaitlisted(userId: string): Promise<boolean> {
  const sql = getSql()
  const [row] = await sql<WaitlistAccessRow[]>`
    select waitlisted
    from users
    where id = ${userId}
    limit 1
  `

  return !hasProductAccess(row)
}
