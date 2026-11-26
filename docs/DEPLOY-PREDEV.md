# Deploying wasm-artcraft on Pre-Dev (predev.oriso.org)

For a session with SSH access to the Pre-Dev server. Each step says how to check it worked.
Parent issue: OpenResilienceInitiative/ORISO-Frontend#2579. Pre-Dev branches are on the dev
state of 2026-11-26 (OpenResilienceInitiative/ORISO-Helm#679).

What the server looked like on 2026-11-26 (read-only check): Helm release `caritas` revision 5
from 2026-10-16 (chart 2.0.1); values and secrets in `/root/ORISO-Helm/{values,secrets}.yaml`
(checkout on `release/oriso-2.0.5`); services rolled out by `/root/predev-deploy-script/*.sh`;
no `addons` namespace.

## 0. The lane scripts

ORISO-Helm, branch `pre-dev`, folder `predev-lane/` (see its README). They read the server's
values and secrets, never print them, and keep their own generated values in
`/root/predev-lane/extra/` (mode 600).

```sh
ssh root@predev.oriso.org
git clone -q --branch pre-dev https://github.com/OpenResilienceInitiative/ORISO-Helm /root/predev-lane/runner \
  || git -C /root/predev-lane/runner pull -q
L=/root/predev-lane/runner/predev-lane
bash $L/status.sh
```

## 1. Upgrade the release to the pre-dev chart

```sh
bash $L/helm-check.sh      # dry run against the cluster: Helm's errors, or the images it would roll out
```

Required values that Pre-Dev's old `values.yaml`/`secrets.yaml` lack show up here as
`... is required` errors (likely candidates after 554 chart commits:
`global.keycloak.serviceTechUserId`, `userService.statisticsMessageCountHmacSecret`,
`global.secrets.keycloakAdminUsername`). Add each to `/root/ORISO-Helm/secrets.yaml` (secrets)
or `values.yaml`, re-run `helm-check` until it says `dry run: OK`, then:

```sh
bash $L/helm-upgrade.sh    # --wait-for-jobs, 20 min; ends with status.sh
```

Check: `helm list -n caritas` shows a new revision `deployed`; `status.sh` lists no workloads
that are not ready. If database migrations fail on old Pre-Dev data, a fresh Pre-Dev database
is acceptable (product owner, 2026-11-26).

## 2. AddonService on

The AddonService image comes from ORISO-AddonService `main` (`latest`); it already contains the
fix that lets the web app frame add-on pages (ORISO-AddonService#3).

```sh
ADDONSERVICE_TAG=latest bash $L/addonservice-on.sh   # generates DB password + token key, switches it on
bash $L/helm-check.sh && bash $L/helm-upgrade.sh
```

Check:
```sh
kubectl -n caritas rollout status deploy/addonservice
kubectl get ns addons
curl -sI https://predev.oriso.org/service/addons/.well-known/jwks.json | head -1   # HTTP 200
```

## 3. The add-on image

Pushing `wasm-artcraft/v1` in this repo runs `.github/workflows/build.yml`: tests, then the
image `ghcr.io/storypapst/oriso-wasm-artcraft:wasm-artcraft-v1` with WordCraft, GridCraft and
PdfCraft from their latest releases (checksummed).

GitHub makes new packages **private**. Either make the package public (GitHub → Packages →
oriso-wasm-artcraft → Package settings → Change visibility), or give the cluster a pull secret
in `addons` and set `imagePullSecrets` in the chart.

## 4. Install the add-on

```sh
git clone -q --branch wasm-artcraft/v1 https://github.com/Storypapst/oriso-wasm-artcraft /root/oriso-wasm-artcraft \
  || git -C /root/oriso-wasm-artcraft pull -q
helm upgrade --install wasm-artcraft /root/oriso-wasm-artcraft/chart -n addons
# A new build reuses the tag wasm-artcraft-v1; pullPolicy Always only pulls when a Pod starts:
kubectl -n addons rollout restart deploy/wasm-artcraft
kubectl -n addons rollout status deploy/wasm-artcraft
```

Check, through the AddonService (same origin as the web app):
```sh
B=https://predev.oriso.org/service/addons/wasm-artcraft/ui
curl -s  $B/entry.js | head -3                                  # the panel module
curl -sI $B/craft/wordcraft/index.html | grep -iE 'x-frame|frame-ancestors'   # SAMEORIGIN / 'self'
curl -s  $B/craft/wordcraft/index.html | grep -o 'wordcraft-web-[0-9a-f]*_bg.wasm'
curl -sI "$B/craft/wordcraft/$(curl -s $B/craft/wordcraft/index.html | grep -o 'wordcraft-web-[0-9a-f]*_bg.wasm' | head -1)" | grep -i content-type   # application/wasm
```

The AddonService lists Services labelled `oriso.io/addon=true` every 30 seconds; the add-on is
then *available*, not active.

## 5. Switch it on for one test Träger only

ORISO-Admin on Pre-Dev as SuperAdmin → Add-ons → **wasm-artcraft** → on globally, mode
`TENANT` or `ON` for the test Träger only, `OFF` for all others.

## 6. Acceptance (the goal of #2579)

As a counsellor of the test Träger, in a case:

- [ ] Next to the audio and video buttons there is **Dokumente**; it opens the smart menu (Text, Tabelle, PDF, Datei öffnen).
- [ ] A `.docx` attachment, after **Prüfen/Entschlüsseln** in the chat, dragged onto **Text** opens in WordCraft with its content.
- [ ] Edit, **Strg+S**: the state says *Gespeichert · Version 1*; the Ablage shows the version.
- [ ] **Großes Fenster** grows the editor without reloading; the chat stays usable on the left.
- [ ] The version dragged into the message field (or **In Chat legen**) appears as an attachment; **Senden** sends it.
- [ ] The sent event is encrypted: in the browser's network tab the upload is `application/octet-stream`, and the timeline event carries `file`, not `url`.
- [ ] Same for `.xlsx` (Tabelle) and `.pdf` (PDF).
- [ ] Another case: the Ablage is empty.
- [ ] Without WebGL (e.g. `chrome://flags` → disable WebGL/WebGPU) the panel says the program could not start.

Write the result (passed items, browser, any `.docx` that did not survive a round trip) into
ORISO-Frontend#2579.

## Rolling back

```sh
helm uninstall wasm-artcraft -n addons            # the add-on
rm /root/predev-lane/extra/addonService.enabled.bool && bash $L/helm-upgrade.sh   # AddonService off
helm rollback caritas <revision> -n caritas       # the release, revision from `helm history caritas -n caritas`
```
