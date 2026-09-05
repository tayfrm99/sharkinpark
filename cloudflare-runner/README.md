# Cloudflare runner (Worker)

This directory contains a Cloudflare Worker rewrite of the bot runtime.

## What it supports

- Discord interactions endpoint (`/discord/interactions`) with:
  - `/wel` command image generation
  - `/bye` command image generation
- Health endpoint (`GET /`)
- Optional event relay endpoints for automation:
  - `POST /events/join`
  - `POST /events/leave`

The event endpoints let you preserve automatic welcome/bye behavior by sending member events from an external relay.

## Required environment variables

Set these with `wrangler secret put` (except `CHANNEL_ID`, which can be plain env in wrangler.toml if preferred):

- `DISCORD_PUBLIC_KEY` – interaction signature verification key
- `DISCORD_BOT_TOKEN` – bot token used for channel message sends
- `EVENT_WEBHOOK_SECRET` – shared secret required by `/events/*` endpoints
- `CHANNEL_ID` – default channel for `/events/*` when request body omits `channelId`

## Optional environment variables

- `DISCORD_APP_ID` – required only if you use the command registration endpoint
- `REGISTER_COMMANDS_SECRET` – required only if you use the command registration endpoint

## Routes

- `GET /` -> health text
- `POST /discord/interactions` -> Discord interactions webhook
- `POST /events/join` -> send welcome image to configured channel
- `POST /events/leave` -> send bye image to configured channel
- `POST /admin/register-commands` -> registers global `/wel` and `/bye` commands (requires admin secret)

## Local development

```bash
cd cloudflare-runner
npm install
wrangler dev
```

Then configure Discord Interactions URL to:

`https://<your-worker-domain>/discord/interactions`

## Example event relay payload

```json
{
  "guildId": "123",
  "channelId": "456",
  "user": {
    "id": "789",
    "username": "shark",
    "avatar": "a_avatarhash"
  }
}
```

Include header:

`x-runner-secret: <EVENT_WEBHOOK_SECRET>`
