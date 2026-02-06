
// REFACTORED: Puter.js dependency removed. Now using Google Direct + Pollinations.ai + Piper (Local) + Puter (Video)

import { generateContentWithGoogle } from './google_direct';
import cinematicKnowledge from '../data/cinematic_knowledge.json';
import viralStrategies from '../data/viral_strategies.json';

const API_KEY = import.meta.env.VITE_GOOGLE_API_KEY;

// --- PIPER VOICE CONFIGURATION ---
// Maps niches/styles to specific Piper voice IDs from HuggingFace
export const PIPER_VOICES: Record<string, { id: string; gender: string; description: string }> = {
  horror: { id: 'en_US-ryan-medium', gender: 'male', description: 'Deep dramatic voice for horror/drama' },
  documentary: { id: 'en_US-norman-medium', gender: 'male', description: 'Serious narrator for documentaries' },
  history: { id: 'en_US-norman-medium', gender: 'male', description: 'Educational authoritative voice' },
  gaming: { id: 'en_US-bryce-medium', gender: 'male', description: 'Confident energetic for gaming' },
  tech: { id: 'en_US-lessac-medium', gender: 'male', description: 'Neutral professional for tech' },
  vlog: { id: 'en_US-joe-medium', gender: 'male', description: 'Warm friendly for vlogs' },
  entertainment: { id: 'en_US-joe-medium', gender: 'male', description: 'Energetic for entertainment' },
  health: { id: 'en_US-amy-medium', gender: 'female', description: 'Warm caring for health/lifestyle' },
  professional: { id: 'en_US-hfc_female-medium', gender: 'female', description: 'Clear professional for business' },
  calm: { id: 'en_US-danny-low', gender: 'male', description: 'Calm soothing for ASMR/meditation' },
  default: { id: 'en_US-lessac-medium', gender: 'male', description: 'Neutral default voice' }
};

// Helper: Get voice based on niche
export function getVoiceForNiche(niche: string): { id: string; gender: string; description: string } {
  const lowerNiche = niche.toLowerCase();
  for (const [key, voice] of Object.entries(PIPER_VOICES)) {
    if (lowerNiche.includes(key)) {
      return voice;
    }
  }
  return PIPER_VOICES.default;
}

// Facade for Gemini calls (Hybrid: Puter Proxy -> Google Direct)
export async function callGeminiViaPuter(systemPrompt: string, userQuery: string) {
  // 1. Try Puter.js AI (Free Proxy) if available
  if (typeof (window as any).puter !== 'undefined' && (window as any).puter.ai) {
    try {
      console.log("[Service] Attempting generation via Puter.ai (Proxy)...");
      // Puter.ai.chat usually returns a string or an object with text
      // We combine prompts since it's a single turn
      const fullPrompt = `${systemPrompt}\n\nUSER INPUT: ${userQuery}`;

      const response = await (window as any).puter.ai.chat(fullPrompt);

      // Parse response
      const text = typeof response === 'string' ? response : response?.message?.content || JSON.stringify(response);
      console.log(`[Service] Puter.ai Success. Length: ${text.length}`);

      // Try to parse JSON if expected
      const cleaned = text.replace(/```json/g, '').replace(/```/g, '').trim();
      try {
        return JSON.parse(cleaned);
      } catch {
        return cleaned;
      }

    } catch (err: any) {
      console.warn("[Service] Puter.ai failed:", err);
      console.log("[Service] Falling back to Direct Google API...");
    }
  } else {
    console.warn("[Service] Puter.js not loaded. Using Direct Google API.");
  }

  // 2. Fallback to Google Direct (using our robust 1.5-flash configuration)
  if (!API_KEY) {
    throw new Error("Missing VITE_GOOGLE_API_KEY. Please add it to your .env file.");
  }
  return await generateContentWithGoogle(systemPrompt, userQuery);
}

// Stub out Voice/Video functions to prevent accidental usage if UI triggers them
export async function generateContentWithPuter(systemPrompt: string, userQuery: string, _imageFile?: File) {
  return callGeminiViaPuter(systemPrompt, userQuery);
}

export async function rankViralTopics(niche: string) {
  return [
    { title: `Why ${niche} is failing`, score: 95 },
    { title: `The future of ${niche}`, score: 90 },
    { title: `Top 10 ${niche} secrets`, score: 85 }
  ];
}


