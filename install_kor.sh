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

# 와이파이 이름 입력
echo "📶 와이파이 SSID 입력 (예: ehbs):"
read -r WIFI_SSID

if [ -z "$WIFI_SSID" ]; then
    echo "❌ 와이파이 SSID가 입력되지 않았습니다."
    exit 1
fi

# 디스코드 웹훅 URL 입력
echo ""
echo "📡 디스코드 웹훅 URL 입력:"
read -r DISCORD_WEBHOOK_URL

if [ -z "$DISCORD_WEBHOOK_URL" ]; then
    echo "❌ 디스코드 웹훅 URL이 입력되지 않았습니다."
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

echo "✅ .env 파일이 생성되었습니다: ${ENV_FILE}"

# Node.js 버전 확인
echo ""
echo "🔍 Node.js 버전 확인 중..."
if command -v node > /dev/null 2>&1; then
    NODE_VERSION=$(node -v)
    echo "✅ Node.js 설치됨: ${NODE_VERSION}"
else
    echo "❌ Node.js가 설치되어 있지 않습니다."
    echo "   Node.js를 먼저 설치해주세요: https://nodejs.org/"
    exit 1
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
    echo "   ffmpeg 설치를 시작합니다..."
    
    if command -v apt-get > /dev/null 2>&1; then
        echo "   sudo 권한이 필요합니다..."
        sudo apt-get update
        sudo apt-get install -y ffmpeg
        echo "✅ ffmpeg 설치 완료"
    else
        echo "❌ apt-get을 찾을 수 없습니다. 수동으로 ffmpeg를 설치해주세요."
    fi
fi

# package.json 파일 확인
echo ""
echo "📦 package.json 확인 중..."
if [ ! -f "${INSTALL_DIR}/package.json" ]; then
    echo "⚠️ package.json이 없습니다. 생성합니다..."
    
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
    echo "⚠️ main.js 파일이 없습니다."
fi

# 설치 완료
echo ""
echo "======================================"
echo "✅ 설치가 완료되었습니다!"
echo "======================================"
echo ""
echo "설정 정보:"
echo "  - 와이파이 SSID: ${WIFI_SSID}"
echo "  - 웹훅 URL: ${DISCORD_WEBHOOK_URL}"
echo "  - 설치 경로: ${INSTALL_DIR}"
echo ""
echo "실행 방법:"
echo "  cd ${INSTALL_DIR}"
echo "  node main.js"
echo ""
echo "또는 systemd 서비스로 등록하려면:"
echo "  sudo cp teslausb-uploader.service /etc/systemd/system/"
echo "  sudo systemctl enable teslausb-uploader"
echo "  sudo systemctl start teslausb-uploader"
echo ""
