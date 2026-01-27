#!/bin/bash

echo "======================================"
echo "Tesla USB Uploader 설치 스크립트"
echo "======================================"
echo ""

# 현재 디렉토리 저장
INSTALL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${INSTALL_DIR}/.env"

echo "설치 디렉토리: ${INSTALL_DIR}"
echo ""

# WiFi SSID 입력
echo "📶 WiFi SSID를 입력하세요 (예: ehbs):"
read -r WIFI_SSID

if [ -z "$WIFI_SSID" ]; then
    echo "❌ WiFi SSID가 입력되지 않았습니다."
    exit 1
fi

# Discord webhook URL 입력
echo ""
echo "📡 Discord 웹훅 URL을 입력하세요:"
read -r DISCORD_WEBHOOK_URL

if [ -z "$DISCORD_WEBHOOK_URL" ]; then
    echo "❌ Discord 웹훅 URL이 입력되지 않았습니다."
    exit 1
fi

# .env 파일 생성
echo ""
echo "📝 .env 파일 생성 중..."

cat > "$ENV_FILE" << EOF
# Tesla USB Uploader 설정
WIFI_SSID=${WIFI_SSID}
DISCORD_WEBHOOK_URL=${DISCORD_WEBHOOK_URL}
EOF

echo "✅ .env 파일 생성 완료: ${ENV_FILE}"

# Node.js 확인 및 설치
echo ""
echo "🔍 Node.js 버전 확인 중..."
REQUIRED_NODE_VERSION=18
NODE_FULL_VERSION="18.20.5"

if command -v node > /dev/null 2>&1; then
    NODE_VERSION=$(node -v)
    NODE_MAJOR_VERSION=$(echo "$NODE_VERSION" | sed 's/v\([0-9]*\).*/\1/')
    echo "✅ Node.js 설치됨: ${NODE_VERSION}"

    # Node.js 실제 동작 테스트 (GLIBC 호환성 확인)
    if node -e "console.log('ok')" > /dev/null 2>&1; then
        if [ "$NODE_MAJOR_VERSION" -lt "$REQUIRED_NODE_VERSION" ]; then
            echo "⚠️ Node.js 버전이 너무 낮습니다. 최소 요구 버전: v${REQUIRED_NODE_VERSION}"
            echo "   Node.js 업그레이드 중..."
            INSTALL_NODE=true
        else
            INSTALL_NODE=false
        fi
    else
        echo "⚠️ Node.js가 설치되어 있지만 동작하지 않습니다 (GLIBC 호환성 문제)."
        echo "   호환 가능한 버전으로 재설치 중..."
        INSTALL_NODE=true
    fi
else
    echo "⚠️ Node.js가 설치되어 있지 않습니다."
    INSTALL_NODE=true
fi

if [ "$INSTALL_NODE" = true ]; then
    echo "📦 라즈베리파이용 Node.js v${NODE_FULL_VERSION} 설치 중..."

    # 아키텍처 감지
    ARCH=$(uname -m)
    echo "   감지된 아키텍처: ${ARCH}"

    case "$ARCH" in
        armv6l)
            # 라즈베리파이 Zero, Pi 1
            NODE_ARCH="armv6l"
            USE_UNOFFICIAL=true
            ;;
        armv7l)
            # 라즈베리파이 2, 3, 4 (32비트 OS)
            NODE_ARCH="armv7l"
            USE_UNOFFICIAL=false
            ;;
        aarch64)
            # 라즈베리파이 3, 4, 5 (64비트 OS)
            NODE_ARCH="arm64"
            USE_UNOFFICIAL=false
            ;;
        *)
            echo "❌ 지원하지 않는 아키텍처: ${ARCH}"
            exit 1
            ;;
    esac

    # 기존 Node.js 설치 제거
    if command -v apt-get > /dev/null 2>&1; then
        echo "   기존 Node.js 설치 제거 중..."
        sudo apt-get remove -y nodejs npm 2>/dev/null || true
        sudo rm -rf /usr/local/lib/node* /usr/local/bin/node /usr/local/bin/npm /usr/local/bin/npx
    fi

    # Node.js 다운로드 및 설치
    cd /tmp

    if [ "$USE_UNOFFICIAL" = true ]; then
        # armv6l용 비공식 빌드 사용 (Pi Zero, Pi 1)
        NODE_URL="https://unofficial-builds.nodejs.org/download/release/v${NODE_FULL_VERSION}/node-v${NODE_FULL_VERSION}-linux-${NODE_ARCH}.tar.gz"
    else
        # armv7l, arm64용 공식 빌드 사용
        NODE_URL="https://nodejs.org/dist/v${NODE_FULL_VERSION}/node-v${NODE_FULL_VERSION}-linux-${NODE_ARCH}.tar.gz"
    fi

    echo "   다운로드 경로: ${NODE_URL}"
    curl -fsSL -o node.tar.gz "$NODE_URL"

    if [ $? -ne 0 ]; then
        echo "❌ Node.js 다운로드 실패"
        exit 1
    fi

    echo "   압축 해제 중..."
    sudo tar -xzf node.tar.gz -C /usr/local --strip-components=1
    rm node.tar.gz

    # 설치 확인
    if command -v node > /dev/null 2>&1 && node -e "console.log('ok')" > /dev/null 2>&1; then
        NODE_VERSION=$(node -v)
        echo "✅ Node.js 설치 완료: ${NODE_VERSION}"
    else
        echo "❌ Node.js 설치 실패"
        exit 1
    fi

    cd "${INSTALL_DIR}"
