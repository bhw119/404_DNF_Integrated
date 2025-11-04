const { MongoClient } = require('mongodb');
require('dotenv').config();

const uri = process.env.MONGODB_URI || process.env.MONGODB_URL || process.env.MONGO_URI;
const dbName = process.env.DB_NAME || 'web';

if (!uri) {
  throw new Error('MongoDB URI가 설정되지 않았습니다. MONGODB_URI 환경변수를 확인해주세요.');
}

const client = new MongoClient(uri);
let predicateCollection;

async function connectPredicateCollection() {
  if (!predicateCollection) {
    await client.connect();
    const db = client.db(dbName);
    predicateCollection = db.collection('predicate');
  }
  return predicateCollection;
}

module.exports = { connectPredicateCollection };