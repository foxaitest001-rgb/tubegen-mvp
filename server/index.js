const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

puppeteer.use(StealthPlugin());

// V5 Pro Pipeline modules
const { generateImagesWhisk } = require('./whisk_director');
const { enrichScenesWithMotion, buildI2VPrompt } = require('./motion_prompts');
const { generateVideosGrokI2V } = require('./grok_i2v_director');
const KB = require('./knowledge_base');
const SM = require('./session_manager');

// V7 Robust Directors (extension-inspired)
const { generateVideosGrokV2 } = require('./grok_director_v2');
const { generateVideosMetaV2 } = require('./meta_director_v2');
const { generateImagesWhiskV2 } = require('./whisk_director_v2');
const { BatchQueue } = require('./batch_queue');

const app = express();
const PORT = 3001;
const VERSION = 'v7.0 (ROBUST DIRECTORS + BATCH QUEUE)';

// ── Middleware ──
app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

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

// ═══════════════════════════════════════════════════════════════
// THE GROK DIRECTOR AGENT — Grok.com Imagine → Video → Upscale → Download
// ═══════════════════════════════════════════════════════════════
async function generateVideoGrok(tasks, projectDir, visualStyle = 'Cinematic photorealistic', aspectRatio = '16:9', jobId = null, styleDNA = null) {
    const outputPublic = projectDir.public;
    const outputServer = projectDir.server;

    directorLog(0, "GROK", `🚀 Grok Director ${VERSION} starting...`);
    directorLog(0, "PROJECT", `Output folder: ${projectDir.name}`);

    if (styleDNA) {
        directorLog(0, "DNA", `✨ Style DNA: ${styleDNA.visual_identity?.art_style || 'Unknown'}`);
    }

    // ── Build flat shot queue ──
    const shotQueue = [];
    for (let sceneIdx = 0; sceneIdx < tasks.length; sceneIdx++) {
        const scene = tasks[sceneIdx];
        const shots = scene.shots || scene.visual_prompts || [scene.visual_prompt || scene.description];
        for (let shotIdx = 0; shotIdx < shots.length; shotIdx++) {
            shotQueue.push({
                sceneNum: sceneIdx + 1,
                shotNum: shotIdx + 1,
                prompt: typeof shots[shotIdx] === 'string' ? shots[shotIdx] : shots[shotIdx]?.prompt || shots[shotIdx]?.description || ''
            });
        }
    }

    directorLog(0, "PLAN", `📋 Blueprint: ${shotQueue.length} Total Shots queued (Grok).`);

    // ── Browser Setup ──
    let browser, page;

    // Try connecting to existing Chrome
    try {
        const response = await fetch('http://127.0.0.1:9222/json/version');
        const data = await response.json();
        if (data.webSocketDebuggerUrl) {
            browser = await puppeteer.connect({ browserWSEndpoint: data.webSocketDebuggerUrl, defaultViewport: null });
            directorLog(0, "BROWSER", "✅ Connected to existing Chrome (Grok)");
        }
    } catch (e) {
        directorLog(0, "BROWSER", "Chrome not running. Launching new instance...");
    }

    if (!browser) {
        try {
            browser = await puppeteer.launch({
                headless: false,
                defaultViewport: null,
                args: [
                    '--start-maximized', '--disable-web-security',
                    '--disable-features=IsolateOrigins,site-per-process',
                    '--mute-audio', '--no-default-browser-check',
                    '--no-sandbox', '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage', '--disable-gpu',
                    '--window-position=0,0'
                ]
            });
        } catch (launchErr) {
            directorLog(0, "ERROR", `Failed to launch Chrome: ${launchErr.message}`);
            return;
        }
    }

    // Find or open Grok.com tab
    const pages = await browser.pages();
    page = pages.find(p => p.url().includes('grok.com'));

    if (!page) {
        directorLog(0, "BROWSER", "Grok tab not found. Opening NEW tab...");
        page = await browser.newPage();
        // SESSION MANAGER: Inject cookies before navigating
        const grokInjected = await SM.injectCookies(page, 'grok');
        if (grokInjected) directorLog(0, "SESSION", "🍪 Grok cookies injected");
        await page.goto('https://grok.com', { waitUntil: 'domcontentloaded', timeout: 0 });
    } else {
        directorLog(0, "BROWSER", "✅ Reusing existing Grok tab");
        await page.bringToFront();
    }

    await page.setBypassCSP(true);

    // ── Navigate to Imagine mode ──
    directorLog(0, "STEP", "⏳ Navigating to Imagine mode...");
    await interruptibleSleep(2000);

    // Click "Imagine" in sidebar
    const clickedImagine = await page.evaluate(() => {
        // Look for "Imagine" link in sidebar
        const links = document.querySelectorAll('a, button, div[role="button"], span');
        for (const el of links) {
            const txt = (el.textContent || '').trim().toLowerCase();
            if (txt === 'imagine') {
                el.click();
                return true;
            }
        }
        // Fallback: navigate directly
        return false;
    });

    if (clickedImagine) {
        directorLog(0, "STEP", "✓ Clicked 'Imagine' in sidebar");
    } else {
        directorLog(0, "STEP", "Navigating directly to grok.com/imagine...");
        await page.goto('https://grok.com/imagine', { waitUntil: 'domcontentloaded', timeout: 0 });
    }

    await interruptibleSleep(3000);

    // ── Select Video mode ──
    directorLog(0, "STEP", "⏳ Selecting Video mode...");
    const clickedVideo = await page.evaluate(() => {
        // Look for "Video" button/option near the input
        const candidates = document.querySelectorAll('button, div[role="button"], span, label');
        for (const el of candidates) {
            const txt = (el.textContent || '').trim().toLowerCase();
            if (txt === 'video' || txt.includes('video')) {
                el.click();
                return true;
            }
        }
        return false;
    });

    if (clickedVideo) {
        directorLog(0, "STEP", "✓ Video mode selected");
    } else {
        directorLog(0, "WARN", "⚠️ Could not find Video mode button, may already be selected");
    }

    await interruptibleSleep(1000);

    // ── Input selector for Grok's Imagine input ──
    const grokInputSelector = 'textarea, input[type="text"], div[contenteditable="true"], div[role="textbox"]';

    try {
        await page.waitForSelector(grokInputSelector, { timeout: 10000 });
        directorLog(0, "STEP", "✓ Input box detected - Grok Imagine ready!");
    } catch (e) {
        directorLog(0, "WARN", "⚠️ Input box not detected after 10s");
    }

    // ── Process each shot ──
    const MAX_RETRIES = 3;
    let currentShotIndex = 0;

    while (currentShotIndex < shotQueue.length) {
        if (await checkControlState()) break;

        const shot = shotQueue[currentShotIndex];
        const { sceneNum, shotNum, prompt: originalPrompt } = shot;
        let shotSuccess = false;

        for (let attempt = 1; attempt <= MAX_RETRIES && !shotSuccess; attempt++) {
            if (await checkControlState()) break;

            let currentPrompt = originalPrompt;
            if (attempt > 1) {
                currentPrompt = rewordAction(currentPrompt);
                directorLog(sceneNum, "RETRY", `🔄 Retry ${attempt}/${MAX_RETRIES} for Shot ${shotNum}`);
            }

            directorLog(sceneNum, "ACTION", `🎬 Starting Shot ${shotNum} (${currentShotIndex + 1}/${shotQueue.length})${attempt > 1 ? ` [Attempt ${attempt}]` : ''} [GROK]`);

            try {
                // ── Step 1: Focus & clear Grok input ──
                directorLog(sceneNum, "STEP", "📍 Step 1: Focus Grok input...");

                let inputElement = null;
                try {
                    inputElement = await page.waitForSelector(grokInputSelector, { timeout: 5000 });
                } catch (e) { /* ignore */ }

                if (inputElement) {
                    await inputElement.evaluate(el => el.scrollIntoView({ block: 'center' }));
                    await new Promise(r => setTimeout(r, 300));

                    const box = await inputElement.boundingBox();
                    if (box) {
                        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
                        await new Promise(r => setTimeout(r, 300));
                    } else {
                        await inputElement.evaluate(el => el.focus());
                        await new Promise(r => setTimeout(r, 300));
                    }

                    // Clear existing text
                    await page.keyboard.down('Control');
                    await page.keyboard.press('A');
                    await page.keyboard.up('Control');
                    await page.keyboard.press('Backspace');
                    await new Promise(r => setTimeout(r, 200));

                    directorLog(sceneNum, "STEP", "✓ Grok input focused & cleared");
                } else {
                    directorLog(sceneNum, "WARN", "⚠️ Grok input not found");
                }

                if (await checkControlState()) continue;

                // ── Step 2: Build and type prompt ──
                const cleanPrompt = currentPrompt.replace(/^Shot\s+\d+(\s*\(.*?\))?:?\s*/i, "").trim();

                let fullPrompt;
                if (styleDNA) {
                    fullPrompt = buildNaturalPrompt(styleDNA, cleanPrompt);
                    const validation = validateAgainstForbidden(styleDNA, fullPrompt);
                    if (!validation.valid) {
                        for (const forbidden of validation.violations) {
                            fullPrompt = fullPrompt.replace(new RegExp(forbidden, 'gi'), '');
                        }
                    }
                } else {
                    fullPrompt = `${cleanPrompt}, ${visualStyle}, aspect ratio ${aspectRatio}`;
                }

                directorLog(sceneNum, "STEP", `📍 Step 2: Typing prompt (${fullPrompt.length} chars)...`);
                await page.keyboard.type(fullPrompt, { delay: 30 });
                await new Promise(r => setTimeout(r, 500));

                // ── Step 3: Send prompt (Enter or click send button) ──
                directorLog(sceneNum, "STEP", "📍 Step 3: Sending prompt...");

                // Try clicking send button first, else press Enter
                const clickedSend = await page.evaluate(() => {
                    // Look for send/submit button
                    const buttons = document.querySelectorAll('button[type="submit"], button[aria-label="Send"], button[aria-label="Submit"]');
                    for (const b of buttons) {
                        b.click();
                        return true;
                    }
                    // Look for button with send icon (arrow up icon)
                    const allBtns = document.querySelectorAll('button');
                    for (const b of allBtns) {
                        if (b.querySelector('svg') && b.closest('form, [class*="input"], [class*="composer"]')) {
                            b.click();
                            return true;
                        }
                    }
                    return false;
                });

                if (clickedSend) {
                    directorLog(sceneNum, "STEP", "✓ Clicked send button");
                } else {
                    await page.keyboard.press('Enter');
                    directorLog(sceneNum, "STEP", "✓ Pressed Enter to send");
                }

                // ── Step 4: Wait for video generation ──
                directorLog(sceneNum, "STEP", "📍 Step 4: Waiting for video to generate (up to 120s)...");

                let videoGenerated = false;
                for (let waitSec = 0; waitSec < 120 && !videoGenerated; waitSec += 5) {
                    if (await checkControlState()) break;
                    await interruptibleSleep(5000);

                    videoGenerated = await page.evaluate(() => {
                        // Look for a video element on the page
                        const videos = document.querySelectorAll('video');
                        if (videos.length > 0) return true;
                        // Also check for loading indicators clearing
                        const loading = document.querySelector('[class*="loading"], [class*="spinner"], [class*="generating"]');
                        return !loading && document.querySelector('img[src*="blob:"], video[src*="blob:"]') !== null;
                    });

                    if (!videoGenerated) {
                        directorLog(sceneNum, "STEP", `  ⏳ Still generating... (${waitSec + 5}s)`);
                    }
                }

                if (!videoGenerated) {
                    directorLog(sceneNum, "WARN", "⚠️ Video didn't appear after 120s");
                    continue;
                }

                directorLog(sceneNum, "STEP", "✓ Video generated!");

                // ── Step 5: Click on the video to open detail view ──
                directorLog(sceneNum, "STEP", "📍 Step 5: Opening video detail...");
                await page.evaluate(() => {
                    const video = document.querySelector('video');
                    if (video) {
                        const parent = video.closest('a, div[role="button"], [class*="card"]') || video;
                        parent.click();
                    }
                });
                await interruptibleSleep(2000);

                // ── Step 6: Click "..." (three dots) menu ──
                directorLog(sceneNum, "STEP", "📍 Step 6: Clicking '...' menu for upscale...");
                const clickedDots = await page.evaluate(() => {
                    // Look for three dots / more menu button
                    const candidates = document.querySelectorAll('button, div[role="button"]');
                    for (const el of candidates) {
                        const text = (el.textContent || '').trim();
                        const ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase();
                        // Match: "...", "•••", ellipsis, "more", "options"
                        if (text === '...' || text === '•••' || text === '⋯' ||
                            ariaLabel.includes('more') || ariaLabel.includes('option') || ariaLabel.includes('menu')) {
                            el.click();
                            return true;
                        }
                        // Check for SVG with 3 dots pattern (common icon)
                        const svg = el.querySelector('svg');
                        if (svg && (svg.querySelectorAll('circle').length >= 3 || svg.querySelectorAll('path').length >= 3)) {
                            el.click();
                            return true;
                        }
                    }
                    return false;
                });

                if (clickedDots) {
                    directorLog(sceneNum, "STEP", "✓ Opened '...' menu");
                    await interruptibleSleep(1000);

                    // ── Step 7: Click "Upscale" ──
                    directorLog(sceneNum, "STEP", "📍 Step 7: Clicking 'Upscale'...");
                    const clickedUpscale = await page.evaluate(() => {
                        const items = document.querySelectorAll('button, div[role="menuitem"], li, a, span');
                        for (const el of items) {
                            const txt = (el.textContent || '').trim().toLowerCase();
                            if (txt.includes('upscale')) {
                                el.click();
                                return true;
                            }
                        }
                        return false;
                    });

                    if (clickedUpscale) {
                        directorLog(sceneNum, "STEP", "✓ Upscale clicked! Waiting for upscale (up to 60s)...");

                        // Wait for upscale to complete
                        for (let waitSec = 0; waitSec < 60; waitSec += 5) {
                            if (await checkControlState()) break;
                            await interruptibleSleep(5000);

                            const upscaleComplete = await page.evaluate(() => {
                                // Check if upscale is still loading
                                const loading = document.querySelector('[class*="upscal"][class*="loading"], [class*="progress"]');
                                return !loading;
                            });

                            if (upscaleComplete) {
                                directorLog(sceneNum, "STEP", "✓ Upscale complete!");
                                break;
                            }
                            directorLog(sceneNum, "STEP", `  ⏳ Upscaling... (${waitSec + 5}s)`);
                        }
                    } else {
                        directorLog(sceneNum, "WARN", "⚠️ Upscale button not found, proceeding with standard quality");
                    }
                } else {
                    directorLog(sceneNum, "WARN", "⚠️ '...' menu not found, skipping upscale");
                }

                // ── Step 8: Download the video ──
                directorLog(sceneNum, "STEP", "📍 Step 8: Looking for download button...");
                await interruptibleSleep(1000);

                const clickedDownload = await page.evaluate(() => {
                    // Grok download button - yellow/gold download icon at bottom
                    const buttons = document.querySelectorAll('button, a, div[role="button"]');
                    for (const el of buttons) {
                        const ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase();
                        const title = (el.getAttribute('title') || '').toLowerCase();
                        const text = (el.textContent || '').trim().toLowerCase();

                        if (ariaLabel.includes('download') || title.includes('download') || text === 'download') {
                            el.click();
                            return true;
                        }

                        // Check for download SVG icon (arrow pointing down into tray)
                        const svg = el.querySelector('svg');
                        if (svg) {
                            const paths = svg.querySelectorAll('path');
                            const hasDownloadIcon = Array.from(paths).some(p => {
                                const d = p.getAttribute('d') || '';
                                return d.includes('M12') && (d.includes('19') || d.includes('download'));
                            });
                            if (hasDownloadIcon && el.closest('[class*="action"], [class*="download"], [class*="toolbar"]')) {
                                el.click();
                                return true;
                            }
                        }
                    }
                    return false;
                });

                if (clickedDownload) {
                    directorLog(sceneNum, "STEP", "✓ Download clicked! Waiting 10s for file...");
                    await interruptibleSleep(10000);

                    // Rename downloaded file
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
                                shotSuccess = true;
                            } else {
                                directorLog(sceneNum, "WARN", "⚠️ Downloaded file too old");
                            }
                        } else {
                            directorLog(sceneNum, "WARN", "⚠️ No new files found to rename");
                        }
                    } catch (e) {
                        directorLog(sceneNum, "ERROR", `Rename failed: ${e.message}`);
                    }
                } else {
                    directorLog(sceneNum, "STEP", "❌ Download button not found");
                }

                // ── Step 9: Go back for next prompt ──
                directorLog(sceneNum, "STEP", "📍 Step 9: Returning for next prompt...");
                await page.evaluate(() => {
                    // Click back button if in detail view
                    const backBtn = document.querySelector('button[aria-label="Back"], a[aria-label="Back"], button[aria-label="Go back"]');
                    if (backBtn) backBtn.click();
                });
                await interruptibleSleep(2000);

            } catch (shotError) {
                directorLog(sceneNum, "ERROR", `Shot attempt failed: ${shotError.message}`);
            }
        } // End retry loop

        if (shotSuccess) {
            currentShotIndex++;
        } else {
            directorLog(sceneNum, "ERROR", `❌ Shot ${shotNum} failed after ${MAX_RETRIES} attempts. Skipping.`);
            currentShotIndex++;
        }
    }

    directorLog(0, "DONE", "All scenes completed (Grok).");

    // Run FFmpeg assembly
    const finalVideo = await assembleVideo(projectDir);
    if (finalVideo) {
        directorLog(0, "ASSEMBLE", `✅ Final video created: ${path.basename(finalVideo)}`);
    }

    // Send completion event
    const outputFiles = fs.readdirSync(outputServer).map(f => ({
        name: f,
        path: `/output/${projectDir.name}/${f}`,
        isFinal: f === 'final_video.mp4'
    }));
    directorLog(0, "FILES", `📦 ${outputFiles.length} files ready for download`);
    sendEvent({ type: 'completed', message: 'Grok Director finished!', files: outputFiles });
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
        // SESSION MANAGER: Inject cookies before navigating
        const metaInjected = await SM.injectCookies(page, 'meta');
        if (metaInjected) directorLog(0, "SESSION", "🍪 Meta.ai cookies injected");
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

    // V2 RESTORED: Simple proven selector
    const inputSelector = 'textarea, div[contenteditable="true"], div[role="textbox"]';

    // V2 RESTORED: Use waitForSelector (Puppeteer handles scroll/visibility)
    try {
        await page.waitForSelector(inputSelector, { timeout: 10000 });
        directorLog(0, "STEP", "✓ Input box detected - Meta.ai ready!");
    } catch (e) {
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
                    directorLog(sceneNum, "STEP", "📍 Step 1: Focus & clear input (V2 Pattern)...");

                    // Kill overlays first
                    await page.evaluate(() => {
                        const blockers = document.querySelectorAll('div[role="dialog"], div[role="banner"], div[aria-modal="true"], [class*="overlay"]');
                        blockers.forEach(el => el.remove());
                    });

                    // V2 RESTORED: waitForSelector + element.click() + element.focus()
                    let inputElement = null;
                    try {
                        inputElement = await page.waitForSelector(inputSelector, { timeout: 5000 });
                    } catch (e) { /* ignore */ }

                    if (inputElement) {
                        // Step A: Scroll into view (safe, always works)
                        await inputElement.evaluate(el => el.scrollIntoView({ block: 'center' }));
                        await new Promise(r => setTimeout(r, 300));

                        // Step B: Get coordinates (now accurate since element is in viewport)
                        const box = await inputElement.boundingBox();
                        if (box) {
                            // Step C: REAL mouse click - activates Lexical editor
                            await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
                            await new Promise(r => setTimeout(r, 300));
                        } else {
                            // Fallback: DOM focus
                            await inputElement.evaluate(el => el.focus());
                            await new Promise(r => setTimeout(r, 300));
                        }

                        // Clear text with Ctrl+A → Backspace
                        await page.keyboard.down('Control');
                        await page.keyboard.press('A');
                        await page.keyboard.up('Control');
                        await page.keyboard.press('Backspace');
                        await new Promise(r => setTimeout(r, 200));

                        directorLog(sceneNum, "STEP", `✓ Input activated & cleared${box ? ` at (${Math.round(box.x + box.width / 2)}, ${Math.round(box.y + box.height / 2)})` : ' (fallback)'}`);
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

                    // V2 RESTORED: delay: 30 is safe for React/Lexical editors
                    await page.keyboard.type(fullPrompt, { delay: 30 });

                    await new Promise(r => setTimeout(r, 500));
                    directorLog(sceneNum, "STEP", "✓ Prompt typed");

                    // SEND
                    directorLog(sceneNum, "STEP", "📍 Step 4: Sending prompt to Meta.ai...");

                    // CRITICAL: Capture video count BEFORE sending prompt (baseline for new video detection)
                    const videoCountBefore = await page.evaluate(() => {
                        return document.querySelectorAll('video').length;
                    });

                    await page.keyboard.press('Enter');
                    directorLog(sceneNum, "STEP", `✓ Prompt sent! Waiting 30s for video generation... (${videoCountBefore} existing videos)`);

                    // WAIT - Reduced from 90s to 30s
                    await interruptibleSleep(30000);
                    if (directorState.restart) continue shotLoop;

                    // DOWNLOAD (Improved: Smart Scroll)
                    try {
                        directorLog(sceneNum, "STEP", "📍 Step 5: locating generated content...");

                        // Scroll to BOTTOM of page to reveal newly generated content
                        await page.evaluate(() => {
                            window.scrollTo(0, document.body.scrollHeight);
                        });
                        await new Promise(r => setTimeout(r, 2000));

                        directorLog(sceneNum, "STEP", `📍 Step 6: Detecting new video... (Had ${videoCountBefore} before prompt)`);

                        // Wait for a NEW video to appear (poll every 5s)
                        let newVideoFound = false;
                        let retryCount = 0;
                        const maxRetries = 15; // 75s max

                        while (!newVideoFound && retryCount < maxRetries) {
                            if (directorState.restart) break;

                            // Scroll to bottom to prod lazy loading and reveal new content
                            await page.evaluate(() => {
                                window.scrollTo(0, document.body.scrollHeight);
                                // Also scroll to the last video element if any
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

                            if (currentInfo.hasNew && currentInfo.validCount > 0) {
                                newVideoFound = true;
                                directorLog(sceneNum, `Shot ${shotNum}`, `✅ New video detected! (${currentInfo.validCount} valid, was ${videoCountBefore})`);
                            } else if (retryCount > 5 && currentInfo.validCount > 0) {
                                // Fallback after 30s: accept whatever valid video is last
                                newVideoFound = true;
                                directorLog(sceneNum, `Shot ${shotNum}`, `⚠️ Fallback: accepting last valid video after ${retryCount * 5}s`);
                            } else {
                                retryCount++;
                                directorLog(sceneNum, `Shot ${shotNum}`, `⏳ Waiting for video... (${retryCount * 5}s / 75s max)`);
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

                        // Extra wait for scroll to settle before hover
                        await new Promise(r => setTimeout(r, 1500));

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

                        // V2 RESTORED: Re-focus textbox using waitForSelector + click
                        directorLog(sceneNum, "STEP", "📍 Re-focusing input for next prompt (V2)...");
                        let refocusElement = null;
                        try {
                            refocusElement = await page.waitForSelector(inputSelector, { timeout: 5000 });
                        } catch (e) { /* ignore */ }

                        if (refocusElement) {
                            // Just click the textbox — next shot's Step 1 handles clearing
                            await refocusElement.evaluate(el => el.scrollIntoView({ block: 'center' }));
                            await new Promise(r => setTimeout(r, 300));
                            const rBox = await refocusElement.boundingBox();
                            if (rBox) {
                                await page.mouse.click(rBox.x + rBox.width / 2, rBox.y + rBox.height / 2);
                            } else {
                                await refocusElement.evaluate(el => el.focus());
                            }
                            await new Promise(r => setTimeout(r, 300));
                            directorLog(sceneNum, "STEP", "✓ Input re-activated for next prompt");
                        } else {
                            directorLog(sceneNum, "WARN", "⚠️ Could not find input for re-focus");
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
    if (!req.body) return res.status(400).json({ error: 'Missing request body' });
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

    // Route to Grok or Meta.ai Director based on videoSource
    const videoSource = scriptData.videoSource || 'meta';
    directorLog(0, "SOURCE", `🎯 Video source: ${videoSource === 'grok' ? 'Grok.com' : 'Meta.ai'}`);
    directorLog(0, "ENGINE", `⚡ Using v2 Robust Directors (MutationObserver + CDP)`);

    // V7: Use robust v2 directors
    const runV2Pipeline = async () => {
        let browser;
        try {
            browser = await puppeteer.connect({
                browserURL: 'http://127.0.0.1:9222',
                defaultViewport: null
            });
            directorLog(0, "BROWSER", "🔗 Connected to Chrome");
        } catch (err) {
            directorLog(0, "ERROR", `Chrome connect failed: ${err.message}. Falling back to v1...`);
            // Fallback to v1
            const directorFn = videoSource === 'grok' ? generateVideoGrok : generateVideo;
            return directorFn(scriptData.structure, projectDir, visualStyle, aspectRatio, newJobId, styleDNA);
        }

        // Build flat scene list — try ALL known field names from Consultant output
        const scenes = [];
        for (let si = 0; si < scriptData.structure.length; si++) {
            const s = scriptData.structure[si];
            // Try array fields first: shots[] → visual_prompts[] → video_prompts[]
            const shots = s.shots || s.visual_prompts || s.video_prompts
                || [s.visual_prompt || s.image_prompt || s.visual || s.description || s.narration || ''];
            for (let sh = 0; sh < shots.length; sh++) {
                const raw = shots[sh];
                const prompt = typeof raw === 'string' ? raw : (raw?.prompt || raw?.description || raw?.visual_prompt || '');
                const finalPrompt = prompt || s.narration || s.title || '';
                if (!finalPrompt || finalPrompt.length < 10) {
                    console.log(`[WARN] Scene ${si + 1} shot ${sh + 1}: No visual prompt found!`);
                    console.log(`[WARN] Scene ${si + 1} keys: [${Object.keys(s).join(', ')}]`);
                    console.log(`[WARN] Scene ${si + 1} data: ${JSON.stringify(s).substring(0, 400)}`);
                }
                scenes.push({ prompt: finalPrompt || `Scene ${si + 1} - cinematic shot`, index: si, shotIndex: sh });
            }
        }
        // Debug: Log all scene prompts
        scenes.forEach((sc, i) => console.log(`[PLAN] Scene ${i + 1} prompt (${sc.prompt.length} chars): "${sc.prompt.substring(0, 100)}..."`));
        directorLog(0, 'PLAN', `📋 ${scenes.length} scenes queued — prompts verified`);

        const onProgress = (p) => {
            directorLog(p.sceneIndex + 1, p.status === 'done' ? 'DONE' : p.status === 'failed' ? 'FAIL' : 'GEN',
                p.status === 'done' ? `✅ Scene ${p.sceneIndex + 1}/${p.totalScenes} downloaded` :
                    p.status === 'failed' ? `❌ Scene ${p.sceneIndex + 1} failed: ${p.error}` :
                        `⏳ Scene ${p.sceneIndex + 1}/${p.totalScenes} generating... (${p.pct}%)`);
        };

        const generateFn = videoSource === 'grok' ? generateVideosGrokV2 : generateVideosMetaV2;
        return generateFn(browser, scenes, {
            projectDir: projectDir.server,
            aspectRatio,
            mode: 'video',
            isI2V: false,
            onProgress
        });
    };

    runV2Pipeline()
        .then(() => {
            directorState.isRunning = false;
            directorLog(0, "COMPLETE", `🎉 ${videoSource === 'grok' ? 'Grok' : 'Meta.ai'} Director job finished successfully!`);
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

// ═══════════════════════════════════════════════════════════════
// PRO PIPELINE — Whisk Images → I2V Videos → FFmpeg Assembly
// ═══════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════
// KNOWLEDGE BASE API ENDPOINTS
// ═══════════════════════════════════════════════════════════════

app.get('/knowledge/styles', (req, res) => {
    res.json(KB.getAllVisualStyles());
});

app.get('/knowledge/styles/:name', (req, res) => {
    const style = KB.getVisualStyle(req.params.name);
    if (!style) return res.status(404).json({ error: 'Style not found' });
    res.json(style);
});

app.get('/knowledge/channels', (req, res) => {
    res.json(KB.getAllChannelWorkflows());
});

app.get('/knowledge/channels/:name', (req, res) => {
    const wf = KB.getChannelWorkflow(req.params.name);
    if (!wf) return res.status(404).json({ error: 'Channel workflow not found' });
    res.json(wf);
});

app.get('/knowledge/camera', (req, res) => {
    res.json(KB.getAllCameraShots());
});

app.get('/knowledge/lighting', (req, res) => {
    res.json(KB.getAllLightingStyles());
});

app.get('/knowledge/thumbnails', (req, res) => {
    res.json(KB.getThumbnailRules());
});

app.get('/knowledge/consultant-context/:channelStyle', (req, res) => {
    const context = KB.buildConsultantContext(req.params.channelStyle);
    res.json({ context, styleMenu: KB.buildStyleMenu() });
});

app.get('/knowledge/summary', (req, res) => {
    res.json(KB.getKnowledgeSummary());
});

// ═══════════════════════════════════════════════════════════════
// PRO PIPELINE ENDPOINT
// ═══════════════════════════════════════════════════════════════

app.post('/generate-pipeline-pro', async (req, res) => {
    const { scriptData } = req.body;
    if (!scriptData || !scriptData.structure) {
        return res.status(400).json({ error: "Missing scriptData or structure" });
    }

    if (directorState.isRunning) {
        return res.status(409).json({ error: "A job is already running" });
    }

    directorState.isRunning = true;
    const newJobId = `pro_${Date.now()}`;
    directorState.currentJobId = newJobId;
    directorState.logs = [];

    const visualStyle = scriptData.visualStyle || 'Cinematic photorealistic';
    const aspectRatio = scriptData.aspectRatio || '16:9';
    const mood = scriptData.mood || 'cinematic';
    const styleDNA = scriptData.style_dna || null;
    const subjectRegistry = scriptData.subject_registry || [];
    const videoSource = scriptData.videoSource || 'meta';
    const channelStyle = scriptData.channelStyle || null;

    // Create project folder
    const projectDir = createProjectFolder(scriptData.topic || 'pro_pipeline');

    directorLog(0, "PRO_PIPELINE", `🚀 Pro Pipeline started: ${newJobId}`);
    directorLog(0, "CONFIG", `Visual: ${visualStyle} | Subjects: ${subjectRegistry.length} | Scenes: ${scriptData.structure.length}`);
    directorLog(0, "CONFIG", `Video Source: ${videoSource} | Mode: Image-to-Video`);

    // ─── Knowledge Base Enrichment ───
    if (channelStyle) {
        const wf = KB.getChannelWorkflow(channelStyle);
        if (wf) {
            directorLog(0, "KNOWLEDGE", `📚 Channel archetype: ${wf.name} (${wf.niche})`);
            directorLog(0, "KNOWLEDGE", `🎬 Script structure: ${wf.script_structure}`);
            directorLog(0, "KNOWLEDGE", `📷 Camera defaults: ${wf.camera_defaults.join(', ')}`);
            directorLog(0, "KNOWLEDGE", `💡 Lighting defaults: ${wf.lighting_defaults.join(', ')}`);
        }
    }
    const styleInfo = KB.getVisualStyle(visualStyle);
    if (styleInfo) {
        directorLog(0, "KNOWLEDGE", `🎨 Visual style loaded: ${styleInfo.name} (${styleInfo.category})`);
    }

    // Enrich scenes with motion prompts
    const enrichedScenes = enrichScenesWithMotion(scriptData.structure, mood);
    directorLog(0, "MOTION", `🎥 Motion prompts assigned to ${enrichedScenes.length} scenes`);

    // Enrich scenes with knowledge-based camera/lighting/style intelligence
    for (const scene of enrichedScenes) {
        const enrichment = KB.enrichScenePrompt(scene, visualStyle, channelStyle);
        scene._enrichedPrompt = enrichment.enrichedPrompt;
        scene._negativePrompt = enrichment.negativePrompt;
        scene._cameraKeywords = enrichment.cameraKeywords;
        scene._lightingKeywords = enrichment.lightingKeywords;
        scene._enrichedMotion = KB.enrichMotionPrompt(scene, visualStyle);
    }
    directorLog(0, "KNOWLEDGE", `📝 ${enrichedScenes.length} scenes enriched with camera/lighting/style intelligence`);

    // Run the pipeline in background
    (async () => {
        try {
            // ─── Phase 1: Generate Images with Whisk ───
            directorLog(0, "PHASE", "━━━ PHASE 1: Image Generation (Whisk) ━━━");

            // Connect to browser
            let browser;
            try {
                browser = await puppeteer.connect({
                    browserURL: 'http://127.0.0.1:9222',
                    defaultViewport: null
                });
                directorLog(0, "BROWSER", "🔗 Connected to Chrome");
            } catch (err) {
                directorLog(0, "ERROR", `Failed to connect to Chrome: ${err.message}`);
                directorState.isRunning = false;
                return;
            }

            const whiskResult = await generateImagesWhisk(
                enrichedScenes,
                subjectRegistry,
                projectDir.server,
                visualStyle,
                styleDNA?.visual_identity || null,
                browser,
                directorLog,
                aspectRatio
            );

            directorLog(0, "PHASE1_DONE", `✅ Whisk generated ${whiskResult.sceneImages.length} scene images`);

            // ─── Phase 2: Image-to-Video (I2V) ───
            directorLog(0, "PHASE", "━━━ PHASE 2: Image-to-Video (I2V) ━━━");
            directorLog(0, "I2V", `🎬 I2V Director: ${videoSource} (${whiskResult.sceneImages.length} images to animate)`);

            let i2vResults = [];

            if (videoSource === 'grok') {
                i2vResults = await generateVideosGrokI2V(
                    whiskResult.sceneImages,
                    enrichedScenes,
                    projectDir.server,
                    aspectRatio,
                    browser,
                    directorLog
                );
            } else {
                // Map the downloaded scene images to the format expected by V2 Director
                const v2Scenes = whiskResult.sceneImages.map(img => {
                    const sceneData = enrichedScenes[img.sceneNum - 1];
                    const motionPrompt = sceneData?.motion_prompt || 'slow cinematic camera movement';
                    return {
                        prompt: motionPrompt,
                        initial_image: img.filePath, // Triggers V2 I2V mode
                        index: img.sceneNum - 1
                    };
                });

                const onProgress = (p) => {
                    directorLog(p.sceneIndex + 1, p.status === 'done' ? 'DONE' : p.status === 'failed' ? 'FAIL' : 'GEN',
                        p.status === 'done' ? `✅ Scene ${p.sceneIndex + 1}/${v2Scenes.length} downloaded` :
                            p.status === 'failed' ? `❌ Scene ${p.sceneIndex + 1} failed: ${p.error}` :
                                `⏳ Scene ${p.sceneIndex + 1}/${v2Scenes.length} generating... (${p.pct}%)`);
                };

                const metaResults = await generateVideosMetaV2(browser, v2Scenes, {
                    projectDir: projectDir.server,
                    aspectRatio,
                    mode: 'video',
                    isI2V: true,
                    onProgress
                });

                // Map back to expected format for assembly
                i2vResults = metaResults.map(r => ({
                    sceneNum: r.sceneIndex + 1,
                    success: r.status === 'done',
                    videoPath: r.filePath
                }));
            }

            const successCount = i2vResults.filter(r => r.success).length;
            directorLog(0, "PHASE2_DONE", `✅ I2V generated ${successCount}/${whiskResult.sceneImages.length} video clips`);

            // ─── Phase 3: FFmpeg Assembly ───
            directorLog(0, "PHASE", "━━━ PHASE 3: Assembly ━━━");

            if (successCount > 0) {
                const videoFiles = i2vResults.filter(r => r.success).map(r => r.videoPath);
                directorLog(0, "ASSEMBLY", `🔨 ${videoFiles.length} clips ready for FFmpeg assembly`);
                // TODO: Sprint 5 — FFmpeg concatenation
                directorLog(0, "ASSEMBLY", "⏳ FFmpeg assembly will be added in Sprint 5");
            } else {
                directorLog(0, "ASSEMBLY", "⚠️ No video clips to assemble");
            }

            directorState.isRunning = false;
            directorLog(0, "COMPLETE", `🎉 Pro Pipeline complete! ${whiskResult.sceneImages.length} images → ${successCount} videos`);

        } catch (err) {
            directorState.isRunning = false;
            directorLog(0, "ERROR", `Pro Pipeline failed: ${err.message}`);
        }
    })();

    res.json({
        status: "started",
        message: "Pro Pipeline started (Phase 1: Whisk Image Generation)",
        projectFolder: projectDir.name,
        visualStyle,
        aspectRatio,
        jobId: newJobId,
        pipelineMode: 'pro',
        videoSource,
        phases: ['whisk_images', 'i2v_video', 'assembly']
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

// ═══════════════════════════════════════════════════════════════
// ACCOUNT SESSION MANAGEMENT API
// ═══════════════════════════════════════════════════════════════

app.get('/accounts/status', (req, res) => {
    res.json(SM.getStatus());
});

app.post('/accounts/:service/load', (req, res) => {
    const { service } = req.params;
    const { cookies } = req.body;
    if (!cookies) return res.status(400).json({ error: 'Missing cookies field' });
    const result = SM.loadSession(service, cookies);
    res.json(result);
});

app.post('/accounts/:service/verify', async (req, res) => {
    const { service } = req.params;
    try {
        // Use existing browser if available, otherwise launch a temporary one
        let tempBrowser = null;
        let browserToUse = null;

        // Try to connect to existing browser
        try {
            const puppeteerCore = require('puppeteer-extra');
            browserToUse = await puppeteerCore.launch({
                headless: false,
                defaultViewport: null,
                args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--window-position=0,0']
            });
            tempBrowser = browserToUse;
        } catch (e) {
            return res.status(500).json({ error: 'Cannot launch browser for verification' });
        }

        const result = await SM.verifySession(service, browserToUse);

        // Close temp browser
        if (tempBrowser) {
            await tempBrowser.close().catch(() => { });
        }

        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/accounts/:service/remove', (req, res) => {
    const result = SM.removeSession(req.params.service);
    res.json(result);
});

app.listen(PORT, () => {
    console.log(`[DIRECTOR AGENT] ${VERSION} - Server running on http://localhost:${PORT}`);
    console.log(`[DIRECTOR AGENT] Output Dirs: \n - Public: ${PUBLIC_OUTPUT_DIR} \n - Server: ${SERVER_OUTPUT_DIR}`);
    console.log(`[SESSION MGR] Account status:`, JSON.stringify(SM.getStatus()));
});
