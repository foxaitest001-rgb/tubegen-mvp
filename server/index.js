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
    restart: false,
    currentJobId: null,  // Unique ID for current job
    isRunning: false     // Track if Director is active
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

    directorLog(0, "ASSEMBLE", "🎬 Starting Advanced Audio/Video Assembly...");

    try {
        const files = fs.readdirSync(outputDir);
        const sceneMap = new Map(); // sceneNum -> { shots: [], audio: null }

        // 1. Group files by Scene
        files.forEach(f => {
            // Match: scene_1_shot_1.mp4
            if (f.startsWith('scene_') && f.endsWith('.mp4') && !f.includes('_final') && !f.includes('_visual')) {
                const match = f.match(/scene_(\d+)_shot_(\d+)/);
                if (match) {
                    const sceneNum = parseInt(match[1]);
                    if (!sceneMap.has(sceneNum)) sceneMap.set(sceneNum, { shots: [], audio: null });
                    sceneMap.get(sceneNum).shots.push(f);
                }
            }
            // Match: scene_1_audio.wav
            if (f.startsWith('scene_') && f.endsWith('_audio.wav')) {
                const match = f.match(/scene_(\d+)_audio\.wav/);
                if (match) {
                    const sceneNum = parseInt(match[1]);
                    if (!sceneMap.has(sceneNum)) sceneMap.set(sceneNum, { shots: [], audio: null });
                    sceneMap.get(sceneNum).audio = f;
                }
            }
        });

        const sortedScenes = Array.from(sceneMap.keys()).sort((a, b) => a - b);

        if (sortedScenes.length === 0) {
            directorLog(0, "WARN", "No scenes found for assembly");
            return null;
        }

        directorLog(0, "ASSEMBLE", `Processing ${sortedScenes.length} scenes with audio/visuals...`);

        const finalConcatList = [];
        const tempFiles = []; // Track temp files to clean up

        // 2. Process each scene
        for (const sceneNum of sortedScenes) {
            const data = sceneMap.get(sceneNum);

            // Sort shots: shot_1, shot_2...
            data.shots.sort((a, b) => {
                const getShot = s => parseInt(s.match(/shot_(\d+)/)[1] || 999);
                return getShot(a) - getShot(b);
            });

            if (data.shots.length === 0) continue;

            directorLog(sceneNum, "ASSEMBLE", `Combining ${data.shots.length} shots + ${data.audio ? 'Audio' : 'No Audio'}`);

            // Step A: Consolidate Visuals (Concat shots)
            let visualFile = data.shots[0];
            if (data.shots.length > 1) {
                const shotListPath = path.join(outputDir, `scene_${sceneNum}_shots.txt`);
                const shotListContent = data.shots.map(s => `file '${s}'`).join('\n');
                fs.writeFileSync(shotListPath, shotListContent);
                tempFiles.push(shotListPath);

                const mergedVisual = `scene_${sceneNum}_visual.mp4`;
                // Fast concat (copy)
                await execAsync(`ffmpeg -f concat -safe 0 -i "${shotListPath}" -c copy "${mergedVisual}" -y`, { cwd: outputDir });
                visualFile = mergedVisual;
                tempFiles.push(path.join(outputDir, mergedVisual));
            }

            // Step B: Merge Visual + Audio
            let sceneFinalFile = `scene_${sceneNum}_final.mp4`;

            if (data.audio) {
                // FORCE SYNC: Loop video to match audio length
                // -stream_loop -1: Loop video infinitely
                // -c:v libx264 -preset ultrafast: Re-encode video for reliable looping
                // -c:a aac: Re-encode audio to AAC
                // -shortest: Stop when audio stream ends
                const cmd = `ffmpeg -stream_loop -1 -i "${visualFile}" -i "${data.audio}" -c:v libx264 -preset ultrafast -c:a aac -shortest "${sceneFinalFile}" -y`;
                try {
                    await execAsync(cmd, { cwd: outputDir });
                    // Verify output
                    if (fs.existsSync(path.join(outputDir, sceneFinalFile)) && fs.statSync(path.join(outputDir, sceneFinalFile)).size > 1000) {
                        finalConcatList.push(`file '${sceneFinalFile}'`);
                        tempFiles.push(path.join(outputDir, sceneFinalFile));
                    } else {
                        throw new Error("Merged file too small or failed");
                    }
                } catch (e) {
                    console.error(`Audio merge failed for scene ${sceneNum}:`, e);
                    finalConcatList.push(`file '${visualFile}'`); // Fallback to visual only
                }
            } else {
                finalConcatList.push(`file '${visualFile}'`);
            }
        }

        // 3. Final Concatenation
        const listPath = path.join(outputDir, 'final_concat_list.txt');
        fs.writeFileSync(listPath, finalConcatList.join('\n'));
        directorLog(0, "ASSEMBLE", "✓ Final assembly started...");

        const finalPath = path.join(outputDir, 'final_video.mp4');
        const ffmpegCmd = `ffmpeg -f concat -safe 0 -i "${listPath}" -c copy "${finalPath}" -y`;

        try {
            await execAsync(ffmpegCmd, { cwd: outputDir });

            // Cleanup temp files
            try {
                fs.unlinkSync(listPath);
                tempFiles.forEach(f => { if (fs.existsSync(f)) fs.unlinkSync(f); });
            } catch (e) { }

            if (fs.existsSync(finalPath)) {
                const stats = fs.statSync(finalPath);
                const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
                directorLog(0, "ASSEMBLE", `✅ Final video created: final_video.mp4 (${sizeMB}MB)`);
                return { path: finalPath, name: 'final_video.mp4', size: stats.size };
            }
        } catch (e) {
            directorLog(0, "ERROR", `Final assembly failed: ${e.message}`);
            return null;
        }

    } catch (e) {
        directorLog(0, "ERROR", `Assembly error: ${e.message}`);
        return null;
    }
}

