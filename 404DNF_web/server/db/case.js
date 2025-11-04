// server/db/case.js
const { MongoClient } = require('mongodb');
require('dotenv').config();

const uri = process.env.MONGODB_URI || process.env.MONGODB_URL || process.env.MONGO_URI;
if (!uri) {
  throw new Error('MongoDB URI가 설정되지 않았습니다. MONGODB_URI 환경변수를 확인해주세요.');
}
const dbName = process.env.DB_NAME?.trim();  // web
const collectionName = 'case';

let caseCollection;

async function connectCaseCollection() {
  if (!caseCollection) {
    const client = new MongoClient(uri);
    await client.connect();
    const db = client.db(dbName);
    caseCollection = db.collection(collectionName);
  }
  return caseCollection;
}

module.exports = { connectCaseCollection };