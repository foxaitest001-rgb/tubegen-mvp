// ═══════════════════════════════════════════════════════════════
// DOWNLOAD WATCHER
// Uses Chrome DevTools Protocol (CDP) for reliable downloads
// + file system watcher as fallback
// ═══════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');

class DownloadWatcher extends EventEmitter {
    constructor(downloadDir) {
        super();
        this.downloadDir = downloadDir;
        this.pendingDownloads = new Map();  // guid → { sceneIndex, resolve, reject, timeout }
        this.completedFiles = [];
        this.sceneCounter = 0;

        // Ensure download dir exists
        if (!fs.existsSync(this.downloadDir)) {
            fs.mkdirSync(this.downloadDir, { recursive: true });
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // CDP SETUP — Hook into Chrome's download events
    // ═══════════════════════════════════════════════════════════════

    async setupCDP(page) {
        try {
            const client = await page.target().createCDPSession();

            // Set download behavior — all downloads go to our folder
            await client.send('Page.setDownloadBehavior', {
                behavior: 'allow',
                downloadPath: this.downloadDir
            });

            // Also try Browser.setDownloadBehavior (works in newer Chrome)
            try {
                await client.send('Browser.setDownloadBehavior', {
                    behavior: 'allow',
                    downloadPath: this.downloadDir,
                    eventsEnabled: true
                });
            } catch { /* older Chrome, Page-level is fine */ }

            // Listen for download events
            client.on('Browser.downloadProgress', (event) => {
                this._handleDownloadProgress(event);
            });

            client.on('Browser.downloadWillBegin', (event) => {
                this._handleDownloadStart(event);
            });

            this.cdpClient = client;
            console.log(`[DownloadWatcher] ✅ CDP hooked — downloads go to: ${this.downloadDir}`);
            return true;
        } catch (err) {
            console.log(`[DownloadWatcher] ⚠️ CDP setup failed: ${err.message}. Using fallback.`);
            return false;
        }
    }

    _handleDownloadStart(event) {
        const { guid, suggestedFilename, url } = event;
        console.log(`[DownloadWatcher] 📥 Download starting: ${suggestedFilename}`);
        this.emit('download:start', { guid, filename: suggestedFilename, url });
    }

    _handleDownloadProgress(event) {
        const { guid, state } = event;

        if (state === 'completed') {
            console.log(`[DownloadWatcher] ✅ Download completed: ${guid}`);

            // Resolve any pending promise waiting for this download
            const pending = this.pendingDownloads.get(guid);
            if (pending) {
                clearTimeout(pending.timeout);
                pending.resolve({ guid });
                this.pendingDownloads.delete(guid);
            }

            this.emit('download:complete', { guid });
        } else if (state === 'canceled') {
            console.log(`[DownloadWatcher] ❌ Download canceled: ${guid}`);
            const pending = this.pendingDownloads.get(guid);
            if (pending) {
                clearTimeout(pending.timeout);
                pending.reject(new Error('Download canceled'));
                this.pendingDownloads.delete(guid);
            }
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // WAIT FOR DOWNLOAD — Returns when file appears in folder
    // ═══════════════════════════════════════════════════════════════

    async waitForDownload(sceneIndex, timeoutMs = 120000) {
        const expectedFile = `scene_${String(sceneIndex + 1).padStart(3, '0')}.mp4`;

        // Get files before download
        const filesBefore = this._getVideoFiles();

        return new Promise((resolve, reject) => {
            const startTime = Date.now();

            // Poll for new files
            const interval = setInterval(() => {
                const filesNow = this._getVideoFiles();
                const newFiles = filesNow.filter(f => !filesBefore.includes(f));

                if (newFiles.length > 0) {
                    clearInterval(interval);
                    const sourceFile = path.join(this.downloadDir, newFiles[0]);
                    const destFile = path.join(this.downloadDir, expectedFile);

                    // Rename to scene-ordered filename
                    try {
                        if (sourceFile !== destFile) {
                            fs.renameSync(sourceFile, destFile);
                        }
                    } catch {
                        // File might already be named correctly or rename failed
                    }

                    const finalPath = fs.existsSync(destFile) ? destFile : sourceFile;
                    this.completedFiles.push(finalPath);

                    this.emit('file:ready', {
                        sceneIndex,
                        filePath: finalPath,
                        filename: path.basename(finalPath),
                        elapsed: Date.now() - startTime
                    });

                    resolve({
                        success: true,
                        filePath: finalPath,
                        duration: Date.now() - startTime
                    });
                }

                // Timeout
                if (Date.now() - startTime > timeoutMs) {
                    clearInterval(interval);
                    reject(new Error(`Download timeout for scene ${sceneIndex + 1} (${timeoutMs / 1000}s)`));
                }
            }, 2000); // Poll every 2 seconds
        });
    }

    // ═══════════════════════════════════════════════════════════════
    // TRIGGER DOWNLOAD via CDP (direct URL download)
    // ═══════════════════════════════════════════════════════════════

    async downloadUrl(url, sceneIndex) {
        const filename = `scene_${String(sceneIndex + 1).padStart(3, '0')}.mp4`;
        const destPath = path.join(this.downloadDir, filename);

        // If we have CDP, use fetch to download directly
        if (this.cdpClient) {
            try {
                // Use Node.js fetch for direct download
                const response = await fetch(url);
                if (!response.ok) throw new Error(`HTTP ${response.status}`);

                const buffer = Buffer.from(await response.arrayBuffer());
                fs.writeFileSync(destPath, buffer);

                this.completedFiles.push(destPath);
                this.emit('file:ready', {
                    sceneIndex,
                    filePath: destPath,
                    filename,
                    method: 'direct'
                });

                return { success: true, filePath: destPath };
            } catch (err) {
                console.log(`[DownloadWatcher] ⚠️ Direct download failed: ${err.message}`);
            }
        }

        return { success: false, error: 'No download method available' };
    }

    // ═══════════════════════════════════════════════════════════════
    // IMAGE DOWNLOAD (for Whisk Pro mode)
    // ═══════════════════════════════════════════════════════════════

    async downloadImage(url, sceneIndex) {
        const filename = `scene_${String(sceneIndex + 1).padStart(3, '0')}.png`;
        const destPath = path.join(this.downloadDir, filename);

        try {
            const response = await fetch(url);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);

            const buffer = Buffer.from(await response.arrayBuffer());
            fs.writeFileSync(destPath, buffer);

            this.completedFiles.push(destPath);
            return { success: true, filePath: destPath };
        } catch (err) {
            return { success: false, error: err.message };
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // HELPERS
    // ═══════════════════════════════════════════════════════════════

    _getVideoFiles() {
        try {
            return fs.readdirSync(this.downloadDir)
                .filter(f => /\.(mp4|webm|mov)$/i.test(f))
                .sort();
        } catch { return []; }
    }

    _getImageFiles() {
        try {
            return fs.readdirSync(this.downloadDir)
                .filter(f => /\.(png|jpg|jpeg|webp)$/i.test(f))
                .sort();
        } catch { return []; }
    }

    getCompletedFiles() {
        return this.completedFiles;
    }

    cleanup() {
        this.pendingDownloads.clear();
        this.completedFiles = [];
    }
}

module.exports = { DownloadWatcher };
