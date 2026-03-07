// ═══════════════════════════════════════════════════════════════
// COMMAND CENTER — YouTube Outlier Reverse-Engineering Agent
// 
// 1. Outlier Hunter: YouTube Data API v3 finds viral videos by
//    channels with low subscribers (views/subs > outlier threshold)
// 2. Transcript Extraction: Gets video transcript for analysis
// 3. Gemini Deep Analysis: Breaks down viral psychology
// 4. JSON Blueprint: Outputs structured retention blueprint
//    that gets injected into the script generation prompt
// ═══════════════════════════════════════════════════════════════

const YOUTUBE_API_KEY = process.env.VITE_GOOGLE_API_KEY || '';
const GEMINI_API_KEY = process.env.VITE_GOOGLE_API_KEY || '';

// ─── Step 1: Outlier Hunter ───

/**
 * Search YouTube for videos in a niche, then calculate outlier scores.
 * Outlier Score = viewCount / subscriberCount
 * Filters for: >1M views on channels with <100K subscribers
 * @param {string} query - Niche search query
 * @param {object} options - { maxResults, minViews, maxSubs }
 * @returns {Array<{videoId, title, views, subs, outlierScore, channelTitle, publishedAt}>}
 */
async function findOutliers(query, options = {}) {
    const {
        maxResults = 50,
        minViews = 500000,
        maxSubs = 100000,
        minOutlierScore = 10
    } = options;

    if (!YOUTUBE_API_KEY) {
        console.log('[CommandCenter] ⚠️ No YouTube API key found');
        return [];
    }

    console.log(`[CommandCenter] 🔍 Searching: "${query}" (min ${(minViews/1000000).toFixed(1)}M views, max ${(maxSubs/1000).toFixed(0)}K subs)`);

    try {
        // Step 1: Search for videos
        const searchUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&q=${encodeURIComponent(query)}&maxResults=${maxResults}&order=viewCount&key=${YOUTUBE_API_KEY}`;
        const searchResp = await fetch(searchUrl);
        if (!searchResp.ok) throw new Error(`YouTube search failed: ${searchResp.status}`);
        const searchData = await searchResp.json();

        const videoIds = searchData.items.map(item => item.id.videoId).filter(Boolean);
        if (videoIds.length === 0) return [];

        // Step 2: Get video statistics (views)
        const statsUrl = `https://www.googleapis.com/youtube/v3/videos?part=statistics,snippet&id=${videoIds.join(',')}&key=${YOUTUBE_API_KEY}`;
        const statsResp = await fetch(statsUrl);
        const statsData = await statsResp.json();

        // Step 3: Get channel subscriber counts
        const channelIds = [...new Set(statsData.items.map(v => v.snippet.channelId))];
        const channelsUrl = `https://www.googleapis.com/youtube/v3/channels?part=statistics&id=${channelIds.join(',')}&key=${YOUTUBE_API_KEY}`;
        const channelsResp = await fetch(channelsUrl);
        const channelsData = await channelsResp.json();

        const channelSubs = {};
        for (const ch of channelsData.items) {
            channelSubs[ch.id] = parseInt(ch.statistics.subscriberCount) || 0;
        }

        // Step 4: Calculate outlier scores and filter
        const outliers = [];
        for (const video of statsData.items) {
            const views = parseInt(video.statistics.viewCount) || 0;
            const subs = channelSubs[video.snippet.channelId] || 1;
            const outlierScore = Math.round(views / Math.max(subs, 1));

            if (views >= minViews && subs <= maxSubs && outlierScore >= minOutlierScore) {
                outliers.push({
                    videoId: video.id,
                    title: video.snippet.title,
                    description: video.snippet.description?.substring(0, 200) || '',
                    channelTitle: video.snippet.channelTitle,
                    publishedAt: video.snippet.publishedAt,
                    views,
                    subs,
                    outlierScore,
                    url: `https://youtube.com/watch?v=${video.id}`,
                    thumbnail: video.snippet.thumbnails?.high?.url || video.snippet.thumbnails?.default?.url
                });
            }
        }

        // Sort by outlier score descending
        outliers.sort((a, b) => b.outlierScore - a.outlierScore);

        console.log(`[CommandCenter] 🎯 Found ${outliers.length} outlier videos from ${statsData.items.length} searched`);
        return outliers;

    } catch (err) {
        console.error(`[CommandCenter] Search error: ${err.message}`);
        return [];
    }
}

// ─── Step 2: Transcript Extraction ───

/**
 * Get video transcript using YouTube's transcript API.
 * Uses the innertube API to fetch captions without authentication.
 * @param {string} videoId - YouTube video ID
 * @returns {string} Full transcript text
 */
async function getTranscript(videoId) {
    try {
        // Method 1: Try the YouTube captions endpoint
        const pageResp = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
        });
        const pageHtml = await pageResp.text();

        // Extract timedText URL from page source
        const captionMatch = pageHtml.match(/"captionTracks":\[(.*?)\]/);
        if (!captionMatch) {
            console.log(`[CommandCenter] No captions found for: ${videoId}`);
            return '';
        }

        const captionData = JSON.parse(`[${captionMatch[1]}]`);
        const englishTrack = captionData.find(t => t.languageCode === 'en') || captionData[0];
        if (!englishTrack?.baseUrl) return '';

        const captionResp = await fetch(englishTrack.baseUrl);
        const captionXml = await captionResp.text();

        // Parse XML captions to plain text
        const textMatches = captionXml.matchAll(/<text[^>]*>(.*?)<\/text>/gs);
        const lines = [];
        for (const match of textMatches) {
            const text = match[1]
                .replace(/&amp;/g, '&')
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .replace(/&#39;/g, "'")
                .replace(/&quot;/g, '"')
                .replace(/<[^>]+>/g, '');
            lines.push(text);
        }

        const transcript = lines.join(' ');
        console.log(`[CommandCenter] 📝 Transcript: ${transcript.length} chars from ${videoId}`);
        return transcript;

    } catch (err) {
        console.error(`[CommandCenter] Transcript error: ${err.message}`);
        return '';
    }
}

