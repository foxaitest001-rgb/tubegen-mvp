// ═══════════════════════════════════════════════════════════════
// Grok I2V Director — Image-to-Video via Browser Automation
// Uploads Whisk-generated scene images → generates video clips
// URL: https://grok.com (Imagine → Video mode)
// Includes upscale step before download
// ═══════════════════════════════════════════════════════════════

const path = require('path');
const fs = require('fs');
const { GROK } = require('./dom_selectors');

// ─── Config ───
const GROK_URL = 'https://grok.com';
const GENERATION_TIMEOUT = 180000;       // 3 min max for video generation
const UPSCALE_TIMEOUT = 120000;          // 2 min max for upscale
const BETWEEN_GENERATIONS_DELAY = 45000; // 45s between generations (rate limit)
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
    else console.log(`[Grok-I2V][${tag}] ${msg}`);
}

// ═══════════════════════════════════════════════════════════════
// MAIN: Generate Videos from Scene Images via Grok
// ═══════════════════════════════════════════════════════════════

/**
 * Generate video clips from Whisk scene images using Grok Imagine.
 * 
 * Flow per scene:
 *   1. Open settings → set Video mode, 6s, 480p, aspect ratio
 *   2. Upload scene image
 *   3. Type motion prompt
 *   4. Submit → wait for video
 *   5. Upscale via 3-dots menu
 *   6. Download video
 *
 * @param {Array} sceneImages - From Whisk: [{ sceneNum, filePath, sceneType }]
 * @param {Array} enrichedScenes - Full scene data with motion_prompt
 * @param {string} outputDir - Path to save video files
 * @param {string} aspectRatio - "16:9", "9:16", "1:1", etc.
 * @param {object} browser - Puppeteer browser instance
 * @param {function} logFn - Director log function
 * @returns {Array} [{ sceneNum, videoPath, success }]
 */