// Helper to summarize knowledge for the prompt
const getDirectorContext = () => {
  const cameraShots = (cinematicKnowledge as any).a_director_s_guide_to_cinematic_ai_visuals__best_practices_for_camera__lighting__and_pose_in_2025
    ?.slice(0, 8)
    .map((s: any) => `${s["Camera Shot"]}: ${s["Prompt Keywords & Narrative Impact"]}`)
    .join("; ") || "";

  const thumbnailUtils = (cinematicKnowledge as any).high_ctr_thumbnail_knowledge_table__deep_sea___prehistoric_niche_
    ?.[0] || {};
  const hookPrinciples = `Hook Principles: ${thumbnailUtils["Primary Emotion Trigger"] || ""} - ${thumbnailUtils["Thumbnail Goal"] || ""}`;

  return `
    DIRECTOR'S KNOWLEDGE BASE (Use this for visual descriptions):
    [Camera Specs]: ${cameraShots}
    [Hook Strategy]: ${hookPrinciples}
    [Lighting]: Motivated Realism (Deakins Principle) - light must have a source.
    `;
};

// Helper: Select the best strategy based on Niche keyword
const getRetentionStrategy = (niche: string) => {
  const lowerNiche = niche.toLowerCase();

  // Simple keyword matching to find the best archetype
  if (lowerNiche.includes('gam') || lowerNiche.includes('play') || lowerNiche.includes('minecraft') || lowerNiche.includes('roblox')) return viralStrategies.Gaming;
  if (lowerNiche.includes('tech') || lowerNiche.includes('review') || lowerNiche.includes('unbox') || lowerNiche.includes('apple')) return viralStrategies.Tech;
  if (lowerNiche.includes('money') || lowerNiche.includes('financ') || lowerNiche.includes('business') || lowerNiche.includes('crypto')) return viralStrategies.Finance;
  if (lowerNiche.includes('history') || lowerNiche.includes('docu') || lowerNiche.includes('crime') || lowerNiche.includes('mystery')) return viralStrategies.Documentary;
  if (lowerNiche.includes('horror') || lowerNiche.includes('scary') || lowerNiche.includes('creep')) return viralStrategies.Horror;
  if (lowerNiche.includes('health') || lowerNiche.includes('fit') || lowerNiche.includes('workout') || lowerNiche.includes('diet')) return viralStrategies.Health;
  if (lowerNiche.includes('vlog') || lowerNiche.includes('life') || lowerNiche.includes('daily')) return viralStrategies.Vlog;

  // Default to Universal if no specific match
  return viralStrategies.Universal;
};

