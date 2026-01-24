# teslausb_uploader

**English** | [한국어](README_KOR.md)

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
- Raspberry Pi Zero 2w
- Discord Webhook URL 
- For instructions on obtaining a Webhook URL, see: [Discord Official Guide](https://support.discord.com/hc/en-us/articles/228383668)

## Installation


0. install teslausb on raspberry Pi Zero 2w  https://github.com/marcone/teslausb/releases/download/v5.2/teslausb-20250203.zip
> **Note:** You must install the latest version of teslausb (requires ffmpeg 5.x or higher).
- Watch installation guide: [Tesla USB Setup Tutorial](https://www.youtube.com/watch?v=ETs6r1vKTO8)
1. set "export INCREASE_ROOT_SIZE=2G" in teslausb_setup_variables.conf
2. set "export SNAPSHOT_INTERVAL=60" in teslausb_setup_variables.conf
3. connect teslausb
4. Make the installation script executable and run it:

```bash
sudo -i
bin/remountfs_rw
sudo apt update
sudo apt install git -y
git clone https://github.com/perpet99/teslausb_uploader.git
cd teslausb_uploader
chmod +x install.sh
./install.sh
```

4. The script will prompt you to enter:
   - WiFi SSID (the network name to monitor)
   - Discord webhook URL (get this from your Discord server settings)

5. The installation script will automatically:
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
sudo journalctl -u teslausb-uploader -n 10

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