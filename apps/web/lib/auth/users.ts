import { getSql } from "@/lib/db"

import { hashPassword, verifyPassword } from "./password"
import { validateAuthInput, validatePasswordInput } from "./validation"

export type UserRecord = {
  id: string
  email: string
  passwordHash: string
  createdAt: Date
}

type UserRow = {
  id: string
  email: string
  password_hash: string
  created_at: Date
}

export class DuplicateEmailError extends Error {
  constructor() {
    super("duplicate email")
    this.name = "DuplicateEmailError"
  }
}

export class InvalidAuthInputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "InvalidAuthInputError"
  }
}

export async function createUser(emailInput: unknown, passwordInput: unknown) {
  const input = validateAuthInput(emailInput, passwordInput)
  if (!input.ok) throw new InvalidAuthInputError(input.error)

  const sql = getSql()
  const passwordHash = await hashPassword(input.value.password)

  try {
    const [row] = await sql<UserRow[]>`
      insert into users (email, password_hash)
      values (${input.value.email}, ${passwordHash})
      returning id, email, password_hash, created_at
    `

    if (!row) throw new Error("user insert failed")
    return mapUser(row)
  } catch (error) {
    if (isUniqueViolation(error)) throw new DuplicateEmailError()
    throw error
  }
}

export async function getUserByEmail(emailInput: unknown) {
  const email =
    typeof emailInput === "string" ? emailInput.trim().toLowerCase() : ""
  if (!email) return null

  const sql = getSql()
  const [row] = await sql<UserRow[]>`
    select id, email, password_hash, created_at
    from users
    where email = ${email}
    limit 1
  `

  return row ? mapUser(row) : null
}

export async function authenticateUser(
  emailInput: unknown,
  passwordInput: unknown
) {
  const input = validateAuthInput(emailInput, passwordInput)
  if (!input.ok) return null

  const user = await getUserByEmail(input.value.email)
  if (!user) return null

  const valid = await verifyPassword(input.value.password, user.passwordHash)
  return valid ? user : null
}

export async function changeUserPassword(
  userId: string,
  passwordInput: unknown
) {
  const password = validatePasswordInput(passwordInput)
  if (!password.ok) throw new InvalidAuthInputError(password.error)

  const passwordHash = await hashPassword(password.value)
  const sql = getSql()
  const [row] = await sql<UserRow[]>`
    update users
    set password_hash = ${passwordHash}, updated_at = now()
    where id = ${userId}
    returning id, email, password_hash, created_at
  `

  return row ? mapUser(row) : null
}

function mapUser(row: UserRow): UserRecord {
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.password_hash,
    createdAt: row.created_at,
  }
}

function isUniqueViolation(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505"
  )
}