export async function generateNarrative(
  topic: string,
  niche: string,
  referenceUrl?: string,
  videoLength?: string,
  voiceStyle?: string,
  visualStyle?: string,
  aspectRatio?: string,
  platform?: string,
  mood?: string
) {
  const strategy = getRetentionStrategy(niche);
  console.log(`[Service] Applied Viral Strategy: ${strategy.structure_name} for niche: ${niche}`);
  console.log(`[Service] Visual Style: ${visualStyle || 'Cinematic/Photorealistic (default)'}`);
  console.log(`[Service] Aspect Ratio: ${aspectRatio || '16:9 (default)'}`);

  // Determine effective values with defaults
  const effectiveVisualStyle = visualStyle || 'Cinematic photorealistic';
  const effectiveAspectRatio = aspectRatio || '16:9';
  const effectivePlatform = platform || 'YouTube';
  const effectiveMood = mood || 'Cinematic';

  const visualStyleGuide = {
    '2d': '2D animated, vibrant colors, clean vector graphics, motion graphics style, flat design with subtle shadows',
    'anime': 'Anime style, Japanese animation aesthetic, expressive characters, dynamic poses, cel-shaded',
    'cinematic': 'Cinematic photorealistic, 35mm film, shallow depth of field, dramatic lighting, movie quality',
    '3d': '3D rendered, Pixar-quality animation, smooth textures, volumetric lighting, high-fidelity CGI',
    'documentary': 'Documentary style, raw footage aesthetic, natural lighting, handheld camera feel, authentic',
    'horror': 'Dark and atmospheric, unsettling imagery, deep shadows, desaturated colors, ominous mood',
    'retro': 'Retro aesthetic, vintage film grain, 80s/90s color palette, nostalgic vibe, VHS texture'
  };

  // Match user's style to guide (case insensitive partial match)
  const lowerStyle = effectiveVisualStyle.toLowerCase();
  let styleDescription = visualStyleGuide['cinematic']; // default
  for (const [key, value] of Object.entries(visualStyleGuide)) {
    if (lowerStyle.includes(key)) {
      styleDescription = value;
      break;
    }
  }

  const directorContext = getDirectorContext();

  const systemPrompt = `You are a World-Class YouTube Scriptwriter, Cinematic Director, and Retention Expert.
  You specialize in the '${niche}' niche and assume the archetype of: ${strategy.structure_name}.
  
  GOAL: Create a viral retention-based script + detailed AI art prompts.
  
  ## VISUAL STYLE (USER PREFERENCE - CRITICAL):
  **ALL video_prompts MUST use this visual style: ${effectiveVisualStyle}**
  Style Guide: ${styleDescription}
  - Every "video_prompts" entry must explicitly include this style in the description.
  - Do NOT generate photorealistic prompts if user asked for 2D/anime.
  - Do NOT generate animated prompts if user asked for cinematic.
  
  ## ASPECT RATIO (CRITICAL):
  **ALL prompts MUST use this aspect ratio: ${effectiveAspectRatio}**
  - Add "--ar ${effectiveAspectRatio}" to EVERY image_prompt and video_prompt.
  - ${effectiveAspectRatio === '9:16' ? 'VERTICAL composition: Center subjects, use portrait framing, ideal for TikTok/Reels/Shorts.' : ''}
  - ${effectiveAspectRatio === '16:9' ? 'HORIZONTAL composition: Wide shots, landscape framing, ideal for YouTube.' : ''}
  - ${effectiveAspectRatio === '1:1' ? 'SQUARE composition: Centered subjects, balanced framing, ideal for Instagram.' : ''}
  
  ## PLATFORM: ${effectivePlatform}
  ## MOOD/TONE: ${effectiveMood}
  
  ## CORE ARCHITECTURE: ${strategy.structure_name}
  You MUST adhere to this exact pacing structure tailored for this niche:
  
  **HOOK STRATEGY**: ${strategy.hook_strategy}
  **PACING RULE**: ${strategy.pacing}
  **EMOTIONAL ARC**: ${strategy.emotional_arc}

  ## RETENTION RULES (The "Secret Sauce"):
  ${strategy.retention_rules.map((r: string, i: number) => `${i + 1}. ${r}`).join('\n  ')}

  ## UNIVERSAL VIRAL STRUCTURE (Underlying Framework):
  1. **THE HOOK**: Execute the Hook Strategy above.
  2. **THE CONTEXT**: Why does this matter?
  3. **THE ESCALATION**: Raise stakes/complexity endlessly.
  4. **THE MIDPOINT**: Subvert expectations.
  5. **THE CLIMAX**: Payoff the hook.
  6. **THE OUTRO**: Quick loop.

  USER INPUT:
  - Topic: "${topic}"
  - Reference Style: ${referenceUrl || 'None'}
  - Target Word Count: ${videoLength || '1500 Words'}
  - Voice: ${voiceStyle || 'Conversational'}
  - **Voice Tone Instruction**: ${voiceStyle === 'Friendly'
      ? 'Read as an engaging, friendly guide sharing a fascinating story. Maintain a warm, clear, and approachable tone that feels like a conversation with an expert friend.'
      : 'Match the requested style.'}
  
  // NOTE: Initial visuals are just placeholders. The Frontend will call 'generateExactVisuals' later.
  6. **VISUAL PLACEHOLDER**:
     - Provide 1-2 generic "Establishing Shots" per scene. 
     - Do NOT waste tokens generating 10 shots here. 
     - The exact visual script will be generated AFTER the audio duration is confirmed.
  
  ${directorContext}

  PROCESS:
  1. **ANALYSIS PHASE**: Analyze niche/reference.
  2. **SCRIPT GENERATION**: Write a **MASSIVE, IN-DEPTH SCRIPT**.
     - **CRITICAL REQUIREMENT**: The user requested a Target Length of **${videoLength || '1500 Words'}**. 
     - **YOU MUST MEET THIS TARGET**. Do not summarize. Do not be concise.
     - **EXPANSION STRATEGY**: 
       * Deep dive into history/science/context for every point.
       * Use detailed examples, analogies, and sensory descriptions.
       * If the topic is simple, broaden the scope to related fields.
       * **The script must be long enough to match the requested word count.**
  3. **DIRECTOR PHASE**: Generated specific image/video prompts.
     - **MANDATORY FORMAT**: Each prompt string must be a rich 40-60 word paragraph.
     - **REQUIRED ELEMENTS**: Subject, Camera, Lighting, Motion, Atmosphere.

  RETURN JSON ONLY:
  {
    "hook": "First 15s lines...",
    "voice_style_recommendation": "...",
    "estimated_duration": "...",
    "structure": [
      { 
        "timestamp": "0:00-0:15", 
        "section": "THE HOOK",
        "visual_cue": "Brief description for editor", 
        "voiceover": "Script lines...",
        "image_prompt": "Cinematic wide shot of..., 35mm, 8k, --ar 16:9",
        "video_prompts": [
          "Shot 1 (0-5s): [Camera Angle] [Subject Action] [Lighting]...",
          "Shot 2 (5-10s): ..."
        ]
      }
    ],
    "title_options": ["Title 1", "Title 2", "Title 3"],
    "keywords": ["tag1", "tag2"],
    "description": "..."
  }
  `;

  const userQuery = `Create a script for: "${topic}"`;

  try {
    return await callGeminiViaPuter(systemPrompt, userQuery);
  } catch (e) {
    console.error("Gemini Gen Error:", e);
    throw e;
  }
}

