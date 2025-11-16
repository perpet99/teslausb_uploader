import { execSync, exec } from 'child_process';
import axios from 'axios';
import FormData from 'form-data';
import fs from 'fs';
import path from 'path';

const { promises: fsPromises } = fs;

// 설정
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL || 'YOUR_DISCORD_WEBHOOK_URL';
const TARGET_WIFI_SSID = process.env.WIFI_SSID || 'ehbs';
const WATCH_FOLDERS = [
  '/mutable/TeslaCam/SavedClips',
  '/mutable/TeslaCam/SentryClips'
];
const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB (Discord limit)
const CHUNK_SIZE = 10 * 1024 * 1024; // 10MB chunk size
const CHUNK_SIZE_MB = Math.round(CHUNK_SIZE / (1024 * 1024));
const CHUNK_TEMP_DIR = '/tmp/teslausb_chunks';
const MAX_FILES_PER_RUN = 4;
const CHECK_INTERVAL = 60 * 1000; // 1분 (밀리초)
const LAST_SENT_FILE = '/tmp/discord_uploader_last_sent.txt';
let lastSentDate = null
let oldWifiConnected = false;

// 마지막 전송 날짜 로드
function getLastSentDate() {
  try {
    if (fs.existsSync(LAST_SENT_FILE)) {
      const content = fs.readFileSync(LAST_SENT_FILE, 'utf8').trim();
      return content ? new Date(content) : new Date(0);
    }
  } catch (error) {
    console.error('Failed to read last sent date:', error.message);
  }
  return new Date(0); // 파일이 없으면 epoch 시작
}

// 마지막 전송 날짜 저장
function saveLastSentDate(date) {
  try {
    fs.writeFileSync(LAST_SENT_FILE, date.toISOString(), 'utf8');
  } catch (error) {
    console.error('Failed to save last sent date:', error.message);
  }
}

// 현재 연결된 Wi-Fi SSID 확인
function getCurrentWifiSSID() {
  try {
    // iwgetid 명령어로 현재 연결된 SSID 확인
    const output = execSync('iwgetid -r', { encoding: 'utf8' }).trim();
    return output;
  } catch (error) {
    // 연결되지 않았거나 오류 발생
    return null;
  }
}

// 특정 Wi-Fi에 연결되어 있는지 확인
function isConnectedToTargetWifi() {
  const currentSSID = getCurrentWifiSSID();
  const connected = currentSSID === TARGET_WIFI_SSID;
  if (connected) {
    console.log(`✅ Connected to target Wi-Fi: ${currentSSID}`);
  } else {
    console.log(`❌ Not connected to target Wi-Fi. Current: ${currentSSID || 'None'}`);
  }
  return connected;
}

// 스냅샷 생성
function makeSnapshot() {
  return new Promise((resolve, reject) => {
    console.log('📸 Creating snapshot...');
    exec('/root/bin/make_snapshot.sh', (error, stdout, stderr) => {
      if (error) {
        console.error('Snapshot error:', error.message);
        reject(error);
        return;
      }
      if (stderr) {
        console.log('Snapshot stderr:', stderr);
      }
      console.log('✅ Snapshot created');
      resolve(stdout);
    });
  });
}

// 폴더에서 모든 mp4 파일 재귀적으로 수집
function getAllMp4Files(folderPath) {
  const files = [];
  
  if (!fs.existsSync(folderPath)) {
    console.log(`⚠️ Folder does not exist: ${folderPath}`);
    return files;
  }

  function scanDir(dir) {
    // console.log(`Scanning directory: ${dir}`);

    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        // console.log(`Processing entry: ${entry.name}`);

        const fullPath = path.join(dir, entry.name);
        
        if (entry.isDirectory()) {
          scanDir(fullPath);
        } else if (entry.name.endsWith('.mp4')) {
          try {
            // 심볼릭 링크인 경우 실제 경로 확인
            const realPath = fs.realpathSync(fullPath);
            const stats = fs.statSync(realPath);
            
            files.push({
              path: fullPath,
              realPath: realPath,
              name: entry.name,
              size: stats.size,
              mtime: stats.mtime,
              folder: path.basename(path.dirname(dir)) // SavedClips or SentryClips
            });
          } catch (err) {
            console.warn(`Skipping ${fullPath}: ${err.message}`);
          }
        }else{
          console.log(`Skipping non-mp4 file: ${fullPath}`);
        }
      }
    } catch (err) {
      console.warn(`Cannot read directory ${dir}: ${err.message}`);
    }
  }

  scanDir(folderPath);
  return files;
}


