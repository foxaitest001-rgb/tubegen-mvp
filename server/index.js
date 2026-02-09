const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const path = require('path');

puppeteer.use(StealthPlugin());

const app = express();
const PORT = 3001;
const VERSION = 'v3.2 (RESTORED SIMPLE INPUT)';

// ═══════════════════════════════════════════════════════════════
// STYLE DNA ARCHITECTURE - Helper Functions
// ═══════════════════════════════════════════════════════════════

/**
 * Build natural language prompt from frozen Style DNA + structured shot
 * The Style DNA is LOCKED - only the action phrase can change on retry
 */
function buildNaturalPrompt(styleDNA, shot, actionOverride = null) {
    if (!styleDNA) {
        // Fallback to legacy behavior if no Style DNA
        return shot;
    }

    const visual = styleDNA.visual_identity || {};
    const cinema = styleDNA.cinematography || {};
    const constraints = styleDNA.constraints || {};

    // Style prefix from DNA (LOCKED - never changes on retry)
    const stylePrefix = [
        visual.art_style,
        cinema.default_lens ? `${cinema.default_lens} lens` : null,
        visual.lighting_setup,
        visual.texture_quality
    ].filter(Boolean).join(", ");

    // Action from shot (this CAN change on retry)
    let actionPart = actionOverride || shot;

    // Clean up the action (remove Shot X: prefix if present)
    actionPart = actionPart.replace(/^Shot\s+\d+(\s*\(.*?\))?:?\s*/i, "").trim();

    // Required keywords from DNA
    const requiredKeywords = (constraints.required_keywords || []).join(", ");

    // Build final prompt
    const parts = [stylePrefix, actionPart];
    if (requiredKeywords) parts.push(requiredKeywords);

    return parts.filter(Boolean).join(", ");
}

/**
 * Reword action for retry - ONLY changes the action, preserves DNA
 * Simple synonym substitution to avoid re-triggering the same filter
 */
function rewordAction(originalAction) {
    const synonyms = {
        "walks": ["strides", "moves", "trudges", "traverses", "approaches"],
        "runs": ["sprints", "dashes", "rushes", "races", "hurries"],
        "stands": ["poses", "waits", "remains", "lingers", "hovers"],
        "looks": ["gazes", "stares", "peers", "glances", "observes"],
        "speaks": ["talks", "whispers", "addresses", "delivers", "murmurs"],
        "fights": ["battles", "clashes", "struggles", "confronts", "engages"],
        "flies": ["soars", "glides", "hovers", "drifts", "floats"],
        "swims": ["glides", "drifts", "navigates", "flows", "moves through water"],
        "rises": ["ascends", "emerges", "lifts", "elevates", "climbs"],
        "falls": ["descends", "drops", "plummets", "sinks", "tumbles"]
    };

    let newAction = originalAction;
    for (const [verb, alternatives] of Object.entries(synonyms)) {
        const regex = new RegExp(`\\b${verb}\\b`, 'gi');
        if (regex.test(newAction)) {
            const randomAlt = alternatives[Math.floor(Math.random() * alternatives.length)];
            newAction = newAction.replace(regex, randomAlt);
            break; // Only replace one verb per retry
        }
    }

    return newAction;
}

/**
 * Validate prompt against forbidden keywords
 */
function validateAgainstForbidden(styleDNA, prompt) {
    if (!styleDNA || !styleDNA.constraints || !styleDNA.constraints.forbidden_keywords) {
        return { valid: true, violations: [] };
    }

    const lowerPrompt = prompt.toLowerCase();
    const violations = styleDNA.constraints.forbidden_keywords.filter(
        keyword => lowerPrompt.includes(keyword.toLowerCase())
    );

    return {
        valid: violations.length === 0,
        violations
    };
}

