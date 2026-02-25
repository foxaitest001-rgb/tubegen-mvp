// ═══════════════════════════════════════════════════════════════
// META DIRECTOR v2
// Extension-inspired robust automation for meta.ai
// Supports: Text→Video (Quick), Image→Video (Pro)
// Features: UI config, MutationObserver, CDP download, batch
// ═══════════════════════════════════════════════════════════════

const path = require('path');
const fs = require('fs');
const { DownloadWatcher } = require('./download_watcher');
const SM = require('./session_manager');

// ─── Multi-Selector Fallback System ───
const SELECTORS = {
    promptInput: [
        '[contenteditable="true"]',
        'div[role="textbox"]',
        'textarea[placeholder]',
        'textarea',
        '.input-field [contenteditable]',
        'div[data-testid="message-input"]'
    ],

    sendButton: [
        'button[aria-label="Send"]',
        'button[aria-label="Submit"]',
        'button[type="submit"]',
        'button[data-testid="send-button"]',
        'div[role="button"][aria-label="Send"]'
    ],

    // Imagine mode toggle
    imagineToggle: [
        'button[aria-label*="Imagine"]',
        'button[aria-label*="imagine"]',
        '[data-testid="imagine-toggle"]',
        'button:has(svg[viewBox])'
    ],

    // Video mode (after Imagine)
    videoMode: [
        'button[aria-label*="Video"]',
        'button[aria-label*="video"]',
        '[data-testid="video-mode"]',
        'button:has-text("Video")'
    ],

    // Animate button (for I2V)
    animateButton: [
        'button[aria-label*="Animate"]',
        'button[aria-label*="animate"]',
        '[data-testid="animate-button"]'
    ],

    // Aspect ratio
    aspectRatio: {
        container: [
            'button[aria-label*="aspect"]',
            'button[aria-label*="ratio"]',
            '[data-testid="aspect-ratio"]',
            '.ratio-selector'
        ],
        options: {
            '16:9': ['[data-value="16:9"]', 'button[aria-label*="16:9"]', '[title="16:9"]'],
            '9:16': ['[data-value="9:16"]', 'button[aria-label*="9:16"]', '[title="9:16"]'],
            '1:1': ['[data-value="1:1"]', 'button[aria-label*="1:1"]', '[title="1:1"]'],
            '4:5': ['[data-value="4:5"]', 'button[aria-label*="4:5"]', '[title="4:5"]']
        }
    },

    // Generated video element
    videoResult: [
        'video[src]',
        'video source[src]',
        'video[autoplay]',
        '.message-content video',
        '[data-testid="generated-video"]'
    ],

    // Download button
    downloadButton: [
        'button[aria-label*="Download"]',
        'a[download]',
        'button[aria-label*="download"]',
        '[data-testid="download"]'
    ],

    // File upload input
    fileInput: [
        'input[type="file"]',
        'input[accept*="image"]'
    ]
};

// ─── Find element with fallback ───
async function findElement(page, selectorList, description = '') {
    for (const selector of selectorList) {
        try {
            const el = await page.$(selector);
            if (el) {
                console.log(`[MetaV2] ✅ Found ${description} via: ${selector}`);
                return el;
            }
        } catch { /* try next */ }
    }
    console.log(`[MetaV2] ⚠️ Could not find ${description}`);
    return null;
}

async function findByText(page, text) {
    return page.evaluateHandle((searchText) => {
        const elements = document.querySelectorAll('button, a, span, div[role="button"]');
        for (const el of elements) {
            if (el.textContent.trim().toLowerCase().includes(searchText.toLowerCase())) {
                return el;
            }
        }
        return null;
    }, text);
}

// ═══════════════════════════════════════════════════════════════
// UI CONFIGURATION
// ═══════════════════════════════════════════════════════════════

async function configureUI(page, options = {}) {
    const { aspectRatio = '16:9', mode = 'video' } = options;
    console.log(`[MetaV2] ⚙️ Configuring UI: mode=${mode}, aspect=${aspectRatio}`);

    // Step 1: Enter Imagine mode
    try {
        const imagineBtn = await findElement(page, SELECTORS.imagineToggle, 'Imagine toggle');
        if (imagineBtn) {
            await imagineBtn.click();
            await delay(1500);
            console.log('[MetaV2] ✅ Imagine mode enabled');
        } else {
            // Try by text
            const textBtn = await findByText(page, 'Imagine');
            if (textBtn) {
                await textBtn.click();
                await delay(1500);
            }
        }
    } catch (err) {
        console.log(`[MetaV2] ⚠️ Imagine toggle: ${err.message}`);
    }

    // Step 2: Select Video mode
    if (mode === 'video') {
        try {
            const videoBtn = await findElement(page, SELECTORS.videoMode, 'Video mode');
            if (videoBtn) {
                await videoBtn.click();
                await delay(1000);
                console.log('[MetaV2] ✅ Video mode selected');
            } else {
                const textBtn = await findByText(page, 'Video');
                if (textBtn) {
                    await textBtn.click();
                    await delay(1000);
                }
            }
        } catch (err) {
            console.log(`[MetaV2] ⚠️ Video mode: ${err.message}`);
        }
    }

    // Step 3: Set aspect ratio
    try {
        const ratioContainer = await findElement(page, SELECTORS.aspectRatio.container, 'aspect ratio');
        if (ratioContainer) {
            await ratioContainer.click();
            await delay(500);

            const ratioSelectors = SELECTORS.aspectRatio.options[aspectRatio] || [];
            const ratioOption = await findElement(page, ratioSelectors, `ratio ${aspectRatio}`);
            if (ratioOption) {
                await ratioOption.click();
                await delay(500);
                console.log(`[MetaV2] ✅ Aspect ratio: ${aspectRatio}`);
            } else {
                const textOption = await findByText(page, aspectRatio);
                if (textOption) {
                    await textOption.click();
                    console.log(`[MetaV2] ✅ Aspect ratio: ${aspectRatio} (via text)`);
                }
            }
        } else {
            console.log(`[MetaV2] ⚠️ No aspect ratio selector — adding to prompt`);
        }
    } catch (err) {
        console.log(`[MetaV2] ⚠️ Aspect ratio config: ${err.message}`);
    }

    console.log('[MetaV2] ⚙️ UI configuration complete');
}

