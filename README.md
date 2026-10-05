# Workshop Inventory

A self-hosted system to catalogue and find everything in a multi-use garage workshop: brewery, metal shop, wood shop, electronics and general DIY. It tracks where tools, materials and project parts are kept. It records models and serial numbers for insurance. It builds pull lists so you can gather everything a project needs in one trip.

It has two parts:

- **[Homebox](https://github.com/sysadminsmedia/homebox)** holds all the records: items, nested locations, model and serial, purchase and warranty details, photos, receipts, QR labels and CSV export.
- **Workshop Capture** is this repo. It adds an installable phone and browser app that uses the camera, microphone and AI to make capturing and finding things quick.

> Status: first prototype. See [Roadmap](#roadmap) and [the add-on docs](workshop_capture/DOCS.md).

---

## Architecture

Everything runs on the Raspberry Pi 4 that already runs Home Assistant OS (4 GB RAM).

```
 Android phone / browser
        │  HTTPS, only over your Tailscale network
        ▼
 ┌─────────────── Raspberry Pi 4 · Home Assistant OS ───────────────┐
 │                                                                  │
 │  Tailscale add-on ──► Workshop Capture add-on ──► Homebox add-on │
 │                        (PWA + API server)          (records)     │
 │                              │                                   │
 │                              └──► AI provider (Claude by default,│
 │                                   swappable)                     │
 │                                                                  │
 │  Home Assistant backups ──► Google Drive (encrypted)             │
 └──────────────────────────────────────────────────────────────────┘
```

| Piece | What it is | Why |
|---|---|---|
| Homebox | Community add-on from [Crafter-Y/homebox-addon](https://github.com/Crafter-Y/homebox-addon) (Homebox 0.26, actively maintained) | Proven home inventory app, light enough for a Pi (well under 100 MB RAM) |
| Workshop Capture | Our own Home Assistant add-on in [`workshop_capture/`](workshop_capture/): a small server plus a PWA | Camera, voice and AI capture, project pull lists. Uses the Homebox API |
| Tailscale | Official Home Assistant add-on | Private remote access that works behind CGNAT, with a real HTTPS certificate. Android Chrome needs HTTPS before it allows camera and mic |
| Backups | Home Assistant's built-in [Google Drive backup](https://www.home-assistant.io/integrations/google_drive/) | Add-on data, including the Homebox database and photos, is included in Home Assistant backups |

### Why Homebox and not something else

| Option | Verdict |
|---|---|
| **Homebox** | Best fit. It already has locations, serials, warranty, attachments, QR labels and export. It lacks AI and voice, which this repo adds. |
| InvenTree | Great for electronic components and parts lists, but heavy (Django + Postgres) and overkill for tools and timber |
| Snipe-IT | Built for corporate IT assets, so too heavy for a garage |
| Grocy | Food and household stock. Could cover brewing ingredients, but not tools |
| Fully custom | Most control, but it would rebuild everything Homebox already does |

---

## AI: swappable provider

The AI features are **provider-agnostic**. The server talks to one internal interface, and each provider is a small adapter. You pick the provider, model and API key in the add-on options.

| Operation | Input | Output |
|---|---|---|
| `identifyItem` | one or more photos | name, brand, model, category, description, confidence |
| `readLabel` | photo of a rating plate or label | model, serial, part number, any other label text |
| `parseRequest` | text, e.g. "cordless drill, top shelf, metal bench" | structured add, move or find action |
| `transcribe` (optional) | audio | text. By default, Android Chrome's built-in speech recognition is used instead |

Planned adapters:

- **Anthropic (Claude)**: the default
- **OpenAI**
- **Google Gemini**
- **OpenAI-compatible endpoints**, including a local [Ollama](https://ollama.com) server on another machine. The Pi itself is too small for local vision models

Rules:

- Photos go to the AI provider only when you tap **Identify** or **Scan label**.
- AI output is always shown as editable suggestions. Nothing is saved until you confirm it.
- API keys stay on the server in the add-on options and never reach the browser.
- You sign in with your Homebox account. The app keeps your Homebox session on the server and gives the browser only an opaque, HttpOnly cookie.

---

## Features, in build order

1. **Quick add.** Snap one or more photos, get AI suggestions, set the location from a recent list, a voice command or a QR scan, then confirm. The item and its photos are created in Homebox.
2. **Label scan.** Photograph a rating plate to fill in model and serial. You check them against the photo before saving.
3. **Find.** Type or say "where's the angle grinder?" to get the location path and a photo.
4. **Projects and pull lists.** A project (for example "Workbench rebuild" or "Brew day: IPA") is a list of needed tools and materials. The pull list is grouped by location so you can collect everything in one pass, and items can be marked as pulled or returned.
5. **Insurance report.** Exports a printable PDF or CSV of items with model, serial, value and photos, by area.
6. **Bulk mode.** Walk the garage shelf by shelf and capture many items quickly, then review them in a queue later.

---

## Setup on the Pi

Do these in order. Steps 1 to 4 secure Home Assistant and are worth doing whether or not this project goes ahead.

### 1. Clean up the old DuckDNS setup

Remote access used to run through DuckDNS and a router port forward, and it stopped working when the ISP moved the connection behind CGNAT. Remove the leftovers:

- [ ] **Delete the port forward on the router** (usually port 8123 or 443 to the Pi). It does nothing behind CGNAT, but it would expose Home Assistant again if your ISP ever gave you a public IP.
- [ ] **Uninstall the DuckDNS add-on** (Settings › Add-ons › DuckDNS › Uninstall).
- [ ] **Check `configuration.yaml`** for an `http:` block with `ssl_certificate` / `ssl_key` pointing at the old DuckDNS certificate. If it's there, remove those lines and restart, because an expired certificate will break local access. Tailscale provides its own certificate.

### 2. Install Tailscale

Tailscale works behind CGNAT. Both ends connect outwards, so you need no port forwarding and no public IP. If a direct link isn't possible, traffic goes through Tailscale's encrypted relays, which is slower but still works.

- [ ] Install the **Tailscale** add-on from the official Add-on Store, start it, and sign in from its log link.
- [ ] Install the Tailscale app on your Android phone and sign in with the same account.
- [ ] In the [Tailscale admin console](https://login.tailscale.com/admin), enable **MagicDNS** and **HTTPS certificates**.
- [ ] Test it: with Wi-Fi off on the phone, open `http://<pi-tailscale-name>:8123`.
- [ ] **Do not enable Funnel.** Funnel publishes services to the public internet, which is what we're avoiding.

### 3. Harden Home Assistant

- [ ] **Two-factor login:** open your Profile and turn on Multi-factor Authentication Modules › Authenticator app (TOTP). Do this for every user.
- [ ] Use a **strong, unique password** for every Home Assistant user, and remove any users you don't use.
- [ ] **Limit access in Tailscale:** in the admin console's Access controls, allow only your own devices to reach the Pi.
- [ ] **Remove add-ons you don't use.** If the SSH add-on is installed, either set it to key-only login (no password) or stop it.
- [ ] **Keep everything updated:** Home Assistant OS, Core and add-ons.
- [ ] Leave **Advanced mode** off in your profile unless you need it.

### 4. Encrypted backups to Google Drive

- [ ] Settings › System › Backups › set up the **Google Drive** location.
- [ ] Turn on automatic daily backups, keep several copies, and make sure **encryption** is on.
- [ ] Store the backup **encryption key** somewhere safe that isn't the Pi, such as a password manager.
- [ ] Once Homebox is in use, restore a backup somewhere to test it.

### 5. Install Homebox

- [ ] Settings › Add-ons › Add-on Store › ⋮ › **Repositories** › add `https://github.com/Crafter-Y/homebox-addon`.
- [ ] Install **Homebox**, start it, open it, and create your account.
- [ ] Rough out your top-level locations: Brewery, Metal shop, Wood shop, Electronics bench, General storage, and so on.

### 6. Install Workshop Capture

This repo is private, so Home Assistant can't fetch it from GitHub directly. Until it's public, or images are published, install it as a local add-on:

- [ ] Install the **Samba share** or **Studio Code Server** add-on so you can reach the Pi's `/addons` folder.
- [ ] Copy the `workshop_capture` folder from this repo into `/addons/` on the Pi.
- [ ] Settings › Add-ons › Add-on Store › ⋮ › **Check for updates**. **Workshop Capture** appears under *Local add-ons*.
- [ ] Install it. The first build takes a few minutes on a Pi 4.
- [ ] In its **Configuration** tab, paste your Anthropic API key into `ai_api_key` (get one at [console.anthropic.com](https://console.anthropic.com)), then start it.
- [ ] Open **Workshop** in the sidebar, or `http://<pi>:8099` on your phone, and sign in with your Homebox account.

All the options are explained in [the add-on docs](workshop_capture/DOCS.md).

---

## Security summary

- The app is reachable **only over your Tailscale network**, with nothing open to the internet.
- You sign in with your Homebox account.
- AI API keys live in the add-on options on the Pi, and your Homebox session stays on the server. Neither ever reaches the browser.
- Photos leave the Pi only when you ask for AI identification, and only to the provider you configured.
- Backups are encrypted before they go to Google Drive.

---

## Tech

- **Server:** TypeScript on Node.js 22, with no web framework and two dependencies (the Anthropic SDK and zod)
- **Frontend:** a mobile-first PWA in plain JavaScript, with no build step
- **Packaging:** a Home Assistant add-on with an `aarch64` Docker image
- **Tests:** mocked Homebox API and mocked AI adapters, so they run without the Pi or API keys

## Roadmap

- [x] Choose the approach (Homebox + capture app on the Home Assistant Pi)
- [ ] Pi setup and hardening (steps 1 to 5 above)
- [x] Scaffold the add-on, server, PWA and AI provider interface
- [x] Quick add, label scan and find
- [x] Projects and pull lists
- [ ] HTTPS on the tailnet, for the 🎤 buttons and installing to the home screen
- [ ] Insurance report
- [ ] Bulk mode
- [ ] Published add-on images, so updates install without copying files

## Development

```bash
cd workshop_capture
npm install
npm run check              # typecheck + tests
node test/demo-server.ts   # runs the UI against a fake Homebox and fake AI; sign in as rob@example.com / pw
```

The server runs TypeScript directly on Node 22.18+ (no build step). Tests use a fake Homebox and fake AI, so they need no Pi or API key.

## Notes

- The Pi currently boots from an SD card. Photos are resized to roughly 200 to 300 KB on the phone before upload, and backups go to Google Drive. Moving to a Pi 5 with NVMe later is a Home Assistant backup and restore.
