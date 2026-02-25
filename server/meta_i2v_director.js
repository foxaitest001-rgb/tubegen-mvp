// ═══════════════════════════════════════════════════════════════
// Meta.ai I2V Director — Image-to-Video via Browser Automation
// Uploads Whisk-generated scene images → generates video clips
// URL: https://meta.ai (Imagine → Video mode)
// ═══════════════════════════════════════════════════════════════

const path = require('path');
const fs = require('fs');
const { META } = require('./dom_selectors');

// ─── Config ───
const META_URL = 'https://www.meta.ai/imagine/';
const GENERATION_TIMEOUT = 180000;       // 3 min max for video generation
const BETWEEN_GENERATIONS_DELAY = 40000; // 40s between generations (rate limit)
const PAGE_LOAD_DELAY = 5000;

/**
 * Interruptible sleep
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Director logging
 */
let _log = null;
function setLog(fn) { _log = fn; }
function log(step, tag, msg) {
    if (_log) _log(step, tag, msg);
    else console.log(`[Meta-I2V][${tag}] ${msg}`);
}

// ═══════════════════════════════════════════════════════════════
// MAIN: Generate Videos from Scene Images via Meta.ai
// ═══════════════════════════════════════════════════════════════

/**
 * Generate video clips from Whisk scene images using Meta.ai Imagine.
 * 
 * Flow per scene:
 *   1. Switch to Video mode
 *   2. Set aspect ratio
 *   3. Upload scene image
 *   4. Type motion prompt
 *   5. Submit → wait for video
 *   6. Download video
 *
 * @param {Array} sceneImages - From Whisk: [{ sceneNum, filePath, sceneType }]
 * @param {Array} enrichedScenes - Full scene data with motion_prompt
 * @param {string} outputDir - Path to save video files
 * @param {string} aspectRatio - "16:9", "9:16", etc.
 * @param {object} browser - Puppeteer browser instance
 * @param {function} logFn - Director log function
 * @returns {Array} [{ sceneNum, videoPath, success }]
 */
async function generateVideosMetaI2V(sceneImages, enrichedScenes, outputDir, aspectRatio, browser, logFn) {
    setLog(logFn);

    const videosDir = path.join(outputDir, 'videos');
    if (!fs.existsSync(videosDir)) {
        fs.mkdirSync(videosDir, { recursive: true });
    }

    log(0, 'META_I2V', '🎬 Meta.ai I2V Director starting...');
    log(0, 'META_I2V', `📁 Output: ${videosDir}`);
    log(0, 'META_I2V', `🖼️ Scene images: ${sceneImages.length}`);

    // ─── Get or open Meta.ai tab ───
    let page = await findOrOpenMetaTab(browser);

    // ─── Switch to Video mode ───
    await switchToVideoMode(page);
    await sleep(1000);

    // ─── Set aspect ratio ───
    await setMetaAspectRatio(page, aspectRatio);
    await sleep(500);

    // ─── Process each scene ───
    const results = [];

    for (const sceneImg of sceneImages) {
        const scene = enrichedScenes[sceneImg.sceneNum - 1];
        const motionPrompt = scene?.motion_prompt || 'slow cinematic camera movement';

        log(sceneImg.sceneNum, 'SCENE', `🎬 Scene ${sceneImg.sceneNum}: ${motionPrompt.substring(0, 50)}...`);

        try {
            // Step 1: Upload scene image
            await uploadImage(page, sceneImg.filePath);
            log(sceneImg.sceneNum, 'UPLOAD', `📤 Uploaded: ${path.basename(sceneImg.filePath)}`);
            await sleep(2000);

            // Step 2: Type motion prompt
            const prompt = buildMetaVideoPrompt(scene, motionPrompt);
            await typePrompt(page, prompt);
            log(sceneImg.sceneNum, 'PROMPT', `📝 Prompt: ${prompt.substring(0, 60)}...`);

            // Step 3: Submit
            await submitPrompt(page);
            log(sceneImg.sceneNum, 'SUBMIT', '🚀 Submitted');

            // Step 4: Wait for video generation
            const videoSrc = await waitForVideo(page);

            if (videoSrc) {
                // Step 5: Download video
                const videoPath = path.join(videosDir, `scene_${sceneImg.sceneNum}.mp4`);
                await downloadVideo(page, videoSrc, videoPath);
                log(sceneImg.sceneNum, 'DONE', `✅ Video saved: scene_${sceneImg.sceneNum}.mp4`);
                results.push({ sceneNum: sceneImg.sceneNum, videoPath, success: true });
            } else {
                log(sceneImg.sceneNum, 'FAIL', `⚠️ Video generation timed out`);
                results.push({ sceneNum: sceneImg.sceneNum, videoPath: null, success: false });
            }

        } catch (err) {
            log(sceneImg.sceneNum, 'ERROR', `❌ Scene ${sceneImg.sceneNum} failed: ${err.message}`);
            results.push({ sceneNum: sceneImg.sceneNum, videoPath: null, success: false });
        }

        // Rate limit pause
        if (sceneImg !== sceneImages[sceneImages.length - 1]) {
            log(sceneImg.sceneNum, 'WAIT', `⏳ Waiting ${BETWEEN_GENERATIONS_DELAY / 1000}s...`);
            await sleep(BETWEEN_GENERATIONS_DELAY);
        }
    }

    const successCount = results.filter(r => r.success).length;
    log(0, 'COMPLETE', `━━━ Meta.ai I2V Complete: ${successCount}/${sceneImages.length} videos ━━━`);

    return results;
}