// ═══════════════════════════════════════════════════════════════
// GENERATE SINGLE SCENE (Text → Video)
// ═══════════════════════════════════════════════════════════════

async function generateScene(page, scene, downloadWatcher) {
    const sceneNum = scene.index + 1;
    console.log(`[MetaV2] 🎬 Scene ${sceneNum}: "${scene.prompt.substring(0, 60)}..."`);

    // Step 1: Find input and type prompt
    const inputElement = await findElement(page, SELECTORS.promptInput, 'prompt input');
    if (!inputElement) throw new Error('Could not find prompt input field');

    // Clear contenteditable
    await page.evaluate((selectors) => {
        for (const sel of selectors) {
            const el = document.querySelector(sel);
            if (el) {
                if (el.getAttribute('contenteditable') === 'true') {
                    el.innerHTML = '';
                    el.textContent = '';
                } else {
                    el.value = '';
                }
                el.dispatchEvent(new Event('input', { bubbles: true }));
                return;
            }
        }
    }, SELECTORS.promptInput);

    await delay(300);
    await inputElement.click();
    await page.keyboard.type(scene.prompt, { delay: 15 });
    await delay(500);

    // Step 2: Submit
    const sendBtn = await findElement(page, SELECTORS.sendButton, 'send button');
    if (sendBtn) {
        await sendBtn.click();
    } else {
        await page.keyboard.press('Enter');
    }

    console.log(`[MetaV2] ⏳ Scene ${sceneNum}: Waiting for generation...`);

    // Step 3: Wait for video via MutationObserver
    const videoUrl = await waitForVideo(page, 180000);
    if (!videoUrl) throw new Error(`Scene ${sceneNum}: No video generated within timeout`);

    console.log(`[MetaV2] 🎥 Scene ${sceneNum}: Video detected`);

    // Step 4: Download
    let result;

    // Direct URL download
    if (videoUrl.startsWith('http')) {
        result = await downloadWatcher.downloadUrl(videoUrl, scene.index);
    }

    // Fallback: click download button
    if (!result || !result.success) {
        const dlBtn = await findElement(page, SELECTORS.downloadButton, 'download button');
        if (dlBtn) {
            await dlBtn.click();
            result = await downloadWatcher.waitForDownload(scene.index, 60000);
        }
    }

    if (!result || !result.success) {
        throw new Error(`Scene ${sceneNum}: Download failed`);
    }

    console.log(`[MetaV2] ✅ Scene ${sceneNum}: Downloaded → ${result.filePath}`);
    return result;
}

// ═══════════════════════════════════════════════════════════════
// IMAGE-TO-VIDEO (Pro mode)
// ═══════════════════════════════════════════════════════════════

async function generateI2VScene(page, scene, downloadWatcher) {
    const sceneNum = scene.index + 1;
    console.log(`[MetaV2] 🎬 I2V Scene ${sceneNum}: image=${scene.imageFile}`);

    // Step 1: Upload image
    const fileInput = await findElement(page, SELECTORS.fileInput, 'file input');
    if (!fileInput) throw new Error('Could not find file upload input');

    await fileInput.uploadFile(scene.imageFile);
    await delay(3000); // Wait for image to load

    // Step 2: Click Animate (if separate from generate)
    const animateBtn = await findElement(page, SELECTORS.animateButton, 'animate button');
    if (animateBtn) {
        await animateBtn.click();
        await delay(1000);
    }

    // Step 3: Type motion prompt
    if (scene.motionPrompt) {
        const inputElement = await findElement(page, SELECTORS.promptInput, 'prompt input');
        if (inputElement) {
            await inputElement.click();
            await page.keyboard.type(scene.motionPrompt, { delay: 15 });
            await delay(500);
        }
    }

    // Step 4: Submit
    const sendBtn = await findElement(page, SELECTORS.sendButton, 'send button');
    if (sendBtn) {
        await sendBtn.click();
    } else {
        await page.keyboard.press('Enter');
    }

    // Step 5: Wait for video
    const videoUrl = await waitForVideo(page, 180000);
    if (!videoUrl) throw new Error(`I2V Scene ${sceneNum}: No video within timeout`);

    // Step 6: Download
    let result;
    if (videoUrl.startsWith('http')) {
        result = await downloadWatcher.downloadUrl(videoUrl, scene.index);
    }
    if (!result || !result.success) {
        const dlBtn = await findElement(page, SELECTORS.downloadButton, 'download button');
        if (dlBtn) {
            await dlBtn.click();
            result = await downloadWatcher.waitForDownload(scene.index, 60000);
        }
    }

    if (!result || !result.success) throw new Error(`I2V Scene ${sceneNum}: Download failed`);
    return result;
}

