import 'dotenv/config';
import express from 'express';
import OpenAI from 'openai';
import Replicate from 'replicate';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const IMAGES_DIR = path.join(PROJECT_ROOT, 'images');
const FALLBACK_VIDEO_URL = '/images/5.mp4';
const HISTORY_FILE = path.join(PROJECT_ROOT, 'generated-videos.json');
const COMMENTS_FILE = path.join(PROJECT_ROOT, 'video-comments.json');
const LIKES_FILE = path.join(PROJECT_ROOT, 'video-likes.json');

function loadHistory() {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
    }
  } catch (_) {}
  return [];
}

function saveHistory(entry) {
  try {
    const history = loadHistory();
    history.unshift(entry);
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(history.slice(0, 50), null, 2), 'utf8');
  } catch (err) {
    console.error('履歴保存エラー:', err);
  }
}

function loadComments() {
  try {
    if (fs.existsSync(COMMENTS_FILE)) {
      return JSON.parse(fs.readFileSync(COMMENTS_FILE, 'utf8'));
    }
  } catch (_) {}
  return {};
}

function saveComment(videoUrl, comment) {
  try {
    const comments = loadComments();
    if (!comments[videoUrl]) comments[videoUrl] = [];
    comments[videoUrl].push(comment);
    fs.writeFileSync(COMMENTS_FILE, JSON.stringify(comments, null, 2), 'utf8');
  } catch (err) {
    console.error('コメント保存エラー:', err);
  }
}

function loadLikes() {
  try {
    if (fs.existsSync(LIKES_FILE)) {
      return JSON.parse(fs.readFileSync(LIKES_FILE, 'utf8'));
    }
  } catch (_) {}
  return {};
}

function saveLikes(likes) {
  try {
    fs.writeFileSync(LIKES_FILE, JSON.stringify(likes, null, 2), 'utf8');
  } catch (err) {
    console.error('いいね保存エラー:', err);
  }
}

const LIMITS = {
  perMinute: 10,
  perDay: 50,
  promptMaxChars: 500,
  seconds: '8',
  size: '1280x720'
};
const rateState = new Map();

const app = express();

// CORS（フロントと別ポートで動かすため）- 最初に設定
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.use(express.json());

// 静的ファイル（生成した動画を返すため）
app.use('/images', express.static(IMAGES_DIR));

/** 生成履歴を取得（全ユーザーの動画を表示） */
app.get('/api/generated-videos', (req, res) => {
  const sort = req.query.sort || 'recent'; // 'recent' or 'popular'
  const history = loadHistory();
  const comments = loadComments();
  const likes = loadLikes();
  
  let videos = history.map(v => ({
    ...v,
    comments: comments[v.videoUrl] || [],
    likes: likes[v.videoUrl] || 0
  }));
  
  // ソート
  if (sort === 'popular') {
    videos.sort((a, b) => b.likes - a.likes);
  }
  
  return res.json({ videos });
});

/** いいねを追加 */
app.post('/api/likes', (req, res) => {
  const { videoUrl } = req.body || {};
  if (!videoUrl) {
    return res.status(400).json({ error: 'videoUrl が必要です。' });
  }
  
  // URLを正規化（絶対URLを相対URLに変換）
  const normalizedUrl = videoUrl.replace(/^https?:\/\/[^/]+/, '');
  
  const likes = loadLikes();
  likes[normalizedUrl] = (likes[normalizedUrl] || 0) + 1;
  saveLikes(likes);
  
  return res.json({ likes: likes[normalizedUrl] });
});

/** 動画にコメントを投稿 */
app.post('/api/comments', (req, res) => {
  const { videoUrl, name, comment } = req.body || {};
  if (!videoUrl || !name || !comment) {
    return res.status(400).json({ error: 'videoUrl, name, comment が必要です。' });
  }
  
  // URLを正規化（絶対URLを相対URLに変換）
  const normalizedUrl = videoUrl.replace(/^https?:\/\/[^/]+/, '');
  
  const entry = {
    name: name.trim().slice(0, 50),
    comment: comment.trim().slice(0, 200),
    createdAt: Date.now()
  };
  saveComment(normalizedUrl, entry);
  return res.json({ ok: true });
});

/** 日本語を英語に翻訳（Google Translate非公式API） */
app.post('/api/translate', async (req, res) => {
  const { text } = req.body || {};
  if (!text || typeof text !== 'string') {
    return res.status(400).json({ error: 'text が必要です。' });
  }
  
  try {
    // Google Translate非公式APIを使用（無料）
    const url = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=ja&tl=en&dt=t&q=' + encodeURIComponent(text);
    const response = await fetch(url);
    const data = await response.json();
    
    // レスポンス形式: [[[translated, original, ...]]]
    if (data && data[0] && data[0][0] && data[0][0][0]) {
      const translated = data[0].map(item => item[0]).join('');
      return res.json({ translated });
    }
    
    return res.status(500).json({ error: '翻訳に失敗しました。' });
  } catch (err) {
    console.error('翻訳エラー:', err);
    return res.status(500).json({ error: err.message || '翻訳に失敗しました。' });
  }
});

