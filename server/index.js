const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const path = require('path');

puppeteer.use(StealthPlugin());

const app = express();
const PORT = 3001;
const VERSION = 'v2.4';

// Enable CORS/JSON
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// DUAL OUTPUT DIRS (Base directories)
const PUBLIC_OUTPUT_DIR = path.join(__dirname, '..', 'public', 'output');
const SERVER_OUTPUT_DIR = path.join(__dirname, 'output');

if (!fs.existsSync(PUBLIC_OUTPUT_DIR)) fs.mkdirSync(PUBLIC_OUTPUT_DIR, { recursive: true });
if (!fs.existsSync(SERVER_OUTPUT_DIR)) fs.mkdirSync(SERVER_OUTPUT_DIR, { recursive: true });

// Current project folder (set when generation starts)
let currentProjectDir = {
    public: PUBLIC_OUTPUT_DIR,
    server: SERVER_OUTPUT_DIR,
    name: null
};

// Helper: Create project folder from title
function createProjectFolder(title) {
    if (!title) title = `project_${Date.now()}`;

    // Sanitize title for folder name
    const safeName = title
        .substring(0, 50)
        .replace(/[<>:"/\\|?*]/g, '')
        .replace(/\s+/g, '_')
        .toLowerCase();

    const timestamp = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const folderName = `${timestamp}_${safeName}`;

    const publicDir = path.join(PUBLIC_OUTPUT_DIR, folderName);
    const serverDir = path.join(SERVER_OUTPUT_DIR, folderName);

    if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir, { recursive: true });
    if (!fs.existsSync(serverDir)) fs.mkdirSync(serverDir, { recursive: true });

    currentProjectDir = {
        public: publicDir,
        server: serverDir,
        name: folderName
    };

    console.log(`[PROJECT] Created folder: ${folderName}`);
    return currentProjectDir;
}

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

// --- FFmpeg Video Assembly ---
const { exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);

async function assembleVideo(projectDir) {
    const outputDir = projectDir.server;
    const projectName = projectDir.name;

    directorLog(0, "ASSEMBLE", "🎬 Starting FFmpeg Video Assembly...");

    try {
        // Find all video files (scene_X_shot_Y.mp4)
        const files = fs.readdirSync(outputDir);
        const videoFiles = files
            .filter(f => f.endsWith('.mp4') && f.startsWith('scene_'))
            .sort((a, b) => {
                // Sort by scene then shot number
                const parseNums = (name) => {
                    const match = name.match(/scene_(\d+)_shot_(\d+)/);
                    return match ? [parseInt(match[1]), parseInt(match[2])] : [0, 0];
                };
                const [as, ash] = parseNums(a);
                const [bs, bsh] = parseNums(b);
                return as !== bs ? as - bs : ash - bsh;
            });

        if (videoFiles.length === 0) {
            directorLog(0, "WARN", "No video files found for assembly");
            return null;
        }

        directorLog(0, "ASSEMBLE", `Found ${videoFiles.length} video files to assemble`);

        // Create concat list file
        const listPath = path.join(outputDir, 'concat_list.txt');
        const listContent = videoFiles.map(f => `file '${f}'`).join('\n');
        fs.writeFileSync(listPath, listContent);
        directorLog(0, "ASSEMBLE", "✓ Created concat list");

        // Run FFmpeg concat
        const finalPath = path.join(outputDir, 'final_video.mp4');
        const ffmpegCmd = `ffmpeg -f concat -safe 0 -i "${listPath}" -c copy "${finalPath}" -y`;

        directorLog(0, "ASSEMBLE", `Running FFmpeg: ${ffmpegCmd.substring(0, 60)}...`);

        try {
            const { stdout, stderr } = await execAsync(ffmpegCmd, {
                cwd: outputDir,
                timeout: 300000 // 5 min timeout
            });

            if (fs.existsSync(finalPath)) {
                const stats = fs.statSync(finalPath);
                const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
                directorLog(0, "ASSEMBLE", `✅ Final video created: final_video.mp4 (${sizeMB}MB)`);

                // Clean up list file
                fs.unlinkSync(listPath);

                return {
                    path: finalPath,
                    name: 'final_video.mp4',
                    size: stats.size
                };
            } else {
                directorLog(0, "ERROR", "FFmpeg completed but final video not found");
                return null;
            }
        } catch (ffmpegErr) {
            directorLog(0, "ERROR", `FFmpeg failed: ${ffmpegErr.message}`);
            return null;
        }

    } catch (e) {
        directorLog(0, "ERROR", `Assembly error: ${e.message}`);
        return null;
    }
}

// --- THE DIRECTOR AGENT (V2: Flat Queue Architecture) ---
async function generateVideo(tasks, projectDir, visualStyle = 'Cinematic photorealistic') {
    // Use provided project dir or current
    const outputPublic = projectDir?.public || currentProjectDir.public;
    const outputServer = projectDir?.server || currentProjectDir.server;

    directorState.stopped = false;
    directorState.paused = false;
    directorState.restart = false;
    directorLog(0, "INIT", `Initializing Director Agent...`);
    directorLog(0, "PROJECT", `Output folder: ${projectDir?.name || 'default'}`);
    directorLog(0, "STYLE", `Visual Style: ${visualStyle}`);

    let browser;
    let page;

    // Try to connect to existing Chrome first (RDP mode)
    try {
        directorLog(0, "BROWSER", "Trying to connect to existing Chrome...");
        browser = await puppeteer.connect({
            browserURL: 'http://localhost:9222',
            defaultViewport: null
        });

        // Get existing pages and find Meta.ai tab or create new
        const pages = await browser.pages();
        page = pages.find(p => p.url().includes('meta.ai'));

        if (page) {
            directorLog(0, "BROWSER", "✅ Connected to existing Meta.ai tab!");
        } else {
            // Use any existing page or create new
            page = pages[0] || await browser.newPage();
            directorLog(0, "BROWSER", "Connected to existing Chrome, opening Meta.ai...");
            await page.goto('https://www.meta.ai', { waitUntil: 'domcontentloaded', timeout: 0 });
        }
    } catch (e) {
        // Fallback: Launch new browser (local mode)
        directorLog(0, "BROWSER", "No existing Chrome found, launching new browser...");
        browser = await puppeteer.launch({
            headless: false,
            userDataDir: "./user_data",
            defaultViewport: null,
            args: [
                '--start-maximized',
                '--disable-web-security',
                '--disable-features=IsolateOrigins,site-per-process',
                '--mute-audio',
                '--no-default-browser-check',
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu'
            ]
        });

        page = await browser.newPage();
        await page.goto('https://www.meta.ai', { waitUntil: 'domcontentloaded', timeout: 0 });
    }

    await page.setBypassCSP(true);

    directorLog(0, "STEP", "✓ Browser connected, CSP bypassed");
    directorLog(0, "STEP", "⏳ Waiting 5s for page warmup...");
    await interruptibleSleep(5000);

    const inputSelector = 'textarea, div[contenteditable="true"], div[role="textbox"]';

    try {
        await page.waitForSelector(inputSelector, { timeout: 5000 });
        directorLog(0, "STEP", "✓ Input box detected - Meta.ai ready!");
    } catch (e) {
        directorLog(0, "WARN", "⚠️ Input box not detected. You may need to log in via VNC.");
    }

    try {
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
                directorLog(sceneNum, "STEP", "📍 Step 1: Finding input box...");

                // FOCUS & CLEAR INPUT
                let inputElement = null;
                try {
                    inputElement = await page.waitForSelector(inputSelector, { timeout: 5000 });
                    directorLog(sceneNum, "STEP", "✓ Input box found");
                } catch (e) {
                    directorLog(sceneNum, "WARN", "⚠️ Input box not found, retrying...");
                }

                if (inputElement) {
                    directorLog(sceneNum, "STEP", "📍 Step 2: Focusing and clearing input...");
                    await inputElement.click();
                    await inputElement.focus();

                    // CLEAR TEXT
                    await page.keyboard.down('Control');
                    await page.keyboard.press('A');
                    await page.keyboard.up('Control');
                    await page.keyboard.press('Backspace');
                    await new Promise(r => setTimeout(r, 200));
                    directorLog(sceneNum, "STEP", "✓ Input cleared");
                }

                if (await checkControlState()) continue;

                // TYPE
                const cleanPrompt = prompt.replace(/^Shot\s+\d+(\s*\(.*?\))?:?\s*/i, "").trim();

                // Build prompt prefix based on visual style
                let stylePrefix = 'Create a photorealistic video (16:9 cinematic)';
                const lowerStyle = visualStyle.toLowerCase();
                if (lowerStyle.includes('2d') || lowerStyle.includes('animated')) {
                    stylePrefix = 'Create a 2D animated video (16:9, motion graphics, vibrant colors)';
                } else if (lowerStyle.includes('anime')) {
                    stylePrefix = 'Create an anime-style video (16:9, Japanese animation, cel-shaded)';
                } else if (lowerStyle.includes('3d') || lowerStyle.includes('cgi')) {
                    stylePrefix = 'Create a 3D CGI video (16:9, Pixar-quality, smooth textures)';
                } else if (lowerStyle.includes('horror')) {
                    stylePrefix = 'Create a dark atmospheric video (16:9, horror style, unsettling)';
                } else if (lowerStyle.includes('retro')) {
                    stylePrefix = 'Create a retro-style video (16:9, vintage 80s aesthetic, film grain)';
                } else if (lowerStyle.includes('documentary')) {
                    stylePrefix = 'Create a documentary-style video (16:9, raw footage, natural lighting)';
                }

                const fullPrompt = `${stylePrefix}: ${cleanPrompt}`;

                directorLog(sceneNum, "STEP", `📍 Step 3: Typing prompt (${fullPrompt.length} chars)...`);
                await page.keyboard.type(fullPrompt, { delay: 30 });
                await new Promise(r => setTimeout(r, 500));
                directorLog(sceneNum, "STEP", "✓ Prompt typed");

                // SEND
                directorLog(sceneNum, "STEP", "📍 Step 4: Sending prompt to Meta.ai...");
                await page.keyboard.press('Enter');
                directorLog(sceneNum, "STEP", "✓ Prompt sent! Waiting 30s for video generation...");

                // WAIT - Reduced from 90s to 30s
                await interruptibleSleep(30000);
                if (directorState.restart) continue;

                // DOWNLOAD (Improved: Scroll first, wait for NEW video, track downloads)
                try {
                    directorLog(sceneNum, "STEP", "📍 Step 5: Scrolling to bottom of page...");

                    // FIRST: Scroll to bottom of page to see new content
                    await page.evaluate(() => {
                        window.scrollTo(0, document.body.scrollHeight);
                    });
                    await new Promise(r => setTimeout(r, 2000));
                    directorLog(sceneNum, "STEP", "✓ Scrolled to bottom");

                    // Get count of videos BEFORE generation completes
                    const videoCountBefore = await page.evaluate(() => {
                        return document.querySelectorAll('video').length;
                    });

                    directorLog(sceneNum, "STEP", `📍 Step 6: Detecting new video... (Found ${videoCountBefore} existing)`);

                    // Wait for a NEW video to appear (poll every 5s)
                    let newVideoFound = false;
                    let retryCount = 0;
                    const maxRetries = 12; // 12 * 5s = 60s max additional wait

                    while (!newVideoFound && retryCount < maxRetries) {
                        if (directorState.restart) break;

                        // Scroll down again to ensure we see new content
                        await page.evaluate(() => {
                            window.scrollTo(0, document.body.scrollHeight);
                        });
                        await new Promise(r => setTimeout(r, 1000));

                        // Check for new videos
                        const currentInfo = await page.evaluate((prevCount) => {
                            const videos = Array.from(document.querySelectorAll('video'));
                            const validVideos = videos.filter(v => v.src && v.src.length > 10 && !v.src.startsWith('blob:'));
                            return {
                                count: videos.length,
                                validCount: validVideos.length,
                                hasNew: videos.length > prevCount,
                                latestSrc: validVideos.length > 0 ? validVideos[validVideos.length - 1].src : null
                            };
                        }, videoCountBefore);

                        if (currentInfo.validCount > 0 && (currentInfo.hasNew || retryCount > 2)) {
                            newVideoFound = true;
                            directorLog(sceneNum, `Shot ${shotNum}`, `✅ New video detected! (${currentInfo.validCount} valid videos)`);
                        } else {
                            retryCount++;
                            directorLog(sceneNum, `Shot ${shotNum}`, `⏳ Waiting for video... (${retryCount * 5}s / 60s max)`);
                            await interruptibleSleep(5000); // 5 second intervals instead of 10
                        }
                    }

                    if (directorState.restart) continue;

                    // NOW get the LAST video on the page (bottom-most = most recent)
                    const latestVideoSrc = await page.evaluate(() => {
                        const videos = Array.from(document.querySelectorAll('video'));
                        // Filter for valid video sources (not blob:, has actual URL)
                        const validVideos = videos.filter(v => v.src && v.src.length > 10 && !v.src.startsWith('blob:'));
                        if (validVideos.length === 0) return null;

                        // Get the LAST one (most recent, at bottom of page)
                        const lastVideo = validVideos[validVideos.length - 1];

                        // Scroll this video into view
                        lastVideo.scrollIntoView({ behavior: 'smooth', block: 'center' });

                        return lastVideo.src;
                    });

                    if (!latestVideoSrc) {
                        throw new Error("No valid video source found after waiting.");
                    }

                    directorLog(sceneNum, "STEP", `📍 Step 7: Hovering over video element...`);

                    // Hover over the video element to reveal download button
                    const videoElem = await page.evaluateHandle((src) => {
                        const videos = Array.from(document.querySelectorAll('video'));
                        return videos.find(v => v.src === src);
                    }, latestVideoSrc);

                    if (videoElem) {
                        await videoElem.hover();
                        await new Promise(r => setTimeout(r, 1500));
                        directorLog(sceneNum, "STEP", "✓ Hovering over video");
                    }

                    directorLog(sceneNum, "STEP", `📍 Step 8: Setting download directory...`);
                    directorLog(sceneNum, "STEP", `   Target folder: ${outputPublic}`);

                    // Set download directory to project folder
                    const client = await page.target().createCDPSession();
                    await client.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: outputPublic });
                    directorLog(sceneNum, "STEP", "✓ Download directory configured");

                    directorLog(sceneNum, "STEP", `📍 Step 9: Finding download button...`);
                    let dlBtn = null;
                    const pollStart = Date.now();
                    while (Date.now() - pollStart < 30000) {
                        if (directorState.restart) break;

                        const selectors = [
                            '[aria-label="Download"]',
                            '[aria-label="Save"]',
                            'div[role="button"][aria-label="Download"]',
                            '[aria-label="Download media"]',
                            'div[role="button"][aria-label="Download media"]'
                        ];

                        for (const sel of selectors) {
                            const buttons = await page.$$(sel);
                            if (buttons.length > 0) {
                                // Get the LAST download button (most recent video's button)
                                dlBtn = buttons[buttons.length - 1];
                                break;
                            }
                        }
                        if (dlBtn) break;
                        await new Promise(r => setTimeout(r, 2000));
                    }

                    if (directorState.restart) continue;

                    if (dlBtn) {
                        directorLog(sceneNum, "STEP", `📍 Step 10: Clicking download button...`);
                        await dlBtn.click();
                        directorLog(sceneNum, "STEP", `✓ Download clicked! Waiting 10s for file...`);
                        await interruptibleSleep(10000);

                        directorLog(sceneNum, "STEP", `📍 Step 11: Renaming downloaded file...`);
                        // RENAME Logic - save to project folder
                        try {
                            const files = fs.readdirSync(outputPublic);
                            const sortedFiles = files
                                .map(fileName => ({ name: fileName, time: fs.statSync(path.join(outputPublic, fileName)).mtime.getTime() }))
                                .sort((a, b) => b.time - a.time);
                            const candidates = sortedFiles.filter(f => !f.name.startsWith('scene_'));

                            if (candidates.length > 0) {
                                const newestFile = candidates[0];
                                if (Date.now() - newestFile.time < 60000) {
                                    const oldPath = path.join(outputPublic, newestFile.name);
                                    const extension = path.extname(newestFile.name);
                                    const newFilename = `scene_${sceneNum}_shot_${shotNum}${extension}`;

                                    const publicPath = path.join(outputPublic, newFilename);
                                    const serverPath = path.join(outputServer, newFilename);

                                    if (fs.existsSync(publicPath)) fs.unlinkSync(publicPath);
                                    fs.renameSync(oldPath, publicPath);
                                    fs.copyFileSync(publicPath, serverPath);

                                    directorLog(sceneNum, "STEP", `✅ COMPLETE: Saved ${newFilename}`);
                                    directorLog(sceneNum, "STEP", `   Location: ${outputPublic}`);
                                } else {
                                    directorLog(sceneNum, "WARN", `⚠️ Downloaded file too old, may have failed`);
                                }
                            } else {
                                directorLog(sceneNum, "WARN", `⚠️ No new files found to rename`);
                            }
                        } catch (e) {
                            directorLog(sceneNum, "ERROR", `Rename failed: ${e.message}`);
                        }

                    } else {
                        directorLog(sceneNum, "STEP", `❌ Download button not found after 30s`);
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

        // Run FFmpeg assembly to create final video
        const finalVideo = await assembleVideo(projectDir);

        // Send completion event with file list for auto-download
        try {
            const files = fs.readdirSync(outputPublic);
            let fileList = files.map(f => ({
                name: f,
                path: `/download/${encodeURIComponent(currentProjectDir.name)}/${encodeURIComponent(f)}`,
                size: fs.statSync(path.join(outputPublic, f)).size,
                isFinal: f === 'final_video.mp4'
            }));

            // Sort to put final_video.mp4 first for priority download
            fileList.sort((a, b) => (b.isFinal ? 1 : 0) - (a.isFinal ? 1 : 0));

            // Broadcast to all connected clients
            clients.forEach(client => {
                client.res.write(`data: ${JSON.stringify({
                    type: 'completed',
                    projectFolder: currentProjectDir.name,
                    files: fileList,
                    finalVideo: finalVideo ? finalVideo.name : null,
                    message: finalVideo
                        ? '🎬 Final video assembled! Downloading...'
                        : 'Generation complete! Downloading files...'
                })}\n\n`);
            });

            directorLog(0, "FILES", `📦 ${fileList.length} files ready for download${finalVideo ? ' (including final_video.mp4)' : ''}`);
        } catch (e) {
            console.error("File list error:", e);
        }

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

// --- FILE DOWNLOAD ENDPOINT ---
app.get('/download/:projectFolder/:filename', (req, res) => {
    try {
        const { projectFolder, filename } = req.params;
        const filePath = path.join(SERVER_OUTPUT_DIR, decodeURIComponent(projectFolder), decodeURIComponent(filename));

        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'File not found' });
        }

        // Set headers for download
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Content-Type', 'application/octet-stream');

        // Stream the file
        const fileStream = fs.createReadStream(filePath);
        fileStream.pipe(res);

        console.log(`[DOWNLOAD] Serving: ${projectFolder}/${filename}`);
    } catch (e) {
        console.error("Download error:", e);
        res.status(500).json({ error: e.message });
    }
});

