# Workshop Capture

A phone-friendly app for getting things into [Homebox](https://homebox.software) quickly and finding them again.

- **Add**: take photos, tap **Identify** to have AI suggest the name, brand, model and value, tap **Scan label** to read a model and serial number off a rating plate, pick a location, and save.
- **Say or type**: "cordless drill, top shelf in the metal shop" fills in the name and location.
- **Find**: search, see where it is with a photo, and move it with one tap.
- **Projects**: list what a project needs (or let AI suggest it), match each thing to your own kit, and get a pull list grouped by location so you can gather it in one trip. Tick items as you collect them, and use **Put all back** when you're done.

Nothing the AI suggests is saved until you press save.

## Before you start

1. Install and start the **Homebox** add-on, and create your Homebox account.
2. Create a few locations in Homebox, or add them from this app with **+ New location**.

## Options

| Option | What it does |
|---|---|
| `homebox_url` | Where Homebox is. The default `http://172.30.32.1:7745` reaches the Homebox add-on through the host. If sign-in says it can't reach Homebox, open the Homebox add-on's Info page and use `http://<its hostname>:7745` instead. |
| `ai_provider` | `anthropic` (Claude), `openai`, `gemini`, or `none` to switch AI off. |
| `ai_api_key` | API key for the provider. Not needed for a local Ollama server. |
| `ai_model` | Leave empty for Claude to use the default (`claude-opus-5-5`). Required for `openai` and `gemini`, for example a vision-capable model name from your provider. |
| `ai_base_url` | Only for `openai`. Leave empty for OpenAI, or point at any OpenAI-compatible server, such as `http://<ollama-machine>:11434/v1` for Ollama. |
| `currency` | Currency for value estimates. Default `GBP`. |
| `session_hours` | How long you stay signed in on a device. Default 720 (30 days). |

Your API key stays on the Pi. The phone never sees it, and photos only go to the AI provider when you tap **Identify** or **Scan label**.

## Opening it

- **From Home Assistant**: use **Workshop** in the sidebar.
- **On your phone**: open `http://<pi-address>:8099`. Away from home, use the Pi's Tailscale name, for example `http://homeassistant:8099`. Tailscale encrypts the connection end to end.

Sign in with your Homebox email and password.

### Voice and "install as app"

Taking photos works everywhere. The 🎤 buttons and installing the app to your home screen need an HTTPS address, which browsers require for microphone access. Until that's set up, use the microphone key on your phone's keyboard in any text box. It works just as well.

## Data and backups

Items, locations and photos live in Homebox. Projects are stored in this add-on's own data folder. Both are included in Home Assistant backups.
