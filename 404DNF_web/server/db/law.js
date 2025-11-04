// server/db/law.js
const { MongoClient } = require('mongodb');
require('dotenv').config();

const uri = process.env.MONGODB_URI || process.env.MONGODB_URL || process.env.MONGO_URI;
if (!uri) {
  throw new Error('MongoDB URI가 설정되지 않았습니다. MONGODB_URI 환경변수를 확인해주세요.');
}
const dbName = process.env.DB_NAME;
const collectionName = 'law';

let lawCollection;

async function connectLawCollection() {
  if (!lawCollection) {
    const client = new MongoClient(uri);
    await client.connect();
    const db = client.db(dbName);
    lawCollection = db.collection(collectionName);
  }
  return lawCollection;
}

module.exports = { connectLawCollection };