// --- LIST PROJECT FILES ENDPOINT ---
app.get('/list-files/:projectFolder', (req, res) => {
    try {
        const { projectFolder } = req.params;
        const folderPath = path.join(SERVER_OUTPUT_DIR, decodeURIComponent(projectFolder));

        if (!fs.existsSync(folderPath)) {
            return res.json({ files: [], error: 'Project folder not found' });
        }

        const files = fs.readdirSync(folderPath).map(f => ({
            name: f,
            path: `/download/${encodeURIComponent(projectFolder)}/${encodeURIComponent(f)}`,
            size: fs.statSync(path.join(folderPath, f)).size
        }));

        res.json({ projectFolder, files });
    } catch (e) {
        console.error("List files error:", e);
        res.status(500).json({ error: e.message });
    }
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

    // Create project folder from first title option
    const title = scriptData.title_options?.[0] || scriptData.title || `video_${Date.now()}`;
    const projectDir = createProjectFolder(title);

    // Get visual style from script data (set by Consultant)
    const visualStyle = scriptData.visualStyle || 'Cinematic photorealistic';

    directorState.paused = false;
    directorState.stopped = false;
    generateVideo(scriptData.structure, projectDir, visualStyle).catch(console.error);
    res.json({ status: "started", message: "Director Agent started.", projectFolder: projectDir.name, visualStyle });
});

