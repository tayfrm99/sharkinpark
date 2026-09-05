# sharkinpark

Discord welcome-image bot with:
- automatic welcome image on member join
- automatic goodbye image on member leave
- optional fallback goodbye trigger from Dyno leave messages (`<username> has left the server. Their loss.`)
- `/wel` slash command to generate welcome images manually
- `/bye` slash command to generate goodbye images manually

Template files in repository root:
- `template.png` for welcome images
- `bye-template.png` for goodbye images (if missing, bot falls back to `template.png`)

## Run locally

### Linux font requirement

On Linux, the bot prefers **Arial Black** and automatically falls back to
`Liberation Sans`, `DejaVu Sans`, or `Noto Sans` if needed.

1. Create `.env`:
   ```env
   TOKEN=your_discord_bot_token
   CHANNEL_ID=your_channel_id
   ENABLE_DYNO_LEAVE_FALLBACK=false
   DYNO_BOT_ID=155149108183695360
   PORT=10000
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Start:
   ```bash
   npm start
   ```

### Discord bot portal settings required

- Enable **Server Members Intent**
- Enable **Message Content Intent** only if `ENABLE_DYNO_LEAVE_FALLBACK=true`

## Deploy on Render

1. Push this repository to GitHub.
2. In Render, create a **Web Service** and connect this repository.
3. Render will detect `render.yaml` and provision the service automatically.
4. Set required environment variables in Render:
   - `TOKEN` (Discord bot token)
   - `CHANNEL_ID` (target channel ID)
5. Optional environment variables:
   - `ENABLE_DYNO_LEAVE_FALLBACK` (`true` or `false`)
   - `DYNO_BOT_ID` (defaults to `155149108183695360`)
   - `PORT` (defaults to `10000`)
6. Deploy and keep the Render service running.

## One-command Azure VM install (Ubuntu/Debian)

From repository root:

```bash
chmod +x ./scripts/install-azure-vm.sh
./scripts/install-azure-vm.sh
```

What it does:
- installs Node.js 20 (if needed)
- runs `npm ci --omit=dev`
- creates `.env` from `.env.example` if missing
- installs and starts a `systemd` service (`sharkinpark-bot`)

If `.env` still has placeholder values, the installer will skip service start until you set real values.

After install, edit `.env` with real Discord values if still placeholders, then restart:

```bash
sudo systemctl restart sharkinpark-bot
sudo systemctl --no-pager --full status sharkinpark-bot
```