export async function fetchPuterUser() { return { username: 'Google Cloud User' }; }
export async function fetchPuterMonthlyUsage() { return { remaining: 1000000, monthUsageAllowance: 1000000 }; }

export async function generateImage(prompt: string) {
  try {
    console.log(`[Service] Generating image via Pollinations (Go-to Free Tier) for: "${prompt.substring(0, 50)}..."`);
    const encodedPrompt = encodeURIComponent(prompt);
    const seed = Math.floor(Math.random() * 1000);
    const url = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=1280&height=720&nologo=true&seed=${seed}`;
    return url;
  } catch (err: any) {
    console.warn("[Service] Image Gen failed:", err);
    return null;
  }
}

// --- SPEECH GENERATION (Google) ---
export async function generateSpeech(text: string, voiceName: string = 'en-US-Journey-D', sceneContext: string = '') {
  try {
    if (API_KEY) {
      console.log("[Service] Using Direct Google TTS");
      const { generateTTSWithGoogle } = await import('./google_direct');
      const audioContent = await generateTTSWithGoogle(text, voiceName);
      const dataUrl = `data:audio/mp3;base64,${audioContent}`;
      // Save logic (bg)
      try {
        const timestamp = Date.now();
        const contextPrefix = sceneContext ? `${sceneContext}_` : '';
        const filename = `${contextPrefix}voice_${timestamp}.mp3`;
        await fetch('http://localhost:3001/save-audio', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filename, audioData: dataUrl })
        });
      } catch (saveErr) { }
      return dataUrl;
    }
    throw new Error("No Google API Key found");
  } catch (err: any) {
    console.warn("[Service] Speech Gen Error:", err);
    return null;
  }
}

// --- THUMBNAIL GENERATOR ---
export async function generateThumbnail(topic: string, niche: string, _referenceUrl: string) {
  try {
    const directorContext = getDirectorContext();
    const systemPrompt = `You are a YouTube Thumbnail Expert.
      GOAL: Describe a HIGH-CTR Thumbnail for a video about "${topic}" in the "${niche}" niche.
      KNOWLEDGE BASE: ${directorContext}
      INSTRUCTIONS: OUTPUT ONLY the raw image prompt for an AI generator.`;
    const userQuery = `Create a thumbnail prompt for: ${topic}`;
    let thumbnailPrompt = "";
    const result = await callGeminiViaPuter(systemPrompt, userQuery);
    if (typeof result === 'string') thumbnailPrompt = result;
    else if (result.response) thumbnailPrompt = result.response;
    else if (result.thumbnail_prompt) thumbnailPrompt = result.thumbnail_prompt;
    else thumbnailPrompt = JSON.stringify(result);
    return await generateImage(thumbnailPrompt);
  } catch (e) {
    console.error("Thumbnail Gen Error:", e);
    return null;
  }
}

export function calculateUsagePercentage() { return 0; }

// --- PIPER TTS (Offline) & UTILS ---
let piperEngine: any = null;
let loadedVoice: string | null = null;

// Available local voices (must be downloaded to public/piper/)
const LOCAL_VOICES: Record<string, string> = {
  'lessac': '/piper/en_US-lessac-medium.onnx',
  'joe': '/piper/en_US-joe-medium.onnx',
  'ryan': '/piper/en_US-ryan-medium.onnx',
};

// Get voice based on style preference
function selectVoiceForStyle(style?: string): string {
  const lowerStyle = (style || '').toLowerCase();
  if (lowerStyle.includes('dramatic') || lowerStyle.includes('horror') || lowerStyle.includes('deep')) {
    return 'ryan';
  }
  if (lowerStyle.includes('friendly') || lowerStyle.includes('warm') || lowerStyle.includes('vlog')) {
    return 'joe';
  }
  return 'lessac'; // default neutral
}

// REPLACED: Client-side Piper removed. Now using Server-Side Piper.
export async function generateAudioOnServer(text: string, voiceStyle: string, sceneNum: number, serverUrl: string) {
  try {
    const voiceName = selectVoiceForStyle(voiceStyle);

    // Remove "piper/" prefix if present in LOCAL_VOICES, we just send the ID
    // Actually selectVoiceForStyle returns 'ryan', 'joe', etc.
    // We need to map that to the ONNX filename expected by server
    // Server expects: "en_US-ryan-medium"
    const voiceMap: Record<string, string> = {
      'ryan': 'en_US-ryan-medium',
      'joe': 'en_US-joe-medium',
      'lessac': 'en_US-lessac-medium'
    };
    const voiceId = voiceMap[voiceName] || 'en_US-lessac-medium';

    console.log(`[Service] Requesting server audio (Voice: ${voiceId})...`);

    const resp = await fetch(`${serverUrl}/generate-voiceover`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        voiceId,
        sceneNum
      })
    });

    if (!resp.ok) {
      const err = await resp.json();
      throw new Error(err.error || 'Server audio gen failed');
    }

    const data = await resp.json();
    console.log(`[Service] Server generated audio: ${data.path}`);
    return true;

  } catch (e: any) {
    console.error("Server Audio Error:", e);
    return false;
  }
}

// Legacy stub
export async function generateSpeechWithPiper(text: string, voiceStyle?: string) {
  console.warn("Legacy generateSpeechWithPiper called - should use generateAudioOnServer");
  return null;
}

// Helper: Silent audio stub (unused in server mode)
function createSilentAudio(): string {
  return "";
}

// --- PUTER VIDEO (Cloud) ---
// Configurable delay between requests to avoid rate limiting
const VIDEO_REQUEST_DELAY_MS = 3000; // 3 seconds between requests

export async function generateVideoWithPuter(
  prompt: string,
  model: string = 'sora-2',
  retries: number = 2
): Promise<string | null> {
  if (typeof (window as any).puter === 'undefined') {
    console.error("[Puter Video] Puter.js not loaded!");
    throw new Error("Puter.js not initialized. Please reload the page.");
  }

  // Clean prompt (remove shot markers, limit length)
  const cleanPrompt = prompt
    .replace(/\[.*?\]/g, '') // Remove [Shot X] markers
    .replace(/\(\d+[s\-]+\d*s?\)/g, '') // Remove (5-15s) timing markers
    .trim()
    .substring(0, 500); // Limit prompt length

  console.log(`[Puter Video] Generating (${model}, 16:9): ${cleanPrompt.substring(0, 60)}...`);

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await (window as any).puter.ai.txt2vid(cleanPrompt, {
        model: model,
        aspect_ratio: '16:9', // Force landscape 16:9
        // duration: 5 // Some APIs support duration in seconds
      });

      // Handle various response formats
      if (res && res.success === false) {
        const errorMsg = res.error?.message || res.error?.code || 'Unknown API error';
        console.error(`[Puter Video] API Error (Attempt ${attempt}/${retries}): ${errorMsg}`);

        // Check for rate limit / budget errors
        if (errorMsg.includes('budget') || errorMsg.includes('limit') || errorMsg.includes('quota')) {
          throw new Error(`BUDGET_EXCEEDED: Puter free tier limit reached. Try again later or upgrade your account.`);
        }

        if (attempt < retries) {
          console.log(`[Puter Video] Retrying in ${VIDEO_REQUEST_DELAY_MS / 1000}s...`);
          await new Promise(r => setTimeout(r, VIDEO_REQUEST_DELAY_MS));
          continue;
        }
        throw new Error(errorMsg);
      }

      // Extract video URL from response
      let videoUrl: string | null = null;
      if (typeof res === 'string') {
        videoUrl = res;
      } else if (res?.src) {
        videoUrl = res.src;
      } else if (res?.url) {
        videoUrl = res.url;
      } else if (res?.outerHTML && res.src) {
        // Video element returned
        videoUrl = res.src;
      }

      if (videoUrl) {
        console.log(`[Puter Video] ✓ Success! Video URL obtained.`);
        return videoUrl;
      }

      console.warn("[Puter Video] Unexpected response format:", res);
      return null;

    } catch (err: any) {
      console.error(`[Puter Video] Error (Attempt ${attempt}/${retries}):`, err);

      // Don't retry budget errors
      if (err.message?.includes('BUDGET_EXCEEDED')) {
        throw err;
      }

      if (attempt < retries) {
        console.log(`[Puter Video] Retrying in ${VIDEO_REQUEST_DELAY_MS / 1000}s...`);
        await new Promise(r => setTimeout(r, VIDEO_REQUEST_DELAY_MS));
      } else {
        throw err;
      }
    }
  }

  return null;
}

export async function generateExtraVideoPrompts(
  niche: string,
  voiceoverContext: string,
  existingPrompts: string[],
  countNeeded: number,
  visualStyle?: string
) {
  try {
    const directorContext = getDirectorContext();
    const strategy = getRetentionStrategy(niche);

    // Use provided visual style or default to cinematic
    const effectiveStyle = visualStyle || 'Cinematic photorealistic';

    const systemPrompt = `You are an Expert Visual Director API.
    ROLE: Expand a video scene by generating ${countNeeded} NEW, UNIQUE video prompts.
    CONTEXT: The voiceover is longer than expected, so we need more B-Roll shots to cover the audio.
    
    ## CRITICAL - VISUAL STYLE (USER PREFERENCE):
    **ALL prompts MUST use this visual style: ${effectiveStyle}**
    - Match the existing shots' style exactly.
    - If existing shots are 2D animated, new shots must also be 2D animated.
    - If existing shots are cinematic, new shots must also be cinematic.
    
    STYLE: ${strategy.structure_name}
    KNOWLEDGE BASE: ${directorContext}

    EXISTING SHOTS (Do NOT repeat these):
    ${existingPrompts.map((p, i) => `Shot ${i + 1}: ${p}`).join('\n')}

    VOICEOVER CONTEXT:
    "${voiceoverContext}"

    INSTRUCTIONS:
    1. Generate exactly ${countNeeded} NEW visual prompts.
    2. Must match the mood/style of the existing shots.
    3. Must be visually distinct (different angles, subjects, or details).
    4. Each prompt must be a standalone 40-60 word description.
    5. OUTPUT JSON ONLY: { "new_prompts": ["Prompt 1...", "Prompt 2..."] }
    `;

    const userQuery = `Generate ${countNeeded} new shots.`;

    const result = await callGeminiViaPuter(systemPrompt, userQuery);

    // Parse result
    let newPrompts: string[] = [];
    if (result && result.new_prompts && Array.isArray(result.new_prompts)) {
      newPrompts = result.new_prompts;
    } else if (Array.isArray(result)) {
      newPrompts = result;
    }

    console.log(`[Service] Generated ${newPrompts.length} extra shots.`);
    return newPrompts;

  } catch (e) {
    console.error("Extra Visuals Gen Error:", e);
    return ["Cinematic B-Roll Placeholder"]; // Fallback
  }
}

export async function generateExactVisuals(
  niche: string,
  voiceoverContext: string,
  countNeeded: number,
  visualStyle?: string
) {
  try {
    const directorContext = getDirectorContext();
    const strategy = getRetentionStrategy(niche);

    // Use provided visual style or default to cinematic
    const effectiveStyle = visualStyle || 'Cinematic photorealistic';

    const systemPrompt = `You are an Expert Visual Director API.
    ROLE: Generate a perfectly paced visual script for a video.
    CONTEXT: We have the final voiceover and need exactly ${countNeeded} visuals to match the duration (5-7s each).
    
    ## CRITICAL - VISUAL STYLE (USER PREFERENCE):
    **ALL prompts MUST use this visual style: ${effectiveStyle}**
    - If "2D" or "animated": Use 2D animation style, motion graphics, clean vectors.
    - If "anime": Use Japanese anime aesthetic, cel-shaded, expressive.
    - If "cinematic": Use photorealistic, 35mm film, dramatic lighting.
    - If "3D": Use 3D CGI renders, Pixar quality.
    
    STYLE: ${strategy.structure_name}
    KNOWLEDGE BASE: ${directorContext}

    VOICEOVER CONTEXT:
    "${voiceoverContext}"

    INSTRUCTIONS:
    1. Generate exactly ${countNeeded} CINEMATIC visual prompts.
    2. Start wide/establishing if it's the beginning, move to close-ups for emotion.
    3. Ensure flow and variety (don't repeat angles).
    4. Each prompt must be a standalone 40-60 word description.
    5. OUTPUT JSON ONLY: { "prompts": ["Shot 1...", "Shot 2..."] }
    `;

    const userQuery = `Create ${countNeeded} shots for this script section.`;

    const result = await callGeminiViaPuter(systemPrompt, userQuery);

    // Parse result
    let prompts: string[] = [];
    if (result && result.prompts && Array.isArray(result.prompts)) {
      prompts = result.prompts;
    } else if (Array.isArray(result)) {
      prompts = result;
    }

    console.log(`[Service] JIT Generated ${prompts.length} exact shots.`);
    return prompts;

  } catch (e) {
    console.error("JIT Visuals Gen Error:", e);
    return [];
  }
}

// --- CONSULTANT AGENT (Agent 3) ---
export async function consultWithUser(history: { role: string, content: string }[]) {
  try {
    const systemPrompt = `You are 'The Consultant', an elite Video Production Manager & Creative Director.
    
    YOUR ROLE: You are the SINGLE POINT OF CONTROL for the entire video creation pipeline.
    - You gather ALL requirements from the user.
    - You validate and lock each parameter.
    - You send a COMPLETE, ACCURATE config to the Director Agent.
    - The Director will use YOUR config EXACTLY as specified.
    
    ═══════════════════════════════════════════════════════════════
    MASTER PARAMETER LIST (You control ALL of these):
    ═══════════════════════════════════════════════════════════════
    
    1. **TOPIC** (Required): What is the video about?
    2. **NICHE** (Required): Category/genre (Gaming, Horror, Tech, Documentary, etc.)
    3. **VIDEO LENGTH** (Required): Duration or word count
       - Short: "30 seconds", "60 seconds"
       - Medium: "3-5 minutes", "1000 words"
       - Long: "10+ minutes", "3000 words"
    4. **VOICE STYLE** (Required): Male/Female + Tone
       - Examples: "Deep male narrator", "Friendly female", "Dramatic male", "Calm ASMR"
    5. **VISUAL STYLE** (Required): Art direction
       - CINEMATIC: 35mm film, photorealistic, movie-quality, dramatic lighting
       - ANIME: Japanese animation, cel-shaded, Makoto Shinkai/Ghibli style
       - 2D ANIMATED: Vector art, Kurzgesagt style, motion graphics
       - 3D CGI: Pixar quality, Unreal Engine 5, soft textures
       - DOCUMENTARY: Raw footage, natural lighting, journalistic
       - HORROR: Dark, desaturated, VHS grain, found footage
       - RETRO: 80s synthwave, neon, chromatic aberration
    6. **ASPECT RATIO** (Required): Video dimensions
       - 16:9 (YouTube, Desktop, Landscape - DEFAULT)
       - 9:16 (TikTok, Reels, Shorts, Vertical/Portrait)
       - 1:1 (Instagram Square)
       - 4:3 (Classic TV format)
    7. **PLATFORM** (Optional): Target platform affects pacing
       - YouTube (longer retention hooks)
       - TikTok/Reels (fast cuts, vertical)
       - Instagram (polished, square-friendly)
    8. **MOOD/TONE** (Optional): Emotional direction
       - Epic, Mysterious, Uplifting, Dark, Comedic, Educational, Inspiring
    
    ═══════════════════════════════════════════════════════════════
    CRITICAL RULES:
    ═══════════════════════════════════════════════════════════════
    
    1. **LISTEN AND APPLY EVERYTHING**: When the user says ANYTHING, you MUST update the config.
       - User says "make it 9:16" → Set aspectRatio to "9:16" IMMEDIATELY
       - User says "change to anime" → Set visualStyle to "Anime" IMMEDIATELY
       - User says "shorter, 30 seconds" → Set videoLength to "30 seconds" IMMEDIATELY
       - NEVER say "ok" without actually changing the value in your config output.
    
    2. **STYLE LOCK**: Once specified, a style is LOCKED. Never mix styles.
       - 2D → ALL prompts use vector art, clean lines. NEVER cinematic.
       - Anime → ALL prompts use Japanese animation. NEVER photorealistic.
       - Cinematic → ALL prompts use film quality. NEVER cartoon.
    
    3. **ASPECT RATIO ENFORCEMENT**: This affects ALL generated prompts.
       - 16:9 → "--ar 16:9" in prompts, horizontal compositions
       - 9:16 → "--ar 9:16" in prompts, vertical compositions, subjects centered
       - The Director and Script Generator will use this EXACT ratio.
    
    4. **OUTPUT FORMAT**: When you have enough info, output JSON:
       \`\`\`json
       {
         "ready": true,
         "topic": "...",
         "niche": "...",
         "videoLength": "30 seconds",
         "voiceStyle": "Deep male narrator",
         "visualStyle": "Anime",
         "aspectRatio": "9:16",
         "platform": "TikTok",
         "mood": "Epic"
       }
       \`\`\`
    
    5. **ALWAYS RE-OUTPUT JSON when user changes ANYTHING**:
       - If user corrects ANY parameter, output a NEW JSON block with ALL parameters updated.
       - This triggers a FRESH generation with the correct settings.
    
    6. **BE PROFESSIONAL**: 
       - Confirm each parameter clearly.
       - Summarize the full config before starting.
       - Ask clarifying questions only if truly needed.
       - Don't ask about parameters the user already specified.
    
    7. **DEFAULTS** (if user doesn't specify):
       - aspectRatio: "16:9"
       - platform: "YouTube"
       - mood: "Cinematic"
    
    ═══════════════════════════════════════════════════════════════
    CURRENT CONVERSATION:
    ═══════════════════════════════════════════════════════════════
    ${history.map(m => `${m.role.toUpperCase()}: ${m.content}`).join('\n')}
    `;

    const userQuery = `Reply to the user. If they specified or changed any parameter, include an updated JSON config block.`;
    const result = await callGeminiViaPuter(systemPrompt, userQuery);

    // Check if result contains JSON block
    let responseText = "";
    let extractedConfig = null;

    if (typeof result === 'string') {
      responseText = result;

      // Try 1: Markdown code block format ```json ... ```
      let jsonMatch = result.match(/```json\n([\s\S]*?)\n```/);

      // Try 2: Raw inline JSON object { ... } at the end of the message
      if (!jsonMatch) {
        // Match JSON object that starts with { "ready": and ends with }
        jsonMatch = result.match(/\{\s*"ready"\s*:\s*(true|false)[\s\S]*?\}/);
        if (jsonMatch) {
          // Wrap in array format for consistent handling
          jsonMatch = [jsonMatch[0], jsonMatch[0]];
        }
      }

      if (jsonMatch && jsonMatch[1]) {
        try {
          extractedConfig = JSON.parse(jsonMatch[1]);
          // Remove the JSON from the displayed message
          responseText = result.replace(jsonMatch[0], '').trim();

          // Auto-enrich with voice selection based on niche
          if (extractedConfig.ready && extractedConfig.niche) {
            const voice = getVoiceForNiche(extractedConfig.niche);
            extractedConfig.voiceId = voice.id;
            extractedConfig.voiceGender = voice.gender;
            extractedConfig.voiceDescription = voice.description;
            console.log(`[Consultant] Auto-selected voice: ${voice.id} (${voice.description})`);
          }

          console.log("[Consultant] Extracted config:", extractedConfig);
        } catch (e) {
          console.warn("Failed to parse Consultant JSON", e);
        }
      }
    } else {
      responseText = result.response || "I'm having trouble thinking. Can you repeat that?";
    }

    return { message: responseText, config: extractedConfig };


  } catch (e) {
    console.error("Consultant Agent Error:", e);
    return { message: "System Error: The Consultant is offline.", config: null };
  }
}

// --- POLLINATIONS (UNLIMITED) ---
export async function generateVideoWithPollinations(prompt: string) {
  // Pollinations.ai is free and unlimited for high-res images.
  // We use this as a robust fallback or primary "Unlimited" option.
  // We use the 'flux' model for realism or 'midjourney' style.
  const cleanPrompt = prompt.replace(/\[.*?\]/g, '').trim();
  const seed = Math.floor(Math.random() * 1000000);

  // URL Structure: https://pollinations.ai/p/{prompt}?width=1280&height=720&seed={seed}&model=flux
  // Note: We return this as a URL string. The frontend can treat it as an image asset 
  // OR we can wrap it in a pseudo-video object if needed.
  // For the "Video" flow, we'll return it, but the UI might need to handle it as an image 
  // that plays with a pan/zoom effect or just static.
  // Using 'flux' model for best quality.

  const url = `https://pollinations.ai/p/${encodeURIComponent(cleanPrompt)}?width=1280&height=720&seed=${seed}&model=flux&nologo=true`;

  console.log(`[Pollinations] Generated: ${url}`);
  return url;
}