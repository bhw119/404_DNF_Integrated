// Google Drive 관련 코드 - 사용하지 않음 (주석 처리)
/*
const { google } = require('googleapis');
const fs = require('fs');
require('dotenv').config();

// Google Drive 환경변수 확인
const hasGoogleDriveConfig = 
  process.env.GOOGLE_CLIENT_EMAIL && 
  process.env.GOOGLE_DRIVE_PRIVATE_KEY && 
  process.env.GOOGLE_DRIVE_FOLDER_ID;

let auth = null;
let drive = null;

if (hasGoogleDriveConfig) {
  try {
    auth = new google.auth.JWT(
      process.env.GOOGLE_CLIENT_EMAIL,
      null,
      process.env.GOOGLE_DRIVE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      ['https://www.googleapis.com/auth/drive']
    );
    drive = google.drive({ version: 'v3', auth });
    console.log('✅ Google Drive 설정 완료');
  } catch (error) {
    console.warn('⚠️  Google Drive 설정 실패:', error.message);
    console.warn('   Google Drive 기능을 사용할 수 없습니다.');
  }
} else {
  console.warn('⚠️  Google Drive 환경변수가 설정되지 않았습니다.');
  console.warn('   GOOGLE_CLIENT_EMAIL, GOOGLE_DRIVE_PRIVATE_KEY, GOOGLE_DRIVE_FOLDER_ID가 필요합니다.');
  console.warn('   Google Drive 기능을 사용할 수 없습니다.');
}

async function uploadToDrive(filePath, fileName) {
  if (!drive || !hasGoogleDriveConfig) {
    throw new Error('Google Drive가 설정되지 않았습니다. 환경변수를 확인해주세요.');
  }

  const fileMetadata = {
    name: fileName,
    parents: [process.env.GOOGLE_DRIVE_FOLDER_ID],
  };

  const media = {
    mimeType: 'image/jpeg',
    body: fs.createReadStream(filePath),
  };

  const response = await drive.files.create({
    resource: fileMetadata,
    media,
    fields: 'id',
  });

  const fileId = response.data.id;

  // 파일 공개 설정
  await drive.permissions.create({
    fileId,
    requestBody: {
      role: 'reader',
      type: 'anyone',
    },
  });

  const result = await drive.files.get({
    fileId,
    fields: 'webViewLink, webContentLink',
  });

  return result.data.webViewLink;
}
*/

// 더미 함수 (호환성 유지)
async function uploadToDrive(filePath, fileName) {
  throw new Error('Google Drive 기능이 비활성화되었습니다.');
}

module.exports = { uploadToDrive };