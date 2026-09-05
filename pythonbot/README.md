# Python bot rewrite

This folder contains a Python rewrite of the root `index.js` bot, keeping behavior and image composition logic aligned with the Node implementation.

## Run

From repository root:

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r pythonbot/requirements.txt
python pythonbot/bot.py
```

Environment variables are the same as `.env.example` in repository root.
