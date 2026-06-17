export function formatContactLabel(contactName: string | null, contactId: string) {
  const name = contactName?.trim()
  return name ? name : `PSID ${contactId}`
}
