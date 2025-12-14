import axios from 'axios';
import FormData from 'form-data';
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execPromise = promisify(exec);

// 설정
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
const WATCH_FOLDERS = ['/mutable/TeslaCam/SavedClips', '/mutable/TeslaCam/SentryClips'];
const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB (Discord limit)

// 마지막 전송 날짜 저장
let lastSentDate = null;

// 디스코드로 파일 전송
async function sendToDiscord(text = '', filePath = null) {
  let fileName = 'none';

  try {
    const form = new FormData();
    
    if (filePath != null) {
      const realPath = fs.realpathSync(filePath);
      const stats = fs.statSync(realPath);
      fileName = path.basename(filePath);
      
      console.log(`Processing: ${fileName} (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);

      form.append('file', fs.createReadStream(realPath), fileName);  
    }
    
    if (text == '') {
      form.append('content', `🚗 Tesla clip: **${fileName}**`);
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
  }
}

// 날짜를 YYYY-MM-DD 형식으로 변환
function getDateString(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// 파일 목록 가져오기 및 필터링
async function getFilesToUpload() {
  const files = [];
  const today = getDateString(new Date());

  for (const folder of WATCH_FOLDERS) {
    try {
      if (!fs.existsSync(folder)) {
        console.log(`⚠️ Folder does not exist: ${folder}`);
        continue;
      }

      const items = fs.readdirSync(folder);
      
      for (const item of items) {
        const fullPath = path.join(folder, item);
        
        // .mp4 파일만 처리
        if (path.extname(item).toLowerCase() === '.mp4') {
          try {
            const stats = fs.statSync(fullPath);
            const fileDate = getDateString(stats.mtime);
            
            // 오늘 날짜가 아니고, 마지막 전송 날짜도 아닌 파일만 추가
            if (fileDate !== today && fileDate !== lastSentDate) {
              files.push({
                path: fullPath,
                date: fileDate,
                mtime: stats.mtime
              });
            }
          } catch (err) {
            console.error(`Error reading file stats: ${fullPath}`, err.message);
          }
        }
      }
    } catch (err) {
      console.error(`Error reading folder: ${folder}`, err.message);
    }
  }

  // 수정 시간 기준으로 정렬 (최신순)
  files.sort((a, b) => b.mtime - a.mtime);

  // 최대 4개만 반환
  return files.slice(0, 4);
}

// 스냅샷 생성 및 파일 전송
async function processFiles() {
  const now = new Date();
  console.log(`\n⏰ Running at: ${now.toLocaleString()}`);

  // 1. make_snapshot.sh 실행
  try {
    console.log('📸 Executing make_snapshot.sh...');
    const { stdout, stderr } = await execPromise('/root/bin/make_snapshot.sh');
    if (stdout) console.log(`stdout: ${stdout.trim()}`);
    if (stderr) console.error(`stderr: ${stderr.trim()}`);
    console.log('✅ make_snapshot.sh completed');
  } catch (error) {
    console.error(`❌ Error executing make_snapshot.sh: ${error.message}`);
  }

  // 2. 파일 목록 가져오기
  const filesToUpload = await getFilesToUpload();
  
  if (filesToUpload.length === 0) {
    console.log('📭 No files to upload');
    return;
  }

  console.log(`📤 Found ${filesToUpload.length} file(s) to upload`);

  // 3. 파일 전송
  for (const file of filesToUpload) {
    await sendToDiscord('', file.path);
  }

  // 4. 마지막 전송 날짜 업데이트 (가장 최신 파일의 날짜)
  if (filesToUpload.length > 0) {
    lastSentDate = filesToUpload[0].date;
    console.log(`📅 Last sent date updated to: ${lastSentDate}`);
  }
}

// 시작
console.log('🚀 Tesla USB Uploader started');
console.log(`📡 Discord webhook configured: ${DISCORD_WEBHOOK_URL ? 'Yes' : 'No'}`);
console.log(`📁 Watching folders: ${WATCH_FOLDERS.join(', ')}`);
console.log('⏱️  Running every 1 minute\n');

// 초기 실행
processFiles();

// 1분마다 실행
setInterval(processFiles, 60000);

// 프로세스 종료 처리
process.on('SIGINT', () => {
  console.log('\n👋 Shutting down...');
  process.exit(0);
});
