# Meta App Review Notes — Messenger

## Review credentials

URL: https://resender.dev/login

Email: demo@resender.dev

Password: [enter the temporary review password]

## Important

This review account is already preconfigured with a connected Facebook Page and an external automation. Please do not connect a new Facebook Page during review.

## Demo Facebook Page

https://www.facebook.com/profile.php?id=61584495695858

## Screen recording

https://www.youtube.com/watch?v=iLLVMWvRhFo

## Steps

1. Log in to Resender using the review credentials above.
2. Go to Connections and confirm the demo Facebook Page is connected.
3. Go to Messages to view the Messenger conversation log.
4. The screen recording demonstrates the end-to-end Messenger flow: an app tester sends a DM to the demo Page, Resender receives and stores the message, Resender forwards it to the configured external automation, and the automation replies through Resender's `/api/meta/send` endpoint.
5. The outgoing reply is delivered back to the Messenger conversation and appears in Resender's message log.

## Product explanation

Resender is a Messenger gateway and durable message log for businesses. Resender receives Messenger webhooks from connected Facebook Pages, stores each conversation, forwards inbound messages to the business' external automation, and allows that automation to reply through Resender's authenticated API.

## Permission usage

- `pages_show_list`: lets the business select the Facebook Pages it manages during connection.
- `pages_manage_metadata`: lets Resender subscribe the selected Page to the app webhook.
- `pages_messaging`: lets Resender send customer support replies to Messenger users through the connected Page.

## Development mode note

Because the app is pending `pages_messaging` approval, the screen recording uses a Facebook account with tester access to demonstrate the Messenger DM flow before Live mode. The Resender review account is preconfigured so reviewers can inspect the connected Page, webhook configuration, and message log.
