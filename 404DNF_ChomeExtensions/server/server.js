import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import mongoose from 'mongoose';
import { z } from 'zod';
import net from 'net';

// ====== 환경변수 ======
const PORT = Number(process.env.PORT || 8000);
const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error('MONGODB_URI is missing in .env');
  process.exit(1);
}
const API_KEY = process.env.API_KEY || ''; // 옵션
const ALLOWED = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

// ====== Mongo 연결 ======
// 데이터베이스 이름을 명시적으로 지정 (web)
const dbName = 'web';

console.log(`🔗 MongoDB 연결 시도: ${MONGODB_URI.replace(/\/\/.*@/, '//***:***@')}`);
await mongoose.connect(MONGODB_URI, {
  dbName: dbName  // 데이터베이스 이름 명시
});
console.log(`✅ MongoDB 연결 성공: db=${mongoose.connection.db.databaseName}, collection=extension`);

// ====== Mongoose 모델 (collection: extension) ======
const StructuredBlockSchema = new mongoose.Schema(
  {
    index: { type: Number },
    selector: { type: String },
    tag: { type: String },
    frameUrl: { type: String },
    frameTitle: { type: String },
    frameBlockIndex: { type: Number },
    blockType: { type: String },
    frameId: { type: Number },
    linkHref: { type: String },
    linkSelector: { type: String },
    text: { type: String },
    plainText: { type: String },
    originalText: { type: String },
    originalPlainText: { type: String },
    rawText: { type: String },
    rawPlainText: { type: String },
    translatedPlainText: { type: String },
    translated: { type: Boolean }
  },
  { _id: false }
);

const FrameMetaSchema = new mongoose.Schema(
  {
    index: { type: Number },
    frameUrl: { type: String },
    frameId: { type: Number },
    title: { type: String },
    blocks: { type: Number }
  },
  { _id: false }
);

const ExtensionDocSchema = new mongoose.Schema(
  {
    tabUrl: { type: String, required: true },
    tabTitle: { type: String },
    collectedAt: { type: Date, required: true },
    framesCollected: { type: Number, required: true },
    fullText: { type: String, required: true },      // 번역된 텍스트 (모델링용)
    originalText: { type: String, required: true },   // 원본 텍스트 (표시용)
    frames: [{ type: String }],
    frameMetadata: { type: [FrameMetaSchema], default: [] },
    structuredBlocks: { type: [StructuredBlockSchema], default: [] },
    clientId: { type: String },
    processingServerId: { type: String },
    // 모델링 진행 상황 필드
    modelingStatus: { type: String, enum: ['pending', 'processing', 'completed', 'failed'], default: 'pending' },
    modelingProgress: { 
      current: { type: Number, default: 0 },
      total: { type: Number, default: 0 }
    },
    modelingError: { type: String },
    modelingCompletedAt: { type: Date }
  },
  {
    collection: 'extension',
    versionKey: false,
    timestamps: true
  }
);
const ExtensionDoc = mongoose.model('ExtensionDoc', ExtensionDocSchema);


const ModelResultSchema = new mongoose.Schema(
  {
    id: { type: String, index: true, required: true },     // extension _id (string)
    is_darkpattern: { type: Boolean, default: false },
    // score, label 등이 있을 수 있으나 읽기만 하므로 필수 아님
  },
  { collection: 'model', versionKey: false, timestamps: true }
);
const ModelResult = mongoose.model('ModelResult', ModelResultSchema);

// ====== App 기본설정 ======
const app = express();
app.use(helmet());
app.use(express.json({ limit: '10mb' }));

// CORS (확장프로그램 팝업은 origin이 null일 수 있어 허용)
app.use(
  cors({
    origin(origin, cb) {
      if (!origin) return cb(null, true); // 확장프로그램/로컬 파일 등
      if (ALLOWED.length === 0) return cb(null, true); // 개발 편의: 제한 해제
      if (ALLOWED.includes(origin) || origin.startsWith('chrome-extension://')) {
        return cb(null, true);
      }
      return cb(null, false);
    }
  })
);

// 간단 API 키 검사(옵션)
app.use((req, res, next) => {
  if (!API_KEY) return next();
  const key = req.header('x-api-key');
  if (key !== API_KEY) return res.status(401).json({ ok: false, error: 'Unauthorized' });
  next();
});

