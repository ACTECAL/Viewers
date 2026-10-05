# OHIF Viewer Development: Viewers

> **Cross-repository principle:** A task originating in this repository may require changes in other repositories. Do not assume repository scope from the task wording. Read `ARCHITECTURE_INDEX.md`, trace the actual implementation, and perform cross-repository impact analysis before implementation.

> **One instruction file for every AI tool.** Kiro, Cursor, Antigravity, Codex, GitHub Copilot and Windsurf read this `AGENTS.md` directly. Claude Code reads it through `CLAUDE.md`, and Gemini CLI through `.gemini/settings.json`. Edit only this file; `node ../erp-architecture/scripts/agent-files.mjs --check` verifies the wiring.

## Architecture context

- **`ARCHITECTURE_INDEX.md`**: read this first. It is `../erp-architecture/ARCHITECTURE_INDEX.md`; §10 is the OHIF → API quick map.
- **`REPO_MAP.md`**: detailed evidence, at `../erp-architecture/REPO_MAP.md`. The sections most relevant here are §6 (custom vs standard, launch, identifiers, endpoints), §8 W9 (the DICOM workflow) and §13.3.
- **Access**: both files are in `../erp-architecture`, a clone next to this repository. Give your tool read access to it: add it as a workspace folder (Kiro, Cursor, Antigravity, VS Code), or start Claude Code with `--add-dir ../erp-architecture`. They are context aids, not a substitute for reading the source. Do not copy their content into this file.
- **Folder names**: `erp-api` (API), `erp_updated_ui` (Main UI), `db-migration` (DB Migration), `Viewers` (this OHIF repository; the docs prefix its paths with `ohif/`), plus `erp-architecture` (cross-repository documents and `TASK_PLAN.md`).

## Required workflow

```text
Requirement
    ↓
ARCHITECTURE_INDEX.md
    ↓
REPO_MAP.md if deeper evidence is required
    ↓
Trace actual source code
    ↓
Identify affected repositories
    ↓
Check API
Check Main UI
Check DB Migration
Check OHIF
Check Authentication/Authorization
    ↓
TASK_PLAN.md
    ↓
Implementation
```

**Before implementing any viewer change, explicitly check the API, DB Migration and Main UI impact.** For significant tasks, write `TASK_PLAN.md` first. A task is significant if it touches more than one repository, an API contract, the database schema, authentication or authorization, tenant handling, or persisted viewer data.

- Default location: `../erp-architecture/TASK_PLAN.md`, unless the user names another.
- Do not commit it unless asked.
- It must contain this block, with a justification for every YES and the open question behind every UNKNOWN:

```text
API: YES / NO / UNKNOWN
Main UI: YES / NO / UNKNOWN
DB Migration: YES / NO / UNKNOWN
OHIF: YES / NO / UNKNOWN
Authentication: YES / NO / UNKNOWN
Authorization: YES / NO / UNKNOWN
```

## Standard OHIF vs custom code

- **Upstream base**: OHIF 3.13.0-beta.67, fork point commit `5bccf0a75`. `git diff --stat 5bccf0a75 HEAD` lists every customization.
- **Custom application code**:
  - `extensions/actecal-erp/`: data source, ApiService, panels, measurement sync, AI.
  - `modes/actecal-radiology/`: route `viewer`, right panels, toolbar.
  - Runtime config in `platform/app/public/config/default.js`.
  - Edits inside upstream packages, for example `platform/app/src/App.tsx`, `platform/app/src/index.js`, `platform/app/src/routes/WorkList/WorkList.tsx`, `extensions/default/src/ViewerLayout/index.tsx` and `extensions/default/src/DicomWebDataSource/index.ts`.
- **Where new behavior goes**: prefer the custom extension or mode. If an upstream file must change, say so in `TASK_PLAN.md`, because it makes OHIF upgrades harder.
- **Standard configuration**:
  - `platform/app/pluginConfig.json` registers extensions and modes.
  - `platform/app/public/config/*.js` holds runtime config.
  - The default data source `actecalApi` (`extensions/actecal-erp/src/getDataSourcesModule.js`) wraps the standard `ohif` DICOMweb data source.

## Viewer workflows (observed; verify in code)

- **Launch from the Main UI**: `../erp_updated_ui/src/modules/hms/hmsPages/Receipt.js` opens `/viewer?StudyInstanceUIDs=…&userId=…&tenant=…` in a new tab.
  - Share links use `?sharecode=`.
  - The worklist lives in `platform/app/src/routes/WorkList/WorkList.tsx`.
