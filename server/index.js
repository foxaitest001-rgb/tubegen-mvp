const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const path = require('path');

puppeteer.use(StealthPlugin());

const app = express();
const PORT = 3001;

// Enable CORS/JSON
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// DUAL OUTPUT DIRS
const PUBLIC_OUTPUT_DIR = path.join(__dirname, '..', 'public', 'output');
const SERVER_OUTPUT_DIR = path.join(__dirname, 'output'); // User requested location

if (!fs.existsSync(PUBLIC_OUTPUT_DIR)) fs.mkdirSync(PUBLIC_OUTPUT_DIR, { recursive: true });
if (!fs.existsSync(SERVER_OUTPUT_DIR)) fs.mkdirSync(SERVER_OUTPUT_DIR, { recursive: true });

// --- SSE LOGGING SYSTEM ---
let clients = [];

function sendEvent(data) {
    clients.forEach(client => client.res.write(`data: ${JSON.stringify(data)}\n\n`));
}

function directorLog(sceneNum, type, message) {
    const time = new Date().toLocaleTimeString();
    const log = `[${time}] [SCENE ${sceneNum}] [${type}] ${message}`;
    console.log(log); // Keep server console log

    // Broadcast to frontend
    sendEvent({
        type: 'log',
        message: log,
        timestamp: Date.now()
    });
}

// --- CONTROLS ---
let directorState = {
    paused: false,
    stopped: false,
    restart: false
};

// Check pause/stop status, returns true if RESTART requested
async function checkControlState() {
    if (directorState.stopped) throw new Error("Director Stopped by User.");
    if (directorState.restart) return true;

    let pauseLogCount = 0;
    while (directorState.paused) {
        if (directorState.stopped) throw new Error("Director Stopped during Pause.");
        if (directorState.restart) return true;

        if (pauseLogCount % 5 === 0) {
            directorLog(0, "PAUSED", "Waiting for Resume... (Press '▶ RESUME')");
        }
        pauseLogCount++;
        await new Promise(r => setTimeout(r, 1000));
    }
    return false;
}

// Helper: Interruptible Sleep (Breaks instantly on Restart)
async function interruptibleSleep(ms) {
    const start = Date.now();
    while (Date.now() - start < ms) {
        if (directorState.restart || directorState.stopped) return;
        await new Promise(r => setTimeout(r, 200)); // Check every 200ms
    }
}

