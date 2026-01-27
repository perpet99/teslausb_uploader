import { execSync, exec ,spawn} from 'child_process';
import axios from 'axios';
import FormData from 'form-data';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

// .env 파일 로드
dotenv.config();

// 설정
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL || 'none';
const TARGET_WIFI_SSID = process.env.WIFI_SSID || 'none';
const WATCH_FOLDERS = [
  '/mutable/TeslaCam/SavedClips',
  '/mutable/TeslaCam/SentryClips'
];
const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB (Discord limit)
const CHUNK_SIZE = 5 * 1024 * 1024; // 10MB - 분할 크기
const MAX_FILES_PER_RUN = 4;
const CHECK_INTERVAL = 60 * 1000; // 1분 (밀리초)
const LAST_SENT_FILE = '/mutable/discord_uploader_last_sent.txt';
const TEMP_SPLIT_DIR = '/mutable/video_split_chunks'; // 임시 분할 파일 저장 폴더
const LOG_FILE = '/mutable/teslausb_uploader.log'; // 로그 파일 경로
const MAX_LOG_SIZE = 1 * 1024 * 1024; // 최대 로그 파일 크기 (1MB)
let lastSentDate = null;
let oldWifiConnected = false;

// 로그 함수 - 콘솔과 파일에 동시에 기록
function log(message) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}`;

  // 콘솔 출력
  console.log(message);

  // 파일에 기록
  try {
    // 로그 파일 크기 확인 및 로테이션
    if (fs.existsSync(LOG_FILE)) {
      const stats = fs.statSync(LOG_FILE);
      if (stats.size > MAX_LOG_SIZE) {
        // 기존 로그 백업
        const backupFile = LOG_FILE + '.old';
        if (fs.existsSync(backupFile)) {
          fs.unlinkSync(backupFile);
        }
        fs.renameSync(LOG_FILE, backupFile);
      }
    }
    fs.appendFileSync(LOG_FILE, logMessage + '\n', 'utf8');
  } catch (error) {
    console.error('로그 파일 기록 실패:', error.message);
  }
}

// 에러 로그 함수
function logError(message) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ❌ ERROR: ${message}`;

  console.error(message);

  try {
    fs.appendFileSync(LOG_FILE, logMessage + '\n', 'utf8');
  } catch (error) {
    console.error('로그 파일 기록 실패:', error.message);
  }
}

// 마지막 전송 날짜 로드
function getLastSentDate() {
  try {
    if (fs.existsSync(LAST_SENT_FILE)) {
      const content = fs.readFileSync(LAST_SENT_FILE, 'utf8').trim();
      return content ? new Date(content) : new Date(0);
    }
  } catch (error) {
    logError('Failed to read last sent date: ' + error.message);
  }
  return new Date(0); // 파일이 없으면 epoch 시작
}

// 마지막 전송 날짜 저장
function saveLastSentDate(date) {
  try {
    fs.writeFileSync(LAST_SENT_FILE, date.toISOString(), 'utf8');
  } catch (error) {
    logError('Failed to save last sent date: ' + error.message);
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
    log(`✅ Connected to target Wi-Fi: ${currentSSID}`);
  } else {
    log(`❌ Not connected to target Wi-Fi. Current: ${currentSSID || 'None'}`);
  }
  return connected;
}

// 스냅샷 생성
function makeSnapshot() {
  return new Promise((resolve, reject) => {
    log('📸 Creating snapshot...');
    exec('/root/bin/make_snapshot.sh', (error, stdout, stderr) => {
      if (error) {
        logError('Snapshot error: ' + error.message);
        reject(error);
        return;
      }
      if (stderr) {
        log('Snapshot stderr: ' + stderr);
      }
      log('✅ Snapshot created');
      resolve(stdout);
    });
  });
}


