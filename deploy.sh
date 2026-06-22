#!/bin/bash
ENVIRONMENT=$1
AWS_ACCOUNT_ID="340752815853"
REGION="ap-south-1"

# Function to read and evaluate the environment values
load_env_values() {
    # Check if env_master.sh exists
    if [ ! -f "env_master.sh" ]; then
        echo "env_master.sh not found. Proceeding with dummy values for demonstration."
        # Fallback values if env_master.sh doesn't exist
        BUCKET_NAME="actecal-ohif-viewer-$ENVIRONMENT"
        CFID="DUMMY_CLOUDFRONT_ID"
        APP_CONFIG="config/default.js"
    else
        # Source the environment configuration script
        source env_master.sh
        # Set the environment variables based on the provided environment
        set_environment "$ENVIRONMENT"
    fi

    if [ -z "$BUCKET_NAME" ] || [ -z "$CFID" ]; then
        echo "Required environment variables (BUCKET_NAME, CFID) are not set."
        exit 1
    fi

    echo "Loaded Environment-Specific Values:"
    echo "BUCKET_NAME: $BUCKET_NAME"
    echo "CFID: $CFID"
}

# Function to assume IAM role using AWS STS
assume_iam_role() {
    echo "Assuming IAM role..."
    # Assuming IAM role in the specified AWS account
    eval $(aws sts assume-role --role-arn arn:aws:iam::${AWS_ACCOUNT_ID}:role/OrganizationAccountAccessRole --role-session-name test | jq -r '.Credentials | "export AWS_ACCESS_KEY_ID=\(.AccessKeyId)\nexport AWS_SECRET_ACCESS_KEY=\(.SecretAccessKey)\nexport AWS_SESSION_TOKEN=\(.SessionToken)\n"')
}

# Prepare Build Yarn (OHIF uses Yarn workspaces)
prepare_build_yarn() {
    echo "Preparing Build with Yarn..."
    
    # Ensure NVM is sourced
    export NVM_DIR="$HOME/.nvm"
    [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
    [ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"

    # Check if NVM is available
    if command -v nvm > /dev/null 2>&1; then
        echo "NVM sourced successfully."
        nvm --version
    else
        echo "NVM command not found. Ensure NVM is correctly sourced."
        exit 1
    fi

    # OHIF explicitly requires node >=18 and yarn >=1.20
    echo "Setting Node version to 18..."
    nvm install 18 || { echo "NVM install 18 failed"; exit 1; }
    nvm use 18 || { echo "NVM use 18 failed"; exit 1; }

    # Set build environment variables
    export NODE_OPTIONS=--max_old_space_size=12000
    export GENERATE_SOURCEMAP=false
    
    # OHIF uses APP_CONFIG to determine which configuration file to build with
    # Default is config/default.js, but you can override this based on environment
    if [ -z "$APP_CONFIG" ]; then
        export APP_CONFIG="config/default.js"
    fi

    echo "Installing Yarn dependencies..."
    yarn install --frozen-lockfile || { echo "Yarn install failed"; exit 1; }
    
    echo "Building OHIF Viewer..."
    yarn run build || { echo "Yarn build failed"; exit 1; }
}

# Copy to S3
copy_to_s3() {
    echo "Copying to S3..."
    # OHIF builds into platform/app/dist
    aws s3 sync platform/app/dist/. "s3://$BUCKET_NAME" || { echo "S3 sync failed"; exit 1; }
}

# Invalidate Cloudfront
invalidate_cloudfront() {
    echo "Invalidating Cloudfront..."
    aws cloudfront create-invalidation --distribution-id "$CFID" --paths "/*" || { echo "Cloudfront invalidation failed"; exit 1; }
}

# Main execution flow
load_env_values
assume_iam_role
prepare_build_yarn
copy_to_s3
invalidate_cloudfront

echo "Deployment to $ENVIRONMENT completed successfully!"