// 디스코드로 메시지 전송
async function sendMessageToDiscord(message) {
    try {
        await axios.post(DISCORD_WEBHOOK_URL, {
            content: message
        });
        console.log(`✅ Message sent to Discord: ${message}`);
        return true;
    } catch (error) {
        console.error(`❌ Error sending message to Discord:`, error.message);
        return false;
    }
}

// 대용량 파일을 임시 디렉터리에 10MB씩 분할
async function splitFileIntoChunks(filePath, baseName) {
  const timestamp = Date.now();
  const chunkDir = path.join(CHUNK_TEMP_DIR, `${baseName}_${timestamp}`);
  await fsPromises.mkdir(chunkDir, { recursive: true });

  const chunks = [];
  const handle = await fsPromises.open(filePath, 'r');
  const { size: totalSize } = await handle.stat();
  const buffer = Buffer.alloc(CHUNK_SIZE);
  let offset = 0;
  let index = 1;

  try {
    while (offset < totalSize) {
      const { bytesRead } = await handle.read(buffer, 0, CHUNK_SIZE, offset);
      if (bytesRead === 0) {
        break;
      }

      const chunkName = `${baseName}_part${String(index).padStart(3, '0')}.mp4`;
      const chunkPath = path.join(chunkDir, chunkName);
      await fsPromises.writeFile(chunkPath, Buffer.from(buffer.slice(0, bytesRead)));
      chunks.push({ path: chunkPath, name: chunkName, size: bytesRead });

      offset += bytesRead;
      index += 1;
    }
  } finally {
    await handle.close();
  }

  if (chunks.length === 0) {
    throw new Error('No chunks were created from file.');
  }

  return { dir: chunkDir, chunks };
}

// 임시 분할 파일 정리
async function cleanupChunkDirectory(dirPath) {
  try {
    await fsPromises.rm(dirPath, { recursive: true, force: true });
  } catch (cleanupError) {
    console.warn(`Cleanup warning for ${dirPath}: ${cleanupError.message}`);
  }
}