// ═══════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════

/**
 * Find existing Meta.ai tab or open new one
 */
async function findOrOpenMetaTab(browser) {
    const pages = await browser.pages();
    for (const p of pages) {
        if (p.url().includes('meta.ai')) {
            log(0, 'TAB', '♻️ Reusing existing Meta.ai tab');
            return p;
        }
    }

    const page = await browser.newPage();
    log(0, 'TAB', `🌐 Opening Meta.ai: ${META_URL}`);
    await page.goto(META_URL, { waitUntil: 'networkidle2', timeout: 30000 });
    await sleep(PAGE_LOAD_DELAY);
    return page;
}

/**
 * Switch Meta.ai Imagine to Video mode
 */
async function switchToVideoMode(page) {
    try {
        const switched = await page.evaluate(() => {
            const buttons = document.querySelectorAll('button');
            for (const b of buttons) {
                // Find button whose direct span text is "Video"
                const spans = b.querySelectorAll('span');
                for (const s of spans) {
                    if (s.textContent.trim() === 'Video') {
                        b.click();
                        return true;
                    }
                }
                if (b.textContent.trim() === 'Video') {
                    b.click();
                    return true;
                }
            }
            return false;
        });

        if (switched) {
            log(0, 'MODE', '🎥 Switched to Video mode');
        } else {
            log(0, 'WARN', '⚠️ Could not find Video mode button');
        }
        await sleep(1000);
    } catch (err) {
        log(0, 'WARN', `Video mode switch failed: ${err.message}`);
    }
}

/**
 * Set aspect ratio on Meta.ai (direct button click by text)
 */
async function setMetaAspectRatio(page, ratio) {
    try {
        const clicked = await page.evaluate((targetRatio) => {
            const buttons = document.querySelectorAll('button');
            for (const b of buttons) {
                if (b.textContent.trim() === targetRatio &&
                    b.className.includes('inline-flex') &&
                    b.className.includes('cursor-pointer')) {
                    b.click();
                    return true;
                }
            }
            return false;
        }, ratio);

        if (clicked) {
            log(0, 'RATIO', `📐 Aspect ratio set to: ${ratio}`);
        } else {
            log(0, 'WARN', `⚠️ Could not set aspect ratio to ${ratio}`);
        }
    } catch (err) {
        log(0, 'WARN', `Aspect ratio failed: ${err.message}`);
    }
}

/**
 * Upload an image via the hidden file input
 */