// --- THE DIRECTOR AGENT (V2: Flat Queue Architecture) ---
async function generateVideo(tasks, projectDir, visualStyle = 'Cinematic photorealistic', aspectRatio = '16:9', jobId = null) {
    // Use provided project dir or current
    const outputPublic = projectDir?.public || currentProjectDir.public;
    const outputServer = projectDir?.server || currentProjectDir.server;

    // Store jobId for this execution
    const myJobId = jobId || `job_${Date.now()}`;

    directorState.stopped = false;
    directorState.paused = false;
    directorState.restart = false;
    directorLog(0, "INIT", `Initializing Director Agent (Job: ${myJobId})...`);
    directorLog(0, "PROJECT", `Output folder: ${projectDir?.name || 'default'}`);
    directorLog(0, "STYLE", `Visual Style: ${visualStyle} | Aspect Ratio: ${aspectRatio}`);

    let browser;
    let page;

    // Try to connect to existing Chrome first (RDP mode)
    try {
        directorLog(0, "BROWSER", "Trying to connect to existing Chrome...");
        browser = await puppeteer.connect({
            browserURL: 'http://localhost:9222',
            defaultViewport: null
        });
        directorLog(0, "BROWSER", "✅ Connected to existing Chrome!");
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
    }

    // ENSURE PAGE IS OPEN
    const pages = await browser.pages();
    directorLog(0, "BROWSER", `Found ${pages.length} existing tabs.`);

    page = pages.find(p => p.url().includes('meta.ai'));

    if (!page) {
        directorLog(0, "BROWSER", "Meta.ai tab not found. Opening NEW tab...");
        // Always open a new tab to ensure visibility (don't recycle background pages)
        page = await browser.newPage();
        await page.goto('https://www.meta.ai', { waitUntil: 'domcontentloaded', timeout: 0 });
    } else {
        directorLog(0, "BROWSER", "✅ Reusing existing Meta.ai tab");
        await page.bringToFront(); // Ensure it is visible/active
    }

    await page.setBypassCSP(true);

    directorLog(0, "STEP", "✓ Browser connected, CSP bypassed");
    directorLog(0, "STEP", "⏳ Resetting session (New Chat)...");

    // NEW CHAT LOGIC (Reset context)
    try {
        await interruptibleSleep(2000);

        // Robust "New Chat" clicker using page execute
        const clicked = await page.evaluate(() => {
            // 1. Selector approach for top-left icons
            const selectors = [
                'a[href="/"]',
                'a[href="/new"]',
                'div[role="button"][aria-label="New chat"]',
                'div[role="button"][aria-label="New conversation"]',
                'div[aria-label="New chat"]',
                '[aria-label="Create new text"]',
                'div[role="button"] svg path[d*="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"]' // Plus icon approximation?
            ];

            for (const s of selectors) {
                const el = document.querySelector(s);
                if (el) { el.click(); return true; }
            }

            // 2. Text Search approach (Backup)
            const candidates = document.querySelectorAll('div, span, button, a');
            for (const el of candidates) {
                const txt = (el.innerText || '').trim().toLowerCase();
                if (txt === 'new chat' || txt === 'new conversation') {
                    el.click();
                    return true;
                }
            }
            return false;
        });

        if (clicked) {
            directorLog(0, "STEP", "✓ Clicked 'New Chat' button (via JS)");
        } else {
            // Check if we are already at root (no /c/ in URL)
            const currentUrl = page.url();
            if (!currentUrl.includes('/c/')) {
                directorLog(0, "STEP", "Already at New Chat (Root URL)");
            } else {
                directorLog(0, "STEP", "Using fallback: Force Navigating to meta.ai root...");
                await page.goto('https://www.meta.ai/', { waitUntil: 'domcontentloaded' });
            }
        }

        await interruptibleSleep(5000); // Increased wait for new chat to load

    } catch (err) {
        directorLog(0, "WARN", `New Chat reset failed: ${err.message}`);
    }

    directorLog(0, "STEP", "⏳ Waiting for input box...");

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

        shotLoop: while (currentShotIndex < shotQueue.length) {

            // CHECK RESTART
            if (directorState.restart) {
                directorLog(0, "RESTART", "🔄 Restarting Sequence from Shot 1...");
                currentShotIndex = 0; // Reset
                directorState.restart = false; // Ack
                await interruptibleSleep(1000);
                continue shotLoop;
            }

            if (await checkControlState()) continue shotLoop; // If restart, loop top handles it

            const job = shotQueue[currentShotIndex];
            const { sceneNum, shotNum, prompt } = job;

            // RETRY LOGIC: Try up to 3 times with prompt simplification
            const MAX_RETRIES = 3;
            let shotSuccess = false;
            let currentPrompt = prompt;

            for (let attempt = 1; attempt <= MAX_RETRIES && !shotSuccess; attempt++) {
                if (directorState.restart) break;

                if (attempt > 1) {
                    directorLog(sceneNum, "RETRY", `🔄 Retry ${attempt}/${MAX_RETRIES} for Shot ${shotNum}...`);
                    // Simplify prompt on retry - remove complex descriptors
                    currentPrompt = currentPrompt
                        .replace(/\d+mm film,?\s*/gi, '')
                        .replace(/shallow depth of field,?\s*/gi, '')
                        .replace(/movie quality,?\s*/gi, '')
                        .replace(/--ar 16:9,?\s*/gi, '')
                        .replace(/\(.*?\)/g, '')
                        .replace(/,\s*,/g, ',')
                        .trim();
                    if (attempt === 3) {
                        // Last attempt: super simple
                        currentPrompt = currentPrompt.split(',').slice(0, 2).join(', ') + ', cinematic video';
                    }
                    directorLog(sceneNum, "RETRY", `📝 Simplified prompt (${currentPrompt.length} chars)`);
                    await interruptibleSleep(3000); // Brief pause before retry
                }

                directorLog(sceneNum, "ACTION", `🎬 Starting Shot ${shotNum} (Progress: ${currentShotIndex + 1}/${shotQueue.length})${attempt > 1 ? ` [Attempt ${attempt}]` : ''}`);

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
                        directorLog(sceneNum, "STEP", "📍 Step 2: Focusing and clearing input (Robust)...");

                        // ROBUST FOCUS via JS (Bypasses "Node not clickable" errors)
                        await page.evaluate((sel) => {
                            // 1. Kill overlays/modals blocking the view
                            const blockers = document.querySelectorAll('div[role="dialog"], div[role="banner"], div[aria-modal="true"], [class*="overlay"]');
                            blockers.forEach(el => el.remove());

                            // 2. Focus directly
                            const el = document.querySelector(sel);
                            if (el) {
                                el.focus();
                                el.click(); // Soft click logic
                            }
                        }, inputSelector);

                        // Ensure we are focused before typing
                        await interruptibleSleep(500);

                        // CLEAR TEXT
                        await page.keyboard.down('Control');
                        await page.keyboard.press('A');
                        await page.keyboard.up('Control');
                        await page.keyboard.press('Backspace');
                        await new Promise(r => setTimeout(r, 200));
                        directorLog(sceneNum, "STEP", "✓ Input cleared");
                    }

                    if (await checkControlState()) continue shotLoop;

                    // TYPE - Use currentPrompt (may be simplified on retries)
                    const cleanPrompt = currentPrompt.replace(/^Shot\s+\d+(\s*\(.*?\))?:?\s*/i, "").trim();

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
                    if (directorState.restart) continue shotLoop;

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

                        if (directorState.restart) continue shotLoop;

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

                        if (directorState.restart) continue shotLoop;

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
                                        shotSuccess = true; // Mark as successful!
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
                } catch (shotError) {
                    directorLog(sceneNum, `ERROR`, `Shot attempt failed: ${shotError.message}`);
                }
            } // End of retry loop

            // Only advance to next shot if successful, otherwise log final failure
            if (shotSuccess) {
                currentShotIndex++;
            } else {
                directorLog(sceneNum, "ERROR", `❌ Shot ${shotNum} failed after ${MAX_RETRIES} attempts. Skipping.`);
                currentShotIndex++; // Skip this shot after all retries exhausted
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
    } else if (action === 'stop' || action === 'cancel') {
        directorState.stopped = true;
        directorState.paused = false;
        directorState.isRunning = false;
        directorLog(0, "CTRL", "🛑 Stopping current job...");
    } else if (action === 'restart') {
        directorState.restart = true;
        directorState.paused = false;
        directorState.stopped = false;
        directorLog(0, "CTRL", "🔄 RESTART Requested...");
    }
    res.json({ status: "ok", state: directorState });
});