// --- THE DIRECTOR AGENT (V2: Flat Queue Architecture) ---
async function generateVideo(tasks) {
    directorState.stopped = false;
    directorState.paused = false;
    directorState.restart = false;
    directorLog(0, "INIT", "Initializing Director Agent...");

    const browser = await puppeteer.launch({
        headless: false,
        userDataDir: "./user_data",
        defaultViewport: null,
        args: [
            '--start-maximized',
            '--disable-web-security',
            '--disable-features=IsolateOrigins,site-per-process',
            '--mute-audio',
            '--no-default-browser-check'
        ]
    });

    const page = await browser.newPage();
    await page.setBypassCSP(true);

    try {
        await page.goto('https://www.meta.ai', { waitUntil: 'domcontentloaded', timeout: 0 });

        directorLog(0, "AUTH", "Waiting 5s for page warmup...");
        await interruptibleSleep(5000);

        const inputSelector = 'textarea, div[contenteditable="true"], div[role="textbox"]';

        try {
            await page.waitForSelector(inputSelector, { timeout: 5000 });
            directorLog(0, "READY", "Input box detected.");
        } catch (e) {
            directorLog(0, "WARN", "Input box not detected yet. Proceeding anyway.");
        }

        // 0. FLATTEN TASKS -> SHOT QUEUE
        let shotQueue = [];
        for (let i = 0; i < tasks.length; i++) {
            const task = tasks[i];
            const sceneNum = i + 1;
            const prompts = task.video_prompts || [];

            for (let j = 0; j < prompts.length; j++) {
                shotQueue.push({
                    sceneNum: sceneNum,
                    shotNum: j + 1,
                    prompt: prompts[j]
                });
            }
        }

        directorLog(0, "PLAN", `📋 Blueprint: ${shotQueue.length} Total Shots queued.`);

        // 1. EXECUTION LOOP
        let currentShotIndex = 0;

        while (currentShotIndex < shotQueue.length) {

            // CHECK RESTART
            if (directorState.restart) {
                directorLog(0, "RESTART", "🔄 Restarting Sequence from Shot 1...");
                currentShotIndex = 0; // Reset
                directorState.restart = false; // Ack
                await interruptibleSleep(1000);
                continue;
            }

            if (await checkControlState()) continue; // If restart, loop top handles it

            const job = shotQueue[currentShotIndex];
            const { sceneNum, shotNum, prompt } = job;

            directorLog(sceneNum, "ACTION", `🎬 Starting Shot ${shotNum} (Progress: ${currentShotIndex + 1}/${shotQueue.length})`);

            try {
                // FOCUS & CLEAR INPUT
                let inputElement = null;
                try {
                    inputElement = await page.waitForSelector(inputSelector, { timeout: 5000 });
                } catch (e) { /* ignore */ }

                if (inputElement) {
                    await inputElement.click();
                    await inputElement.focus();

                    // CLEAR TEXT
                    await page.keyboard.down('Control');
                    await page.keyboard.press('A');
                    await page.keyboard.up('Control');
                    await page.keyboard.press('Backspace');
                    await new Promise(r => setTimeout(r, 200));
                }

                if (await checkControlState()) continue;

                // TYPE
                const cleanPrompt = prompt.replace(/^Shot\s+\d+(\s*\(.*?\))?:?\s*/i, "").trim();
                const fullPrompt = `Create a photorealistic video (16:9 cinematic): ${cleanPrompt}`;
                await page.keyboard.type(fullPrompt, { delay: 30 });
                await new Promise(r => setTimeout(r, 500));

                // SEND
                await page.keyboard.press('Enter');
                directorLog(sceneNum, `Shot ${shotNum}`, "Generating... (15s minimum)");

                // WAIT
                await interruptibleSleep(90000);
                if (directorState.restart) continue;

                // DOWNLOAD
                try {
                    let videoSrcs = [];
                    let retryCount = 0;

                    while (retryCount < 3 && videoSrcs.length === 0) {
                        if (directorState.restart) break;
                        try {
                            // SCROLL TO BOTTOM OF PAGE FIRST (to find latest video)
                            await page.evaluate(() => {
                                window.scrollTo(0, document.body.scrollHeight);
                            });
                            await new Promise(r => setTimeout(r, 1000)); // Wait for scroll

                            // Find all videos and get the LAST one (most recent)
                            videoSrcs = await page.evaluate(() => {
                                const videos = Array.from(document.querySelectorAll('video'));
                                return videos.filter(v => v.src && v.src.length > 5).map(v => v.src);
                            });

                            if (videoSrcs.length === 0) {
                                directorLog(sceneNum, `Shot ${shotNum}`, `⚠️ No videos found. Scrolling and retrying (${retryCount + 1}/3)...`);
                                await interruptibleSleep(10000);
                                retryCount++;
                            }
                        } catch (e) { break; }
                    }

                    if (directorState.restart) continue;

                    if (videoSrcs.length > 0) {
                        // GET THE LAST VIDEO (most recently generated, at bottom of page)
                        const latestVideoSrc = videoSrcs[videoSrcs.length - 1];

                        directorLog(sceneNum, `Shot ${shotNum}`, `📥 Found ${videoSrcs.length} videos. Downloading LATEST (bottom of page)...`);

                        const src = latestVideoSrc;

                        const client = await page.target().createCDPSession();
                        // Default to PUBLIC output for browser downloads
                        await client.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: PUBLIC_OUTPUT_DIR });

                        const videoElem = await page.evaluateHandle((src) => {
                            return Array.from(document.querySelectorAll('video')).find(v => v.src === src);
                        }, src);
                        if (videoElem) { await videoElem.hover(); await new Promise(r => setTimeout(r, 1000)); }

                        let dlBtn = null;
                        const pollStart = Date.now();
                        while (Date.now() - pollStart < 60000) {
                            if (directorState.restart) break;
                            const selectors = ['[aria-label="Download"]', '[aria-label="Save"]', 'div[role="button"][aria-label="Download"]', '[aria-label="Download media"]', 'div[role="button"][aria-label="Download media"]'];
                            for (const sel of selectors) { dlBtn = await page.$(sel); if (dlBtn) break; }
                            if (dlBtn) break;
                            await interruptibleSleep(2000);
                        }

                        if (directorState.restart) continue;

                        if (dlBtn) {
                            await dlBtn.click();
                            directorLog(sceneNum, `Shot ${shotNum}`, `✅ Download Clicked.`);
                            await interruptibleSleep(10000);

                            // RENAME Logic (Apply to both dirs)
                            try {
                                // 1. Handle Public Dir
                                const files = fs.readdirSync(PUBLIC_OUTPUT_DIR);
                                const sortedFiles = files
                                    .map(fileName => ({ name: fileName, time: fs.statSync(path.join(PUBLIC_OUTPUT_DIR, fileName)).mtime.getTime() }))
                                    .sort((a, b) => b.time - a.time);
                                const candidates = sortedFiles.filter(f => !f.name.startsWith('scene_'));

                                if (candidates.length > 0) {
                                    const newestFile = candidates[0];
                                    if (Date.now() - newestFile.time < 60000) {
                                        const oldPath = path.join(PUBLIC_OUTPUT_DIR, newestFile.name);
                                        const extension = path.extname(newestFile.name);
                                        const newFilename = `scene_${sceneNum}_shot_${shotNum}${extension}`;

                                        const publicPath = path.join(PUBLIC_OUTPUT_DIR, newFilename);
                                        const serverPath = path.join(SERVER_OUTPUT_DIR, newFilename); // Mirror copy

                                        if (fs.existsSync(publicPath)) fs.unlinkSync(publicPath);
                                        fs.renameSync(oldPath, publicPath); // Rename in public

                                        // Copy to server/output for user convenience
                                        fs.copyFileSync(publicPath, serverPath);

                                        directorLog(sceneNum, `Shot ${shotNum}`, `📂 Saved: ${newFilename} (to public & server/output)`);
                                    }
                                }
                            } catch (e) { console.error(e); }

                        } else {
                            directorLog(sceneNum, `Shot ${shotNum}`, `❌ Download button missing.`);
                        }
                    } else {
                        throw new Error("No videos rendered.");
                    }

                } catch (dlErr) {
                    directorLog(sceneNum, `WARN`, `Download failed: ${dlErr.message}`);
                }
                currentShotIndex++;
            } catch (shotError) {
                directorLog(sceneNum, `ERROR`, `Shot failed: ${shotError.message}`);
                currentShotIndex++;
            }
        }

        directorLog(0, "DONE", "All scenes completed.");

    } catch (error) {
        if (error.message && error.message.includes("Stopped")) {
            directorLog(0, "STOPPED", "🛑 Process stopped by user.");
        } else {
            console.error("[DIRECTOR] ❌ Error:", error);
            directorLog(0, "ERROR", error.message);
        }
    }
}