async function uploadImage(page, imagePath) {
    // Trigger by finding the hidden file input
    const fileInput = await page.$('input[type="file"]');
    if (!fileInput) {
        throw new Error('File input not found');
    }
    await fileInput.uploadFile(imagePath);
    await sleep(3000); // Wait for upload + preview
}

/**
 * Type a prompt into the Meta.ai textarea
 */
async function typePrompt(page, prompt) {
    const textarea = await page.$('textarea');
    if (!textarea) {
        throw new Error('Textarea not found');
    }
    // Clear existing text
    await textarea.click({ clickCount: 3 });
    await sleep(200);
    await textarea.type(prompt, { delay: 10 });
}

/**
 * Submit the prompt
 */
async function submitPrompt(page) {
    // Try aria-label="Send" first
    let btn = await page.$('button[aria-label="Send"]');
    if (btn) {
        await btn.click();
        return;
    }
    // Fallback: find Create button
    const clicked = await page.evaluate(() => {
        const buttons = document.querySelectorAll('button');
        for (const b of buttons) {
            if (b.textContent.trim() === 'Create') {
                b.click();
                return true;
            }
        }
        return false;
    });
    if (!clicked) {
        throw new Error('Submit button not found');
    }
}

/**
 * Wait for a video to appear in the results
 * @returns {string|null} Video src URL or null if timeout
 */
async function waitForVideo(page) {
    log(0, 'WAIT', '⏳ Waiting for Meta.ai to generate video...');
    const startTime = Date.now();

    // Count existing videos before generation
    const existingCount = await page.evaluate(() => document.querySelectorAll('video').length);

    while (Date.now() - startTime < GENERATION_TIMEOUT) {
        const newVideoSrc = await page.evaluate((prevCount) => {
            const videos = document.querySelectorAll('video');
            // Check if we have more videos than before
            if (videos.length > prevCount) {
                // Get the newest video (last one)
                const newest = videos[videos.length - 1];
                return newest.src || newest.currentSrc || null;
            }
            return null;
        }, existingCount);

        if (newVideoSrc && newVideoSrc.includes('fbcdn.net')) {
            log(0, 'RESULT', '🎥 Video generated!');
            return newVideoSrc;
        }

        await sleep(5000);
    }

    log(0, 'TIMEOUT', '⏰ Video generation timed out');
    return null;
}

/**
 * Download a video from its src URL
 */
async function downloadVideo(page, videoSrc, outputPath) {
    try {
        // Method 1: Fetch the URL directly from Node
        // Meta.ai video URLs are direct HTTPS from Facebook CDN
        const response = await page.evaluate(async (src) => {
            const res = await fetch(src);
            const blob = await res.blob();
            return new Promise((resolve) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result);
                reader.readAsDataURL(blob);
            });
        }, videoSrc);

        if (response && response.startsWith('data:')) {
            const base64Data = response.replace(/^data:video\/\w+;base64,/, '');
            fs.writeFileSync(outputPath, Buffer.from(base64Data, 'base64'));
            return;
        }
    } catch (err) {
        log(0, 'WARN', `Fetch download failed, trying direct navigation: ${err.message}`);
    }

    // Method 2: Navigate to the URL and download
    try {
        const viewSource = await page.goto(videoSrc);
        const buffer = await viewSource.buffer();
        fs.writeFileSync(outputPath, buffer);
        // Go back to Meta.ai
        await page.goto(META_URL, { waitUntil: 'networkidle2' });
        await sleep(PAGE_LOAD_DELAY);
    } catch (err) {
        log(0, 'ERROR', `Download completely failed: ${err.message}`);
    }
}

/**
 * Build a video prompt from scene data + motion prompt
 */
function buildMetaVideoPrompt(scene, motionPrompt) {
    const visual = scene?.image_prompt || scene?.visual_cue || '';
    // Keep it concise for video — Meta.ai works best with short, descriptive prompts
    return `${visual}. ${motionPrompt}. Cinematic quality, smooth motion.`.substring(0, 500);
}


// ═══════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════

module.exports = {
    generateVideosMetaI2V
};