function getOpenAI() {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  return new OpenAI({ apiKey: key });
}

function getReplicate() {
  const key = process.env.REPLICATE_API_TOKEN;
  if (!key) return null;
  return new Replicate({ auth: key });
}

function getClientKey(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim();
  }
  return req.ip || 'unknown';
}

function checkRateLimit(clientKey) {
  const now = Date.now();
  const day = new Date(now).toISOString().slice(0, 10);
  const state = rateState.get(clientKey) || { day, dayCount: 0, minuteStart: now, minuteCount: 0 };
  if (state.day !== day) {
    state.day = day;
    state.dayCount = 0;
  }
  if (now - state.minuteStart > 60 * 1000) {
    state.minuteStart = now;
    state.minuteCount = 0;
  }
  if (state.dayCount >= LIMITS.perDay) {
    return { ok: false, reason: 'day', retryAfter: 24 * 60 * 60 };
  }
  if (state.minuteCount >= LIMITS.perMinute) {
    const retryAfter = Math.ceil((state.minuteStart + 60 * 1000 - now) / 1000);
    return { ok: false, reason: 'minute', retryAfter };
  }
  state.dayCount += 1;
  state.minuteCount += 1;
  rateState.set(clientKey, state);
  return { ok: true };
}

// 生成した動画のID → ローカルパス
const downloadedVideos = new Map();
const replicatePredictions = new Map();

/** 完全無料モード（デモ）- APIキー不要 */
app.post('/api/generate-video-free', async (req, res) => {
  const { prompt } = req.body || {};
  if (!prompt || typeof prompt !== 'string') {
    return res.status(400).json({ error: 'prompt を送信してください。' });
  }

  // デモモード: 既存の動画をランダムに返す
  const demoVideoId = 'demo-' + Date.now();
  replicatePredictions.set(demoVideoId, { 
    prompt: prompt.trim(),
    demoMode: true,
    status: 'processing'
  });
  
  return res.json({
    videoId: demoVideoId,
    status: 'processing',
    provider: 'demo'
  });
});

/** デモモード動画の状態を取得 */
app.get('/api/video-status-free/:videoId', async (req, res) => {
  const { videoId } = req.params;
  if (!videoId) return res.status(400).json({ error: 'videoId が必要です。' });

  try {
    // すでにダウンロード済みならパスを返す
    const cached = downloadedVideos.get(videoId);
    if (cached) {
      return res.json({
        status: 'completed',
        progress: 100,
        videoUrl: cached
      });
    }

    const predData = replicatePredictions.get(videoId);
    if (predData && predData.demoMode) {
      // デモモード: 疑似的な遅延後にサンプル動画を返す
      if (!predData.startTime) {
        predData.startTime = Date.now();
        replicatePredictions.set(videoId, predData);
        return res.json({ status: 'processing', progress: 30 });
      }
      
      const elapsed = Date.now() - predData.startTime;
      if (elapsed < 3000) {
        // 3秒待機（リアルな生成体験のため）
        const progress = Math.min(90, 30 + Math.floor(elapsed / 50));
        return res.json({ status: 'processing', progress });
      }
      
      // 3秒後に完成
      const localUrl = FALLBACK_VIDEO_URL; // images/5.mp4 を使用
      downloadedVideos.set(videoId, localUrl);
      saveHistory({ videoUrl: localUrl, prompt: predData.prompt || '', createdAt: Date.now() });
      
      return res.json({ status: 'completed', progress: 100, videoUrl: localUrl });
    }

    return res.status(404).json({ error: '動画が見つかりません。' });
  } catch (err) {
    return res.status(500).json({
      error: err.message || '状態の取得に失敗しました。'
    });
  }
});