// 디스코드로 파일 전송
async function sendToDiscord(text = '', filePath = null) {
  let fileName = 'none';

  try {
    const form = new FormData();

    if (filePath != null) {
      const realPath = fs.realpathSync(filePath);
      const stats = fs.statSync(realPath);
      fileName = path.basename(filePath);

      log(`Processing: ${fileName} (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);

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

    log(`✅ Successfully uploaded: ${fileName}`);
  } catch (error) {
    logError(`Error uploading ${fileName}: ${error.message}`);
  }
}

function nameToDate(fileName) {
  // 예: TeslaCam_2023-10-01_12-30-45-front.mp4
  const regex = /(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})/;
  const match = fileName.match(regex);  
  if (match) {
    const [_, year, month, day, hour, minute, second] = match;
    return new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}Z`);
  } 
  return new Date(0); // 기본값
}

// 폴더별 최신 파일 4개씩 수집
function getAllMp4FilesByFolder(rootPath,folderMap) {
  // const folderMap = new Map();
  
  if (!fs.existsSync(rootPath)) {
    log(`⚠️ Root path does not exist: ${rootPath}`);
    return folderMap;
  }

  function scanDir(folderKey, dir) {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        
        if (entry.isDirectory()) {
          scanDir(entry.name, fullPath);
        } else if (entry.name.endsWith('.mp4')) {
          try {

            
            const realPath = fs.realpathSync(fullPath);
            const stats = fs.statSync(realPath);
            const fildDate = nameToDate(entry.name);
            if( lastSentDate != null && fildDate <= lastSentDate ) {
              // console.log(`Skipping old file: ${fullPath}`);
              continue;
            }

            // const folderKey = dir;
            
            if (!folderMap.has(folderKey)) {
              folderMap.set(folderKey, []);
            }
            
            folderMap.get(folderKey).push({
              path: fullPath,
              realPath: realPath,
              name: entry.name,
              size: stats.size,
              mtime: fildDate,
              folder: path.basename(dir)
            });
          } catch (err) {
            log(`Skipping ${fullPath}: ${err.message}`);
          }
        }
      }
    } catch (err) {
      log(`Cannot read directory ${dir}: ${err.message}`);
    }
  }

  scanDir('root', rootPath);
  
  // 각 폴더별로 최신 4개만 유지
  for (const [folder, files] of folderMap.entries()) {
    files.sort((a, b) => b.mtime - a.mtime ); // 최신순 정렬
    folderMap.set(folder, files.slice(0, 4));
  }
  
  return folderMap;
}

// 폴더에서 모든 mp4 파일 재귀적으로 수집
function getAllMp4Files(folderPath) {
  const files = [];
  
  if (!fs.existsSync(folderPath)) {
    log(`⚠️ Folder does not exist: ${folderPath}`);
    return files;
  }

  function scanDir(pathKey,dir) {
    // console.log(`Scanning directory: ${dir}`);

    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        // console.log(`Processing entry: ${entry.name}`);

        const fullPath = path.join(dir, entry.name);
        
        if (entry.isDirectory()) {
          scanDir(entry.name,fullPath);
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
            log(`Skipping ${fullPath}: ${err.message}`);
          }
        }else{
          log(`Skipping non-mp4 file: ${fullPath}`);
        }
      }
    } catch (err) {
      log(`Cannot read directory ${dir}: ${err.message}`);
    }
  }

  scanDir('root',folderPath);
  return files;
}


// 디스코드로 메시지 전송
async function sendMessageToDiscord(message) {
    try {
        await axios.post(DISCORD_WEBHOOK_URL, {
            content: message
        });
        log(`✅ Message sent to Discord: ${message}`);
        return true;
    } catch (error) {
        logError(`Error sending message to Discord: ${error.message}`);
        return false;
    }
}


function runFFmpeg(args) {
  return new Promise((resolve, reject) => {
    const ff = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });

    ff.stdout.on('data', d => process.stdout.write(d.toString()));
    ff.stderr.on('data', d => process.stderr.write(d.toString())); // ffmpeg progress logs
    ff.on('close', code => (code === 0 ? resolve() : reject(new Error(`FFmpeg exited ${code}`))));
  });
}


async function runFFmepgByTime(fileName, start, duration,outputFileName) {

  // ffmpeg -ss 90 -i input.mp4 -t 30 -c copy output_last30.mp4

  const args = [
    '-y',
    '-ss', start,
    '-i', fileName,
    '-t', duration,
    '-c', 'copy',
    outputFileName,
  ];

  try {
    await runFFmpeg(args);
  } catch (error) {
    logError('FFmpeg error: ' + error.message);
    throw error;
  }

}