async function generateVideosGrokI2V(sceneImages, enrichedScenes, outputDir, aspectRatio, browser, logFn) {
    setLog(logFn);

    const videosDir = path.join(outputDir, 'videos');
    if (!fs.existsSync(videosDir)) {
        fs.mkdirSync(videosDir, { recursive: true });
    }

    log(0, 'GROK_I2V', '🎬 Grok I2V Director starting...');
    log(0, 'GROK_I2V', `📁 Output: ${videosDir}`);
    log(0, 'GROK_I2V', `🖼️ Scene images: ${sceneImages.length}`);

    // ─── Get or open Grok tab ───
    let page = await findOrOpenGrokTab(browser);

    // ─── Configure video settings ───
    await configureVideoSettings(page, aspectRatio);

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
            const prompt = buildGrokVideoPrompt(scene, motionPrompt);
            await typePrompt(page, prompt);
            log(sceneImg.sceneNum, 'PROMPT', `📝 Prompt: ${prompt.substring(0, 60)}...`);

            // Step 3: Submit
            await submitPrompt(page);
            log(sceneImg.sceneNum, 'SUBMIT', '🚀 Submitted');

            // Step 4: Wait for video generation
            const videoGenerated = await waitForVideo(page);

            if (videoGenerated) {
                log(sceneImg.sceneNum, 'GENERATED', '🎥 Video generated!');

                // Step 5: Upscale the video
                await upscaleVideo(page);
                log(sceneImg.sceneNum, 'UPSCALE', '⬆️ Upscale started...');
                await waitForUpscale(page);
                log(sceneImg.sceneNum, 'UPSCALE', '✅ Upscale complete');

                // Step 6: Download the video
                const videoPath = path.join(videosDir, `scene_${sceneImg.sceneNum}.mp4`);
                await downloadVideo(page, videoPath);
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
    log(0, 'COMPLETE', `━━━ Grok I2V Complete: ${successCount}/${sceneImages.length} videos ━━━`);

    return results;
}


// ═══════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════

/**
 * Find existing Grok Imagine tab or open new one
 */
async function findOrOpenGrokTab(browser) {
    const pages = await browser.pages();
    for (const p of pages) {
        if (p.url().includes('grok.com')) {
            log(0, 'TAB', '♻️ Reusing existing Grok tab');

            // Navigate to Imagine if not already there
            const url = p.url();
            if (!url.includes('imagine')) {
                // Click Imagine tab in sidebar
                await p.evaluate(() => {
                    const links = document.querySelectorAll('a');
                    for (const a of links) {
                        if (a.textContent.trim() === 'Imagine') {
                            a.click();
                            return;
                        }
                    }
                });
                await sleep(2000);
            }
            return p;
        }
    }

    const page = await browser.newPage();
    log(0, 'TAB', `🌐 Opening Grok: ${GROK_URL}`);
    await page.goto(GROK_URL, { waitUntil: 'networkidle2', timeout: 30000 });
    await sleep(PAGE_LOAD_DELAY);

    // Navigate to Imagine
    await page.evaluate(() => {
        const links = document.querySelectorAll('a');
        for (const a of links) {
            if (a.textContent.trim() === 'Imagine') {
                a.click();
                return;
            }
        }
    });
    await sleep(3000);
    return page;
}

/**
 * Open settings dropdown and configure: Video mode, 6s, 480p, aspect ratio
 */
async function configureVideoSettings(page, aspectRatio) {
    try {
        // Open settings dropdown
        const optionsBtn = await page.$('button[aria-label="Options"]');
        if (optionsBtn) {
            await optionsBtn.click();
            await sleep(1000);
        } else {
            log(0, 'WARN', '⚠️ Could not find Options button');
            return;
        }

        // Select Video mode (click the "Video" span in the dropdown)
        await page.evaluate(() => {
            const dropdown = document.querySelector('[data-state="open"]');
            if (!dropdown) return;
            const spans = dropdown.querySelectorAll('span.font-semibold');
            for (const s of spans) {
                if (s.textContent.trim() === 'Video') {
                    // Click the parent clickable element
                    const parent = s.closest('div[role="menuitem"]') || s.closest('div') || s.parentElement;
                    if (parent) parent.click();
                    return;
                }
            }
        });
        await sleep(500);
        log(0, 'MODE', '🎥 Video mode selected');

        // Reopen dropdown (it may have closed)
        const optionsBtn2 = await page.$('button[aria-label="Options"]');
        if (optionsBtn2) {
            await optionsBtn2.click();
            await sleep(1000);
        }

        // Set duration: 6s (free tier)
        const dur6s = await page.$('button[aria-label="6s"]');
        if (dur6s) {
            await dur6s.click();
            log(0, 'DURATION', '⏱️ Duration: 6s');
        }
        await sleep(300);

        // Set resolution: 480p (free tier)
        const res480 = await page.$('button[aria-label="480p"]');
        if (res480) {
            await res480.click();
            log(0, 'RESOLUTION', '📺 Resolution: 480p');
        }
        await sleep(300);

        // Set aspect ratio
        const ratioSelector = `button[aria-label="${aspectRatio}"]`;
        const ratioBtn = await page.$(ratioSelector);
        if (ratioBtn) {
            await ratioBtn.click();
            log(0, 'RATIO', `📐 Aspect ratio: ${aspectRatio}`);
        } else {
            log(0, 'WARN', `⚠️ Ratio ${aspectRatio} not found, using default`);
        }
        await sleep(300);

        // Close dropdown by clicking elsewhere
        await page.keyboard.press('Escape');
        await sleep(500);

    } catch (err) {
        log(0, 'WARN', `Settings configuration failed: ${err.message}`);
    }
}

/**
 * Upload an image via the hidden file input
 */
async function uploadImage(page, imagePath) {
    // Click "Upload image" button first to activate the file input
    const uploadBtn = await page.$('button[aria-label="Upload image"]');
    if (uploadBtn) {
        await uploadBtn.click();
        await sleep(1000);
    }

    const fileInput = await page.$('input[type="file"]');
    if (!fileInput) {
        throw new Error('File input not found');
    }
    await fileInput.uploadFile(imagePath);
    await sleep(3000); // Wait for upload + preview
}

/**
 * Type a prompt into Grok's TipTap/ProseMirror editor
 */
async function typePrompt(page, prompt) {
    // Grok uses a contenteditable div with TipTap
    const editor = await page.$('div.tiptap.ProseMirror');
    if (editor) {
        await editor.click();
        await sleep(200);
        // Select all existing text and replace
        await page.keyboard.down('Control');
        await page.keyboard.press('a');
        await page.keyboard.up('Control');
        await sleep(100);
        await page.keyboard.type(prompt, { delay: 10 });
        return;
    }

    // Fallback: try textarea
    const textarea = await page.$('textarea');
    if (textarea) {
        await textarea.click({ clickCount: 3 });
        await sleep(200);
        await textarea.type(prompt, { delay: 10 });
        return;
    }

    throw new Error('No text input found');
}

/**
 * Submit the prompt
 */
async function submitPrompt(page) {
    const btn = await page.$('button[aria-label="Submit"]');
    if (btn) {
        await btn.click();
        return;
    }
    throw new Error('Submit button not found');
}

/**
 * Wait for a video to appear in the results
 */
async function waitForVideo(page) {
    log(0, 'WAIT', '⏳ Waiting for Grok to generate video...');
    const startTime = Date.now();

    // Count existing videos
    const existingCount = await page.evaluate(() => document.querySelectorAll('video').length);

    while (Date.now() - startTime < GENERATION_TIMEOUT) {
        const hasNewVideo = await page.evaluate((prevCount) => {
            const videos = document.querySelectorAll('video');
            if (videos.length > prevCount) {
                const newest = videos[videos.length - 1];
                const src = newest.src || newest.currentSrc || '';
                return src.includes('assets.grok.com') || src.length > 10;
            }
            return false;
        }, existingCount);

        if (hasNewVideo) {
            return true;
        }

        await sleep(5000);
    }

    return false;
}

/**
 * Upscale the latest video via 3-dots menu
 */
async function upscaleVideo(page) {
    try {
        // Click "Video Options" (3-dots button)
        const optionsBtn = await page.$('button[aria-label="Video Options"]');
        if (!optionsBtn) {
            log(0, 'WARN', '⚠️ Video Options button not found, skipping upscale');
            return;
        }
        await optionsBtn.click();
        await sleep(1000);

        // Click "Upscale" menu item
        const clicked = await page.evaluate(() => {
            const menuItems = document.querySelectorAll('div[role="menuitem"]');
            for (const item of menuItems) {
                if (item.textContent.trim() === 'Upscale') {
                    item.click();
                    return true;
                }
            }
            return false;
        });

        if (clicked) {
            log(0, 'UPSCALE', '⬆️ Upscale initiated');
        } else {
            log(0, 'WARN', '⚠️ Upscale menu item not found');
        }
    } catch (err) {
        log(0, 'WARN', `Upscale failed: ${err.message}`);
    }
}

/**
 * Wait for upscale to complete (video src may change)
 */
async function waitForUpscale(page) {
    const startTime = Date.now();

    while (Date.now() - startTime < UPSCALE_TIMEOUT) {
        // Check if loading indicators are gone
        const isLoading = await page.evaluate(() => {
            const loaders = document.querySelectorAll('[class*="loading"], [class*="spinner"], [class*="progress"], [class*="processing"]');
            return loaders.length > 0;
        });

        if (!isLoading && Date.now() - startTime > 10000) {
            // Give it 10s minimum, then check if we're done
            return;
        }

        await sleep(5000);
    }
}

/**
 * Download the latest video
 */
async function downloadVideo(page, outputPath) {
    try {
        // Method 1: Get video src and fetch it
        const videoSrc = await page.evaluate(() => {
            const videos = document.querySelectorAll('video');
            if (videos.length === 0) return null;
            const latest = videos[videos.length - 1];
            return latest.src || latest.currentSrc || null;
        });

        if (videoSrc && videoSrc.includes('assets.grok.com')) {
            // Fetch via page context
            const base64Video = await page.evaluate(async (src) => {
                const res = await fetch(src);
                const blob = await res.blob();
                return new Promise((resolve) => {
                    const reader = new FileReader();
                    reader.onloadend = () => resolve(reader.result);
                    reader.readAsDataURL(blob);
                });
            }, videoSrc);

            if (base64Video && base64Video.startsWith('data:')) {
                const base64Data = base64Video.replace(/^data:video\/\w+;base64,/, '');
                fs.writeFileSync(outputPath, Buffer.from(base64Data, 'base64'));
                return;
            }
        }

        // Method 2: Click download button
        const dlBtn = await page.$('button[aria-label="Download"]');
        if (dlBtn) {
            // Set download path via CDP
            const client = await page.target().createCDPSession();
            await client.send('Page.setDownloadBehavior', {
                behavior: 'allow',
                downloadPath: path.dirname(outputPath)
            });
            await dlBtn.click();
            log(0, 'DOWNLOAD', '📥 Download button clicked, waiting for file...');
            await sleep(10000);
            // Try to find the downloaded file and rename it
            const dir = path.dirname(outputPath);
            const files = fs.readdirSync(dir).filter(f => f.endsWith('.mp4')).sort((a, b) => {
                return fs.statSync(path.join(dir, b)).mtime - fs.statSync(path.join(dir, a)).mtime;
            });
            if (files.length > 0) {
                const latestFile = path.join(dir, files[0]);
                if (latestFile !== outputPath) {
                    fs.renameSync(latestFile, outputPath);
                }
            }
        }

    } catch (err) {
        log(0, 'ERROR', `Download failed: ${err.message}`);
        // Fallback: take a screenshot as evidence
        const screenshotPath = outputPath.replace('.mp4', '_error.png');
        try { await page.screenshot({ path: screenshotPath }); } catch (e) { }
    }
}

/**
 * Build a video prompt from scene data + motion prompt
 */
function buildGrokVideoPrompt(scene, motionPrompt) {
    const visual = scene?.image_prompt || scene?.visual_cue || '';
    return `${visual}. ${motionPrompt}. Cinematic, smooth, professional.`.substring(0, 500);
}


// ═══════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════

module.exports = {
    generateVideosGrokI2V
};
