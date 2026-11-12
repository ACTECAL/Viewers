#!/bin/bash
# Builds the public offline edition of Spectra (build-offline.sh) and uploads it to s3://$BUCKET_NAME/offline/,
# served at https://spectra.actecal.com/offline/ (erp-architecture/TASK_PLAN.md, TASK_PLAN 3).
# Never run it without approval. Before the first run, add the CloudFront behaviours and the function in
# infra/cloudfront-offline-rewrite.js. The main viewer (deploy.sh) and this build share platform/app/dist,
# so this script always builds right before it uploads.
# The main viewer's Jenkins deploy (jenkins-config script_react_yarn.sh) syncs the bucket root with --delete,
# which removes offline/ on every main deploy, unless that sync gets --exclude "offline/*" first. See
# extensions/actecal-offline/README.md.
#
# Usage: ./deploy-offline.sh <environment>
set -euo pipefail

ENVIRONMENT=${1:?Usage: ./deploy-offline.sh <environment>}
AWS_ACCOUNT_ID="340752815853"
REGION="ap-south-1"
PREFIX="offline"

load_env_values() {
    if [ -f "env_master.sh" ]; then
        # shellcheck disable=SC1091
        source env_master.sh
        set_environment "$ENVIRONMENT"
    else
        echo "env_master.sh not found; set BUCKET_NAME and CFID in the environment."
    fi
    if [ -z "${BUCKET_NAME:-}" ] || [ -z "${CFID:-}" ]; then
        echo "BUCKET_NAME and CFID must be set."
        exit 1
    fi
    echo "Bucket: $BUCKET_NAME, prefix: $PREFIX/, distribution: $CFID"
}

assume_iam_role() {
    echo "Assuming IAM role..."
    eval "$(aws sts assume-role --role-arn "arn:aws:iam::${AWS_ACCOUNT_ID}:role/OrganizationAccountAccessRole" --role-session-name spectra-offline | jq -r '.Credentials | "export AWS_ACCESS_KEY_ID=\(.AccessKeyId)\nexport AWS_SECRET_ACCESS_KEY=\(.SecretAccessKey)\nexport AWS_SESSION_TOKEN=\(.SessionToken)\n"')"
}

build_offline() {
    export NVM_DIR="$HOME/.nvm"
    # shellcheck disable=SC1091
    [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
    # The same Node.js as the main viewer's Jenkins build (jenkins-config script_react_yarn.sh).
    nvm install 20 && nvm use 20
    export NODE_OPTIONS=--max_old_space_size=12000
    yarn install --frozen-lockfile
    # Builds platform/app directly and checks that dist is the offline edition for /$PREFIX/.
    ./build-offline.sh "/$PREFIX/"
}

upload() {
    # --delete is limited to the offline/ prefix, so the main viewer at the bucket root is untouched.
    aws s3 sync platform/app/dist/. "s3://$BUCKET_NAME/$PREFIX/" --delete --region "$REGION"
    aws cloudfront create-invalidation --distribution-id "$CFID" --paths "/$PREFIX" "/$PREFIX/*"
}

load_env_values
assume_iam_role
build_offline
upload
echo "Offline edition deployed to s3://$BUCKET_NAME/$PREFIX/ ($ENVIRONMENT)."
