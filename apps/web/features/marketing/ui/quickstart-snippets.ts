// Snippets reales del endpoint público v1 (ver api.resender.dev/docs).
// Placeholders obvios, nunca secretos reales. Lo único que varía por idioma es
// el texto de ejemplo del campo `text`; el resto son identificadores de la API.
export function buildSnippets(text: string) {
  return [
    {
      id: "curl",
      label: "curl",
      lang: "bash",
      code: `curl -X POST https://api.resender.dev/v1/messages \\
  -H "Authorization: Bearer pk_live_..." \\
  -H "Idempotency-Key: message-7ac2cc32-001" \\
  -H "Content-Type: application/json" \\
  -d '{
    "pageId": "7ac2cc32-38cf-4d41-8c73-c6cf640d5b15",
    "recipientId": "6543210987",
    "type": "text",
    "text": "${text}"
  }'`,
    },
    {
      id: "node",
      label: "Node.js",
      lang: "javascript",
      code: `await fetch("https://api.resender.dev/v1/messages", {
  method: "POST",
  headers: {
    Authorization: \`Bearer \${process.env.RESENDER_KEY}\`,
    "Idempotency-Key": "message-7ac2cc32-001",
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    pageId: "7ac2cc32-38cf-4d41-8c73-c6cf640d5b15",
    recipientId: "6543210987",
    type: "text",
    text: "${text}",
  }),
})`,
    },
    {
      id: "python",
      label: "Python",
      lang: "python",
      code: `import os
import requests

requests.post(
    "https://api.resender.dev/v1/messages",
    headers={
        "Authorization": f"Bearer {os.environ['RESENDER_KEY']}",
        "Idempotency-Key": "message-7ac2cc32-001",
    },
    json={
        "pageId": "7ac2cc32-38cf-4d41-8c73-c6cf640d5b15",
        "recipientId": "6543210987",
        "type": "text",
        "text": "${text}",
    },
)`,
    },
  ]
}