async function runGrid2x2(files, outputFileName, folderKey) {
  if (files.length !== 4) {
    // throw new Error(`Expected 4 files, but got ${files.length}`);
    return null
  }

  await sendMessageToDiscord(`🚗 Start merging tesla clip from folder: **${folderKey}**\n ${files[0].path} : ${files[1].path}\n ${files[2].path} : ${files[3].path}`);
  

  const args = [
    '-y',
    '-sseof', '-20',
    '-i', files[0].path,
    '-sseof', '-20',
    '-i', files[1].path,
    '-sseof', '-20',
    '-i', files[2].path,
    '-sseof', '-20',
    '-i', files[3].path,
    '-filter_complex',
    '[0:v]scale=320:240,format=yuv420p[v0];' +
    '[1:v]scale=320:240,format=yuv420p[v1];' +
    '[2:v]scale=320:240,format=yuv420p[v2];' +
    '[3:v]scale=320:240,format=yuv420p[v3];' +
    '[v0][v1]hstack=inputs=2[top];[v2][v3]hstack=inputs=2[bottom];' +
    '[top][bottom]vstack=inputs=2[out]',
    '-map', '[out]',
    '-c:v', 'h264_v4l2m2m',
    '-b:v', '5M',
    '-r', '10',
    outputFileName,
  ];

  // const args = [
  //   '-y',
  //   '-i', files[0].path,
  //   '-i', files[1].path,
  //   '-i', files[2].path,
  //   '-i', files[3].path,
  //   '-filter_complex',
  //   '[0:v]scale=640:480,format=yuv420p[v0];' +
  //   '[1:v]scale=640:480,format=yuv420p[v1];' +
  //   '[2:v]scale=640:480,format=yuv420p[v2];' +
  //   '[3:v]scale=640:480,format=yuv420p[v3];' +
  //   '[v0][v1]hstack=inputs=2[top];[v2][v3]hstack=inputs=2[bottom];' +
  //   '[top][bottom]vstack=inputs=2[out]',
  //   '-map', '[out]',
  //   '-c:v', 'h264_v4l2m2m',
  //   '-crf', '18',
  //   '-preset', 'slow',
  //   '-r', '10',
  //   '-pix_fmt', 'yuv420p',
  //   '-b:v', '5M',
  //   outputFileName,
  // ];

  await runFFmpeg(args);

  return outputFileName;
}

// 4개의 파일을 ffmpeg로 합치기
async function mergeVideos(files) {
  if (files.length !== 4) {
    throw new Error(`Expected 4 files, but got ${files.length}`);
  }

  try {
    log('🎬 Merging 4 videos with ffmpeg...');
    
    // 임시 디렉토리 생성
    if (!fs.existsSync(TEMP_SPLIT_DIR)) {
      fs.mkdirSync(TEMP_SPLIT_DIR, { recursive: true });
    }
    
    // 임시 파일 목록 생성
    const fileListPath = path.join(TEMP_SPLIT_DIR, 'filelist.txt');
    
    // ffmpeg concat 파일 포맷으로 작성
    const fileListContent = files
      .map(file => `file '${file.realPath}'`)
      .join('\n');
    fs.writeFileSync(fileListPath, fileListContent, 'utf8');
    
    // 합쳐진 파일 경로
    const mergedFileName = `merged_${Date.now()}.mp4`;
    const mergedFilePath = path.join(TEMP_SPLIT_DIR, mergedFileName);
    
    // ffmpeg로 합치기
    execSync(
      `ffmpeg -y -f concat -safe 0 -i "${fileListPath}" -c copy "${mergedFilePath}"`,
      { encoding: 'utf8' }
    );
    
    log(`✅ Videos merged successfully: ${mergedFilePath}`);

    // 파일 목록 정리
    fs.unlinkSync(fileListPath);

    return mergedFilePath;

  } catch (error) {
    logError('Error merging videos: ' + error.message);
    throw error;
  }
}