// Get current Director status
app.get('/status', (req, res) => {
    res.json({
        isRunning: directorState.isRunning,
        paused: directorState.paused,
        stopped: directorState.stopped,
        currentJobId: directorState.currentJobId
    });
});

// Upload Audio Endpoint (For Client -> Server audio transfer)
app.post('/upload-audio', express.raw({ type: 'audio/wav', limit: '50mb' }), (req, res) => {
    const { sceneNum, jobId } = req.query;
    if (!directorState.isRunning || !directorState.currentJobId) {
        return res.status(400).json({ error: "No active job" });
    }

    // Find project dir
    const projects = fs.readdirSync(path.join(__dirname, 'public')).filter(f => fs.statSync(path.join(__dirname, 'public', f)).isDirectory());
    // Assume most recent project is the current one (simplification, but efficient)
    const recentProject = projects
        .map(p => ({ name: p, time: fs.statSync(path.join(__dirname, 'public', p)).mtime.getTime() }))
        .sort((a, b) => b.time - a.time)[0];

    if (!recentProject) return res.status(500).json({ error: "No project folder found" });

    const outputPath = path.join(__dirname, 'public', recentProject.name, `scene_${sceneNum}_audio.wav`);
    fs.writeFileSync(outputPath, req.body);

    directorLog(parseInt(sceneNum), "AUDIO", `📥 Received audio for Scene ${sceneNum}`);
    res.json({ success: true, path: outputPath });
});