// ─── Step 3: Gemini Deep Analysis ───

/**
 * Analyze a viral video transcript with Gemini to extract retention psychology.
 * @param {string} transcript - Full video transcript
 * @param {object} videoInfo - Video metadata (title, views, subs, outlierScore)
 * @returns {object} Structured JSON blueprint
 */
async function analyzeWithGemini(transcript, videoInfo) {
    if (!GEMINI_API_KEY || !transcript) return null;

    const prompt = `You are a viral video reverse-engineering expert. Analyze this transcript from a viral YouTube video and extract its exact structure as a JSON blueprint.

VIDEO INFO:
- Title: "${videoInfo.title}"
- Views: ${videoInfo.views.toLocaleString()}
- Channel Subscribers: ${videoInfo.subs.toLocaleString()}
- Outlier Score: ${videoInfo.outlierScore}x (views/subs ratio — proves the TOPIC is viral, not just the creator)

TRANSCRIPT:
"""
${transcript.substring(0, 30000)}
"""

RETURN A JSON OBJECT with these exact fields. Do NOT wrap in markdown code blocks. Return ONLY valid JSON:
{
  "hook_analysis": {
    "opening_technique": "exact technique used in first 15 seconds",
    "hook_type": "question|false_floor|mystery|shock|promise",
    "retention_trigger": "what makes viewers stay past the first 30 seconds"
  },
  "narrative_structure": {
    "total_segments": 0,
    "segments": [
      {
        "segment_number": 1,
        "name": "segment name",
        "duration_pct": 0,
        "purpose": "what this segment achieves psychologically",
        "technique": "retention technique used here"
      }
    ]
  },
  "emotional_arc": {
    "opening_emotion": "curiosity|fear|wonder|shock",
    "peak_emotion": "awe|terror|satisfaction|revelation",
    "closing_emotion": "resolution|cliffhanger|call-to-action",
    "tension_curve": "builds|releases_and_rebuilds|constant_escalation"
  },
  "retention_rules": [
    "specific rule derived from this video's structure"
  ],
  "pacing": {
    "avg_words_per_sentence": 0,
    "pause_frequency": "after_every_reveal|every_30_seconds|at_transitions",
    "speed_variation": "constant|accelerates_at_climax|slow_fast_alternating"
  },
  "visual_blueprint": {
    "shot_types": ["wide|close-up|aerial|tracking"],
    "transitions": ["cut|dissolve|zoom|whip_pan"],
    "b_roll_frequency": "every_sentence|every_segment|minimal"
  },
  "replication_prompt": "A one-paragraph prompt that captures the exact pacing, tone, and structure of this video for recreating similar content on any topic"
}`;

    try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;
        const resp = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: {
                    temperature: 0.3,
                    maxOutputTokens: 4096,
                    responseMimeType: 'application/json'
                }
            })
        });

        if (!resp.ok) throw new Error(`Gemini API error: ${resp.status}`);

        const data = await resp.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) return null;

        const blueprint = JSON.parse(text);
        console.log(`[CommandCenter] 🧠 Gemini analysis complete: ${blueprint.retention_rules?.length || 0} retention rules extracted`);
        return blueprint;

    } catch (err) {
        console.error(`[CommandCenter] Gemini analysis error: ${err.message}`);
        return null;
    }
}

// ─── Step 4: Full Pipeline ───

/**
 * Run the full Command Center pipeline:
 * 1. Find outlier videos in a niche
 * 2. Extract transcript from top outlier
 * 3. Analyze with Gemini
 * 4. Return JSON blueprint for script generation
 * 
 * @param {string} niche - Content niche to research
 * @param {object} options - Search options
 * @returns {object} { outliers, blueprint, replicationPrompt }
 */
async function runCommandCenter(niche, options = {}) {
    console.log(`[CommandCenter] ━━━ Starting Research for: "${niche}" ━━━`);

    // Step 1: Find outliers
    const outliers = await findOutliers(niche, options);
    if (outliers.length === 0) {
        console.log(`[CommandCenter] ⚠️ No outlier videos found for: "${niche}"`);
        return { outliers: [], blueprint: null, replicationPrompt: null };
    }

    console.log(`[CommandCenter] 🏆 Top outlier: "${outliers[0].title}" (${outliers[0].outlierScore}x score)`);

    // Step 2: Get transcript of top outlier
    const transcript = await getTranscript(outliers[0].videoId);
    if (!transcript) {
        console.log(`[CommandCenter] ⚠️ Could not extract transcript — returning outliers only`);
        return { outliers, blueprint: null, replicationPrompt: null };
    }

    // Step 3: Gemini analysis
    const blueprint = await analyzeWithGemini(transcript, outliers[0]);

    return {
        outliers: outliers.slice(0, 10), // Top 10
        topVideo: outliers[0],
        transcript: transcript.substring(0, 5000), // First 5000 chars for context
        blueprint,
        replicationPrompt: blueprint?.replication_prompt || null
    };
}

module.exports = {
    findOutliers,
    getTranscript,
    analyzeWithGemini,
    runCommandCenter
};