// 메인 처리 함수
async function processFiles() {
  log('\n========================================');
  log(`🔍 Starting check at ${new Date().toLocaleString()}`);

  // Wi-Fi 확인
  if (!isConnectedToTargetWifi()) {
    oldWifiConnected = false;
    log('⏸️ Skipping - not connected to target Wi-Fi');
    return;
  }

  try {

    if( oldWifiConnected === false ) {

      if( await sendMessageToDiscord(`✅ Connected to Wi-Fi: ${TARGET_WIFI_SSID}`) != true ){
        log('❌ Failed to send Wi-Fi connected message');
        return;
      }

      // WiFi 연결 성공 시 로그 파일 전송
      if (fs.existsSync(LOG_FILE)) {
        log('📄 Sending log file to Discord...');
        await sendToDiscord('📋 시스템 로그 파일:', LOG_FILE);
      }

      oldWifiConnected = true;
    }
    // Wi-Fi 연결 알림 전송
    
    // 스냅샷 생성
    // await makeSnapshot();
    // // 5초 대기
    // await new Promise(resolve => setTimeout(resolve, 5000));
    // 마지막 전송 날짜 로드
    // const lastSentDate = getLastSentDate();
    // console.log(`📅 Last sent date: ${lastSentDate.toISOString()}`);
    
    // 모든 폴더에서 파일 수집
    // let allFiles = [];
    const folderMap = new Map();

    for (const folder of WATCH_FOLDERS) {
      getAllMp4FilesByFolder(folder,folderMap);
      // console.log(`📂 Found ${files.length} files in ${folder}`);
      // allFiles = allFiles.concat(files);
    }
    
    // folderMap 정보 출력
    let newLastSentDate = lastSentDate;
    for (const [folderKey, files] of folderMap.entries()) {
      log(`\n📁 Folder: ${folderKey}`);
      log(`   Files count: ${files.length}`);

        const outputFileName = '/mutable/output.mp4';
        
        

        const startTime = Date.now();
        await runGrid2x2 (files, outputFileName,folderKey);
        const endTime = Date.now();
        const duration = ((endTime - startTime) / 1000).toFixed(0);
        const minutes = Math.floor(duration / 60);
        const seconds = (duration % 60).toFixed(0);
        log(`⏱️ Merging completed in ${minutes}min ${seconds}sec`);

        const stats = fs.statSync(outputFileName);
        const fileSizeMB = (stats.size / 1024 / 1024).toFixed(2);
        log(`📊 Output file size: ${fileSizeMB} MB`);

        await sendMessageToDiscord(`🚗 End merging tesla clip from folder: file size: ${fileSizeMB} MB\n⏱️ Merging completed in ${minutes}min ${seconds}sec`);

        await sendToDiscord('🚗 Tesla clip grid video:', outputFileName);


      
      // 순차적으로 실행되도록 for...of + await 사용
      for (let index = 0; index < files.length; index++) {
        const file = files[index];

        if (newLastSentDate == null) {
          newLastSentDate = file.mtime;
        }

        if (file.mtime > newLastSentDate) {
          newLastSentDate = file.mtime;
        }

        // const outputFileName = '/mutable/output.mp4';

        // if (file.name.includes('-front') || file.name.includes('-back')) {

        //   const stats = fs.statSync(file.path);
        //   const fileSizeMB = (stats.size / 1024 / 1024).toFixed(2);
        //   await sendMessageToDiscord(`🚗 Tesla ${file.name} size: ${fileSizeMB} MB`);

        //   await runFFmepgByTime(file.path, '0', '15', outputFileName);
        //   await sendToDiscord(`🚗 Tesla ${file.name} 0~15:`, outputFileName);

        //   await runFFmepgByTime(file.path, '15', '15', outputFileName);
        //   await sendToDiscord(`🚗 Tesla ${file.name} 15~30:`, outputFileName);

        //   await runFFmepgByTime(file.path, '30', '15', outputFileName);
        //   await sendToDiscord(`🚗 Tesla ${file.name} 30~45:`, outputFileName);

        //   await runFFmepgByTime(file.path, '45', '15', outputFileName);
        //   await sendToDiscord(`add timestamp tool : https://teslacamconverter.netlify.app/\n 🚗 Tesla ${file.name} 45~60:`, outputFileName);
        // }

        // console.log(`   ${index + 1}. ${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB, ${file.mtime.toISOString()})`);
      }



      // // 병렬 처리 (주의: 디스코드 업로드 제한에 걸릴 수 있음)
      // files.forEach(async (file, index) => {

      //   if( newLastSentDate == null){
      //     newLastSentDate = file.mtime;
      //   }

      //   if (file.mtime > newLastSentDate) {
      //     newLastSentDate = file.mtime;
      //   }

      //     const outputFileName = '/mutable/output.mp4';

      //     if (file.name.includes('-front') || file.name.includes('-back')) {

      //       const stats = fs.statSync(file.path);
      //       const fileSizeMB = (stats.size / 1024 / 1024).toFixed(2);
      //       await sendMessageToDiscord(`🚗 Tesla ${file.name} size: ${fileSizeMB} MB`);

      //       await runFFmepgByTime(file.path, '0', '15',outputFileName);
      //       await sendToDiscord(`🚗 Tesla ${file.name} 0~15:`, outputFileName);

      //       await runFFmepgByTime(file.path, '15', '15',outputFileName);
      //       await sendToDiscord(`🚗 Tesla ${file.name} 15~30:`, outputFileName);
            
      //       await runFFmepgByTime(file.path, '30', '15',outputFileName);
      //       await sendToDiscord(`🚗 Tesla ${file.name} 30~45:`, outputFileName);
            
      //       await runFFmepgByTime(file.path, '45', '15',outputFileName);
      //       await sendToDiscord(`add timestamp tool : https://teslacamconverter.netlify.app/\n 🚗 Tesla ${file.name} 45~60:`, outputFileName);
      //     }

      //   console.log(`   ${index + 1}. ${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB, ${file.mtime.toISOString()})`);
      // });
    }

    log('\n📊 Folder Map Information: ');
    log(`Total folders: ${folderMap.size}`);

    log(`\n🕒 newLastSentDate: ${newLastSentDate instanceof Date ? newLastSentDate.toISOString() : newLastSentDate}`);

    lastSentDate = newLastSentDate

    // folderMap에서 파일 리스트 추출

    

    return





    log(`📤 Uploading merged grid video: ${outputFileName}`);

    // for (const file of filesToSend) {


    //     if (file.mtime > lastSentDate) {
    //       lastSentDate = file.mtime;
    //     }

    //   const success = await sendToDiscord(file);
    //   if (success) {
    //     uploadedCount++;
    //   }
    //   // Discord rate limit 방지를 위해 잠시 대기
    //   await new Promise(resolve => setTimeout(resolve, 1000));
    // }
    
    // 성공적으로 업로드된 파일이 있으면 마지막 전송 날짜 업데이트
    // if (uploadedCount > 0) {
    //   saveLastSentDate(latestMtime);
    //   console.log(`✅ Uploaded ${uploadedCount} file(s). Updated last sent date to ${latestMtime.toISOString()}`);
    // }
    
  } catch (error) {

    logError('Process error: ' + error.message);
    await sendMessageToDiscord(`Process error : ${error.message}`);
  }
}

