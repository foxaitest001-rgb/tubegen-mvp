
import fs from 'fs';
import path from 'path';
import https from 'https';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODELS_DIR = path.join(__dirname, '..', 'public', 'models');

if (!fs.existsSync(MODELS_DIR)) {
    fs.mkdirSync(MODELS_DIR, { recursive: true });
}

const files = [
    {
        url: 'https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_US/lessac/medium/en_US-lessac-medium.onnx?download=true',
        name: 'en_US-lessac-medium.onnx'
    },
    {
        url: 'https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_US/lessac/medium/en_US-lessac-medium.onnx.json?download=true',
        name: 'en_US-lessac-medium.onnx.json'
    }
];

async function downloadFile(url, filename) {
    const dest = path.join(MODELS_DIR, filename);
    if (fs.existsSync(dest)) {
        console.log(`✅ ${filename} already exists.`);
        return;
    }

    console.log(`⬇️ Downloading ${filename}...`);
    const file = fs.createWriteStream(dest);

    return new Promise((resolve, reject) => {
        https.get(url, (response) => {
            if (response.statusCode === 302 || response.statusCode === 301) {
                downloadFile(response.headers.location, filename).then(resolve).catch(reject);
                return;
            }
            response.pipe(file);
            file.on('finish', () => {
                file.close();
                console.log(`✨ Saved ${filename}`);
                resolve();
            });
        }).on('error', (err) => {
            fs.unlink(dest, () => { });
            reject(err);
        });
    });
}

(async () => {
    try {
        await Promise.all(files.map(f => downloadFile(f.url, f.name)));
        console.log("🎉 All models downloaded!");
    } catch (e) {
        console.error("Download failed:", e);
    }
})();