/** Soraで動画生成を開始 */
app.post('/api/generate-video', async (req, res) => {
  const { prompt, userApiKey, speedMode } = req.body || {};
  if (!prompt || typeof prompt !== 'string') {
    return res.status(400).json({ error: 'prompt を送信してください。' });
  }

  // 速度モードの設定（Soraがサポートする長さ: 4, 8, 12秒のみ）
  const SPEED_CONFIGS = {
    fast: { seconds: '4', size: '1280x720', maxChars: 300 },      // 超高速（4秒）
    normal: { seconds: '4', size: '1280x720', maxChars: 500 },    // 標準（4秒）
    high: { seconds: '4', size: '1792x1024', maxChars: 1000 }     // 高品質（4秒・高解像度）
  };
  
  const mode = speedMode || 'normal';
  const config = SPEED_CONFIGS[mode] || SPEED_CONFIGS.normal;

  // ユーザーが自分のAPIキーを提供した場合
  let openai;
  let usingUserKey = false;
  let promptMaxChars = config.maxChars;
  let seconds = config.seconds;
  let size = config.size;

  if (userApiKey && typeof userApiKey === 'string' && userApiKey.trim().startsWith('sk-')) {
    // ユーザーのキーを使用（レート制限なし）
    try {
      openai = new OpenAI({ apiKey: userApiKey.trim() });
      usingUserKey = true;
    } catch (err) {
      return res.status(400).json({ error: '無効なAPIキーです。' });
    }
  } else {
    // サーバーのAPIキーを使用（レート制限あり）
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({
        error: 'サーバーのAPIキーが設定されていません。自分のAPIキーを入力して生成してください。',
        needSetup: true,
        needUserKey: true
      });
    }

    // 高品質モードはユーザーキーのみ
    if (mode === 'high') {
      return res.status(400).json({
        error: '高品質モードは自分のAPIキーが必要です。',
        needUserKey: true
      });
    }

    const clientKey = getClientKey(req);
    const limit = checkRateLimit(clientKey);
    if (!limit.ok) {
      return res.status(429).json({
        error: '利用制限に達しました。自分のAPIキーを使用するか、しばらく待ってから再試行してください。',
        reason: 'rate_limit',
        retryAfter: limit.retryAfter,
        needUserKey: true
      });
    }

    openai = getOpenAI();
    if (!openai) {
      return res.status(500).json({
        error: 'OPENAI_API_KEY が設定されていません。',
        needSetup: true,
        needUserKey: true
      });
    }
  }

  if (prompt.length > promptMaxChars) {
    return res.status(400).json({ error: `プロンプトは最大 ${promptMaxChars} 文字までです。` });
  }

  // プロンプトをアニメーションキャラクター＋擬音スタイルに変換
  const enhancedPrompt = `Cute animated character performing action with onomatopoeia text effects. ${prompt.trim()}. Style: colorful 2D animation, expressive cartoon character, Japanese anime style with visible sound effect text (like "ドカーン", "キラキラ", "ピョン"), dynamic motion, vibrant colors, simple background`;

  try {
    const video = await openai.videos.create({
      model: 'sora-2',
      prompt: enhancedPrompt,
      size: size,
      seconds: seconds
    });
    return res.json({
      videoId: video.id,
      status: video.status,
      progress: video.progress ?? 0,
      usingUserKey,
      speedMode: mode
    });
  } catch (err) {
    const message = err.message || 'Sora API でエラーが発生しました。';
    const status = err.status === 401 ? 401 : err.status === 429 ? 429 : 500;
    const isBillingLimit = typeof message === 'string' &&
      message.toLowerCase().includes('billing hard limit');
    
    if (isBillingLimit) {
      if (usingUserKey) {
        return res.status(402).json({
          error: 'あなたのAPIキーが課金上限に達しました。OpenAIダッシュボードで上限を確認してください。',
          reason: 'billing_limit'
        });
      } else {
        return res.status(402).json({
          error: 'サーバーの課金上限に達しました。自分のAPIキーを使用してください。',
          fallback: true,
          videoUrl: FALLBACK_VIDEO_URL,
          reason: 'billing_limit',
          needUserKey: true
        });
      }
    }

    if (status === 401 && usingUserKey) {
      return res.status(401).json({
        error: 'APIキーが無効です。正しいキーを入力してください。',
        needUserKey: true
      });
    }

    return res.status(status).json({
      error: message,
      needSetup: status === 401 && !usingUserKey,
      needUserKey: status === 401 || status === 429
    });
  }
});

/** 動画ジョブの状態を取得。完了していればダウンロードしてURLを返す */
app.get('/api/video-status/:videoId', async (req, res) => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'OPENAI_API_KEY が設定されていません。' });
  }

  const { videoId } = req.params;
  if (!videoId) return res.status(400).json({ error: 'videoId が必要です。' });

  const openai = getOpenAI();
  if (!openai) {
    return res.status(500).json({ error: 'OPENAI_API_KEY が設定されていません。' });
  }
  try {
    // すでにダウンロード済みならパスを返す
    const cached = downloadedVideos.get(videoId);
    if (cached) {
      return res.json({
        status: 'completed',
        progress: 100,
        videoUrl: cached
      });
    }

    const video = await openai.videos.retrieve(videoId);
    const status = video.status;
    const progress = video.progress ?? 0;

    if (status === 'completed') {
      const response = await openai.videos.downloadContent(videoId);
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const safeName = videoId.replace(/[^a-zA-Z0-9_-]/g, '_');
      const filename = `sora-${safeName}.mp4`;
      const filepath = path.join(IMAGES_DIR, filename);
      if (!fs.existsSync(IMAGES_DIR)) fs.mkdirSync(IMAGES_DIR, { recursive: true });
      fs.writeFileSync(filepath, buffer);
      const videoUrl = `/images/${filename}`;
      downloadedVideos.set(videoId, videoUrl);
      saveHistory({ videoUrl, prompt: video.prompt || '', createdAt: Date.now() });
      return res.json({ status: 'completed', progress: 100, videoUrl });
    }

    if (status === 'failed') {
      const errMsg = video.error?.message || '動画の生成に失敗しました。';
      return res.status(500).json({ error: errMsg, status: 'failed' });
    }

    return res.json({ status, progress });
  } catch (err) {
    return res.status(500).json({
      error: err.message || '状態の取得に失敗しました。'
    });
  }
});

