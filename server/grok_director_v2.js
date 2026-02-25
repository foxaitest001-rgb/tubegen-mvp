// ═══════════════════════════════════════════════════════════════
// GROK DIRECTOR v2
// Extension-inspired robust automation for grok.com
// Supports: Text→Video (Quick), Image→Video (Pro)
// Features: UI config, MutationObserver, CDP download, batch
// ═══════════════════════════════════════════════════════════════

const path = require('path');
const fs = require('fs');
const { DownloadWatcher } = require('./download_watcher');
const SM = require('./session_manager');

// ─── Multi-Selector Fallback System ───
const SELECTORS = {
    // Prompt input field — try multiple selectors
    promptInput: [
        'textarea[placeholder*="anything"]',
        'textarea[placeholder*="Ask"]',
        'div[contenteditable="true"]',
        'textarea',
        'div[role="textbox"]',
        '.chat-input textarea',
        '[data-testid="chat-input"]'
    ],

    // Send/Generate button
    sendButton: [
        'button[aria-label="Send"]',
        'button[aria-label="Submit"]',
        'button[data-testid="send-button"]',
        'button[type="submit"]',
        'button svg[viewBox]',   // Icon buttons
    ],

    // Imagine/Video mode toggle
    imagineToggle: [
        'button[aria-label*="Imagine"]',
        'button[aria-label*="imagine"]',
        '[data-testid="imagine-button"]',
        'button:has(svg)',  // Various icon buttons
    ],

    // Aspect ratio selector
    aspectRatio: {
        container: [
            '[data-testid="aspect-ratio"]',
            '.aspect-ratio-selector',
            'button[aria-label*="aspect"]',
            'button[aria-label*="ratio"]'
        ],
        options: {
            '16:9': ['[data-value="16:9"]', 'button:has-text("16:9")', '[aria-label*="16:9"]'],
            '9:16': ['[data-value="9:16"]', 'button:has-text("9:16")', '[aria-label*="9:16"]'],
            '1:1': ['[data-value="1:1"]', 'button:has-text("1:1")', '[aria-label*="1:1"]'],
            '3:2': ['[data-value="3:2"]', 'button:has-text("3:2")', '[aria-label*="3:2"]'],
            '2:3': ['[data-value="2:3"]', 'button:has-text("2:3")', '[aria-label*="2:3"]']
        }
    },

    // Generated video element
    videoResult: [
        'video[src]',
        'video source[src]',
        '.generated-video video',
        '[data-testid="generated-video"]'
    ],

    // Download button for generated content
    downloadButton: [
        'button[aria-label*="Download"]',
        'button[aria-label*="download"]',
        'a[download]',
        'button[data-testid="download"]',
        '[data-testid="download-button"]'
    ]
};

// ─── Find element with fallback selectors ───
async function findElement(page, selectorList, description = '') {
    for (const selector of selectorList) {
        try {
            const el = await page.$(selector);
            if (el) {
                console.log(`[GrokV2] ✅ Found ${description} via: ${selector}`);
                return el;
            }
        } catch { /* try next */ }
    }

    // Fallback: try finding by text content
    console.log(`[GrokV2] ⚠️ Could not find ${description} with standard selectors, trying text search`);
    return null;
}

// ─── Find element by visible text ───
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
// UI CONFIGURATION — Set mode, aspect ratio before generating
// ═══════════════════════════════════════════════════════════════