app.post('/save-audio', async (req, res) => {
    try {
        const { filename, audioData, projectName } = req.body;
        if (!filename || !audioData) return res.status(400).json({ error: "Missing data" });

        const base64Data = audioData.split(';base64,').pop();

        // Use current project folder or create one if projectName provided
        let targetPublic = currentProjectDir.public;
        let targetServer = currentProjectDir.server;

        if (projectName) {
            const projectDir = createProjectFolder(projectName);
            targetPublic = projectDir.public;
            targetServer = projectDir.server;
        }

        const publicPath = path.join(targetPublic, filename);
        const serverPath = path.join(targetServer, filename);

        fs.writeFileSync(publicPath, Buffer.from(base64Data, 'base64'));
        fs.writeFileSync(serverPath, Buffer.from(base64Data, 'base64'));

        console.log(`[API] Saved Audio: ${filename} -> ${currentProjectDir.name || 'default'}`);
        res.json({ success: true, filepath: publicPath, projectFolder: currentProjectDir.name });
    } catch (e) {
        console.error("Save Audio Error:", e);
        res.status(500).json({ error: e.message });
    }
});

app.listen(PORT, () => {
    console.log(`[DIRECTOR AGENT] ${VERSION} - Server running on http://localhost:${PORT}`);
    console.log(`[DIRECTOR AGENT] Output Dirs: \n - Public: ${PUBLIC_OUTPUT_DIR} \n - Server: ${SERVER_OUTPUT_DIR}`);
});
