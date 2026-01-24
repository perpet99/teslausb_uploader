# teslausb_uploader

[English](README.md) | **한국어**

특정 WiFi 네트워크에 연결되면 Tesla 블랙박스 영상을 자동으로 Discord에 업로드합니다.

## 주요 기능

- 📶 WiFi 기반 자동 업로드 (지정된 WiFi에 연결됐을 때만 업로드)
- 📹 Tesla 블랙박스 폴더 모니터링 (SavedClips, SentryClips)
- 📦 대용량 영상 자동 분할 (10MB 이상 파일은 청크로 분할)
- 🔄 마지막 전송 날짜 추적으로 중복 업로드 방지
- 📸 1분마다 스냅샷 생성
- ⏱️ 60초마다 확인 실행

## 요구 사항

- Node.js (v14 이상)
- npm
- ffmpeg (영상 처리용)
- Raspberry Pi Zero 2w
- Discord 웹훅 URL
- 웹훅 URL 발급 방법: [Discord 공식 가이드](https://support.discord.com/hc/ko/articles/228383668)

## 설치 방법

0. Raspberry Pi Zero 2w에 teslausb 설치: https://github.com/marcone/teslausb/releases/download/v5.2/teslausb-20250203.zip
> **참고:** 반드시 최신 버전의 teslausb를 설치해야 합니다 (ffmpeg 5.x 이상 필요).
- 설치 가이드 영상: [Tesla USB 설정 튜토리얼](https://www.youtube.com/watch?v=ETs6r1vKTO8)

1. teslausb_setup_variables.conf에서 `export INCREASE_ROOT_SIZE=2G` 설정
2. teslausb_setup_variables.conf에서 `export SNAPSHOT_INTERVAL=60` 설정
3. teslausb 연결
4. 설치 스크립트 실행:

```bash
sudo -i
bin/remountfs_rw
sudo apt update
sudo apt install git -y
git clone https://github.com/perpet99/teslausb_uploader.git
cd teslausb_uploader
chmod +x install_kor.sh
./install_kor.sh
```

4. 스크립트가 다음 정보를 입력하라고 요청합니다:
   - WiFi SSID (모니터링할 네트워크 이름)
   - Discord 웹훅 URL (Discord 서버 설정에서 발급)

5. 설치 스크립트가 자동으로 수행하는 작업:
   - 설정이 담긴 `.env` 파일 생성
   - Node.js와 npm 확인
   - ffmpeg가 없으면 설치
   - 필요시 `package.json` 생성
   - 필요한 Node.js 모듈 설치 (axios, form-data, dotenv)

## 업로더 실행

### 수동 실행

```bash
cd /path/to/teslausb_uploader
node main.js
```

### systemd 서비스로 실행 (권장)

1. systemd 서비스 파일 생성:

```bash
sudo nano /etc/systemd/system/teslausb-uploader.service
```

2. 다음 내용 추가 (경로는 필요에 따라 수정):

```ini
[Unit]
Description=Tesla USB Discord Uploader
After=network.target

[Service]
Type=simple
User=pi
WorkingDirectory=/home/pi/teslausb_uploader
ExecStart=/usr/bin/node main.js
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

3. 서비스 활성화 및 시작:

```bash
sudo systemctl enable teslausb-uploader
sudo systemctl start teslausb-uploader
sudo systemctl status teslausb-uploader

# 로그 실시간 확인
sudo journalctl -u teslausb-uploader -f

# 최근 로그 10줄 확인
sudo journalctl -u teslausb-uploader -n 10
```

## 설정

설정은 `.env` 파일에 저장됩니다:

```env
WIFI_SSID=your_wifi_name
DISCORD_WEBHOOK_URL=your_discord_webhook_url
```

## 작동 방식

1. 60초마다 지정된 WiFi에 연결되어 있는지 확인
2. 연결되면 `/root/bin/make_snapshot.sh`를 실행하여 스냅샷 생성
3. TeslaCam 폴더에서 새 영상 파일 스캔
4. 파일 수정 시간과 마지막 업로드 시간 비교
5. 최신 파일 최대 4개를 Discord에 업로드
6. 10MB 이상 파일은 자동으로 청크로 분할
7. 마지막 전송 타임스탬프 업데이트

## 문제 해결

**서비스 로그 확인:**
```bash
sudo journalctl -u teslausb-uploader -f
```

**실행 중인지 확인:**
```bash
ps aux | grep node
```

**수동 테스트:**
```bash
node main.js
```

## 라이선스

MIT