async function configureUI(page, options = {}) {
    const { aspectRatio = '16:9', mode = 'video' } = options;
    console.log(`[GrokV2] ⚙️ Configuring UI: mode=${mode}, aspect=${aspectRatio}`);

    // Step 1: Navigate to Grok Imagine
    try {
        const imagineUrl = 'https://grok.com/imagine';
        if (!page.url().includes('grok.com/imagine')) {
            await page.goto(imagineUrl, { waitUntil: 'networkidle2', timeout: 30000 });
            await delay(3000);
        }
    } catch (err) {
        console.log(`[GrokV2] ⚠️ Navigation issue: ${err.message}. Continuing...`);
    }

    // Step 2: Select Video mode (if available as a toggle)
    if (mode === 'video') {
        try {
            const videoToggle = await findByText(page, 'Video');
            if (videoToggle) {
                await videoToggle.click();
                await delay(1000);
                console.log('[GrokV2] ✅ Video mode selected');
            }
        } catch {
            console.log('[GrokV2] ⚠️ Could not find Video toggle — may already be in video mode');
        }
    }

    // Step 3: Set aspect ratio
    try {
        // First, open the aspect ratio dropdown/selector
        const ratioContainer = await findElement(page, SELECTORS.aspectRatio.container, 'aspect ratio selector');

        if (ratioContainer) {
            await ratioContainer.click();
            await delay(500);

            // Now find and click the specific ratio
            const ratioSelectors = SELECTORS.aspectRatio.options[aspectRatio] || [];
            const ratioOption = await findElement(page, ratioSelectors, `ratio ${aspectRatio}`);

            if (ratioOption) {
                await ratioOption.click();
                await delay(500);
                console.log(`[GrokV2] ✅ Aspect ratio set to ${aspectRatio}`);
            } else {
                // Try clicking by text
                const textOption = await findByText(page, aspectRatio);
                if (textOption) {
                    await textOption.click();
                    console.log(`[GrokV2] ✅ Aspect ratio set to ${aspectRatio} (via text)`);
                }
            }
        } else {
            console.log(`[GrokV2] ⚠️ No aspect ratio selector found — will include in prompt`);
        }
    } catch (err) {
        console.log(`[GrokV2] ⚠️ Aspect ratio config failed: ${err.message}`);
    }

    console.log('[GrokV2] ⚙️ UI configuration complete');
}

// ═══════════════════════════════════════════════════════════════
// GENERATE SINGLE SCENE — Content script approach
// ═══════════════════════════════════════════════════════════════

async function generateScene(page, scene, downloadWatcher) {
    const sceneNum = scene.index + 1;
    console.log(`[GrokV2] 🎬 Scene ${sceneNum}: "${scene.prompt.substring(0, 60)}..."`);

    // Step 1: Clear and type prompt
    const inputElement = await findElement(page, SELECTORS.promptInput, 'prompt input');

    if (!inputElement) {
        throw new Error('Could not find prompt input field');
    }

    // Clear existing text
    await page.evaluate((selectors) => {
        for (const sel of selectors) {
            const el = document.querySelector(sel);
            if (el) {
                if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
                    el.value = '';
                } else {
                    el.textContent = '';
                }
                el.dispatchEvent(new Event('input', { bubbles: true }));
                return;
            }
        }
    }, SELECTORS.promptInput);

    await delay(300);

    // Type the prompt
    await inputElement.click();
    await page.keyboard.type(scene.prompt, { delay: 20 });
    await delay(500);

    // Step 2: Click generate/send
    const sendBtn = await findElement(page, SELECTORS.sendButton, 'send button');
    if (sendBtn) {
        await sendBtn.click();
    } else {
        // Fallback: press Enter
        await page.keyboard.press('Enter');
    }

    console.log(`[GrokV2] ⏳ Scene ${sceneNum}: Waiting for generation...`);

    // Step 3: Wait for video to appear using MutationObserver
    const videoUrl = await waitForVideo(page, 180000); // 3 min timeout

    if (!videoUrl) {
        throw new Error(`Scene ${sceneNum}: No video generated within timeout`);
    }

    console.log(`[GrokV2] 🎥 Scene ${sceneNum}: Video URL found`);

    // Step 4: Download the video
    let result;

    // Try direct URL download first (fastest)
    if (videoUrl.startsWith('http')) {
        result = await downloadWatcher.downloadUrl(videoUrl, scene.index);
    }

    // If direct download failed, try clicking the download button
    if (!result || !result.success) {
        console.log(`[GrokV2] Trying button download for scene ${sceneNum}...`);
        const dlBtn = await findElement(page, SELECTORS.downloadButton, 'download button');
        if (dlBtn) {
            await dlBtn.click();
            result = await downloadWatcher.waitForDownload(scene.index, 60000);
        }
    }

    if (!result || !result.success) {
        throw new Error(`Scene ${sceneNum}: Could not download video`);
    }

    console.log(`[GrokV2] ✅ Scene ${sceneNum}: Downloaded to ${result.filePath}`);
    return result;
}

// ═══════════════════════════════════════════════════════════════
// MUTATION OBSERVER — Wait for video element to appear
// ═══════════════════════════════════════════════════════════════

