/**
 * Transcrição local de áudios recebidos via whisper.cpp.
 *
 * Pipeline:
 *   audio recebido (ogg/opus etc) → ffmpeg → WAV 16k mono → whisper-cli → texto
 *
 * Configurável via env:
 *   WHISPER_BIN       (default: 'whisper-cli')   binário no PATH
 *   WHISPER_MODEL     (default: 'models/ggml-base.bin')   modelo ggml
 *   WHISPER_LANG      (default: 'pt')   código de idioma (pt, en, es...)
 *   TRANSCRIBE_ENABLED (default: '1')   define '0' para desligar globalmente
 *
 * Se o binário ou modelo não existirem, o módulo deteta no arranque, regista
 * 1x e passa a no-op silencioso — não rebenta o processamento de mensagens.
 *
 * Instalação na VM (Ubuntu/Debian):
 *   sudo apt-get install -y build-essential git ffmpeg
 *   git clone https://github.com/ggerganov/whisper.cpp /opt/whisper.cpp
 *   cd /opt/whisper.cpp && make -j
 *   bash ./models/download-ggml-model.sh base
 *   sudo ln -sf /opt/whisper.cpp/build/bin/whisper-cli /usr/local/bin/whisper-cli
 *   # no .env (ou ecosystem.config.js):
 *   #   WHISPER_MODEL=/opt/whisper.cpp/models/ggml-base.bin
 */

const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const db = require('../db/schema');
const ioInstance = require('../io-instance');
const metrics = require('../metrics');

const BIN = process.env.WHISPER_BIN || 'whisper-cli';
const MODEL = process.env.WHISPER_MODEL || 'models/ggml-base.bin';
const LANG = process.env.WHISPER_LANG || 'pt';
const ENABLED = (process.env.TRANSCRIBE_ENABLED ?? '1') === '1';

let _ready = null;        // true / false depois de verificado
let _readyReason = '';    // motivo pelo qual está disabled

function checkReady() {
  if (_ready !== null) return _ready;

  if (!ENABLED) { _ready = false; _readyReason = 'TRANSCRIBE_ENABLED=0'; return false; }

  // Binário no PATH
  try {
    execSync(process.platform === 'win32' ? `where ${BIN}` : `which ${BIN}`, { stdio: 'ignore' });
  } catch {
    _ready = false; _readyReason = `${BIN} não encontrado no PATH`;
    return false;
  }

  // Modelo existe
  if (!fs.existsSync(MODEL)) {
    _ready = false; _readyReason = `modelo whisper não encontrado em ${MODEL}`;
    return false;
  }

  // ffmpeg (já usado no envio de áudio, mas confirmar mesmo assim)
  try {
    execSync(process.platform === 'win32' ? 'where ffmpeg' : 'which ffmpeg', { stdio: 'ignore' });
  } catch {
    _ready = false; _readyReason = 'ffmpeg não encontrado no PATH';
    return false;
  }

  _ready = true;
  return true;
}

function logStatusOnce() {
  if (logStatusOnce._called) return;
  logStatusOnce._called = true;
  if (checkReady()) {
    console.log(`[transcribe] activo — bin=${BIN}, model=${MODEL}, lang=${LANG}`);
  } else {
    console.log(`[transcribe] inactivo — ${_readyReason} (mensagens de áudio passam sem transcrição)`);
  }
}

/**
 * Transcreve um ficheiro de áudio em background. Não rebenta nem bloqueia
 * o caller — erros são logged e a mensagem fica como está.
 *
 * Quando a transcrição completa, actualiza messages.body na BD e emite
 * 'message:updated' para os clientes ligados ao Socket.io re-renderizarem.
 */
async function transcribeAudio(filePath, messageId) {
  logStatusOnce();
  if (!checkReady()) { try { metrics.transcribeTotal.inc({ outcome: 'disabled' }); } catch (_) {} return; }
  if (!filePath || !messageId) return;

  const tmpWav = path.join(os.tmpdir(), `wh-${process.pid}-${Date.now()}.wav`);
  const outBase = tmpWav; // whisper-cli escreve <outBase>.txt quando -otxt
  const outTxt = `${outBase}.txt`;

  try {
    // 1. Converter para WAV 16kHz mono (formato pedido pelo whisper)
    await new Promise((resolve, reject) => {
      const ff = spawn('ffmpeg', ['-y', '-i', filePath, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', tmpWav], { stdio: ['ignore', 'ignore', 'pipe'] });
      let err = '';
      ff.stderr.on('data', d => err += d.toString());
      ff.on('close', code => code === 0 ? resolve() : reject(new Error(`ffmpeg saiu com ${code}: ${err.slice(-200)}`)));
      ff.on('error', reject);
    });

    // 2. Correr whisper-cli — escreve resultado em <outBase>.txt
    await new Promise((resolve, reject) => {
      const wh = spawn(BIN, [
        '-m', MODEL,
        '-f', tmpWav,
        '-l', LANG,
        '-otxt',                  // formato texto puro
        '-of', outBase,           // output file base name (sem extensão)
        '--no-prints',            // silencia stderr verboso
      ], { stdio: ['ignore', 'ignore', 'pipe'] });
      let err = '';
      wh.stderr.on('data', d => err += d.toString());
      wh.on('close', code => code === 0 ? resolve() : reject(new Error(`whisper saiu com ${code}: ${err.slice(-200)}`)));
      wh.on('error', reject);
    });

    // 3. Ler texto e gravar na BD
    const text = fs.readFileSync(outTxt, 'utf8').trim();
    if (!text) {
      console.log(`[transcribe] msg ${messageId}: vazio (provavelmente só silêncio)`);
      metrics.transcribeTotal.inc({ outcome: 'empty' });
      return;
    }

    db.prepare('UPDATE messages SET body = ? WHERE id = ?').run(text, messageId);
    const updated = db.prepare('SELECT * FROM messages WHERE id = ?').get(messageId);
    ioInstance.get()?.emit('message:updated', { message: updated });
    console.log(`[transcribe] msg ${messageId}: "${text.slice(0, 60)}${text.length > 60 ? '...' : ''}"`);
    metrics.transcribeTotal.inc({ outcome: 'ok' });
  } catch (err) {
    console.error(`[transcribe] msg ${messageId} falhou: ${err.message}`);
    metrics.transcribeTotal.inc({ outcome: 'error' });
  } finally {
    // Cleanup — silencioso, ficheiros em /tmp não são críticos
    try { fs.unlinkSync(tmpWav); } catch (_) {}
    try { fs.unlinkSync(outTxt); } catch (_) {}
  }
}

module.exports = { transcribeAudio, isReady: checkReady };
