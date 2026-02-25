// ═══════════════════════════════════════════════════════════════
// BATCH QUEUE MANAGER
// Handles 1-300+ scenes with chunking, retry, checkpoint, progress
// ═══════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');

class BatchQueue extends EventEmitter {
    constructor(options = {}) {
        super();
        this.chunkSize = options.chunkSize || 5;
        this.maxRetries = options.maxRetries || 3;
        this.cooldownMs = options.cooldownMs || 5000;
        this.checkpointDir = options.checkpointDir || null;

        // State
        this.scenes = [];
        this.results = [];      // { sceneIndex, status, filePath, error, attempts }
        this.currentIndex = 0;
        this.isPaused = false;
        this.isStopped = false;
        this.startTime = null;
    }

    // ─── Load scenes into the queue ───
    load(scenes) {
        this.scenes = scenes.map((scene, i) => ({
            index: i,
            prompt: scene.prompt,
            imageFile: scene.imageFile || null,    // For I2V (Pro mode)
            motionPrompt: scene.motionPrompt || null,
            status: 'pending',      // pending → generating → done → failed
            attempts: 0,
            filePath: null,
            error: null
        }));
        this.results = [];
        this.currentIndex = 0;
        this.isStopped = false;
        this.isPaused = false;
        this.startTime = Date.now();

        // Restore from checkpoint if available
        this._restoreCheckpoint();

        this.emit('loaded', { total: this.scenes.length });
        return this;
    }

    // ─── Execute the batch with a generator function ───
    // generatorFn(scene) => Promise<{ success, filePath, error? }>
    async run(generatorFn) {
        for (let i = this.currentIndex; i < this.scenes.length; i++) {
            if (this.isStopped) {
                this.emit('stopped', this._getProgress());
                return this.results;
            }

            // Wait while paused
            while (this.isPaused) {
                await this._delay(1000);
                if (this.isStopped) return this.results;
            }

            const scene = this.scenes[i];
            this.currentIndex = i;

            // Skip already completed scenes (from checkpoint)
            if (scene.status === 'done') {
                continue;
            }

            // Retry loop
            let success = false;
            while (scene.attempts < this.maxRetries && !success) {
                scene.attempts++;
                scene.status = 'generating';

                this.emit('scene:start', {
                    sceneIndex: i,
                    totalScenes: this.scenes.length,
                    attempt: scene.attempts,
                    prompt: scene.prompt.substring(0, 80) + '...'
                });

                try {
                    const result = await generatorFn(scene);

                    if (result.success) {
                        scene.status = 'done';
                        scene.filePath = result.filePath;
                        success = true;

                        this.emit('scene:done', {
                            sceneIndex: i,
                            totalScenes: this.scenes.length,
                            filePath: result.filePath,
                            duration: result.duration || null
                        });
                    } else {
                        scene.error = result.error || 'Generation returned no result';
                        this.emit('scene:retry', {
                            sceneIndex: i,
                            attempt: scene.attempts,
                            maxRetries: this.maxRetries,
                            error: scene.error
                        });
                    }
                } catch (err) {
                    scene.error = err.message;
                    this.emit('scene:retry', {
                        sceneIndex: i,
                        attempt: scene.attempts,
                        maxRetries: this.maxRetries,
                        error: err.message
                    });
                }

                // Cooldown between attempts
                if (!success && scene.attempts < this.maxRetries) {
                    await this._delay(this.cooldownMs * scene.attempts);
                }
            }

            // Max retries exhausted
            if (!success) {
                scene.status = 'failed';
                this.emit('scene:failed', {
                    sceneIndex: i,
                    error: scene.error,
                    attempts: scene.attempts
                });
            }

            this.results.push({
                sceneIndex: i,
                status: scene.status,
                filePath: scene.filePath,
                error: scene.error,
                attempts: scene.attempts
            });

            // Save checkpoint after each scene
            this._saveCheckpoint();

            // Cooldown between scenes (avoid rate limiting)
            if (i < this.scenes.length - 1) {
                await this._delay(this.cooldownMs);
            }
        }

        const progress = this._getProgress();
        this.emit('complete', progress);
        return this.results;
    }

    // ─── Controls ───
    pause() {
        this.isPaused = true;
        this.emit('paused', this._getProgress());
    }

    resume() {
        this.isPaused = false;
        this.emit('resumed', this._getProgress());
    }

    stop() {
        this.isStopped = true;
    }

    // ─── Progress ───
    _getProgress() {
        const done = this.scenes.filter(s => s.status === 'done').length;
        const failed = this.scenes.filter(s => s.status === 'failed').length;
        const pending = this.scenes.filter(s => s.status === 'pending').length;
        const elapsed = Date.now() - (this.startTime || Date.now());
        const avgPerScene = done > 0 ? elapsed / done : 0;
        const eta = pending > 0 ? avgPerScene * pending : 0;

        return {
            total: this.scenes.length,
            done,
            failed,
            pending,
            current: this.currentIndex,
            elapsed: Math.round(elapsed / 1000),
            etaSeconds: Math.round(eta / 1000),
            pct: Math.round((done / this.scenes.length) * 100)
        };
    }

    getProgress() {
        return this._getProgress();
    }

    // ─── Checkpoint (resume on crash) ───
    _saveCheckpoint() {
        if (!this.checkpointDir) return;
        try {
            const cpFile = path.join(this.checkpointDir, 'batch_checkpoint.json');
            fs.writeFileSync(cpFile, JSON.stringify({
                currentIndex: this.currentIndex,
                scenes: this.scenes.map(s => ({
                    index: s.index,
                    status: s.status,
                    filePath: s.filePath,
                    attempts: s.attempts
                })),
                savedAt: new Date().toISOString()
            }, null, 2));
        } catch { /* ignore checkpoint errors */ }
    }

    _restoreCheckpoint() {
        if (!this.checkpointDir) return;
        try {
            const cpFile = path.join(this.checkpointDir, 'batch_checkpoint.json');
            if (!fs.existsSync(cpFile)) return;

            const cp = JSON.parse(fs.readFileSync(cpFile, 'utf-8'));

            // Only restore if scene count matches
            if (cp.scenes.length !== this.scenes.length) return;

            let restored = 0;
            cp.scenes.forEach(saved => {
                if (saved.status === 'done' && this.scenes[saved.index]) {
                    this.scenes[saved.index].status = 'done';
                    this.scenes[saved.index].filePath = saved.filePath;
                    this.scenes[saved.index].attempts = saved.attempts;
                    restored++;
                }
            });

            if (restored > 0) {
                this.currentIndex = cp.currentIndex;
                this.emit('checkpoint:restored', { restored, from: cp.savedAt });
            }
        } catch { /* ignore */ }
    }

    clearCheckpoint() {
        if (!this.checkpointDir) return;
        try {
            const cpFile = path.join(this.checkpointDir, 'batch_checkpoint.json');
            if (fs.existsSync(cpFile)) fs.unlinkSync(cpFile);
        } catch { /* ignore */ }
    }

    // ─── Helpers ───
    _delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

module.exports = { BatchQueue };
