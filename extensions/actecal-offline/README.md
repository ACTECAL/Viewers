# Spectra standalone (offline) edition

A DICOM viewer built from this repository with no ERP, sign-in, server or analytics. Files, folders and ZIP files open from the visitor's device into OHIF's in-memory `dicomlocal` data source; nothing is uploaded, and a reload clears the study. Premium Spectra features are shown locked and link to Actecal. Plan and decisions: `erp-architecture/TASK_PLAN.md`, TASK_PLAN 3 ("Public offline DICOM viewer").

## Parts

| What | Where |
|---|---|
| Home page (drop zone, file and folder pickers), friendly 404 and "study cleared" pages, premium dialog and panel | `extensions/actecal-offline/` |
| ZIP reading (stored, deflate, ZIP64; password-protected entries refused) with the browser's DecompressionStream | `extensions/actecal-offline/src/unzip.js` |
| The viewer: upstream basic mode plus three locked buttons (AI analysis, Report, Share) | `modes/actecal-offline/` |
| Configuration: data source, links, `onboardingLive`; follows the build's `PUBLIC_URL` | `platform/app/public/config/offline.js` |
| Plugin list (selected with `PLUGIN_CONFIG`) | `platform/app/pluginConfig.offline.json` |
| Build, deploy, CloudFront function | `build-offline.sh`, `deploy-offline.sh`, `infra/cloudfront-offline-rewrite.js` |

Shared files with an edition check: `platform/app/.webpack/writePluginImportsFile.js` (reads `PLUGIN_CONFIG`), `platform/ui-next/src/components/Header/Header.tsx` (no placeholder doctor name) and `extensions/actecal-erp/src/components/MobileBottomNav.tsx` (no Actecal mobile menu). `nx.json` hashes `APP_CONFIG`, `PLUGIN_CONFIG` and `PUBLIC_URL`, so that the root `yarn run build` never reuses one edition's result for the other.

The edition does not include `@ohif/extension-actecal-erp` or `@ohif/mode-actecal-radiology`, and its config has no `apiBaseUrl`, tenant, auth, AI, GPU or scribe keys, so it never calls erp-api.

## Build

```bash
yarn install            # once, at the repository root: links the two new workspace packages
./build-offline.sh      # for https://spectra.actecal.com/offline/ (PUBLIC_URL /offline/)
./build-offline.sh /    # for the root of a domain, or for a desktop app
```

The output is `platform/app/dist`, which the main viewer's build also uses, so build right before you copy or upload it. The script checks that `dist` is this edition, for that path.

To try a build, serve `platform/app/dist` at the path it was built for, from a static server that answers every path without a file extension with `index.html`, as `infra/cloudfront-offline-rewrite.js` does on CloudFront.

## Links and onboarding

`window.config.actecal` in `config/offline.js` holds the links, so they change without a code change. `onboardingLive` works like `ONBOARDING_LIVE` on actecal.com: while it is `false`, every premium button is "Book a demo" to `contactUrl`, and nothing links to `signUpUrl`. Set it to `true` when self-service onboarding opens to the public; the buttons then become "Get started" and "Talk to us".

## Deploy (approval needed)

At `spectra.actecal.com/offline/`, in the Spectra bucket:

1. **First, the main viewer's Jenkins deploy must keep `offline/`.** jenkins-config `script_react_yarn.sh` (environment `erp_viewer`) syncs the bucket root with `--delete`, which deletes `offline/` on every main deploy. Add `--exclude "offline/*"` to that sync before the first offline deploy.
2. Add the CloudFront behaviours and the function, as the header of `infra/cloudfront-offline-rewrite.js` describes.
3. Run `./deploy-offline.sh <environment>`. It builds, syncs `dist/` to `s3://<bucket>/offline/` with `--delete` limited to that prefix, and invalidates `/offline/*`.

Another option: a bucket and distribution of its own, such as a separate subdomain, built with `./build-offline.sh /`. That leaves the Spectra distribution and its deploy unchanged. Visitors' files also stay on an origin that does not share browser storage with the ERP viewer, which keeps the user's permission token in `localStorage`.

## Spectra Desktop

The desktop app (`desktop/`, TASK_PLAN 13) ships this edition built for `/`. The home page gets the app's file, folder and drive pickers when the app's bridge (`window.spectraDesktop`) is present, and the files the app found by address (`src/desktop.js`). In a browser the page is unchanged. See `desktop/README.md`.

## Checks

`cd desktop && npm run e2e -- web` runs this edition in Chrome, served at `/` with the recommended Content-Security-Policy and the CloudFront rewrite rule. It opens files, the three kinds of ZIP and a password-protected one, renders the images, runs MPR, presses a locked button, reloads on the viewer, opens an unknown address and checks the phone layout, with no console errors and no request to another site. It needs the build in `desktop/app/viewer` (`npm run viewer` there). Before a deploy, also open the tag browser and measure by hand.