app.post('/generate-video', async (req, res) => {
    const { scriptData } = req.body;
    if (!scriptData || !scriptData.structure) return res.status(400).json({ error: "Invalid data" });

    // CRITICAL: Stop any existing job before starting new one
    if (directorState.isRunning) {
        directorLog(0, "CTRL", "🛑 Canceling previous job to start new one...");
        directorState.stopped = true;
        // Wait a moment for the old job to acknowledge stop
        await new Promise(r => setTimeout(r, 1000));
    }

    // Reset state for new job
    const newJobId = `job_${Date.now()}`;
    directorState.paused = false;
    directorState.stopped = false;
    directorState.restart = false;
    directorState.currentJobId = newJobId;
    directorState.isRunning = true;

    // Create project folder from first title option
    const title = scriptData.title_options?.[0] || scriptData.title || `video_${Date.now()}`;
    const projectDir = createProjectFolder(title);

    // Get ALL config from script data (set by Consultant)
    const visualStyle = scriptData.visualStyle || 'Cinematic photorealistic';
    const aspectRatio = scriptData.aspectRatio || '16:9';
    const platform = scriptData.platform || 'YouTube';
    const mood = scriptData.mood || 'Cinematic';

    directorLog(0, "NEW_JOB", `🚀 Starting Job: ${newJobId}`);
    directorLog(0, "CONFIG", `Visual: ${visualStyle} | Aspect: ${aspectRatio} | Platform: ${platform} | Mood: ${mood}`);

    generateVideo(scriptData.structure, projectDir, visualStyle, aspectRatio, newJobId)
        .then(() => {
            directorState.isRunning = false;
            directorLog(0, "COMPLETE", "🎉 Director job finished successfully!");
        })
        .catch(err => {
            directorState.isRunning = false;
            directorLog(0, "ERROR", `Job failed: ${err.message}`);
        });

    res.json({
        status: "started",
        message: "Director Agent started.",
        projectFolder: projectDir.name,
        visualStyle,
        aspectRatio,
        jobId: newJobId
    });
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