async function waitForVideo(page, timeoutMs = 180000) {
    return page.evaluate((timeout, videoSelectors) => {
        return new Promise((resolve) => {
            // Check if video already exists
            for (const sel of videoSelectors) {
                const existing = document.querySelector(sel);
                if (existing) {
                    const src = existing.src || existing.querySelector('source')?.src;
                    if (src) { resolve(src); return; }
                }
            }

            let resolved = false;

            // Watch for new video elements
            const observer = new MutationObserver((mutations) => {
                if (resolved) return;

                for (const sel of videoSelectors) {
                    const el = document.querySelector(sel);
                    if (el) {
                        const src = el.src || el.querySelector('source')?.src;
                        if (src) {
                            resolved = true;
                            observer.disconnect();
                            resolve(src);
                            return;
                        }
                    }
                }

                // Also check for blob URLs in any video tag
                const videos = document.querySelectorAll('video');
                for (const video of videos) {
                    if (video.src && !resolved) {
                        resolved = true;
                        observer.disconnect();
                        resolve(video.src);
                        return;
                    }
                }
            });

            observer.observe(document.body, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ['src']
            });

            // Timeout fallback
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
// IMAGE-TO-VIDEO (Pro mode)
// ═══════════════════════════════════════════════════════════════

async function generateI2VScene(page, scene, downloadWatcher) {
    const sceneNum = scene.index + 1;
    console.log(`[GrokV2] 🎬 I2V Scene ${sceneNum}: image=${scene.imageFile}`);

    // Step 1: Find and click the image upload area
    const uploadInput = await page.$('input[type="file"]');
    if (!uploadInput) {
        throw new Error('Could not find file upload input');
    }

    // Upload the image
    await uploadInput.uploadFile(scene.imageFile);
    await delay(2000);

    // Step 2: Type motion prompt (if provided)
    if (scene.motionPrompt) {
        const inputElement = await findElement(page, SELECTORS.promptInput, 'prompt input');
        if (inputElement) {
            await inputElement.click();
            await page.keyboard.type(scene.motionPrompt, { delay: 20 });
        }
    }

    // Step 3: Submit
    const sendBtn = await findElement(page, SELECTORS.sendButton, 'send button');
    if (sendBtn) {
        await sendBtn.click();
    } else {
        await page.keyboard.press('Enter');
    }

    // Step 4: Wait for video
    const videoUrl = await waitForVideo(page, 180000);
    if (!videoUrl) {
        throw new Error(`I2V Scene ${sceneNum}: No video generated within timeout`);
    }

    // Step 5: Download
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

    if (!result || !result.success) {
        throw new Error(`I2V Scene ${sceneNum}: Could not download video`);
    }

    return result;
}

// ═══════════════════════════════════════════════════════════════
// MAIN — Full batch generation flow
// ═══════════════════════════════════════════════════════════════

async function generateVideosGrokV2(browser, scenes, options = {}) {
    const {
        projectDir,
        aspectRatio = '16:9',
        mode = 'video',
        isI2V = false,
        onProgress = () => { }
    } = options;

    const videoDir = path.join(projectDir, 'videos');
    if (!fs.existsSync(videoDir)) fs.mkdirSync(videoDir, { recursive: true });

    // Set up download watcher
    const downloadWatcher = new DownloadWatcher(videoDir);

    // Open Grok tab
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });

    // Set up CDP download hook
    await downloadWatcher.setupCDP(page);

    // Inject cookies
    await SM.injectCookies(page, 'grok');

    // Navigate + configure UI
    await page.goto('https://grok.com', { waitUntil: 'networkidle2', timeout: 30000 });
    await delay(3000);

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

                results.push({
                    sceneIndex: i,
                    status: 'done',
                    filePath: result.filePath,
                    attempts
                });

                success = true;

                onProgress({
                    sceneIndex: i,
                    totalScenes: scenes.length,
                    status: 'done',
                    filePath: result.filePath,
                    pct: Math.round(((i + 1) / scenes.length) * 100)
                });
            } catch (err) {
                console.log(`[GrokV2] ❌ Scene ${i + 1} attempt ${attempts}/3: ${err.message}`);
                if (attempts >= 3) {
                    results.push({
                        sceneIndex: i,
                        status: 'failed',
                        error: err.message,
                        attempts
                    });

                    onProgress({
                        sceneIndex: i,
                        totalScenes: scenes.length,
                        status: 'failed',
                        error: err.message
                    });
                }
                await delay(5000 * attempts); // Increasing cooldown
            }
        }

        // Cooldown between scenes
        if (i < scenes.length - 1) {
            await delay(5000);
        }
    }

    // Close tab but keep browser
    await page.close();

    const doneCount = results.filter(r => r.status === 'done').length;
    console.log(`[GrokV2] 🏁 Batch complete: ${doneCount}/${scenes.length} scenes generated`);

    return results;
}

// ─── Helpers ───
function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

module.exports = { generateVideosGrokV2, configureUI, generateScene, generateI2VScene };
