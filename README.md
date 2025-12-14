# teslausb_uploader

Automatically upload Tesla dashcam videos to Discord when connected to a specific WiFi network.

## Features

- 📶 WiFi-based automatic upload (only uploads when connected to specified WiFi)
- 📹 Monitors Tesla dashcam folders (SavedClips and SentryClips)
- 📦 Automatic file splitting for large videos (splits files over 10MB into chunks)
- 🔄 Prevents duplicate uploads by tracking last sent date
- 📸 Creates snapshots every minute
- ⏱️ Runs checks every 60 seconds

## Requirements

- Node.js (v14 or higher)
- npm
- ffmpeg (for video processing)
- Raspberry Pi or Linux system with WiFi capability

## Installation

1. Clone or download this repository
2. Make the installation script executable and run it:

```bash
chmod +x install.sh
./install.sh
```

3. The script will prompt you to enter:
   - WiFi SSID (the network name to monitor)
   - Discord webhook URL (get this from your Discord server settings)

4. The installation script will automatically:
   - Create `.env` file with your settings
   - Check for Node.js and npm
   - Install ffmpeg if not present
   - Create `package.json` if needed
   - Install required Node.js modules (axios, form-data, dotenv)

## Running the Uploader

### Manual Start

```bash
cd /path/to/teslausb_uploader
node main.js
```

### Run as systemd Service (Recommended)

1. Create a systemd service file:

```bash
sudo nano /etc/systemd/system/teslausb-uploader.service
```

2. Add the following content (adjust paths as needed):

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

3. Enable and start the service:

```bash
sudo systemctl enable teslausb-uploader
sudo systemctl start teslausb-uploader
sudo systemctl status teslausb-uploader

sudo journalctl -u teslausb-uploader -f
sudo journalctl -u teslausb-uploader -n 100

```

## Configuration

Settings are stored in `.env` file:

```env
WIFI_SSID=your_wifi_name
DISCORD_WEBHOOK_URL=your_discord_webhook_url
```

## How It Works

1. Every 60 seconds, the program checks if you're connected to the specified WiFi
2. If connected, it runs `/root/bin/make_snapshot.sh` to create a snapshot
3. Scans the TeslaCam folders for new video files
4. Compares file modification times with the last upload time
5. Uploads up to 4 newest files to Discord
6. Files larger than 10MB are automatically split into chunks
7. Updates the last sent timestamp

## Troubleshooting

**Check service logs:**
```bash
sudo journalctl -u teslausb-uploader -f
```

**Check if running:**
```bash
ps aux | grep node
```

**Manual test:**
```bash
node main.js
```

## License

MIT