// --- API ENDPOINTS ---
app.get('/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    const clientId = Date.now();
    clients.push({ id: clientId, res });
    res.write(`data: ${JSON.stringify({ type: 'connected', message: 'Connected to Director Agent' })}\n\n`);
    req.on('close', () => { clients = clients.filter(c => c.id !== clientId); });
});

app.post('/control', (req, res) => {
    const { action } = req.body;
    if (action === 'pause') {
        directorState.paused = true;
        directorLog(0, "CTRL", "⏸️ Paused");
    } else if (action === 'resume') {
        directorState.paused = false;
        directorLog(0, "CTRL", "▶️ Resumed");
    } else if (action === 'stop') {
        directorState.stopped = true;
        directorState.paused = false;
        directorLog(0, "CTRL", "🛑 Stopping...");
    } else if (action === 'restart') {
        directorState.restart = true;
        directorState.paused = false;
        directorState.stopped = false;
        directorLog(0, "CTRL", "🔄 RESTART Requested...");
    }
    res.json({ status: "ok", state: directorState });
});

app.post('/generate-video', async (req, res) => {
    const { scriptData } = req.body;
    if (!scriptData || !scriptData.structure) return res.status(400).json({ error: "Invalid data" });
    directorState.paused = false;
    directorState.stopped = false;
    generateVideo(scriptData.structure).catch(console.error);
    res.json({ status: "started", message: "Director Agent started." });
});

app.post('/save-audio', async (req, res) => {
    try {
        const { filename, audioData } = req.body;
        if (!filename || !audioData) return res.status(400).json({ error: "Missing data" });

        const base64Data = audioData.split(';base64,').pop();

        // Save to BOTH locations
        const publicPath = path.join(PUBLIC_OUTPUT_DIR, filename);
        const serverPath = path.join(SERVER_OUTPUT_DIR, filename);

        fs.writeFileSync(publicPath, Buffer.from(base64Data, 'base64'));
        fs.writeFileSync(serverPath, Buffer.from(base64Data, 'base64'));

        console.log(`[API] Saved Audio: ${filename} (Dual Location)`);
        res.json({ success: true, filepath: publicPath });
    } catch (e) {
        console.error("Save Audio Error:", e);
        res.status(500).json({ error: e.message });
    }
});

app.listen(PORT, () => {
    console.log(`[DIRECTOR AGENT] Server running on http://localhost:${PORT}`);
    console.log(`[DIRECTOR AGENT] Output Dirs: \n - Public: ${PUBLIC_OUTPUT_DIR} \n - Server: ${SERVER_OUTPUT_DIR}`);
});
