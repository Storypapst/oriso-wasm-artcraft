# wasm-artcraft: ORISO add-on for Word, Excel and PDF files beside the chat

An [ORISO](https://github.com/OpenResilienceInitiative) add-on (contract `oriso-addon/v1`,
ADR-034) that puts the ArtCraft Crafting Apps
[WordCraft](https://github.com/storytold/wordcraft), [GridCraft](https://github.com/storytold/gridcraft)
and [PdfCraft](https://github.com/storytold/pdfcraft) into a side panel next to the chat. They
run as WebAssembly in the browser.

**Prototype** (branch line `wasm-artcraft/v1`). The editors are alpha software; keep the original
attachment in the chat and send the edited file as a new one.

## Why

When a client sends a form as `.docx` or `.pdf`, a counsellor today downloads it, edits it in
desktop Word or Acrobat and uploads it again. That leaves a plaintext copy of sensitive
counselling data in a Downloads folder or a sync client. With this add-on the file never leaves
the browser tab, and the edited version goes back into the chat through the chat's normal
upload, which encrypts attachments end to end.

## How it works

| Step | What happens |
|---|---|
| Find it | A **Dokumente** button in the case header, next to the call buttons (slot `consultant.session`), and an entry in the chat menu. It opens a side panel with a smart menu: Text, Tabelle, PDF, Datei öffnen. |
| Open | Drag a decrypted chat attachment (or a file) onto a tool. The panel reads its bytes from the browser (the attachment is a `blob:` link) and opens the matching editor: `.docx` → WordCraft, `.xlsx` → GridCraft, `.pdf` → PdfCraft. |
| Edit | The editor runs in an iframe under `/service/addons/wasm-artcraft/ui/craft/<app>/` on the web app's origin, which its `postMessage` bridge requires. Comments and tracked changes carry the user's name (`?author=`). |
| Save | Save in the editor sends the file to the panel (`<app>:save`). Every save becomes a version in the **Ablage** (name, version, time). **Großes Fenster** grows the editor over the right part of the screen and leaves the chat free on the left. |
| Sizes | Side panel, **beside the chat** (the chat keeps 380 px on the left) and **full screen**; Esc steps back one size. Dragging a version out of full screen shrinks the window so the chat can take the drop. **Zoom** (− / % / +) scales the editor and is remembered per program. **In neuem Tab öffnen** moves the document into its own tab (`ui/tab.html`); every save there still lands in the Ablage, nothing is downloaded. |
| Pass on | Drag the chip into the chat (or press **In den Chat legen**). It lands in the message field like a dropped file; **Senden** uploads it encrypted. The next person opens it the same way. |

Work is sequential: one person edits, saves and passes the file on. There is no simultaneous
editing.

**What the add-on does not do:** it has no API and no storage. Its server only serves the
manifest and static files. It never sees a document. Saved files live in the panel's memory
until the panel closes or another chat opens, and the editors' "recent files" lists are cleared.

## Layout

| Path | |
|---|---|
| `src/manifest.mjs` | Manifest: one app `office` in the slots `consultant.session`, `consultant.session-menu`, `asker.session-menu` |
| `src/server.mjs` | Node server: manifest, `/health`, `/ui/**` (`.wasm` as `application/wasm`, hashed files cached forever) |
| `ui/entry.js` | The panel: plain DOM, no build step, no React |
| `scripts/fetch-craft.sh` | Image build: downloads the editors' `*-web-*.zip` releases and checks them against the release's `SHA256SUMS.txt` |
| `chart/` | Helm chart for the add-on namespace (Service labelled `oriso.io/addon`, NetworkPolicy: only the AddonService may connect, no egress) |

## Install

1. ORISO-Helm: `addonService.enabled: true` (see its README, section "Add-ons").
2. `helm upgrade --install wasm-artcraft ./chart -n addons` (`image.tag: wasm-artcraft-v1`; set
   `orisoNamespace` if ORISO does not run in `caritas`).
3. ORISO-Admin: switch the add-on on for a test Träger only.

The AddonService has to allow its add-on pages in a frame on the same origin
(`X-Frame-Options: SAMEORIGIN` for `/addons/*/ui/**`).

## Development

```sh
npm test               # server: manifest, MIME types, caching, path traversal (Node 24)
node test/browser.mjs  # panel in Chromium with stand-in editors that speak the Craft bridge
```

`test/fixtures/host.html` stands in for the web app: a chat with the drop zone class the web app
uses (`dragAndDropArea`) and a decrypted attachment link.

## Versions

Branch lines are named `wasm-artcraft/v1`, `wasm-artcraft/v2`, … in every repository taking
part, and publish the image `ghcr.io/storypapst/oriso-wasm-artcraft:wasm-artcraft-v<N>`.
Pin the editor releases for reproducible images with the workflow inputs (`wordcraft_tag`, …).

## License

MIT (see `LICENSE`). WordCraft, GridCraft and PdfCraft are by the ArtCraft team under MIT OR
Apache-2.0; the image includes their release files unchanged.
