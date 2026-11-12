#!/bin/bash
# Builds the standalone (offline) edition of Actecal Spectra into platform/app/dist: a DICOM viewer that opens
# files, folders and ZIPs from the visitor's device, with no ERP, sign-in, server or analytics
# (platform/app/public/config/offline.js, platform/app/pluginConfig.offline.json, extensions/actecal-offline).
#
# Usage: ./build-offline.sh [PUBLIC_URL]
#   PUBLIC_URL  the path the build is served from; default /offline/ (https://spectra.actecal.com/offline/).
#               Use / for the root of a domain or for a desktop app. It must start and end with "/".
#
# The main viewer and this edition share platform/app/dist, so build right before copying or uploading it.
# It builds platform/app directly, not through the root `yarn run build`, so that no cached main build can be
# restored in its place. Needs Node.js 18 or later and `yarn install` done at the repository root.
set -euo pipefail

PUBLIC_URL="${1:-/offline/}"
if [[ ! "$PUBLIC_URL" =~ ^/([A-Za-z0-9._-]+/)*$ ]]; then
    echo "PUBLIC_URL must start and end with /, like /offline/ or /" >&2
    exit 1
fi

cd "$(dirname "$0")"
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if (( NODE_MAJOR < 18 )); then
    echo "Node.js 18 or later is needed (found $(node -v))." >&2
    exit 1
fi
if [[ ! -e node_modules/@ohif/extension-actecal-offline || ! -e node_modules/@ohif/mode-actecal-offline ]]; then
    echo "The offline extension and mode are not linked yet: run yarn install at the repository root." >&2
    exit 1
fi

export PUBLIC_URL
export APP_CONFIG="config/offline.js"
export PLUGIN_CONFIG="pluginConfig.offline.json"
echo "Building the offline edition for $PUBLIC_URL (Node.js $(node -v))..."
# Removed first, so that the checks below fail when a build stops early instead of passing on an older build.
rm -f platform/app/dist/app-config.js platform/app/dist/index.html
(cd platform/app && yarn run build:viewer)

# The output must be this edition, for this path, before anything copies or uploads it.
grep -q "config/offline.js" platform/app/dist/app-config.js || { echo "platform/app/dist is not the offline edition." >&2; exit 1; }
grep -q "src=\"${PUBLIC_URL}app-config.js\"" platform/app/dist/index.html || { echo "platform/app/dist/index.html is not built for $PUBLIC_URL." >&2; exit 1; }
echo "Built the offline edition for $PUBLIC_URL in platform/app/dist."