const StructuredBlockSchemaZ = z.object({
  index: z.number().int().nonnegative().optional(),
  selector: z.string().optional(),
  tag: z.string().optional(),
  frameUrl: z.string().optional(),
  frameTitle: z.string().optional(),
  frameBlockIndex: z.number().int().nonnegative().optional(),
  blockType: z.string().optional(),
  frameId: z.number().int().optional().nullable(),
  linkHref: z.string().optional().nullable(),
  linkSelector: z.string().optional().nullable(),
  text: z.string().min(1),
  plainText: z.string().optional(),
  originalText: z.string().optional(),
  originalPlainText: z.string().optional(),
  rawText: z.string().optional(),
  rawPlainText: z.string().optional(),
  translatedPlainText: z.string().optional(),
  translated: z.boolean().optional()
});

const FrameMetaSchemaZ = z.object({
  index: z.number().int().nonnegative(),
  frameUrl: z.string().optional(),
  frameId: z.number().int().optional().nullable(),
  title: z.string().optional(),
  blocks: z.number().int().nonnegative().optional()
});

const PayloadSchema = z.object({
  tabUrl: z.string().url(),
  tabTitle: z.string().optional(),
  collectedAt: z.string(), // ISO datetime
  framesCollected: z.number().int().nonnegative(),
  fullText: z.string().min(1),      // 번역된 텍스트 (모델링용)
  originalText: z.string().min(1),  // 원본 텍스트 (표시용)
  frames: z.array(z.string().url()).optional(),  // URL 배열
  frameMetadata: z.array(FrameMetaSchemaZ).optional(),
  structuredBlocks: z.array(StructuredBlockSchemaZ).optional(),
  clientId: z.string().optional()
});

app.get('/health', (_req, res) => res.json({ ok: true }));

app.post('/collect', async (req, res) => {
  try {
    const parsed = PayloadSchema.parse(req.body);
    
    // 크롤링 데이터 수신 로그
    console.log('\n' + '='.repeat(80));
    console.log('📥 [크롤링 데이터 수신]');
    console.log('='.repeat(80));
    console.log(`📍 URL: ${parsed.tabUrl}`);
    console.log(`📄 제목: ${parsed.tabTitle || '(없음)'}`);
    console.log(`📊 프레임 수: ${parsed.framesCollected}개`);
    console.log(`📝 텍스트 길이: ${parsed.fullText?.length || 0} 문자 (번역됨)`);
    console.log(`📝 원본 텍스트 길이: ${parsed.originalText?.length || 0} 문자`);
    
    // * 기준으로 문장 수 계산
    const sentences = parsed.fullText?.split('*').filter(s => s.trim()) || [];
    console.log(`📋 문장 수 (* 기준): ${sentences.length}개`);
    console.log(`📄 번역된 텍스트 미리보기: ${parsed.fullText?.substring(0, 150) || ''}...`);
    console.log(`📄 원본 텍스트 미리보기: ${parsed.originalText?.substring(0, 150) || ''}...`);
    console.log('='.repeat(80));
    
    const doc = await ExtensionDoc.create({
      tabUrl: parsed.tabUrl,
      tabTitle: parsed.tabTitle,
      collectedAt: new Date(parsed.collectedAt),
      framesCollected: parsed.framesCollected,
      fullText: parsed.fullText,           // 번역된 텍스트 (모델링용)
      originalText: parsed.originalText,    // 원본 텍스트 (표시용)
      frames: parsed.frames || [],
      frameMetadata: parsed.frameMetadata || [],
      structuredBlocks: parsed.structuredBlocks || [],
      clientId: parsed.clientId
    });
    
    console.log(`✅ [MongoDB 저장 완료]`);
    console.log(`   - _id: ${doc._id}`);
    console.log(`   - Collection: ${ExtensionDoc.collection.name}`);
    console.log(`   - Database: ${mongoose.connection.db.databaseName}`);
    console.log(`   - 저장 시간: ${new Date().toISOString()}`);
    console.log('='.repeat(80) + '\n');
    
    res.json({ ok: true, id: doc._id.toString() });
  } catch (e) {
    console.error('\n❌ [크롤링 데이터 저장 실패]');
    console.error(`   오류: ${e?.message || e}`);
    console.error('='.repeat(80) + '\n');
    res.status(400).json({ ok: false, error: e?.message || 'invalid payload' });
  }
});