fi

# npm 버전 확인
if command -v npm > /dev/null 2>&1; then
    NPM_VERSION=$(npm -v)
    echo "✅ npm 설치됨: ${NPM_VERSION}"
else
    echo "❌ npm이 설치되어 있지 않습니다."
    exit 1
fi

# ffmpeg 설치 (라즈베리파이/Debian 기반)
echo ""
echo "📦 ffmpeg 설치 확인 중..."
if command -v ffmpeg > /dev/null 2>&1; then
    FFMPEG_VERSION=$(ffmpeg -version | head -n 1)
    echo "✅ ffmpeg 이미 설치됨: ${FFMPEG_VERSION}"
else
    echo "⚠️ ffmpeg가 설치되어 있지 않습니다."
    echo "   ffmpeg 설치 시작..."

    if command -v apt-get > /dev/null 2>&1; then
        echo "   sudo 권한이 필요합니다..."
        sudo apt-get update
        sudo apt-get install -y ffmpeg
        echo "✅ ffmpeg 설치 완료"
    else
        echo "❌ apt-get을 찾을 수 없습니다. ffmpeg를 수동으로 설치해주세요."
    fi
fi

# package.json 파일 확인
echo ""
echo "📦 package.json 확인 중..."
if [ ! -f "${INSTALL_DIR}/package.json" ]; then
    echo "⚠️ package.json을 찾을 수 없습니다. 생성 중..."

    cat > "${INSTALL_DIR}/package.json" << 'EOF'
{
  "name": "teslausb-uploader",
  "version": "1.0.0",
  "description": "Tesla USB 영상을 Discord로 업로드하는 프로그램",
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

    echo "✅ package.json 생성 완료"
fi

# Node.js 모듈 설치
echo ""
echo "📦 Node.js 모듈 설치 중..."
cd "${INSTALL_DIR}"
npm install

if [ $? -eq 0 ]; then
    echo "✅ Node.js 모듈 설치 완료"
else
    echo "❌ Node.js 모듈 설치 실패"
    exit 1
fi

# main.js 파일 확인
echo ""
if [ -f "${INSTALL_DIR}/main.js" ]; then
    echo "✅ main.js 파일 확인됨"
else
    echo "⚠️ main.js 파일을 찾을 수 없습니다."
fi

# systemd 서비스 등록
echo ""
echo "🔧 systemd 서비스 설정 중..."

SERVICE_FILE="${INSTALL_DIR}/teslausb-uploader.service"

# node 경로 가져오기
NODE_PATH=$(which node)
echo "   Node.js 경로: ${NODE_PATH}"

if [ ! -f "$SERVICE_FILE" ]; then
    echo "⚠️ 서비스 파일을 찾을 수 없습니다. 생성 중..."
fi

# 올바른 node 경로를 위해 항상 서비스 파일 재생성
cat > "$SERVICE_FILE" << EOF
[Unit]
Description=Tesla USB Uploader 서비스
After=network.target

[Service]
Type=simple
User=${USER}
WorkingDirectory=${INSTALL_DIR}
ExecStart=${NODE_PATH} ${INSTALL_DIR}/main.js
Restart=no
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

echo "✅ 서비스 파일 생성 완료: ${SERVICE_FILE}"

echo ""
echo "📋 지금 systemd 서비스를 등록하시겠습니까? (y/n)"
read -r REGISTER_SERVICE

if [ "$REGISTER_SERVICE" = "y" ] || [ "$REGISTER_SERVICE" = "Y" ]; then
    echo "   서비스 등록 중 (sudo 권한 필요)..."
    sudo cp "$SERVICE_FILE" /etc/systemd/system/
    sudo systemctl daemon-reload
    sudo systemctl stop teslausb-uploader
    sudo systemctl enable teslausb-uploader
    sudo systemctl start teslausb-uploader

    echo "✅ 서비스 등록 및 활성화 완료"
    echo ""
    echo "   서비스 시작: sudo systemctl start teslausb-uploader"
    echo "   상태 확인: sudo systemctl status teslausb-uploader"
else
    echo "⏭️ 서비스 등록 건너뜀"
fi


# 설치 완료
echo ""
echo "======================================"
echo "✅ 설치가 성공적으로 완료되었습니다!"
echo "======================================"
echo ""
echo "설정 정보:"
echo "  - WiFi SSID: ${WIFI_SSID}"
echo "  - 웹훅 URL: ${DISCORD_WEBHOOK_URL}"
echo "  - 설치 경로: ${INSTALL_DIR}"
echo ""
echo "실행 방법:"
echo "  cd ${INSTALL_DIR}"
echo "  node main.js"
echo ""
echo "systemd 서비스로 등록하려면:"
echo "  sudo cp teslausb-uploader.service /etc/systemd/system/"
echo "  sudo systemctl enable teslausb-uploader"
echo "  sudo systemctl start teslausb-uploader"
echo ""