// Enable CORS/JSON
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// SERVE STATIC FILES FROM OUTPUT DIRECTORIES (for video downloads)
app.use('/output', express.static(path.join(__dirname, 'output')));
app.use('/public-output', express.static(path.join(__dirname, '..', 'public', 'output')));

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
        directorLog(0, "DEBUG", `📂 Assembly scanning: ${outputDir}`);
        directorLog(0, "DEBUG", `📄 Files found: ${files.join(', ')}`);

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
async function generateVideo(tasks, projectDir, visualStyle = 'Cinematic photorealistic', aspectRatio = '16:9', jobId = null, styleDNA = null) {
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

    // STYLE DNA ARCHITECTURE: Log and freeze DNA
    if (styleDNA) {
        directorLog(0, "DNA", `✨ Style DNA LOCKED: ${styleDNA.visual_identity?.art_style || 'Not specified'}`);
        directorLog(0, "DNA", `   Forbidden: [${(styleDNA.constraints?.forbidden_keywords || []).join(', ')}]`);
        directorLog(0, "DNA", `   Required: [${(styleDNA.constraints?.required_keywords || []).join(', ')}]`);
    } else {
        directorLog(0, "DNA", `⚠️ No Style DNA provided (legacy mode)`);
    }

    let browser;
    let page;

    // Try to connect to existing Chrome first (RDP mode)
    let connected = false;
    try {
        directorLog(0, "BROWSER", "Trying to connect to existing Chrome...");
        browser = await puppeteer.connect({
            browserURL: 'http://localhost:9222',
            defaultViewport: null
        });

        // 🔍 HEALTH CHECK: Can we actually control this browser?
        // (Fixes "Zombie Chrome" issue where background process accepts connection but has no windows)
        const testPage = await browser.newPage();
        await testPage.close();

        directorLog(0, "BROWSER", "✅ Connected to existing Chrome (and verified)!");
        connected = true;
    } catch (e) {
        directorLog(0, "WARN", `Could not connect to existing Chrome: ${e.message}`);
        if (browser) { try { browser.disconnect(); } catch (err) { } }
    }

    if (!connected) {
        // Fallback: Launch new browser (local mode)
        directorLog(0, "BROWSER", "⚠️ Connection failed/rejected. Preparing fresh launch...");

        // NUKE OPTION: Kill all zombie Chromes to unlock user_data
        try {
            directorLog(0, "BROWSER", "🧹 Killing zombie Chrome processes...");
            // Cross-platform Zombie Killer
            const isWin = process.platform === 'win32';
            const killCmd = isWin ? 'taskkill /F /IM chrome.exe /T' : 'pkill -f chrome || pkill -f chromium';

            directorLog(0, "BROWSER", `🧹 Killing zombie processes (${isWin ? 'Windows' : 'Linux/Unix'})...`);
            await execAsync(killCmd).catch(() => { });
            await interruptibleSleep(2000); // Wait for file locks to release
        } catch (e) { /* ignore */ }

        directorLog(0, "BROWSER", "🚀 Launching NEW Browser (Visible Mode)...");
        try {
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
                    '--disable-gpu',
                    '--window-position=0,0'
                ]
            });
        } catch (launchErr) {
            directorLog(0, "WARN", `Launch with profile failed: ${launchErr.message}. Retrying with TEMPORARY profile...`);
            // Retry without userDataDir (fresh profile)
            browser = await puppeteer.launch({
                headless: false,
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
                    '--disable-gpu',
                    '--window-position=0,0'
                ]
            });
        }
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

            // 0. SPLASH KILLER (For fresh profiles)
            const killSplash = () => {
                const terms = ['accept cookies', 'allow all', 'continue without logging', 'start chatting', 'continue as guest', 'continue'];
                const buttons = document.querySelectorAll('button, div[role="button"]');
                for (const b of buttons) {
                    const txt = (b.innerText || '').toLowerCase();
                    if (terms.some(term => txt.includes(term))) {
                        b.click();
                        return true;
                    }
                }
                return false;
            };
            killSplash(); // Run once to clear overlays

            // 1. Selector approach for top-left icons (V3 Updated)
            const selectors = [
                '[title="New chat"]',           // META.AI V3: title attribute
                'div[title="New chat"]',        // Div with title
                'a[href="/"]',
                'a[href="/new"]',
                'div[role="button"][aria-label="New chat"]',
                'div[role="button"][aria-label="New conversation"]'
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

    // META.AI V3 SELECTOR: Uses <p> tags for input
    const inputSelector = [
        'p.x1oj8htv',                        // META.AI V3: Exact class from user
        'p[dir="auto"]',                     // P tag with dir attribute  
        'div[contenteditable="true"] p',    // P inside contenteditable
        '[contenteditable="true"]',          // Any contenteditable
        'div[role="textbox"]',
        'div[role="textbox"] p',             // P inside textbox
        'textarea',
        '[data-lexical-editor="true"]',
        '[data-lexical-editor="true"] p'    // P inside Lexical
    ].join(', ');

    // Wait for input using pure JS (no element handles)
    let inputReady = false;
    for (let waitAttempt = 0; waitAttempt < 20 && !inputReady; waitAttempt++) {
        inputReady = await page.evaluate((sel) => {
            return document.querySelector(sel) !== null;
        }, inputSelector);
        if (!inputReady) await interruptibleSleep(500);
    }

    if (inputReady) {
        directorLog(0, "STEP", "✓ Input box detected - Meta.ai ready!");
    } else {
        directorLog(0, "WARN", "⚠️ Input box not detected after 10s. Attempting to continue anyway...");

        // DEBUG: Log what elements ARE found
        const foundElements = await page.evaluate(() => {
            const elements = document.querySelectorAll('textarea, div[contenteditable], input[type="text"], [role="textbox"], p[dir]');
            return Array.from(elements).slice(0, 5).map(el => ({
                tag: el.tagName,
                class: (el.className || '').slice(0, 30),
                role: el.getAttribute('role'),
                contenteditable: el.getAttribute('contenteditable')
            }));
        });
        directorLog(0, "DEBUG", `Found ${foundElements.length} potential inputs: ${JSON.stringify(foundElements)}`);
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

                    // STYLE DNA RETRY STRATEGY:
                    // Attempt 2: "Reword Action" - Use synonyms to bypass filter, KEEP style locked
                    if (attempt === 2 && styleDNA) {
                        const originalAction = currentPrompt;
                        currentPrompt = rewordAction(originalAction);
                        directorLog(sceneNum, "DNA", `🔄 Reworded action (Style DNA preserved)`);
                    }
                    // Attempt 2 (Legacy mode - no DNA): Pure retry
                    else if (attempt === 2) {
                        // Do nothing to the prompt, just wait longer.
                    }
                    // Attempt 3: "Reword + Lowercase" - Last resort
                    else if (attempt === 3) {
                        currentPrompt = rewordAction(currentPrompt)
                            .replace(/[A-Z][a-z]+/g, (match) => match.toLowerCase());
                        directorLog(sceneNum, "RETRY", `📝 Applied reword + lowercase fallback`);
                    }

                    directorLog(sceneNum, "RETRY", `📝 Retrying with prompt (${currentPrompt.length} chars)`);
                    await interruptibleSleep(4000); // Longer pause
                }

                directorLog(sceneNum, "ACTION", `🎬 Starting Shot ${shotNum} (Progress: ${currentShotIndex + 1}/${shotQueue.length})${attempt > 1 ? ` [Attempt ${attempt}]` : ''}`);

                try {
                    directorLog(sceneNum, "STEP", "📍 Step 1: Finding and focusing input (Pure JS)...");

                    // META.AI V3: Use pure page.evaluate - NO Puppeteer element handles
                    const inputFound = await page.evaluate((sel) => {
                        // Kill overlays/modals first
                        const blockers = document.querySelectorAll('div[role="dialog"], div[role="banner"], div[aria-modal="true"], [class*="overlay"]');
                        blockers.forEach(el => el.remove());

                        // Find the input element
                        const el = document.querySelector(sel);
                        if (!el) return false;

                        // Focus the element or its parent contenteditable
                        let target = el;
                        if (!el.isContentEditable) {
                            // Look for parent contenteditable
                            const parent = el.closest('[contenteditable="true"]') || el.closest('[role="textbox"]');
                            if (parent) target = parent;
                        }

                        target.focus();
                        target.click();

                        // Clear content via innerText for <p> tags
                        if (el.tagName === 'P') {
                            el.innerHTML = '<br>';
                        }

                        return true;
                    }, inputSelector);

                    if (inputFound) {
                        directorLog(sceneNum, "STEP", "✓ Input focused (Pure JS)");

                        // Brief pause for focus
                        await interruptibleSleep(300);

                        directorLog(sceneNum, "STEP", "✓ Input ready");
                    } else {
                        directorLog(sceneNum, "WARN", "⚠️ Input element not found on page");
                    }

                    if (await checkControlState()) continue shotLoop;

                    // TYPE - Use currentPrompt (may be simplified on retries)
                    const cleanPrompt = currentPrompt.replace(/^Shot\s+\d+(\s*\(.*?\))?:?\s*/i, "").trim();

                    // STYLE DNA ARCHITECTURE: Build prompt from frozen DNA
                    let fullPrompt;
                    if (styleDNA) {
                        // Use buildNaturalPrompt for deterministic, style-locked prompts
                        fullPrompt = buildNaturalPrompt(styleDNA, cleanPrompt);

                        // Validate against forbidden keywords
                        const validation = validateAgainstForbidden(styleDNA, fullPrompt);
                        if (!validation.valid) {
                            directorLog(sceneNum, "DNA", `⚠️ Forbidden keywords detected: [${validation.violations.join(', ')}]`);
                            // Remove forbidden keywords from prompt
                            for (const forbidden of validation.violations) {
                                fullPrompt = fullPrompt.replace(new RegExp(forbidden, 'gi'), '');
                            }
                        }

                        directorLog(sceneNum, "DNA", `✨ Style DNA prompt built (${fullPrompt.length} chars)`);
                    } else {
                        // LEGACY: Build prompt prefix based on visual style string
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

                        // Fix: Avoid double colons if prompts already start with one
                        const safeCleanPrompt = cleanPrompt.startsWith(':') ? cleanPrompt.substring(1).trim() : cleanPrompt;
                        fullPrompt = `${stylePrefix}: ${safeCleanPrompt}`;
                    }

                    directorLog(sceneNum, "STEP", `📍 Step 3: Typing prompt (${fullPrompt.length} chars)...`);

                    // SLOW TYPING IS SAFER for React apps than Paste
                    // But we increased delay slightly to avoid character skipping
                    await page.keyboard.type(fullPrompt, { delay: 10 });

                    await new Promise(r => setTimeout(r, 500));
                    directorLog(sceneNum, "STEP", "✓ Prompt typed");

                    // SEND
                    directorLog(sceneNum, "STEP", "📍 Step 4: Sending prompt to Meta.ai...");
                    await page.keyboard.press('Enter');
                    directorLog(sceneNum, "STEP", "✓ Prompt sent! Waiting 30s for video generation...");

                    // WAIT - Reduced from 90s to 30s
                    await interruptibleSleep(30000);
                    if (directorState.restart) continue shotLoop;

                    // DOWNLOAD (Improved: Smart Scroll)
                    try {
                        directorLog(sceneNum, "STEP", "📍 Step 5: locating generated content...");

                        // Smart Scroll: Instead of jumping to bottom (which might hide content behind input box),
                        // we verify if we need to scroll.
                        await page.evaluate(() => {
                            // Scroll down a "little bit" (approx 300px) to reveal newly loaded content below the fold
                            window.scrollBy(0, 300);
                        });
                        await new Promise(r => setTimeout(r, 2000));

                        // Get count of videos BEFORE generation completes
                        const videoCountBefore = await page.evaluate(() => {
                            return document.querySelectorAll('video').length;
                        });

                        directorLog(sceneNum, "STEP", `📍 Step 6: Detecting new video... (Found ${videoCountBefore} existing)`);

                        // Wait for a NEW video to appear (poll every 5s)
                        let newVideoFound = false;
                        let retryCount = 0;
                        const maxRetries = 15; // 75s max

                        while (!newVideoFound && retryCount < maxRetries) {
                            if (directorState.restart) break;

                            // Incremental Scroll to prod lazy loading
                            await page.evaluate(() => {
                                window.scrollBy(0, 100);
                                // Also try to find the last loading indicator or video and scroll to it
                                const vids = document.querySelectorAll('video');
                                if (vids.length > 0) vids[vids.length - 1].scrollIntoView({ behavior: "smooth", block: "center" });
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

    // Use the active project directory directly
    if (!currentProjectDir || !currentProjectDir.server) {
        return res.status(500).json({ error: "No active project directory" });
    }

    const outputPath = path.join(currentProjectDir.server, `scene_${sceneNum}_audio.wav`);
    fs.writeFileSync(outputPath, req.body);

    // Also save to public dir for playback
    if (currentProjectDir.public) {
        const publicPath = path.join(currentProjectDir.public, `scene_${sceneNum}_audio.wav`);
        fs.writeFileSync(publicPath, req.body);
    }

    console.log(`[AUDIO] Saved ${req.body.length} bytes to ${outputPath}`);
    directorLog(parseInt(sceneNum), "AUDIO", `📥 Saved audio: ${outputPath} (${req.body.length} bytes)`);
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

    // STYLE DNA ARCHITECTURE: Extract Style DNA from Consultant output
    const styleDNA = scriptData.style_dna || null;

    directorLog(0, "NEW_JOB", `🚀 Starting Job: ${newJobId}`);
    directorLog(0, "CONFIG", `Visual: ${visualStyle} | Aspect: ${aspectRatio} | Platform: ${platform} | Mood: ${mood}`);

    if (styleDNA) {
        directorLog(0, "DNA", `✨ Style DNA detected: ${styleDNA.visual_identity?.art_style || 'Unknown'}`);
    } else {
        directorLog(0, "DNA", `⚠️ No Style DNA in request (legacy mode)`);
    }

    generateVideo(scriptData.structure, projectDir, visualStyle, aspectRatio, newJobId, styleDNA)
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

// SERVER-SIDE PIPER GENERATION
app.post('/generate-voiceover', async (req, res) => {
    const { text, voiceId, sceneNum } = req.body;

    if (!currentProjectDir.server) {
        return res.status(500).json({ error: "No active project. Start generation first." });
    }

    try {
        const piperBinary = path.join(__dirname, 'piper', 'piper'); // User must install this
        // MODELS ARE IN ROOT PUBLIC FOLDER, NOT SERVER PUBLIC
        // Duplicate declaration removed

        const outputFilename = `scene_${sceneNum}_audio.wav`;
        const outputPath = path.join(currentProjectDir.server, outputFilename);
        const publicPath = path.join(currentProjectDir.public, outputFilename);

        directorLog(sceneNum, "AUDIO", `🎙️ Generating audio on server (Voice: ${voiceId})...`);

        // Robust Model Path Resolution
        const possiblePaths = [
            path.join(__dirname, '..', 'public', 'piper', `${voiceId}.onnx`), // Project Root (Dev/RDP)
            path.join(__dirname, 'public', 'piper', `${voiceId}.onnx`),       // Server Local (Deployment)
            path.join(process.cwd(), 'public', 'piper', `${voiceId}.onnx`)    // CWD fallback
        ];

        let modelPath = null;
        for (const p of possiblePaths) {
            if (fs.existsSync(p)) {
                modelPath = p;
                break;
            }
        }

        if (!modelPath) {
            // Graceful fallback: Skip audio generation if models not installed
            const msg = `Voice models not found. Audio skipped. (Checked: ${possiblePaths[0]})`;
            console.warn(`[AUDIO] ${msg}`);
            directorLog(sceneNum, "AUDIO", `⚠️ ${msg}`);
            return res.json({ success: false, skipped: true, reason: "Voice models not installed on server" });
        }

        console.log(`[AUDIO] Found model at: ${modelPath}`);

        // Execute Piper
        // Command: echo "text" | ./piper --model model.onnx --output_file out.wav
        const cmd = `echo "${text.replace(/"/g, '\\"')}" | "${piperBinary}" --model "${modelPath}" --output_file "${outputPath}"`;

        await execAsync(cmd);

        // Copy to public for playback check
        fs.copyFileSync(outputPath, publicPath);

        const size = fs.statSync(outputPath).size;
        directorLog(sceneNum, "AUDIO", `✓ Generated audio: ${outputFilename} (${size} bytes)`);
        console.log(`[AUDIO] Server-side generation success: ${outputPath}`);

        res.json({ success: true, path: outputPath });

    } catch (e) {
        console.error("Piper Server Gen Error:", e);
        directorLog(sceneNum, "ERROR", `Audio Gen Failed: ${e.message}`);
        res.status(500).json({ error: e.message });
    }
});

app.listen(PORT, () => {
    console.log(`[DIRECTOR AGENT] ${VERSION} - Server running on http://localhost:${PORT}`);
    console.log(`[DIRECTOR AGENT] Output Dirs: \n - Public: ${PUBLIC_OUTPUT_DIR} \n - Server: ${SERVER_OUTPUT_DIR}`);
});
