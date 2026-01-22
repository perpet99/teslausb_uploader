#!/bin/bash

echo "======================================"
echo "Tesla USB Uploader Installation Script"
echo "======================================"
echo ""

# Save current directory
INSTALL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${INSTALL_DIR}/.env"

echo "Installation directory: ${INSTALL_DIR}"
echo ""

# Input WiFi SSID
echo "📶 Enter WiFi SSID (e.g., ehbs):"
read -r WIFI_SSID

if [ -z "$WIFI_SSID" ]; then
    echo "❌ WiFi SSID not provided."
    exit 1
fi

# Input Discord webhook URL
echo ""
echo "📡 Enter Discord webhook URL:"
read -r DISCORD_WEBHOOK_URL

if [ -z "$DISCORD_WEBHOOK_URL" ]; then
    echo "❌ Discord webhook URL not provided."
    exit 1
fi

# Create .env file
echo ""
echo "📝 Creating .env file..."

cat > "$ENV_FILE" << EOF
# Tesla USB Uploader 설정
WIFI_SSID=${WIFI_SSID}
DISCORD_WEBHOOK_URL=${DISCORD_WEBHOOK_URL}
EOF

echo "✅ .env file created: ${ENV_FILE}"

# Check and install Node.js
echo ""
echo "🔍 Checking Node.js version..."
REQUIRED_NODE_VERSION=18
NODE_FULL_VERSION="18.20.5"

if command -v node > /dev/null 2>&1; then
    NODE_VERSION=$(node -v)
    NODE_MAJOR_VERSION=$(echo "$NODE_VERSION" | sed 's/v\([0-9]*\).*/\1/')
    echo "✅ Node.js installed: ${NODE_VERSION}"

    # Test if node actually works (GLIBC compatibility check)
    if node -e "console.log('ok')" > /dev/null 2>&1; then
        if [ "$NODE_MAJOR_VERSION" -lt "$REQUIRED_NODE_VERSION" ]; then
            echo "⚠️ Node.js version is too old. Minimum required: v${REQUIRED_NODE_VERSION}"
            echo "   Upgrading Node.js..."
            INSTALL_NODE=true
        else
            INSTALL_NODE=false
        fi
    else
        echo "⚠️ Node.js is installed but not working (GLIBC compatibility issue)."
        echo "   Reinstalling with compatible version..."
        INSTALL_NODE=true
    fi
else
    echo "⚠️ Node.js is not installed."
    INSTALL_NODE=true
fi

if [ "$INSTALL_NODE" = true ]; then
    echo "📦 Installing Node.js v${NODE_FULL_VERSION} for Raspberry Pi..."

    # Detect architecture
    ARCH=$(uname -m)
    echo "   Detected architecture: ${ARCH}"

    case "$ARCH" in
        armv6l)
            # Raspberry Pi Zero, Pi 1
            NODE_ARCH="armv6l"
            USE_UNOFFICIAL=true
            ;;
        armv7l)
            # Raspberry Pi 2, 3, 4 (32-bit OS)
            NODE_ARCH="armv7l"
            USE_UNOFFICIAL=false
            ;;
        aarch64)
            # Raspberry Pi 3, 4, 5 (64-bit OS)
            NODE_ARCH="arm64"
            USE_UNOFFICIAL=false
            ;;
        *)
            echo "❌ Unsupported architecture: ${ARCH}"
            exit 1
            ;;
    esac

    # Remove existing broken Node.js installation
    if command -v apt-get > /dev/null 2>&1; then
        echo "   Removing existing Node.js installation..."
        sudo apt-get remove -y nodejs npm 2>/dev/null || true
        sudo rm -rf /usr/local/lib/node* /usr/local/bin/node /usr/local/bin/npm /usr/local/bin/npx
    fi

    # Download and install Node.js
    cd /tmp

    if [ "$USE_UNOFFICIAL" = true ]; then
        # Use unofficial-builds for armv6l (Pi Zero, Pi 1)
        NODE_URL="https://unofficial-builds.nodejs.org/download/release/v${NODE_FULL_VERSION}/node-v${NODE_FULL_VERSION}-linux-${NODE_ARCH}.tar.gz"
    else
        # Use official builds for armv7l and arm64
        NODE_URL="https://nodejs.org/dist/v${NODE_FULL_VERSION}/node-v${NODE_FULL_VERSION}-linux-${NODE_ARCH}.tar.gz"
    fi

    echo "   Downloading from: ${NODE_URL}"
    curl -fsSL -o node.tar.gz "$NODE_URL"

    if [ $? -ne 0 ]; then
        echo "❌ Failed to download Node.js"
        exit 1
    fi

    echo "   Extracting..."
    sudo tar -xzf node.tar.gz -C /usr/local --strip-components=1
    rm node.tar.gz

    # Verify installation
    if command -v node > /dev/null 2>&1 && node -e "console.log('ok')" > /dev/null 2>&1; then
        NODE_VERSION=$(node -v)
        echo "✅ Node.js installation complete: ${NODE_VERSION}"
    else
        echo "❌ Node.js installation failed."
        exit 1
    fi

    cd "${INSTALL_DIR}"
