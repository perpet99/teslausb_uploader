const chokidar = require('chokidar');
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

// 설정
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL
const WATCH_FOLDER = process.env.WATCH_FOLDER || '/mutable/TeslaCam/SavedClips';
const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB (Discord limit)

// 디스코드로 파일 전송
async function sendToDiscord(text = '',filePath = null) {
    let fileName = 'none'

  try {

    const form = new FormData();
    
    if( filePath != null ) {
        // 심볼릭 링크인 경우 실제 파일 경로 확인
        const realPath = fs.realpathSync(filePath);
        const stats = fs.statSync(realPath);
        fileName = path.basename(filePath);
        
        console.log(`Processing: ${fileName} (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);

        // if (stats.size > MAX_FILE_SIZE) {
        // console.warn(`File ${fileName} exceeds Discord's 25MB limit. Sending notification only.`);
        // await axios.post(DISCORD_WEBHOOK_URL, {
        //     content: `⚠️ New clip recorded but too large to upload: **${fileName}** (${(stats.size / 1024 / 1024).toFixed(2)} MB)`
        // });
        // return;
        // }
        form.append('file', fs.createReadStream(realPath), fileName);  
    }
    
    if( text == '') {
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

// 파일 감시 시작
console.log(`🔍 Watching folder: ${WATCH_FOLDER}`);
console.log(`📡 Discord webhook configured: ${DISCORD_WEBHOOK_URL ? 'Yes' : 'No'}`);



const watcher = chokidar.watch(`${WATCH_FOLDER}/**/*.mp4`, {
  persistent: true,
  ignoreInitial: true, // 시작 시 기존 파일 무시
  followSymlinks: true, // 심볼릭 링크 따라가기
  awaitWriteFinish: {
    stabilityThreshold: 2000, // 파일 쓰기가 완료될 때까지 대기
    pollInterval: 100
  }
});

// 1분마다 현재 시간 출력
// 초기 실행

function archiveClips() {
     const now = new Date();
console.log(`⏰ Current time: ${now.toLocaleString()}`);
exec('/root/bin/archive-clips.sh', (error, stdout, stderr) => {
    if (error) {
        console.error(`Error executing archive-clips.sh: ${error.message}`);
        return;
    }
    if (stderr) {
        console.error(`stderr: ${stderr}`);
    }
    if (stdout) {
        console.log(`stdout: ${stdout}`);
    }
});
}

archiveClips();

// 60초마다 반복 실행
setInterval(() => {
    archiveClips();
}, 60000);

// 10초 대기
console.log('⏳ Waiting 10 seconds before starting to watch for new clips...');
await new Promise(resolve => setTimeout(resolve, 10000));

console.log('done waiting. Starting watcher now.');

watcher
  .on('add', filePath => {
    console.log(`\n📹 New file detected: ${path.basename(filePath)}`);
    // 기존 타이머가 있으면 취소
    if (global.uploadTimer) {
      clearTimeout(global.uploadTimer);
    }
    
    // 마지막 파일 경로 저장
    global.lastFilePath = filePath;
    global.lastFilePathList = global.lastFilePathList || [];
    global.lastFilePathList.push(filePath);
    // 10초 후 마지막 파일만 전송
    global.uploadTimer = setTimeout( async () => {

        // 마지막 4개 파일만 선택
        const filesToUpload = global.lastFilePathList.slice(-4);
        // global.lastFilePathList = [];

        // 선택된 파일들 전송
        for (const file of filesToUpload) {
            console.log(`⏰ Uploading: ${path.basename(file)}`);
            await sendToDiscord('', file);
        }

    //   console.log(`⏰ 10 seconds elapsed. Uploading last file: ${path.basename(global.lastFilePath)}`);
    //   sendToDiscord('', global.lastFilePath);
    //   global.uploadTimer = null;
    //   global.lastFilePath = null;
    }, 10000);
    
    return; // sendToDiscord 호출 방지
    sendToDiscord('', filePath);
  })
  .on('error', error => {
    console.error('Watcher error:', error);
  })
  .on('ready', async() => {
    console.log('✅ Ready for new clips!\n');
    await sendToDiscord('🚀 Tesla USB Uploader started and monitoring for new clips.');
  });

// 프로세스 종료 시 정리
process.on('SIGINT', () => {
  console.log('\n👋 Shutting down...');
  watcher.close();
  process.exit(0);
});
