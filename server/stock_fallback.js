// ═══════════════════════════════════════════════════════════════
// Stock Footage Fallback — Pexels + Pixabay Dual-Provider Search
// Searches for B-roll video clips before falling back to AI generation.
// ═══════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');

const PEXELS_API_KEY = process.env.PEXELS_API_KEY || '';
const PIXABAY_API_KEY = process.env.PIXABAY_API_KEY || '';

/**
 * Extract search keywords from a scene prompt.
 * Strips cinematic jargon, keeps core subject/action words.
 * @param {string} prompt - Scene image/motion prompt
 * @returns {string[]} 3-5 clean search keywords
 */
function extractKeywords(prompt) {
    // Remove cinematic terms that pollute stock searches
    const junk = /\b(cinematic|dramatic|8k|4k|ultra|hd|--ar|16:9|9:16|1:1|shot|close-up|wide|aerial|dolly|pan|zoom|tracking|establishing|camera|lens|mm|depth of field|shallow|bokeh|composition|rim lighting|ambient|golden hour|high-key|low-key|film grain|style|aesthetic)\b/gi;
    let clean = prompt.replace(junk, '').replace(/[^a-zA-Z\s]/g, ' ').replace(/\s+/g, ' ').trim();

    // Take the 3-5 most meaningful words (skip short words)
    const words = clean.split(' ').filter(w => w.length > 3);
    return words.slice(0, 5);
}

/**
 * Search Pexels for stock video clips.
 * @param {string} query - Search query
 * @param {string} orientation - 'landscape', 'portrait', or 'square'
 * @returns {object|null} { url, width, height, duration, thumbnail, source: 'pexels' }
 */
async function searchPexels(query, orientation = 'landscape') {
    if (!PEXELS_API_KEY) return null;

    try {
        const url = `https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&per_page=5&orientation=${orientation}&size=medium`;
        const resp = await fetch(url, {
            headers: { Authorization: PEXELS_API_KEY }
        });

        if (!resp.ok) {
            console.log(`[Stock] Pexels error: ${resp.status}`);
            return null;
        }

        const data = await resp.json();

        for (const video of (data.videos || [])) {
            // Find HD or larger file
            const hdFile = video.video_files.find(f => f.width >= 1280 && f.quality === 'hd');
            const anyFile = video.video_files.find(f => f.width >= 960);
            const file = hdFile || anyFile;

            if (file && video.duration >= 3) {
                return {
                    url: file.link,
                    width: file.width,
                    height: file.height,
                    duration: video.duration,
                    thumbnail: video.image,
                    source: 'pexels',
                    attribution: `Video by ${video.user.name} from Pexels`
                };
            }
        }

        return null;
    } catch (err) {
        console.log(`[Stock] Pexels fetch error: ${err.message}`);
        return null;
    }
}

/**
 * Search Pixabay for stock video clips.
 * @param {string} query - Search query
 * @returns {object|null} { url, width, height, duration, thumbnail, source: 'pixabay' }
 */
async function searchPixabay(query) {
    if (!PIXABAY_API_KEY) return null;

    try {
        const url = `https://pixabay.com/api/videos/?key=${PIXABAY_API_KEY}&q=${encodeURIComponent(query)}&per_page=5&safesearch=true`;
        const resp = await fetch(url);

        if (!resp.ok) {
            console.log(`[Stock] Pixabay error: ${resp.status}`);
            return null;
        }

        const data = await resp.json();

        for (const video of (data.hits || [])) {
            // Prefer 'large' (1920x1080), fallback to 'medium' (1280x720)
            const large = video.videos?.large;
            const medium = video.videos?.medium;
            const file = (large && large.url) ? large : medium;

            if (file && file.url && video.duration >= 3) {
                return {
                    url: file.url,
                    width: file.width,
                    height: file.height,
                    duration: video.duration,
                    thumbnail: file.thumbnail || medium?.thumbnail,
                    source: 'pixabay',
                    attribution: `Video by ${video.user} from Pixabay`
                };
            }
        }

        return null;
    } catch (err) {
        console.log(`[Stock] Pixabay fetch error: ${err.message}`);
        return null;
    }
}

/**
 * Search both Pexels and Pixabay in parallel, return best match.
 * @param {string} prompt - Scene prompt to extract keywords from
 * @param {string} aspectRatio - '16:9', '9:16', or '1:1'
 * @returns {object|null} Best stock clip or null
 */
async function searchStockVideo(prompt, aspectRatio = '16:9') {
    const keywords = extractKeywords(prompt);
    if (keywords.length === 0) return null;

    const query = keywords.join(' ');
    console.log(`[Stock] Searching: "${query}" (from prompt: "${prompt.substring(0, 60)}...")`);

    const orientation = aspectRatio === '9:16' ? 'portrait' : aspectRatio === '1:1' ? 'square' : 'landscape';

    // Search both APIs in parallel
    const [pexelsResult, pixabayResult] = await Promise.all([
        searchPexels(query, orientation),
        searchPixabay(query)
    ]);

    // Prefer HD, longer clips
    const candidates = [pexelsResult, pixabayResult].filter(Boolean);
    if (candidates.length === 0) {
        console.log(`[Stock] No matches found for: "${query}"`);
        return null;
    }

    // Sort by resolution (width) descending, then duration
    candidates.sort((a, b) => (b.width - a.width) || (b.duration - a.duration));

    const best = candidates[0];
    console.log(`[Stock] ✅ Found: ${best.source} (${best.width}x${best.height}, ${best.duration}s)`);
    return best;
}

/**
 * Download a stock video clip to a local file.
 * @param {string} videoUrl - URL of the video to download
 * @param {string} outputPath - Local path to save to
 * @returns {boolean} true if successful
 */
async function downloadStockClip(videoUrl, outputPath) {
    try {
        const resp = await fetch(videoUrl);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

        const buffer = Buffer.from(await resp.arrayBuffer());
        fs.writeFileSync(outputPath, buffer);

        console.log(`[Stock] 💾 Downloaded: ${path.basename(outputPath)} (${(buffer.length / 1024 / 1024).toFixed(1)}MB)`);
        return true;
    } catch (err) {
        console.log(`[Stock] ❌ Download failed: ${err.message}`);
        return false;
    }
}

/**
 * Try to find and download stock B-roll for a scene.
 * Returns the local file path if successful, null if no match.
 * @param {string} prompt - Scene prompt
 * @param {string} outputDir - Directory to save downloads
 * @param {string} filename - Output filename (e.g., 'scene_001_stock.mp4')
 * @param {string} aspectRatio - Target aspect ratio
 * @returns {string|null} Local path to downloaded clip, or null
 */
async function getStockForScene(prompt, outputDir, filename, aspectRatio = '16:9') {
    const match = await searchStockVideo(prompt, aspectRatio);
    if (!match) return null;

    const outputPath = path.join(outputDir, filename);
    const success = await downloadStockClip(match.url, outputPath);

    return success ? outputPath : null;
}

module.exports = {
    searchStockVideo,
    downloadStockClip,
    getStockForScene,
    extractKeywords,
    searchPexels,
    searchPixabay
};