// 디스코드로 파일 전송
async function sendToDiscord(file) {
  try {
    console.log(`Processing: ${file.name} from ${file.folder} (${(file.size / 1024 / 1024).toFixed(2)} MB)`);

    // 파일이 10MB보다 크면 임시 폴더에 10MB씩 분할하여 전송
    if (file.size > CHUNK_SIZE) {
      const baseName = path.basename(file.name, path.extname(file.name));
      let chunkDir = null;

      try {
        const { dir, chunks } = await splitFileIntoChunks(file.realPath, baseName);
        chunkDir = dir;

        console.log(`📦 Split into ${chunks.length} chunk(s)`);

        for (let i = 0; i < chunks.length; i += 1) {
          const chunk = chunks[i];
          const form = new FormData();
          form.append('file', fs.createReadStream(chunk.path), chunk.name);
          form.append(
            'content',
            `🚗 **${file.folder}**: ${file.name} (Part ${i + 1}/${chunks.length}, ${(chunk.size / 1024 / 1024).toFixed(2)} MB of ${(file.size / 1024 / 1024).toFixed(2)} MB)`
          );

          await axios.post(DISCORD_WEBHOOK_URL, form, {
            headers: form.getHeaders(),
            maxContentLength: Infinity,
            maxBodyLength: Infinity,
            timeout: 30 * 1000
          });

          console.log(`   ✅ Uploaded chunk ${i + 1}/${chunks.length}`);

          if (i < chunks.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        }

        console.log(`✅ Successfully uploaded all chunks for: ${file.name}`);
        return true;
      } finally {
        if (chunkDir) {
          await cleanupChunkDirectory(chunkDir);
        }
      }
    }

    // 10MB 이하면 전체 파일 전송
    const form = new FormData();
    form.append('file', fs.createReadStream(file.realPath), file.name);
    form.append('content', `🚗 **${file.folder}**: ${file.name}`);

    await axios.post(DISCORD_WEBHOOK_URL, form, {
      headers: form.getHeaders(),
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
      timeout: 30 * 1000
    });

    console.log(`✅ Successfully uploaded: ${file.name}`);
    return true;
  } catch (error) {
    console.error(`❌ Error uploading ${file.name}:`, error.message);

    try {
      await axios.post(DISCORD_WEBHOOK_URL, {
        content: `❌ Failed to upload: **${file.name}**\nError: ${error.message}`
      });
    } catch (notifyError) {
      console.error('Failed to send error notification:', notifyError.message);
    }
    return false;
  }
}

// 메인 처리 함수
async function processFiles() {
  console.log('\n========================================');
  console.log(`🔍 Starting check at ${new Date().toLocaleString()}`);
  
  // Wi-Fi 확인
  if (!isConnectedToTargetWifi()) {
    oldWifiConnected = false;
    console.log('⏸️ Skipping - not connected to target Wi-Fi');
    return;
  }

  try {

    if( oldWifiConnected === false ) {
      await sendMessageToDiscord(`✅ Connected to Wi-Fi: ${TARGET_WIFI_SSID}`);
      oldWifiConnected = true;
    }
    // Wi-Fi 연결 알림 전송
    
    // 스냅샷 생성
    await makeSnapshot();
    // 5초 대기
    await new Promise(resolve => setTimeout(resolve, 5000));
    // 마지막 전송 날짜 로드
    // const lastSentDate = getLastSentDate();
    // console.log(`📅 Last sent date: ${lastSentDate.toISOString()}`);
    
    // 모든 폴더에서 파일 수집
    let allFiles = [];
    for (const folder of WATCH_FOLDERS) {
      const files = getAllMp4Files(folder);
      console.log(`📂 Found ${files.length} files in ${folder}`);
      allFiles = allFiles.concat(files);
    }
    
    // 마지막 전송 날짜 이후의 파일만 필터링
    const newFiles = allFiles.filter(file => lastSentDate ? file.mtime > lastSentDate : true);
    console.log(`🆕 ${newFiles.length} new files since last upload`);
    
    if (newFiles.length === 0) {
      console.log('✅ No new files to upload');
      return;
    }
    
    // 수정 시간 기준 최신순 정렬
    newFiles.sort((a, b) => b.mtime - a.mtime);
    
    // 최대 4개만 선택
    const filesToSend = newFiles.slice(0, MAX_FILES_PER_RUN);
    console.log(`📤 Uploading ${filesToSend.length} file(s)...`);
    
    // 파일 전송
    let uploadedCount = 0;
    // let latestMtime = lastSentDate;
    if( lastSentDate == null ) {
      lastSentDate = new Date(0);
        
      for (const file of filesToSend) {
        if (file.mtime > lastSentDate) {
          lastSentDate = file.mtime;
        }
      }

      console.log(`📅 Initial last sent date set to epoch start.`,lastSentDate);
      return;
    }

    for (const file of filesToSend) {


        if (file.mtime > lastSentDate) {
          lastSentDate = file.mtime;
        }

      const success = await sendToDiscord(file);
      if (success) {
        uploadedCount++;
      }
      // Discord rate limit 방지를 위해 잠시 대기
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    // 성공적으로 업로드된 파일이 있으면 마지막 전송 날짜 업데이트
    // if (uploadedCount > 0) {
    //   saveLastSentDate(latestMtime);
    //   console.log(`✅ Uploaded ${uploadedCount} file(s). Updated last sent date to ${latestMtime.toISOString()}`);
    // }
    
  } catch (error) {
    console.error('❌ Process error:', error.message);
  }
}

// 주기적 실행
console.log('🚀 Tesla USB Discord Uploader Started');
console.log(`📡 Discord webhook: ${DISCORD_WEBHOOK_URL ? 'Configured' : 'NOT CONFIGURED'}`);
console.log(`📶 Target Wi-Fi: ${TARGET_WIFI_SSID}`);
console.log(`⏱️ Check interval: ${CHECK_INTERVAL / 1000} seconds`);
console.log(`📂 Watching folders:`);
WATCH_FOLDERS.forEach(folder => console.log(`   - ${folder}`));
console.log('========================================\n');

// 즉시 한 번 실행
processFiles().catch(err => console.error('Initial run error:', err));

// 주기적 실행
const interval = setInterval(() => {
  processFiles().catch(err => console.error('Periodic run error:', err));
}, CHECK_INTERVAL);

// 프로세스 종료 시 정리
process.on('SIGINT', () => {
  console.log('\n👋 Shutting down...');
  clearInterval(interval);
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n👋 Shutting down...');
  clearInterval(interval);
  process.exit(0);
});
