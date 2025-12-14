import axios from 'axios';
import FormData from 'form-data';
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// 설정
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
const WATCH_FOLDERS = [
  '/mutable/TeslaCam/SavedClips',
  '/mutable/TeslaCam/SentryClips'
];
const LAST_SENT_DATE_FILE = '/tmp/last_sent_date.txt';

// 마지막 전송 날짜 읽기
function getLastSentDate() {
  try {
    if (fs.existsSync(LAST_SENT_DATE_FILE)) {
      const dateStr = fs.readFileSync(LAST_SENT_DATE_FILE, 'utf8').trim();
      return new Date(dateStr);
    }
  } catch (error) {
    console.error('Error reading last sent date:', error.message);
  }
  return new Date(0); // 파일이 없으면 1970-01-01 반환
}

// 마지막 전송 날짜 저장
function saveLastSentDate(date) {
  try {
    fs.writeFileSync(LAST_SENT_DATE_FILE, date.toISOString(), 'utf8');
  } catch (error) {
    console.error('Error saving last sent date:', error.message);
  }
}

// 디스코드로 파일 전송
async function sendToDiscord(text = '', filePath = null) {
  let fileName = 'none';

  try {
    const form = new FormData();
    
    if (filePath != null) {
      // 심볼릭 링크인 경우 실제 파일 경로 확인
      const realPath = fs.realpathSync(filePath);
      const stats = fs.statSync(realPath);
      fileName = path.basename(filePath);
      
      console.log(`Processing: ${fileName} (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);
      
      form.append('file', fs.createReadStream(realPath), fileName);  
    }
    
    if (text === '') {
      form.append('content', `🚗 New Tesla clip: **${fileName}**`);
    } else {
      form.append('content', text);
    }

    await axios.post(DISCORD_WEBHOOK_URL, form, {
      headers: form.getHeaders(),
      maxContentLength: Infinity,
      maxBodyLength: Infinity
    });

    console.log(`✅ Successfully uploaded: ${fileName}`);
  } catch (error) {
    console.error(`❌ Error uploading ${fileName}:`, error.message);
    
    // 에러 발생 시 알림만 전송
    try {
      await axios.post(DISCORD_WEBHOOK_URL, {
        content: `❌ Failed to upload: **${fileName}**\nError: ${error.message}`
      });
    } catch (notifyError) {
      console.error('Failed to send error notification:', notifyError.message);
    }
  }
}

// 폴더에서 MP4 파일 목록 가져오기
function getMP4Files(folderPath) {
  const files = [];
  
  try {
    if (!fs.existsSync(folderPath)) {
      console.warn(`Folder does not exist: ${folderPath}`);
      return files;
    }

    const entries = fs.readdirSync(folderPath, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(folderPath, entry.name);
      
      if (entry.isDirectory()) {
        // 하위 폴더 재귀 탐색
        files.push(...getMP4Files(fullPath));
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.mp4')) {
        try {
          const realPath = fs.realpathSync(fullPath);
          const stats = fs.statSync(realPath);
          files.push({
            path: fullPath,
            mtime: stats.mtime
          });
        } catch (error) {
          console.error(`Error processing file ${fullPath}:`, error.message);
        }
      }
    }
  } catch (error) {
    console.error(`Error reading folder ${folderPath}:`, error.message);
  }
  
  return files;
}

// 스냅샷 생성 및 파일 전송
async function processClips() {
  const now = new Date();
  console.log(`\n⏰ Processing clips at: ${now.toLocaleString()}`);
  
  try {
    // 1. make_snapshot.sh 실행
    console.log('📸 Executing make_snapshot.sh...');
    const { stdout, stderr } = await execAsync('/root/bin/make_snapshot.sh');
    if (stdout) console.log(`stdout: ${stdout}`);
    if (stderr) console.error(`stderr: ${stderr}`);
    console.log('✅ make_snapshot.sh executed successfully');
  } catch (error) {
    console.error(`❌ Error executing make_snapshot.sh: ${error.message}`);
  }
  
  // 2. 마지막 전송 날짜 읽기
  const lastSentDate = getLastSentDate();
  console.log(`📅 Last sent date: ${lastSentDate.toLocaleString()}`);
  
  // 3. 두 폴더에서 모든 MP4 파일 수집
  const allFiles = [];
  for (const folder of WATCH_FOLDERS) {
    console.log(`📂 Scanning folder: ${folder}`);
    const files = getMP4Files(folder);
    allFiles.push(...files);
    console.log(`   Found ${files.length} files`);
  }
  
  // 4. 마지막 전송 날짜보다 최신 파일만 필터링
  const newFiles = allFiles.filter(file => file.mtime > lastSentDate);
  console.log(`🆕 Found ${newFiles.length} new files since last sent date`);
  
  if (newFiles.length === 0) {
    console.log('   No new files to upload');
    return;
  }
  
  // 5. 수정 시간 기준으로 정렬 (최신 순)
  newFiles.sort((a, b) => b.mtime - a.mtime);
  
  // 6. 최신 4개 파일만 선택
  const filesToUpload = newFiles.slice(0, 4);
  console.log(`📤 Uploading ${filesToUpload.length} files (max 4)`);
  
  // 7. 디스코드로 전송
  for (const file of filesToUpload) {
    console.log(`   Uploading: ${path.basename(file.path)} (${file.mtime.toLocaleString()})`);
    await sendToDiscord('', file.path);
  }
  
  // 8. 마지막 전송 날짜 업데이트
  const latestFileDate = filesToUpload[0].mtime;
  saveLastSentDate(latestFileDate);
  console.log(`✅ Updated last sent date to: ${latestFileDate.toLocaleString()}`);
}

// 시작
console.log('🚀 Tesla USB Uploader (main2) started');
console.log(`📡 Discord webhook configured: ${DISCORD_WEBHOOK_URL ? 'Yes' : 'No'}`);
console.log(`📂 Watching folders: ${WATCH_FOLDERS.join(', ')}`);
console.log('⏱️  Processing every 60 seconds\n');

// 초기 실행
processClips();

// 60초마다 반복 실행
setInterval(() => {
  processClips();
}, 60000);

// 프로세스 종료 시 정리
process.on('SIGINT', () => {
  console.log('\n👋 Shutting down...');
  process.exit(0);
});
