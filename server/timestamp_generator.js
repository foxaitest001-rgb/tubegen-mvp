// ═══════════════════════════════════════════════════════════════
// Timestamp Generator — Word-Level Timing from Audio Duration
// Generates accurate timestamps for Piper TTS output by using
// audio duration + word count to estimate word positions.
// Falls back to faster-whisper if available on the system.
// ═══════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

/**
 * Get audio duration in seconds using FFprobe.
 * @param {string} audioPath - Path to .wav file
 * @returns {number} Duration in seconds
 */
function getAudioDuration(audioPath) {
    try {
        const output = execSync(
            `ffprobe -v error -show_entries format=duration -of csv=p=0 "${audioPath}"`,
            { encoding: 'utf-8', timeout: 5000 }
        ).trim();
        return parseFloat(output) || 0;
    } catch (err) {
        console.log(`[Timestamps] FFprobe failed: ${err.message}`);
        return 0;
    }
}

/**
 * Generate estimated word-level timestamps from text and audio duration.
 * Works well with Piper TTS which has consistent pacing.
 * @param {string} text - Voiceover text
 * @param {number} duration - Audio duration in seconds
 * @returns {Array<{word: string, start: number, end: number}>}
 */
function generateWordTimestamps(text, duration) {
    const words = text.replace(/\n+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .split(' ')
        .filter(w => w.length > 0);

    if (words.length === 0 || duration <= 0) return [];

    // Calculate base time per word with variable weighting
    const totalChars = words.reduce((sum, w) => sum + w.length, 0);
    const timestamps = [];
    let currentTime = 0.1; // Small initial offset

    for (let i = 0; i < words.length; i++) {
        const word = words[i];
        // Duration proportional to word length (longer words take more time)
        const wordRatio = word.length / totalChars;
        const wordDuration = wordRatio * (duration - 0.2); // Leave margin at start/end

        // Add extra pause after sentence-ending punctuation
        let pauseAfter = 0;
        if (word.match(/[.!?]$/)) pauseAfter = 0.3;
        else if (word.match(/[,;:]$/)) pauseAfter = 0.15;

        timestamps.push({
            word: word,
            start: Math.round(currentTime * 1000) / 1000,
            end: Math.round((currentTime + wordDuration) * 1000) / 1000
        });

        currentTime += wordDuration + pauseAfter;
    }

    // Scale timestamps to fit exact duration
    if (timestamps.length > 0) {
        const lastEnd = timestamps[timestamps.length - 1].end;
        const scale = (duration - 0.1) / lastEnd;
        for (const ts of timestamps) {
            ts.start = Math.round(ts.start * scale * 1000) / 1000;
            ts.end = Math.round(ts.end * scale * 1000) / 1000;
        }
    }

    return timestamps;
}

/**
 * Try to use faster-whisper for accurate timestamps.
 * Falls back to estimation if not available.
 * @param {string} audioPath - Path to .wav file
 * @param {string} text - Original text (for fallback)
 * @returns {Array<{word: string, start: number, end: number}>}
 */
function extractTimestamps(audioPath, text) {
    const duration = getAudioDuration(audioPath);
    if (duration <= 0) {
        console.log(`[Timestamps] Could not get audio duration for: ${audioPath}`);
        return [];
    }

    console.log(`[Timestamps] Audio: ${duration.toFixed(1)}s, ${text.split(' ').length} words`);

    // Try faster-whisper first (if installed)
    try {
        const whisperCmd = `faster-whisper "${audioPath}" --model tiny --language en --word_timestamps --output_format json`;
        const output = execSync(whisperCmd, { encoding: 'utf-8', timeout: 30000 });
        const result = JSON.parse(output);
        if (result.segments && result.segments.length > 0) {
            const words = [];
            for (const seg of result.segments) {
                for (const word of (seg.words || [])) {
                    words.push({
                        word: word.word.trim(),
                        start: word.start,
                        end: word.end
                    });
                }
            }
            if (words.length > 0) {
                console.log(`[Timestamps] ✅ Whisper extracted ${words.length} word timestamps`);
                return words;
            }
        }
    } catch (err) {
        // Whisper not available, use estimation
        console.log(`[Timestamps] Whisper not available, using estimation`);
    }

    // Fallback: Estimated timestamps from text + duration
    const estimated = generateWordTimestamps(text, duration);
    console.log(`[Timestamps] 📐 Estimated ${estimated.length} word timestamps`);
    return estimated;
}

/**
 * Generate SRT subtitle file from word timestamps.
 * Groups words into subtitle lines (max ~8 words per line for readability).
 * @param {Array<{word: string, start: number, end: number}>} timestamps
 * @param {string} outputPath - Path to save .srt file
 * @param {object} options - { maxWordsPerLine: 8 }
 */
function generateSRT(timestamps, outputPath, options = {}) {
    const maxWords = options.maxWordsPerLine || 8;
    const entries = [];
    let lineWords = [];
    let lineStart = 0;
    let lineEnd = 0;
    let entryNum = 1;

    for (let i = 0; i < timestamps.length; i++) {
        const ts = timestamps[i];
        if (lineWords.length === 0) lineStart = ts.start;
        lineWords.push(ts.word);
        lineEnd = ts.end;

        // Split at max words, or at sentence-ending punctuation
        const isSentenceEnd = ts.word.match(/[.!?]$/);
        if (lineWords.length >= maxWords || isSentenceEnd || i === timestamps.length - 1) {
            entries.push({
                num: entryNum++,
                start: formatSRTTime(lineStart),
                end: formatSRTTime(lineEnd),
                text: lineWords.join(' ')
            });
            lineWords = [];
        }
    }

    const srtContent = entries.map(e =>
        `${e.num}\n${e.start} --> ${e.end}\n${e.text}\n`
    ).join('\n');

    fs.writeFileSync(outputPath, srtContent);
    console.log(`[Timestamps] 📄 Generated SRT: ${path.basename(outputPath)} (${entries.length} entries)`);
    return entries.length;
}

/**
 * Format seconds to SRT time format: HH:MM:SS,mmm
 */
function formatSRTTime(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    const ms = Math.round((seconds % 1) * 1000);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}

/**
 * Process all scene audio files and generate timestamps + SRT.
 * @param {string} projectDir - Project server directory
 * @param {Array<{voiceover: string}>} scenes - Scene data with voiceover text
 * @returns {Array<{sceneNum: number, srtPath: string, timestampsPath: string}>}
 */
function processAllSceneTimestamps(projectDir, scenes) {
    const results = [];

    for (let i = 0; i < scenes.length; i++) {
        const sceneNum = i + 1;
        const audioPath = path.join(projectDir, `scene_${sceneNum}_audio.wav`);
        const voiceover = scenes[i]?.voiceover || '';

        if (!fs.existsSync(audioPath) || !voiceover) {
            console.log(`[Timestamps] Skipping scene ${sceneNum}: no audio or voiceover`);
            continue;
        }

        const timestamps = extractTimestamps(audioPath, voiceover);
        if (timestamps.length === 0) continue;

        // Save timestamps JSON
        const tsPath = path.join(projectDir, `scene_${sceneNum}_timestamps.json`);
        fs.writeFileSync(tsPath, JSON.stringify(timestamps, null, 2));

        // Generate SRT
        const srtPath = path.join(projectDir, `scene_${sceneNum}.srt`);
        generateSRT(timestamps, srtPath);

        results.push({ sceneNum, srtPath, timestampsPath: tsPath });
    }

    return results;
}

module.exports = {
    getAudioDuration,
    generateWordTimestamps,
    extractTimestamps,
    generateSRT,
    formatSRTTime,
    processAllSceneTimestamps
};