const ENV_PATH = path.join(__dirname, '.env');

function reloadEnv() {
  try {
    if (fs.existsSync(ENV_PATH)) {
      const content = fs.readFileSync(ENV_PATH, 'utf8');
      const m = content.match(/OPENAI_API_KEY=(.*)/);
      if (m) process.env.OPENAI_API_KEY = m[1].replace(/#.*$/, '').trim();
    }
  } catch (_) {}
}

/** ブラウザで API キーを設定するページ（手間を取らせない） */
app.get('/setup', (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Sora API キー設定</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: system-ui, sans-serif; margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; background: #f5f5f5; padding: 20px; }
    .card { background: #fff; border-radius: 16px; padding: 2rem; max-width: 420px; width: 100%; box-shadow: 0 4px 20px rgba(0,0,0,0.08); }
    h1 { margin: 0 0 0.5rem; font-size: 1.35rem; color: #333; }
    p { color: #666; font-size: 0.9rem; margin: 0 0 1.25rem; line-height: 1.5; }
    a { color: #e91e63; }
    input { width: 100%; padding: 12px 14px; border: 2px solid #eee; border-radius: 10px; font-size: 1rem; margin-bottom: 1rem; }
    input:focus { outline: none; border-color: #e91e63; }
    button { width: 100%; padding: 14px; background: linear-gradient(135deg, #e91e63, #f48fb1); color: #fff; border: none; border-radius: 10px; font-size: 1rem; font-weight: 600; cursor: pointer; }
    button:hover { opacity: 0.95; }
    .ok { margin-top: 1rem; padding: 12px; background: #e8f5e9; color: #2e7d32; border-radius: 10px; font-size: 0.95rem; display: none; }
    .ok.show { display: block; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Sora 用 API キー設定</h1>
    <p>OpenAI の API キーを1回だけ貼り付けて保存すると、Sora で動画生成が使えます。<br><a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener">API キーを取得する</a></p>
    <form id="f">
      <input type="password" id="key" placeholder="sk-..." autocomplete="off">
      <button type="submit">保存して使う</button>
    </form>
    <div class="ok" id="ok">✓ 保存しました。このタブを閉じて、サイトで「Sora で生成」を試してください。</div>
  </div>
  <script>
    document.getElementById('f').onsubmit = async (e) => {
      e.preventDefault();
      const key = document.getElementById('key').value.trim();
      if (!key) return;
      const r = await fetch('/setup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ apiKey: key }) });
      const j = await r.json();
      if (j.ok) { document.getElementById('ok').classList.add('show'); document.getElementById('f').style.display = 'none'; }
      else alert(j.error || '保存に失敗しました');
    };
  </script>
</body>
</html>
  `);
});

app.post('/setup', (req, res) => {
  const { apiKey } = req.body || {};
  const key = (apiKey && typeof apiKey === 'string') ? apiKey.trim() : '';
  if (!key) {
    return res.status(400).json({ error: 'API キーを入力してください。' });
  }
  try {
    let content = '';
    const envExample = path.join(__dirname, '.env.example');
    if (fs.existsSync(ENV_PATH)) {
      content = fs.readFileSync(ENV_PATH, 'utf8');
    } else if (fs.existsSync(envExample)) {
      content = fs.readFileSync(envExample, 'utf8');
    } else {
      content = '# OpenAI API キー\nOPENAI_API_KEY=\n';
    }
    if (!content.includes('OPENAI_API_KEY=')) content += '\nOPENAI_API_KEY=\n';
    content = content.replace(/OPENAI_API_KEY=.*/m, `OPENAI_API_KEY=${key}`);
    fs.writeFileSync(ENV_PATH, content, 'utf8');
    reloadEnv();
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err.message || '保存に失敗しました。' });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Sora API サーバー: http://localhost:${PORT}`);
  console.log('キー未設定時: http://localhost:' + PORT + '/setup で設定できます。');
  if (!process.env.OPENAI_API_KEY) {
    console.log('※ 上記 /setup で API キーを入力すると Sora が使えます。');
  }
});