// 주기적 실행
log('🚀 Tesla USB Discord Uploader Started');
log(`📡 Discord webhook: ${DISCORD_WEBHOOK_URL ? 'Configured' : 'NOT CONFIGURED'}`);
log(`📶 Target Wi-Fi: ${TARGET_WIFI_SSID}`);
log(`⏱️ Check interval: ${CHECK_INTERVAL / 1000} seconds`);
log(`📂 Watching folders:`);
WATCH_FOLDERS.forEach(folder => log(`   - ${folder}`));
log('========================================\n');

// // 즉시 한 번 실행
// processFiles().catch(err => console.error('Initial run error:', err));

// // 주기적 실행
// const interval = setInterval(() => {
//   processFiles().catch(err => console.error('Periodic run error:', err));
// }, CHECK_INTERVAL);

// 프로세스 종료 시 정리
process.on('SIGINT', () => {
  log('\n👋 Shutting down...');
  clearInterval(interval);
  process.exit(0);
});

process.on('SIGTERM', () => {
  log('\n👋 Shutting down...');
  clearInterval(interval);
  process.exit(0);
});


async function startScheduler() {
  while (true) {
    const start = Date.now();
    await processFiles(); // 업데이트 로직이 끝날 때까지 기다림
    const elapsed = Date.now() - start;

    // 최소 1분 간격 유지
    const wait = Math.max(0, 60 * 1000 - elapsed);
    await new Promise(resolve => setTimeout(resolve, wait));
  }
}

const folderMap = new Map();

for (const folder of WATCH_FOLDERS) {
  getAllMp4FilesByFolder(folder,folderMap);
}


// lastSentDate 초기설정
for (const [folderKey, files] of folderMap.entries()) {
  log(`\n📁 Folder: ${folderKey}`);
  log(`   Files count: ${files.length}`);


  files.forEach(async (file, index) => {
    if( lastSentDate == null){
      lastSentDate = file.mtime
    }

    if (file.mtime > lastSentDate) {
      lastSentDate = file.mtime
    }
  });
}
    

startScheduler();