// 최신 문서 (탭 URL 기준)
app.get('/latest', async (req, res) => {
  try {
    const tabUrl = req.query.tabUrl;
    if (!tabUrl || typeof tabUrl !== 'string') {
      return res.status(400).json({ ok: false, error: 'tabUrl query required' });
    }
    const doc = await ExtensionDoc.findOne({ tabUrl }).sort({ createdAt: -1 }).lean().exec();
    if (!doc) return res.status(404).json({ ok: false, error: 'not found' });

    doc._id = doc._id.toString();
    res.json({ ok: true, doc });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: 'server error' });
  }
});

// 최신 문서 (전체에서 가장 최근)
app.get('/doc/latest', async (_req, res) => {
  try {
    const doc = await ExtensionDoc.findOne().sort({ createdAt: -1 }).lean().exec();
    if (!doc) return res.status(404).json({ ok: false, error: 'not found' });

    doc._id = doc._id.toString();
    res.json({ ok: true, doc });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: 'server error' });
  }
});

// ID로 단건 조회
app.get('/doc/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const doc = await ExtensionDoc.findById(id).lean().exec();
    if (!doc) return res.status(404).json({ ok: false, error: 'not found' });

    doc._id = doc._id.toString();
    res.json({ ok: true, doc });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: 'server error' });
  }
});

// 모델 진행 상황 조회
app.get('/model/progress/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const doc = await ExtensionDoc.findById(id).lean().exec();
    if (!doc) return res.status(404).json({ ok: false, error: 'not found' });

    const progress = {
      status: doc.modelingStatus || 'pending', // pending, processing, completed, failed
      progress: doc.modelingProgress || { current: 0, total: 0 },
      error: doc.modelingError || null,
      completedAt: doc.modelingCompletedAt || null
    };

    res.json({ ok: true, progress });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: 'server error' });
  }
});

app.get('/model', async (req, res) => {
  try {
    const id = req.query.id;
    if (!id || typeof id !== 'string') {
      return res.status(400).json({ ok: false, error: 'id query required' });
    }
    const rows = await ModelResult.find({ id }).lean().exec();
    res.json(rows); // 배열만 반환 (ok 필드 없이)
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: 'server error' });
  }
});

// 합계/다크개수/퍼센트 요약
app.get('/model/summary', async (req, res) => {
  try {
    const id = req.query.id;
    if (!id || typeof id !== 'string') {
      return res.status(400).json({ ok: false, error: 'id query required' });
    }
    const [total, dark] = await Promise.all([
      ModelResult.countDocuments({ id }),
      ModelResult.countDocuments({ id, is_darkpattern: true })
    ]);
    const percent = total > 0 ? Math.round((dark / total) * 100) : 0;
    res.json({ ok: true, id, total, dark, percent });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: 'server error' });
  }
});


// ====== 포트 충돌 확인 ======
function checkPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    
    server.listen(port, () => {
      server.once('close', () => resolve(true));
      server.close();
    });
    
    server.on('error', () => resolve(false));
  });
}

// ====== 시작 ======
async function startServer() {
  // 포트 사용 가능 여부 확인
  const isAvailable = await checkPortAvailable(PORT);
  
  if (!isAvailable) {
    console.error('\n' + '='.repeat(80));
    console.error(`❌ 포트 ${PORT}가 이미 사용 중입니다.`);
    console.error('='.repeat(80));
    console.error(`다음 중 하나를 선택하세요:`);
    console.error(`1. 기존 프로세스 종료: lsof -ti:${PORT} | xargs kill -9`);
    console.error(`2. 환경변수로 다른 포트 사용: PORT=8001 node server.js`);
    console.error(`3. .env 파일에 PORT=8001 설정`);
    console.error('='.repeat(80) + '\n');
    process.exit(1);
  }
  
  const server = app.listen(PORT, () => {
    console.log('\n' + '='.repeat(80));
    console.log(`✅ Extension 서버 시작 완료`);
    console.log('='.repeat(80));
    console.log(`📍 포트: ${PORT}`);
    console.log(`🌐 URL: http://localhost:${PORT}`);
    console.log(`📊 MongoDB: ${mongoose.connection.db.databaseName}`);
    console.log(`📝 Collection: extension`);
    console.log('='.repeat(80) + '\n');
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`\n❌ 포트 ${PORT}가 이미 사용 중입니다.`);
      console.error(`프로세스 확인: lsof -ti:${PORT}`);
      process.exit(1);
    } else {
      throw err;
    }
  });
}

startServer().catch(err => {
  console.error('서버 시작 실패:', err);
  process.exit(1);
});
