/**
 * Download and curate VidProM + Lunara datasets
 * Creates a curated subset of ~50K prompts for the Consultant Chat
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import https from 'https';
import { createWriteStream } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, '../src/data');
const RAW_DIR = path.join(__dirname, '../datasets_raw');

// Dataset URLs (HuggingFace)
const DATASETS = {
    vidprom: {
        url: 'https://huggingface.co/datasets/WenhaoWang/VidProM/resolve/main/VidProM_unique.csv',
        filename: 'VidProM_unique.csv',
        sizeMB: 383
    },
    lunara: {
        url: 'https://huggingface.co/datasets/lunaralloy/lunara-aesthetic-v1/resolve/main/data/train-00000-of-00001.parquet',
        filename: 'lunara_aesthetic.parquet',
        sizeMB: 50
    }
};

// Download with progress
function downloadFile(url, dest) {
    return new Promise((resolve, reject) => {
        console.log(`📥 Downloading: ${path.basename(dest)}`);
        const file = createWriteStream(dest);

        https.get(url, {
            headers: { 'User-Agent': 'FoxTubeGen/1.0' }
        }, (response) => {
            // Handle redirects
            if (response.statusCode === 301 || response.statusCode === 302) {
                console.log(`  ↪ Redirecting...`);
                return downloadFile(response.headers.location, dest).then(resolve).catch(reject);
            }

            const totalBytes = parseInt(response.headers['content-length'], 10);
            let downloadedBytes = 0;

            response.on('data', (chunk) => {
                downloadedBytes += chunk.length;
                const percent = ((downloadedBytes / totalBytes) * 100).toFixed(1);
                process.stdout.write(`\r  Progress: ${percent}% (${(downloadedBytes / 1024 / 1024).toFixed(1)} MB)`);
            });

            response.pipe(file);

            file.on('finish', () => {
                file.close();
                console.log(`\n✅ Downloaded: ${path.basename(dest)}`);
                resolve();
            });
        }).on('error', (err) => {
            fs.unlink(dest, () => { }); // Delete partial file
            reject(err);
        });
    });
}

async function main() {
    // Create directories
    if (!fs.existsSync(RAW_DIR)) fs.mkdirSync(RAW_DIR, { recursive: true });
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

    console.log('🚀 VidProM + Lunara Dataset Downloader\n');
    console.log(`Total download size: ~${DATASETS.vidprom.sizeMB + DATASETS.lunara.sizeMB} MB\n`);

    // Download VidProM
    const vidpromPath = path.join(RAW_DIR, DATASETS.vidprom.filename);
    if (!fs.existsSync(vidpromPath)) {
        await downloadFile(DATASETS.vidprom.url, vidpromPath);
    } else {
        console.log(`⏭️  Skipping VidProM (already exists)`);
    }

    // Download Lunara
    const lunaraPath = path.join(RAW_DIR, DATASETS.lunara.filename);
    if (!fs.existsSync(lunaraPath)) {
        await downloadFile(DATASETS.lunara.url, lunaraPath);
    } else {
        console.log(`⏭️  Skipping Lunara (already exists)`);
    }

    console.log('\n🎉 Downloads complete! Run `npm run curate-prompts` to process.');
}

main().catch(console.error);
