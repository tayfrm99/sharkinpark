# sharkinpark

Discord welcome-image bot with:
- automatic welcome image on member join
- automatic goodbye image on member leave
- fallback goodbye trigger from Dyno leave messages (`<username> has left the server. Their loss.`)
- `/wel` slash command to generate welcome images manually
- `/bye` slash command to generate goodbye images manually

Template files in repository root:
- `template.png` for welcome images
- `bye-template.png` for goodbye images (if missing, bot falls back to `template.png`)

## Run locally

### Linux font requirement

On Linux, this bot now requires the **Arial Black** system font.  
If Arial Black is not installed, the process exits with an error instead of falling back to another font.

1. Create `.env`:
   ```env
   TOKEN=your_discord_bot_token
   CHANNEL_ID=your_channel_id
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
- Enable **Message Content Intent** (needed for Dyno leave-message fallback detection)

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
