# Python bot rewrite (PythonAnywhere-friendly)

This folder contains a Python rewrite of the root `index.js` bot, keeping behavior and image composition logic aligned with the Node implementation.

## PythonAnywhere free-tier layout

Run the bot from this folder only (`/pythonbot`) and keep assets local:

- `/pythonbot/bot.py`
- `/pythonbot/template.png`
- `/pythonbot/bye-template.png`
- `/pythonbot/.env`

The bot now loads templates and `.env` from `/pythonbot` only and does not rely on parent directories.

## Run

From repository root:

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r pythonbot/requirements.txt
python pythonbot/bot.py
```

## Environment variables

Use the same keys as root `.env.example`:

```env
TOKEN=replace-with-discord-bot-token
CHANNEL_ID=replace-with-channel-id
ENABLE_DYNO_LEAVE_FALLBACK=false
DYNO_BOT_ID=155149108183695360
PORT=10000
```

## Ping / health page

The bot starts an HTTP server on `PORT` and serves a styled health page at `/` for uptime pings.
