#!/usr/bin/env node
/**
 * Sora バックエンドをワンクリックで起動
 * - .env がなければ作成し、キーが空ならターミナルで1回だけ入力を促す
 * - 入力されたキーを .env に自動保存
 * - npm install → node server.js で起動
 */
const path = require('path');
const fs = require('fs');
const readline = require('readline');
const { spawnSync, spawn } = require('child_process');

const root = path.resolve(__dirname, '..');
const backend = path.join(root, 'backend');
const envPath = path.join(backend, '.env');
const envExample = path.join(backend, '.env.example');

function getEnvKey() {
  if (!fs.existsSync(envPath)) return null;
  const content = fs.readFileSync(envPath, 'utf8');
  const m = content.match(/OPENAI_API_KEY=(.*)/);
  if (!m) return null;
  const val = m[1].replace(/#.*$/, '').trim();
  return val || null;
}

function writeEnvKey(key) {
  let content = '';
  if (fs.existsSync(envPath)) {
    content = fs.readFileSync(envPath, 'utf8');
  } else if (fs.existsSync(envExample)) {
    content = fs.readFileSync(envExample, 'utf8');
  } else {
    content = '# OpenAI API キー\nOPENAI_API_KEY=\n';
  }
  if (!content.includes('OPENAI_API_KEY=')) {
    content += '\nOPENAI_API_KEY=\n';
  }
  const val = (key || '').trim();
  content = content.replace(/OPENAI_API_KEY=.*/m, `OPENAI_API_KEY=${val}`);
  fs.writeFileSync(envPath, content, 'utf8');
}

function promptKey() {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    console.log('\n--- Sora 用 OpenAI API キー ---');
    console.log('未設定の場合、ここで1回だけ貼り付けると .env に保存され、以降は不要です。');
    console.log('取得: https://platform.openai.com/api-keys\n');
    rl.question('API キーを貼り付けて Enter（スキップはそのまま Enter）: ', (answer) => {
      rl.close();
      resolve((answer || '').trim());
    });
  });
}

async function main() {
  if (!fs.existsSync(envPath) && fs.existsSync(envExample)) {
    fs.copyFileSync(envExample, envPath);
  }

  let key = getEnvKey();
  if (!key) {
    key = await promptKey();
    if (key) {
      writeEnvKey(key);
      console.log('✓ API キーを .env に保存しました。\n');
    } else {
      console.log('スキップしました。あとで http://localhost:3001/setup で設定できます。\n');
    }
  }

  console.log('npm install を実行中...');
  const install = spawnSync('npm', ['install'], {
    cwd: backend,
    stdio: 'inherit',
    shell: process.platform === 'win32'
  });
  if (install.status !== 0) {
    process.exit(install.status || 1);
  }

  console.log('\nSora API サーバーを起動しています...\n');
  const server = spawn('node', ['server.js'], {
    cwd: backend,
    stdio: 'inherit',
    shell: process.platform === 'win32'
  });
  server.on('close', (code) => process.exit(code || 0));
}

main();
