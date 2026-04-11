# sharkinpark

Discord welcome-image bot with:
- automatic welcome image on member join
- `/wel` slash command to generate welcome images manually

## Run locally

1. Create `.env`:
   ```env
   TOKEN=your_discord_bot_token
   CHANNEL_ID=your_channel_id
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

## One-command Azure VM install (Ubuntu/Debian)

From repository root:

```bash
chmod +x /home/runner/work/sharkinpark/sharkinpark/scripts/install-azure-vm.sh
/home/runner/work/sharkinpark/sharkinpark/scripts/install-azure-vm.sh
```

What it does:
- installs Node.js 20 (if needed)
- runs `npm ci --omit=dev`
- creates `.env` from `.env.example` if missing
- installs and starts a `systemd` service (`sharkinpark-bot`)

After install, edit `.env` with real Discord values if still placeholders, then restart:

```bash
sudo systemctl restart sharkinpark-bot
sudo systemctl --no-pager --full status sharkinpark-bot
```