- **Boot sequence**:
  1. `platform/app/src/index.js` runs `restoreReturnTo`.
  2. `platform/app/src/App.tsx` stores `userId` in localStorage `actecal_userId`.
  3. `extensions/actecal-erp/src/index.js` runs `preRegistration` / `initializeStudy` (study context, GCP token, measurement sync).
  4. `getDataSourcesModule.js` configures the data source.
- **Panels**: components in `extensions/actecal-erp/src/components/`, registered in `getPanelModule` (`extensions/actecal-erp/src/index.js`) and wired as right panels in `modes/actecal-radiology/src/index.tsx`.

## API integration

- **Client**: every ERP call goes through `extensions/actecal-erp/src/services/ApiService.js`.
  - `authFetch` sends cookies with `credentials:'include'`.
  - On a 401 it calls `POST /auth/token`, then `GET /auth/get-permission`, then retries.
  - If that fails it redirects to Cognito with `state` containing `app=viewer`.
- **Base URL and tenant**: the base URL is `window.config.apiBaseUrl`, and the tenant is **`window.config.tenant`, not the URL `tenant` parameter**.
- **Backend handlers**:
  - `../erp-api/modules/hms/routes/viewer.routes.js` → `../erp-api/modules/hms/controllers/viewer.controller.js` / `../erp-api/modules/hms/models/viewer.model.js`.
  - Templates and dictation config come from `../erp-api/modules/hms/controllers/erpDashboard/erpDashboard.controller.js`.
- **Before calling an endpoint, confirm the route exists.** These are known to be missing: `/dicom/worklist/submit` (called from `extensions/default/src/ViewerLayout/index.tsx`) and `/dicom/studies/:id/notes`.

## Google Cloud Healthcare API integration

- **Image loading**: images load straight from `https://healthcare.googleapis.com/v1/{dicom_store_path}/dicomWeb`.
  - `dicom_store_path` comes from `GET /dicom/studies/context`.
  - The Bearer token comes from `GET /dicom/gcp-token`. It is cached in sessionStorage `actecal_cache_{uid}` and refreshed every 45 minutes.
- **One store per view**: each study has its own store path. Studies from different stores open in separate tabs.
- **Access control and token scope are API concerns**: changing them means changing `../erp-api/utils/helpers/gcpHelper.js` and `viewer.controller.js` `getGcpToken`.

## Authentication

- **Session**: the cookie session comes from the shared Cognito login.
- **Headers**:
  - The `x-user-id` header carries `users.id`, and the backend trusts it without verifying.
  - `x-perm` is sent only on some calls.
- **Exposed credentials**: the GCP token is held in the browser, and `window.config.ai` contains a Gemini API key.
- **Rules**: do not add more secrets to client config, and do not log tokens. Any auth change also affects the API (`../erp-api/middleware/auth.js`, `../erp-api/modules/erp/controllers/auth.controller.js`) and the Main UI.

## Patient / study / series / image identifiers

- **StudyInstanceUID** = `dicom_study_map.study_instance_uid` (the primary key). It is used in the URL, in every `/dicom/*` call, and in `measurements`, `study_shares` and `doctor_study_access`.
- **SeriesInstanceUID and SOPInstanceUID** come from DICOMweb through standard OHIF. Measurements store `annotation_uid`, `sop_instance_uid` and `frame_of_reference_uid`.
- **Study-list patientId**: the study list's `patientId` is filled with the ERP reference `erprefid` (= `patient.ref_no`), **not** the DICOM PatientID. Don't conflate them.
- **Other identifiers**:
  - `userId` = `users.id`.
  - The share code = `study_shares.share_token`.
  - Whether `doctor_study_access.doctor_id` matches the viewer `userId` is UNKNOWN.

## Cross-repository checks (required before implementation)

- **API**: endpoint existence, request and response shape, auth (cookies, `x-user-id`, `x-perm`), tenant, and GCP token issuance.
- **DB Migration**: any new or changed persisted viewer data (`measurements`, `study_shares`, `dicom_study_map`, `doctor_study_access`, `test_reports`, `template`, `settings`) needs `../db-migration/migrations/V<next>__*.sql`.
- **Main UI**: launch URL and parameters (`Receipt.js`), DICOM upload and ingestion (`ReportUploadModal.js`), and the patient, report and template screens that share the same data.

## Verification

- Use yarn workspaces.
- `yarn run build` runs the viewer build. `deploy.sh` builds with `APP_CONFIG=config/default.js`, syncs `platform/app/dist` to S3 and invalidates CloudFront; never run `deploy.sh` without explicit approval.
- `yarn run test:unit` runs the upstream Jest tests. The custom code has no tests.
- `yarn dev` starts a long-running dev server; ask the user to start it.