// ═══════════════════════════════════════════════════════════════
// MUTATION OBSERVER
// ═══════════════════════════════════════════════════════════════

async function waitForVideo(page, timeoutMs = 180000) {
    return page.evaluate((timeout, videoSelectors) => {
        return new Promise((resolve) => {
            // Track which videos existed before
            const existingVideos = new Set();
            document.querySelectorAll('video').forEach(v => {
                if (v.src) existingVideos.add(v.src);
            });

            let resolved = false;

            const observer = new MutationObserver(() => {
                if (resolved) return;

                // Look for NEW video elements (not ones that existed before)
                const allVideos = document.querySelectorAll('video');
                for (const video of allVideos) {
                    const src = video.src || video.querySelector('source')?.src;
                    if (src && !existingVideos.has(src)) {
                        resolved = true;
                        observer.disconnect();
                        resolve(src);
                        return;
                    }
                }

                // Also check our specific selectors
                for (const sel of videoSelectors) {
                    const el = document.querySelector(sel);
                    if (el) {
                        const src = el.src || el.querySelector('source')?.src;
                        if (src && !existingVideos.has(src)) {
                            resolved = true;
                            observer.disconnect();
                            resolve(src);
                            return;
                        }
                    }
                }
            });

            observer.observe(document.body, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ['src']
            });

            setTimeout(() => {
                if (!resolved) {
                    resolved = true;
                    observer.disconnect();
                    resolve(null);
                }
            }, timeout);
        });
    }, timeoutMs, SELECTORS.videoResult);
}

// ═══════════════════════════════════════════════════════════════
// MAIN — Full batch generation
// ═══════════════════════════════════════════════════════════════

async function generateVideosMetaV2(browser, scenes, options = {}) {
    const {
        projectDir,
        aspectRatio = '16:9',
        mode = 'video',
        isI2V = false,
        onProgress = () => { }
    } = options;

    const videoDir = path.join(projectDir, 'videos');
    if (!fs.existsSync(videoDir)) fs.mkdirSync(videoDir, { recursive: true });

    const downloadWatcher = new DownloadWatcher(videoDir);
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });
    await downloadWatcher.setupCDP(page);

    // Inject cookies & navigate
    await SM.injectCookies(page, 'meta');
    await page.goto('https://www.meta.ai/', { waitUntil: 'networkidle2', timeout: 30000 });
    await delay(3000);

    // Configure UI (mode, aspect ratio)
    await configureUI(page, { aspectRatio, mode });

    // Process scenes
    const results = [];
    for (let i = 0; i < scenes.length; i++) {
        const scene = { ...scenes[i], index: i };

        onProgress({
            sceneIndex: i,
            totalScenes: scenes.length,
            status: 'generating',
            pct: Math.round((i / scenes.length) * 100)
        });

        let attempts = 0;
        let success = false;

        while (attempts < 3 && !success) {
            attempts++;
            try {
                let result;
                if (isI2V) {
                    result = await generateI2VScene(page, scene, downloadWatcher);
                } else {
                    result = await generateScene(page, scene, downloadWatcher);
                }

                results.push({ sceneIndex: i, status: 'done', filePath: result.filePath, attempts });
                success = true;

                onProgress({
                    sceneIndex: i,
                    totalScenes: scenes.length,
                    status: 'done',
                    filePath: result.filePath,
                    pct: Math.round(((i + 1) / scenes.length) * 100)
                });
            } catch (err) {
                console.log(`[MetaV2] ❌ Scene ${i + 1} attempt ${attempts}/3: ${err.message}`);
                if (attempts >= 3) {
                    results.push({ sceneIndex: i, status: 'failed', error: err.message, attempts });
                    onProgress({ sceneIndex: i, totalScenes: scenes.length, status: 'failed', error: err.message });
                }
                await delay(5000 * attempts);
            }
        }

        if (i < scenes.length - 1) await delay(5000);
    }

    await page.close();
    const doneCount = results.filter(r => r.status === 'done').length;
    console.log(`[MetaV2] 🏁 Batch complete: ${doneCount}/${scenes.length} scenes`);
    return results;
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

module.exports = { generateVideosMetaV2, configureUI, generateScene, generateI2VScene };