fi

# Check npm version
if command -v npm > /dev/null 2>&1; then
    NPM_VERSION=$(npm -v)
    echo "✅ npm installed: ${NPM_VERSION}"
else
    echo "❌ npm is not installed."
    exit 1
fi

# Install ffmpeg (Raspberry Pi/Debian based)
echo ""
echo "📦 Checking ffmpeg installation..."
if command -v ffmpeg > /dev/null 2>&1; then
    FFMPEG_VERSION=$(ffmpeg -version | head -n 1)
    echo "✅ ffmpeg already installed: ${FFMPEG_VERSION}"
else
    echo "⚠️ ffmpeg is not installed."
    echo "   Starting ffmpeg installation..."
    
    if command -v apt-get > /dev/null 2>&1; then
        echo "   sudo privileges required..."
        sudo apt-get update
        sudo apt-get install -y ffmpeg
        echo "✅ ffmpeg installation complete"
    else
        echo "❌ apt-get not found. Please install ffmpeg manually."
    fi
fi

# Check package.json file
echo ""
echo "📦 Checking package.json..."
if [ ! -f "${INSTALL_DIR}/package.json" ]; then
    echo "⚠️ package.json not found. Creating..."
    
    cat > "${INSTALL_DIR}/package.json" << 'EOF'
{
  "name": "teslausb-uploader",
  "version": "1.0.0",
  "description": "Tesla USB video uploader to Discord",
  "main": "main.js",
  "type": "module",
  "scripts": {
    "start": "node main.js",
    "test": "echo \"Error: no test specified\" && exit 1"
  },
  "keywords": ["tesla", "discord", "uploader"],
  "author": "",
  "license": "ISC",
  "dependencies": {
    "axios": "^1.6.0",
    "form-data": "^4.0.0",
    "dotenv": "^16.3.1"
  }
}
EOF
    
    echo "✅ package.json created"
fi

# Install Node.js modules
echo ""
echo "📦 Installing Node.js modules..."
cd "${INSTALL_DIR}"
npm install

if [ $? -eq 0 ]; then
    echo "✅ Node.js modules installed successfully"
else
    echo "❌ Node.js modules installation failed"
    exit 1
fi

# Check main.js file
echo ""
if [ -f "${INSTALL_DIR}/main.js" ]; then
    echo "✅ main.js file found"
else
    echo "⚠️ main.js file not found."
fi

# Register systemd service
echo ""
echo "🔧 Setting up systemd service..."

SERVICE_FILE="${INSTALL_DIR}/teslausb-uploader.service"

if [ ! -f "$SERVICE_FILE" ]; then
    echo "⚠️ Service file not found. Creating..."
    
    cat > "$SERVICE_FILE" << EOF
[Unit]
Description=Tesla USB Uploader Service
After=network.target

[Service]
Type=simple
User=${USER}
WorkingDirectory=${INSTALL_DIR}
ExecStart=/usr/bin/node ${INSTALL_DIR}/main.js
Restart=no
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF
    
    echo "✅ Service file created: ${SERVICE_FILE}"
fi

echo ""
echo "📋 Would you like to register the systemd service now? (y/n)"
read -r REGISTER_SERVICE

if [ "$REGISTER_SERVICE" = "y" ] || [ "$REGISTER_SERVICE" = "Y" ]; then
    echo "   Registering service (sudo privileges required)..."
    sudo cp "$SERVICE_FILE" /etc/systemd/system/
    sudo systemctl daemon-reload
    sudo systemctl stop teslausb-uploader
    sudo systemctl enable teslausb-uploader
    sudo systemctl start teslausb-uploader

    echo "✅ Service registered and enabled"
    echo ""
    echo "   Start the service with: sudo systemctl start teslausb-uploader"
    echo "   Check status with: sudo systemctl status teslausb-uploader"
else
    echo "⏭️ Service registration skipped"
fi


# Installation complete
echo ""
echo "======================================"
echo "✅ Installation completed successfully!"
echo "======================================"
echo ""
echo "Configuration:"
echo "  - WiFi SSID: ${WIFI_SSID}"
echo "  - Webhook URL: ${DISCORD_WEBHOOK_URL}"
echo "  - Installation path: ${INSTALL_DIR}"
echo ""
echo "To run:"
echo "  cd ${INSTALL_DIR}"
echo "  node main.js"
echo ""
echo "Or to register as a systemd service:"
echo "  sudo cp teslausb-uploader.service /etc/systemd/system/"
echo "  sudo systemctl enable teslausb-uploader"
echo "  sudo systemctl start teslausb-uploader"
echo ""
