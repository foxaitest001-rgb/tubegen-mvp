
import { useState, useRef, useEffect } from 'react'
import { Sparkles, Layers, Type, Youtube, Video, Mic, Image as ImageIcon } from 'lucide-react';
import { UsageBadge } from './components/UsageBadge'
import { ConsultantChat } from './components/ConsultantChat'
import { generateNarrative, generateImage, generateSpeech, generateSpeechWithPiper, generateVideoWithPuter } from './services/puter'

function App() {
  const [step, setStep] = useState<'input' | 'generating' | 'result'>('input')
  const [niche, setNiche] = useState('')
  const [topic, setTopic] = useState('')
  const [result, setResult] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)

  // ... existing state ...
  const [referenceUrl, setReferenceUrl] = useState('')
  const [videoLength, setVideoLength] = useState('8-10 minutes')
  const [voiceStyle, setVoiceStyle] = useState('Conversational')
  const [voiceModel, setVoiceModel] = useState('en-US-Journey-D')
  // Providers
  const [voiceProvider, setVoiceProvider] = useState<'google' | 'piper'>('google')
  const [videoProvider, setVideoProvider] = useState<'pollinations' | 'puter' | 'meta-local'>('pollinations')
  // Remote Server URL (for GitHub RDP hybrid mode)
  const [remoteServerUrl, setRemoteServerUrl] = useState('')

  // New state for assets
  const [assets, setAssets] = useState<Record<string, { image?: any, audio?: any, type?: string, url?: string, label?: string }>>({})
  const [generatingAssets, setGeneratingAssets] = useState(false)

  // Thumbnail State
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
  const [generatingThumbnail, setGeneratingThumbnail] = useState(false);

  // ... 

  // State for director logs
  const [directorLogs, setDirectorLogs] = useState<string[]>([]);
  const logEndRef = useRef<HTMLDivElement>(null)

  // Audio State
  const [isGeneratingAudio, setIsGeneratingAudio] = useState(false);
  const [audioProgress, setAudioProgress] = useState(0);

  // Video State (Sora-2)
  const [isGeneratingVideos, setIsGeneratingVideos] = useState(false);
  const [videoProgress, setVideoProgress] = useState(0);
  const [generatedVideos, setGeneratedVideos] = useState<{ sceneIndex: number, shotIndex: number, url: string }[]>([]);

  // Consultant Handler
  const handleApplyConfig = (config: any) => {
    if (config.topic) setTopic(config.topic);
    if (config.niche) setNiche(config.niche);
    if (config.videoLength) setVideoLength(config.videoLength);
    if (config.voiceStyle) setVoiceStyle(config.voiceStyle);
    console.log("Config Applied:", config);
  };

  // AUTO-PIPELINE: Triggered when Consultant says "ready: true"
  // Full automation: Script → Piper Voiceover → Meta.ai Videos
  const handleStartPipeline = async (config: any) => {
    console.log("[Pipeline] 🚀 Starting FULL auto-generation with config:", config);

    // Step 0: Set providers to Piper (offline TTS) + Meta.ai (local video)
    setVoiceProvider('piper');
    setVideoProvider('meta-local');
    console.log("[Pipeline] Providers set: Voice=Piper, Video=Meta.ai");

    // Step 1: Generate the script
    try {
      setStep('generating');
      const { generateNarrative, generateSpeechWithPiper } = await import('./services/puter');

      const topicToUse = config.topic || topic;
      const nicheToUse = config.niche || niche;
      const lengthToUse = config.videoLength || videoLength;
      const styleToUse = config.voiceStyle || voiceStyle;
      const visualStyleToUse = config.visualStyle || 'Cinematic'; // Default to cinematic

      console.log("[Pipeline] Step 1: Generating script...");
      console.log(`[Pipeline] Visual Style: ${visualStyleToUse}`);
      const scriptResult = await generateNarrative(topicToUse, nicheToUse, referenceUrl, lengthToUse, styleToUse, visualStyleToUse);

      // Store visual style in result for later use by Director
      if (scriptResult) {
        scriptResult.visualStyle = visualStyleToUse;
      }

      if (!scriptResult || !scriptResult.structure) {
        throw new Error("Script generation failed");
      }

      setResult(scriptResult);
      setStep('result');
      console.log("[Pipeline] ✅ Script generated! Scenes:", scriptResult.structure.length);

      // Small delay for UI update
      await new Promise(r => setTimeout(r, 1000));

      // Step 2: Generate voiceover with Piper (offline)
      console.log("[Pipeline] Step 2: Generating Piper voiceover...");
      setIsGeneratingAudio(true);
      setAudioProgress(0);

      let totalScenes = scriptResult.structure.length;
      const generatedAudios: { name: string, url: string }[] = [];

      // Helper to save audio to server project folder
      const saveAudioToServer = async (url: string, filename: string, projectTitle: string, serverUrl: string) => {
        try {
          let base64 = '';
          if (typeof url === 'string' && url.startsWith('data:')) {
            base64 = url;
          } else {
            const blob = await fetch(url).then(r => r.blob());
            const reader = new FileReader();
            await new Promise((resolve) => {
              reader.onloadend = () => { base64 = reader.result as string; resolve(true); };
              reader.readAsDataURL(blob);
            });
          }

          const res = await fetch(`${serverUrl}/save-audio`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              filename,
              audioData: base64,
              projectName: projectTitle  // Pass project name for folder creation
            })
          });

          if (res.ok) {
            const data = await res.json();
            console.log(`[Audio] ✅ Saved to project folder: ${filename} -> ${data.projectFolder || 'server'}`);
            return true;
          } else {
            console.warn(`[Audio] ⚠️ Save failed for ${filename}`);
            return false;
          }
        } catch (err) {
          console.error(`[Audio] Save error for ${filename}:`, err);
          return false;
        }
      };

      // Generate Hook audio if present
      if (scriptResult.hook) {
        console.log("[Pipeline] Generating Hook voiceover...");
        const hookAudioUrl = await generateSpeechWithPiper(scriptResult.hook);
        if (hookAudioUrl) {
          setAssets(prev => ({
            ...prev,
            'hook_intro': { type: 'audio', url: hookAudioUrl, label: 'Hook Voiceover' }
          }));
          generatedAudios.push({ name: 'hook_intro.wav', url: hookAudioUrl });
        }
      }

      // Generate scene voiceovers
      for (let i = 0; i < scriptResult.structure.length; i++) {
        const scene = scriptResult.structure[i];
        setAudioProgress(Math.round(((i + 1) / totalScenes) * 100));

        if (scene.voiceover) {
          console.log(`[Pipeline] Generating voiceover for Scene ${i + 1}...`);
          try {
            const audioUrl = await generateSpeechWithPiper(scene.voiceover);
            if (audioUrl) {
              scene.audioUrl = audioUrl;
              generatedAudios.push({ name: `scene_${i + 1}_voiceover.wav`, url: audioUrl });
              console.log(`[Pipeline] ✅ Scene ${i + 1} voiceover complete`);
            }
          } catch (e) {
            console.warn(`[Pipeline] Scene ${i + 1} voiceover failed:`, e);
          }
        }

        // Small delay between generations
        await new Promise(r => setTimeout(r, 200));
      }

      setIsGeneratingAudio(false);
      setResult({ ...scriptResult }); // Update result with audio URLs
      console.log("[Pipeline] ✅ All voiceovers generated!");

      // Step 3: Send to Meta.ai Director (Local or Remote)
      const serverUrl = remoteServerUrl.trim() || 'http://localhost:3001';
      const isRemote = !!remoteServerUrl.trim();

      // Get project title for folder naming
      const projectTitle = scriptResult.title_options?.[0] || `video_${Date.now()}`;

      // SAVE ALL VOICEOVERS TO SERVER PROJECT FOLDER
      console.log(`[Pipeline] 📥 Saving ${generatedAudios.length} voiceover files to project folder...`);
      console.log(`[Pipeline] Project: ${projectTitle}`);
      console.log(`[Pipeline] Server: ${serverUrl}`);

      for (const audio of generatedAudios) {
        await saveAudioToServer(audio.url, audio.name, projectTitle, serverUrl);
        await new Promise(r => setTimeout(r, 200)); // Small delay between saves
      }
      console.log("[Pipeline] ✅ All voiceovers saved to project folder!");

      console.log(`[Pipeline] Step 3: Sending to ${isRemote ? 'REMOTE' : 'LOCAL'} Director: ${serverUrl}`);
      await new Promise(r => setTimeout(r, 500));

      try {
        const res = await fetch(`${serverUrl}/generate-video`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ scriptData: scriptResult })
        });

        const data = await res.json();
        if (res.ok) {
          console.log("[Pipeline] ✅ Director Agent started:", data.message);
          const locationMsg = isRemote
            ? `Videos generating on REMOTE server (GitHub RDP)!\nDownload from GitHub Artifacts when complete.`
            : `Meta.ai is now generating your videos.\nCheck the server console for progress.`;
          alert(`🎬 Full Pipeline Complete!\n\n✅ Script Generated\n✅ Voiceovers Created (Piper)\n✅ Director Agent Started\n\n${locationMsg}`);
        } else {
          throw new Error(data.error || "Director failed");
        }
      } catch (e: any) {
        console.error("[Pipeline] Director error:", e);
        alert(`⚠️ Script & Voiceover complete, but Meta.ai Director failed.\n\n${e.message}\n\nMake sure the backend server is running:\nnode server/index.js`);
      }

    } catch (e: any) {
      console.error("[Pipeline] Error:", e);
      alert("Pipeline Error: " + e.message);
      setStep('input');
      setIsGeneratingAudio(false);
    }
  };

  const handleGenerateVoiceover = async () => {
    if (!result || !result.structure) return;
    setIsGeneratingAudio(true);
    setAudioProgress(0);

    // 1. GENERATE HOOK AUDIO (Explicitly requested)
    if (result.hook) {
      console.log("[Audio] Generating HOOK Voiceover...");
      try {
        let hookAudioUrl = '';
        if (voiceProvider === 'piper') {
          hookAudioUrl = await generateSpeechWithPiper(result.hook) || '';
        } else {
          hookAudioUrl = await generateSpeech(result.hook, voiceModel, 'hook_intro') || '';
        }

        if (hookAudioUrl) {
          setAssets(prev => ({
            ...prev,
            'hook_intro': {
              type: 'audio',
              url: hookAudioUrl,
              label: 'Voiceover - The Hook (Intro)'
            }
          }));

          // Attempt to save to server
          try {
            let base64 = '';
            if (typeof hookAudioUrl === 'string' && hookAudioUrl.startsWith('data:')) {
              base64 = hookAudioUrl;
            } else {
              // fetch blob if url
              const blob = await fetch(hookAudioUrl).then(r => r.blob());
              const reader = new FileReader();
              await new Promise((resolve) => {
                reader.onloadend = () => { base64 = reader.result as string; resolve(true); };
                reader.readAsDataURL(blob);
              });
            }
            const safeTitle = result.title_options?.[0]?.substring(0, 10).replace(/[^a-z0-9]/gi, '_') || 'video';
            const projectTitle = result.title_options?.[0] || 'video';
            const serverUrl = remoteServerUrl.trim() || 'http://localhost:3001';
            await fetch(`${serverUrl}/save-audio`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                filename: `hook_${safeTitle}.mp3`,
                audioData: base64,
                projectName: projectTitle
              })
            });
            console.log("[Audio] Hook Saved to project folder.");
          } catch (err) {
            console.warn("Could not save hook audio", err);
          }
        }
      } catch (e) {
        console.error("Hook Audio Failed:", e);
      }
    }

    const newStructure = [...result.structure];
    let totalSeconds = 0;

    for (let i = 0; i < newStructure.length; i++) {
      const scene = newStructure[i];
      if (scene.voiceover) {
        // Pass scene context (e.g., "scene_1") for filename
        let audioUrl = '';
        if (voiceProvider === 'piper') {
          audioUrl = await generateSpeechWithPiper(scene.voiceover) || '';
        } else {
          audioUrl = await generateSpeech(scene.voiceover, voiceModel, `scene_${i + 1}`) || '';
        }

        console.log(`[Audio] Generated for Scene ${i + 1} using ${voiceProvider}`);

        // 11/17/2024 - Add to Assets
        setAssets(prev => ({
          ...prev,
          [`scene_${i + 1}`]: {
            ...prev[`scene_${i + 1}`],
            audio: {
              url: audioUrl,
              label: `Voiceover - Scene ${i + 1}`
            }
          }
        }));

        if (audioUrl) {
          // Attach Audio URL to scene
          if (typeof audioUrl === 'string') scene.audio_url = audioUrl;

          // Measure Duration
          try {
            const audio = new Audio(typeof audioUrl === 'string' ? audioUrl : '');
            await new Promise(r => {
              audio.onloadedmetadata = r;
              audio.onerror = r; // proceed even if fail
            });

            if (audio.duration && audio.duration !== Infinity) {
              scene.duration = audio.duration;
              scene.timestamp = `${formatTime(totalSeconds)} - ${formatTime(totalSeconds + audio.duration)}`;

              // RECALCULATE NEEDED VISUALS
              // 5s per clip
              const neededClips = Math.ceil(audio.duration / 5);
              // If we have fewer prompts than needed, repeat the last one or add generic ones
              if (!scene.video_prompts) scene.video_prompts = [];

              // Adjust array length (JIT Generation)
              // Professional Workflow: Generate visuals AFTER audio duration is known.
              if (scene.video_prompts.length !== neededClips) { // Always regenerate to match perfectly
                console.log(`[Visuals] JIT Sync: Audio is ${audio.duration}s. Generating exact shot list (${neededClips} shots)...`);

                try {
                  const { generateExactVisuals } = await import('./services/puter');
                  const newShots = await generateExactVisuals(
                    niche,
                    scene.voiceover,
                    neededClips
                  );

                  if (newShots && newShots.length > 0) {
                    scene.video_prompts = newShots; // REPLACE existing placeholders
                    console.log(`[Visuals] ✨ JIT Success: Replaced scene with ${newShots.length} perfect shots.`);
                  } else {
                    // Fallback if AI fails (keep existing or cycle)
                    console.warn("[Visuals] JIT Gen failed. Using fallback cycling.");
                    // ... fill deficit logic ...
                    const currentLen = scene.video_prompts.length;
                    const deficit = Math.max(0, neededClips - currentLen);
                    // Fallback using AI Expansion (No more duplicates!)
                    console.log(`[Visuals] JIT Shortfall. Generating ${deficit} EXTRA shots...`);
                    try {
                      const { generateExtraVideoPrompts } = await import('./services/puter');
                      const extraShots = await generateExtraVideoPrompts(
                        niche,
                        scene.voiceover,
                        scene.video_prompts,
                        deficit
                      );
                      if (extraShots && extraShots.length > 0) {
                        scene.video_prompts = [...scene.video_prompts, ...extraShots];
                        console.log(`[Visuals] Expanded scene with ${extraShots.length} unique shots.`);
                      } else {
                        // Ultimate fallback (should be rare)
                        const basePrompts = [...scene.video_prompts];
                        if (basePrompts.length === 0) basePrompts.push(scene.image_prompt || "Cinematic B-Roll Placeholder");
                        for (let k = 0; k < deficit; k++) {
                          scene.video_prompts.push(basePrompts[k % basePrompts.length]);
                        }
                      }
                    } catch (e) {
                      console.error("Expansion Error:", e);
                    }
                  }
                } catch (err) {
                  console.error("JIT Error:", err);
                }
              }


              totalSeconds += audio.duration;

              // AUTO-SAVE TO SERVER
              try {
                console.log(`[Audio] Generated for Scene ${i + 1}. Saving...`);

                let base64 = '';
                if (typeof audioUrl === 'string' && audioUrl.startsWith('data:')) {
                  base64 = audioUrl;
                } else {
                  const blob = await fetch(typeof audioUrl === 'string' ? audioUrl : '').then(r => r.blob());
                  const reader = new FileReader();
                  await new Promise((resolve, reject) => {
                    reader.onloadend = () => { base64 = reader.result as string; resolve(true); };
                    reader.onerror = reject;
                    reader.readAsDataURL(blob);
                  });
                }

                const safeTitle = result.title_options?.[0]?.substring(0, 10).replace(/[^a-z0-9]/gi, '_') || 'audio';
                const projectTitle = result.title_options?.[0] || 'video';
                const serverUrl = remoteServerUrl.trim() || 'http://localhost:3001';
                const filename = `voiceover_scene_${i + 1}_${safeTitle}.mp3`;

                const saveRes = await fetch(`${serverUrl}/save-audio`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    filename,
                    audioData: base64,
                    projectName: projectTitle
                  })
                });

                if (!saveRes.ok) {
                  const errText = await saveRes.text();
                  console.error("Save Audio API Error:", errText);
                  alert(`Audio Save Failed for Scene ${i + 1}: ${errText}`);
                } else {
                  console.log(`[Audio] Saved to project folder: ${filename}`);
                }

              } catch (saveErr: any) {
                console.error("Failed to save audio to server", saveErr);
                alert(`Audio Save Network Error: ${saveErr.message}`);
              }

            }
          } catch (e) {
            console.warn("Could not measure audio duration", e);
          }
        }

        // FAILSAFE: If no audio generated (or failed), ESTIMATE duration
        // Avg speaking rate: 150 wpm = 2.5 words/sec.
        if (scene.duration === undefined || scene.duration === 0) {
          const words = scene.voiceover.split(/\s+/).length;
          const estimatedDuration = Math.max(5, Math.ceil(words / 2.5)); // Min 5s
          console.log(`[Audio] TTS Not Available. Estimated duration for Scene ${i + 1}: ${estimatedDuration}s (${words} words)`);

          scene.duration = estimatedDuration;
          scene.timestamp = `${formatTime(totalSeconds)} - ${formatTime(totalSeconds + estimatedDuration)}`;

          // RECALCULATE NEEDED VISUALS for estimation
          const neededClips = Math.ceil(estimatedDuration / 5);
          if (!scene.video_prompts) scene.video_prompts = [];
          if (scene.video_prompts.length < neededClips) {
            const lastPrompt = scene.video_prompts[scene.video_prompts.length - 1] || scene.image_prompt || "Cinematic filler shot";
            for (let k = scene.video_prompts.length; k < neededClips; k++) {
              scene.video_prompts.push(lastPrompt);
            }
          }

          totalSeconds += estimatedDuration;
        }
      }
      setAudioProgress(Math.round(((i + 1) / newStructure.length) * 100));
    }

    setResult((prev: any) => ({ ...prev, structure: newStructure }));
    setIsGeneratingAudio(false);

    // Calculate Stats
    const totalScenes = newStructure.filter((s: any) => s.voiceover).length;
    const computed = newStructure.filter((s: any) => s.audio_url).length;
    const estimated = totalScenes - computed;

    // Smart Alert
    setTimeout(() => {
      if (computed === 0 && estimated > 0) {
        alert(`Google TTS API Forbidden (403).\n\nSwitched to 'Estimation Mode'.\nTimestamps have been calculated based on word count.\n\nYou can proceed to 'Send to Director'!`);
      } else if (estimated > 0) {
        alert(`Voiceover Partial Success: ${computed} files saved, ${estimated} estimated (API limit).`);
      } else {
        alert("Voiceover Generated & Saved to Server! Timestamps Synced.");
      }
    }, 100);
  };

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  useEffect(() => {
    // Scroll to bottom of logs
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [directorLogs]);

  useEffect(() => {
    // Subscribe to Director Events with Retry Logic (Silent when server offline)
    let evtSource: EventSource | null = null;
    let retryTimeout: any;
    let hasLoggedError = false; // Only log error once to avoid spam

    const connect = () => {
      evtSource = new EventSource('http://localhost:3001/events');

      evtSource.onopen = () => {
        hasLoggedError = false; // Reset on successful connection
        console.log("[Director] ✅ Connected to Director Logs");
        setDirectorLogs(prev => [...prev, "--- Connection Established ---"]);
      };

      evtSource.onmessage = (event) => {
        const data = JSON.parse(event.data);
        setDirectorLogs(prev => [...prev, data.message]);
      };

      evtSource.onerror = () => {
        if (!hasLoggedError) {
          console.log("[Director] ⚠️ Backend server not running. Retrying silently...");
          hasLoggedError = true;
        }
        if (evtSource) evtSource.close();
        // Retry silently in 5s (less aggressive than 3s)
        retryTimeout = setTimeout(connect, 5000);
      };
    };

    connect();

    return () => {
      if (evtSource) evtSource.close();
      if (retryTimeout) clearTimeout(retryTimeout);
    };
  }, []);

  const handleGenerate = async () => {
    if (!niche || !topic) return
    setStep('generating')
    setError(null)
    setAssets({}) // Reset assets

    console.log("Starting generation with:", { topic, niche, referenceUrl, videoLength, voiceStyle });

    try {
      // Create a timeout promise (Extended to 5 mins for Long Scripts)
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Generation timed out (300s). Check your internet connection.")), 300000)
      );

      // Race the generation against the timeout
      const data = await Promise.race([
        generateNarrative(topic, niche, referenceUrl, videoLength, voiceStyle),
        timeoutPromise
      ]);

      console.log("Generation successful:", data);
      setResult(data)
      setStep('result')
    } catch (e: any) {
      console.error("Gen Error:", e)
      // Display detailed error if available
      setError(`Error: ${e.message || 'Unknown error'}. Check F12 Console for details.`)
      setStep('input')
    }
  }

  // ...

  const handleGenerateAssets = async () => {
    if (!result || !result.structure) return;
    setGeneratingAssets(true);

    // ... existing logic ...


    const newAssets: Record<string, { image?: any, audio?: any }> = {};

    // Parallel processing for speed
    await Promise.all(result.structure.map(async (scene: any, index: number) => {
      const key = scene.timestamp || index.toString();
      newAssets[key] = {};

      try {
        if (scene.image_prompt || scene.visual_cue) {
          const prompt = scene.image_prompt || scene.visual_cue;

          if (videoProvider === 'puter') {
            // SORA-2 (Quota)
            const vid = await generateVideoWithPuter(prompt);
            if (vid) newAssets[key].image = { url: vid, type: 'video' };
          } else if (videoProvider === 'pollinations') {
            // POLLINATIONS (Unlimited)
            const { generateVideoWithPollinations } = await import('./services/puter');
            const vid = await generateVideoWithPollinations(prompt);
            // Note: Pollinations returns a URL that works like an image but we treat it as video source
            if (vid) newAssets[key].image = { url: vid, type: 'image' };
          } else if (videoProvider === 'meta-local') {
            // META LOCAL (Handled by separate button, but we can generate placeholder)
            const img = await generateImage(prompt);
            if (img) newAssets[key].image = { url: img, type: 'image' };
          } else {
            // Fallback
            const img = await generateImage(prompt);
            if (img) newAssets[key].image = { url: img, type: 'image' };
          }
        }
      } catch (e) {
        console.error("Image Gen Error for", key, e);
      }

      try {
        if (scene.voiceover) {
          const audio = await generateSpeech(scene.voiceover);
          if (audio) newAssets[key].audio = audio;
        }
      } catch (e) {
        console.error("Audio Gen Error for", key, e);
      }
    }));

    setAssets(newAssets);
    setGeneratingAssets(false);
  };

  // --- VIDEO GENERATION (Pollinations + Sora-2) ---
  const handleGenerateVideos = async () => {
    if (!result || !result.structure) return;

    // Allow both Puter and Pollinations
    if (videoProvider !== 'puter' && videoProvider !== 'pollinations') {
      alert("Video generation requires Sora-2 (Puter) or Pollinations (Unlimited) to be selected.");
      return;
    }

    setIsGeneratingVideos(true);
    setVideoProgress(0);
    setGeneratedVideos([]);

    // Collect all prompts first
    const allPrompts: { sceneIndex: number, shotIndex: number, prompt: string }[] = [];
    result.structure.forEach((scene: any, sceneIdx: number) => {
      if (scene.video_prompts && scene.video_prompts.length > 0) {
        scene.video_prompts.forEach((p: string, shotIdx: number) => {
          allPrompts.push({ sceneIndex: sceneIdx + 1, shotIndex: shotIdx + 1, prompt: p });
        });
      } else if (scene.image_prompt) {
        allPrompts.push({ sceneIndex: sceneIdx + 1, shotIndex: 1, prompt: scene.image_prompt });
      }
    });

    console.log(`[Video Gen] Starting generation for ${allPrompts.length} clips with ${videoProvider}...`);

    const videos: { sceneIndex: number, shotIndex: number, url: string }[] = [];
    let budgetExceeded = false;

    // Dynamically import pollinations if needed
    let generateVideoWithPollinations: any = null;
    if (videoProvider === 'pollinations') {
      const mod = await import('./services/puter');
      generateVideoWithPollinations = mod.generateVideoWithPollinations;
    }

    for (let i = 0; i < allPrompts.length; i++) {
      if (budgetExceeded) break; // Stop if budget hit

      const { sceneIndex, shotIndex, prompt } = allPrompts[i];
      setVideoProgress(Math.round(((i + 1) / allPrompts.length) * 100));

      try {
        console.log(`[${videoProvider}] Generating Scene ${sceneIndex}, Shot ${shotIndex}...`);

        let videoUrl = null;
        if (videoProvider === 'puter') {
          videoUrl = await generateVideoWithPuter(prompt);
        } else if (videoProvider === 'pollinations') {
          videoUrl = await generateVideoWithPollinations(prompt);
        }

        if (videoUrl) {
          videos.push({ sceneIndex, shotIndex, url: videoUrl as string });
          console.log(`[${videoProvider}] ✓ Generated: Scene ${sceneIndex}, Shot ${shotIndex}`);
        }

        // Add delay only for Puter (Rate Limit protection)
        // Pollinations is faster/unlimited but we still add small delay to be safe
        if (i < allPrompts.length - 1) {
          const delay = videoProvider === 'puter' ? 3000 : 500;
          await new Promise(r => setTimeout(r, delay));
        }

      } catch (e: any) {
        console.error(`[${videoProvider}] Failed for Scene ${sceneIndex}, Shot ${shotIndex}:`, e);

        // Check for budget errors (Puter only)
        if (videoProvider === 'puter' && e.message?.includes('BUDGET_EXCEEDED')) {
          budgetExceeded = true;
          alert(`⚠️ Puter Free Tier Limit Reached!\n\nSwitching to "Pollinations (Unlimited)" is recommended.`);
        }
      }
    }

    setGeneratedVideos(videos);
    setIsGeneratingVideos(false);

    if (!budgetExceeded) {
      alert(`✅ Video Generation Complete!\n\n${videos.length}/${allPrompts.length} clips generated.`);
    }
  };



  const handleGenerateThumbnail = async () => {
    if (!niche || !topic) return;
    setGeneratingThumbnail(true);
    try {
      const { generateThumbnail } = await import('./services/puter');
      const url = await generateThumbnail(topic, niche, referenceUrl || '');
      if (url) {
        setThumbnailUrl(url);
        alert("Thumbnail Generated! Scroll down to view.");
      } else {
        alert("Failed to generate thumbnail. Check console.");
      }
    } catch (e: any) {
      alert("Error: " + e.message);
    } finally {
      setGeneratingThumbnail(false);
    }
  };

  return (
    <div className="min-h-screen bg-black text-gray-100 font-sans selection:bg-purple-500/30">
      {/* Header */}
      <header className="fixed top-0 w-full border-b border-white/10 bg-black/50 backdrop-blur-md z-50">
        <div className="max-w-5xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="bg-purple-600 p-2 rounded-lg">
              <Youtube className="w-5 h-5 text-white" />
            </div>
            <span className="font-bold text-xl tracking-tight">TubeGen</span>
          </div>
          <UsageBadge />
        </div>
      </header>

      <main className="pt-32 pb-20 px-6">
        <div className="max-w-3xl mx-auto">

          {/* STEP 1: INPUT */}
          {
            step === 'input' && (
              <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div className="text-center space-y-4">
                  <h1 className="text-5xl md:text-7xl font-black mb-6 tracking-tight">
                    FoxTube<span className="text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-600">Gen</span>
                  </h1>
                  <p className="text-xl text-gray-400 max-w-2xl mx-auto">
                    AI-powered script generation specialized for retention.
                  </p>
                </div>

                {/* Error Message Display */}
                {error && (
                  <div className="bg-red-900/50 border border-red-500/50 p-4 rounded-xl text-red-200 text-center text-sm font-mono break-words">
                    {error}
                  </div>
                )}

                <div className="bg-gray-900/50 border border-white/10 p-8 rounded-2xl backdrop-blur-sm space-y-6 shadow-2xl">

                  {/* Row 1: Niche & Topic */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-gray-300 ml-1">Your Niche</label>
                      <div className="relative">
                        <Layers className="absolute left-4 top-3.5 w-5 h-5 text-gray-500" />
                        <input
                          type="text"
                          className="w-full bg-black/50 border border-white/10 rounded-xl py-3 pl-12 pr-4 text-white placeholder:text-gray-600 focus:outline-none focus:ring-2 focus:ring-purple-500 transition-all"
                          placeholder="e.g. True Crime"
                          value={niche}
                          onChange={(e) => setNiche(e.target.value)}
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <label className="text-sm font-medium text-gray-300 ml-1">Video Topic</label>
                      <div className="relative">
                        <Type className="absolute left-4 top-3.5 w-5 h-5 text-gray-500" />
                        <input
                          type="text"
                          className="w-full bg-black/50 border border-white/10 rounded-xl py-3 pl-12 pr-4 text-white placeholder:text-gray-600 focus:outline-none focus:ring-2 focus:ring-purple-500 transition-all"
                          placeholder="e.g. The Mystery of..."
                          value={topic}
                          onChange={(e) => setTopic(e.target.value)}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Row 2: Advanced Options */}
                  <div className="space-y-4 pt-4 border-t border-white/10">
                    <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider">Advanced Refining</h3>

                    <div className="space-y-2">
                      <label className="text-sm font-medium text-gray-300 ml-1">Channel Reference (Style Match)</label>
                      <div className="relative">
                        <Youtube className="absolute left-4 top-3.5 w-5 h-5 text-gray-500" />
                        <input
                          type="text"
                          className="w-full bg-black/50 border border-white/10 rounded-xl py-3 pl-12 pr-4 text-white placeholder:text-gray-600 focus:outline-none focus:ring-2 focus:ring-purple-500 transition-all"
                          placeholder="e.g. https://youtube.com/@MagnatesMedia"
                          value={referenceUrl}
                          onChange={(e) => setReferenceUrl(e.target.value)}
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-gray-300 ml-1">Target Word Count (Exact)</label>
                        <div className="relative">
                          <input
                            type="number"
                            min="1"
                            step={videoLength.includes('MANUAL') ? "5" : "100"}
                            className="w-full bg-black/50 border border-white/10 rounded-xl py-3 px-4 text-white placeholder:text-gray-600 focus:outline-none focus:ring-2 focus:ring-purple-500 transition-all font-mono"
                            placeholder="e.g. 1500"
                            value={String(videoLength).replace(/\D/g, '')}
                            onChange={(e) => {
                              const val = e.target.value;
                              if (videoLength.includes('MANUAL')) {
                                setVideoLength(`MANUAL: ${val}s`);
                              } else {
                                setVideoLength(`${val} Words`);
                              }
                            }}
                          />
                          <span className="absolute right-4 top-3.5 text-xs text-gray-500 font-bold">
                            {videoLength.includes('MANUAL') ? "SECONDS" : "WORDS"}
                          </span>
                        </div>
                      </div>

                      <div className="space-y-2">
                        <label className="text-sm font-medium text-gray-300 ml-1">Voice Style</label>
                        <select
                          value={voiceStyle}
                          onChange={(e) => setVoiceStyle(e.target.value)}
                          className="w-full bg-black/50 border border-white/10 rounded-xl py-3 px-4 text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
                        >
                          <option value="Conversational">Conversational</option>
                          <option value="Authoritative">Authoritative / Documentary</option>
                          <option value="Energetic">Energetic / Hype</option>
                          <option value="Dramatic">Dramatic / Storyteller</option>
                          <option value="Friendly">Friendly Expert (Warm & Engaging)</option>
                          <option value="Horror">Dark / Mystery</option>
                          <option value="Tech">Clean / Tech Reviewer</option>
                        </select>
                      </div>

                      <div className="space-y-2">
                        <label className="text-sm font-medium text-gray-300 ml-1">Voice Model (Renderer)</label>
                        <select
                          value={voiceModel}
                          onChange={(e) => setVoiceModel(e.target.value)}
                          className="w-full bg-black/50 border border-white/10 rounded-xl py-3 px-4 text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
                        >
                          <option value="en-US-Journey-D">Achird (Deep Male - Journey)</option>
                          <option value="en-US-Journey-F">Kore (Standard Female - Journey)</option>
                          <option value="en-US-Studio-M">Studio M (Deep Professional)</option>
                          <option value="en-US-Studio-O">Studio O (Warm Professional)</option>
                          <option value="en-US-Neural2-D">Neural2 D (Deep Narrator)</option>
                        </select>
                      </div>

                      {/* Engine Selectors */}
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-gray-300 ml-1 flex items-center gap-2">
                          <Mic className="w-3 h-3 text-purple-400" /> Audio Engine
                        </label>
                        <div className="flex bg-black/50 border border-white/10 rounded-xl p-1">
                          <button
                            onClick={() => setVoiceProvider('google')}
                            className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all ${voiceProvider === 'google' ? 'bg-purple-600 text-white' : 'text-gray-400 hover:text-white'}`}
                          >
                            Google Cloud (HQ)
                          </button>
                          <button
                            onClick={() => setVoiceProvider('piper')}
                            className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all ${voiceProvider === 'piper' ? 'bg-purple-600 text-white' : 'text-gray-400 hover:text-white'}`}
                          >
                            Piper (Offline)
                          </button>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-gray-300 ml-1 flex items-center gap-2">
                          <Video className="w-3 h-3 text-pink-400" /> Visual Engine
                        </label>
                        <div className="flex bg-black/50 border border-white/10 rounded-xl p-1">
                          <button
                            onClick={() => setVideoProvider('pollinations')}
                            className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all ${videoProvider === 'pollinations' ? 'bg-pink-600 text-white' : 'text-gray-400 hover:text-white'}`}
                          >
                            Pollinations (Unlimited)
                          </button>
                          <button
                            onClick={() => setVideoProvider('puter')}
                            className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all ${videoProvider === 'puter' ? 'bg-pink-600 text-white' : 'text-gray-400 hover:text-white'}`}
                          >
                            Sora-2 (Video)
                          </button>
                          <button
                            onClick={() => setVideoProvider('meta-local')}
                            className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all ${videoProvider === 'meta-local' ? 'bg-pink-600 text-white' : 'text-gray-400 hover:text-white'}`}
                          >
                            Meta (Local)
                          </button>
                        </div>
                      </div>

                      {/* Remote Server URL for GitHub RDP */}
                      <div className="space-y-2 col-span-2">
                        <label className="text-sm font-medium text-gray-300 ml-1 flex items-center gap-2">
                          <span className="text-green-400">🌐</span> Remote Server URL (GitHub RDP)
                        </label>
                        <input
                          type="text"
                          className="w-full bg-black/50 border border-green-500/30 rounded-xl py-3 px-4 text-white placeholder:text-gray-600 focus:outline-none focus:ring-2 focus:ring-green-500 transition-all font-mono text-sm"
                          placeholder="https://xxx.trycloudflare.com (leave empty for local)"
                          value={remoteServerUrl}
                          onChange={(e) => setRemoteServerUrl(e.target.value)}
                        />
                        <p className="text-xs text-gray-500 ml-1">
                          Paste the API URL from GitHub Actions to generate videos remotely.
                        </p>
                      </div>
                    </div>
                  </div>

                  <button
                    onClick={handleGenerate}
                    disabled={!niche || !topic}
                    className="w-full bg-white text-black font-bold py-4 rounded-xl hover:bg-gray-200 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    <Sparkles className="w-5 h-5" />
                    Generate Blueprint
                  </button>

                  {/* THUMBNAIL GENERATOR (Standalone) */}
                  <div className="pt-6 border-t border-white/10 space-y-4">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider">Extras</h3>
                    </div>

                    <button
                      onClick={handleGenerateThumbnail}
                      disabled={generatingThumbnail || !niche || !topic} // Only enable if we have inputs
                      className="w-full py-3 bg-gray-800 hover:bg-gray-700 text-gray-300 font-bold rounded-xl border border-white/5 transition-all flex items-center justify-center gap-2 group"
                    >
                      {generatingThumbnail ? (
                        <span className="animate-pulse">Designing Thumbnail...</span>
                      ) : (
                        <>
                          <ImageIcon className="w-5 h-5 text-purple-500 group-hover:text-purple-400" />
                          Generate Viral Thumbnail
                        </>
                      )}
                    </button>

                    {/* Result Area */}
                    {thumbnailUrl && (
                      <div className="mt-4 animate-in fade-in slide-in-from-bottom-2">
                        <p className="text-xs text-green-400 mb-2 font-mono">✅ Thumbnail Generated</p>
                        <div className="rounded-xl overflow-hidden border border-purple-500/30 shadow-2xl relative group">
                          <img src={thumbnailUrl} alt="Generated Thumbnail" className="w-full h-auto object-cover" />
                          <a
                            href={thumbnailUrl}
                            download={`thumbnail_${topic.substring(0, 10)}.png`}
                            target="_blank"
                            rel="noreferrer"
                            className="absolute bottom-2 right-2 bg-black/80 text-white text-xs px-3 py-1 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                            Download
                          </a>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )
          }

          {/* STEP 2: LOADING */}
          {
            step === 'generating' && (
              <div className="text-center space-y-8 py-20 animate-in fade-in duration-500">
                <div className="relative w-24 h-24 mx-auto">
                  <div className="absolute inset-0 border-t-4 border-purple-500 rounded-full animate-spin"></div>
                  <div className="absolute inset-2 border-t-4 border-pink-500 rounded-full animate-spin animation-delay-150"></div>
                  <div className="absolute inset-4 border-t-4 border-white rounded-full animate-spin animation-delay-300"></div>
                </div>
                <div className="space-y-2">
                  <h2 className="text-2xl font-bold text-white">Crafting your narrative...</h2>
                  <p className="text-gray-400">Analyzing successful patterns in {niche}...</p>
                </div>
              </div>
            )
          }

          {/* STEP 3: RESULT */}
          {
            step === 'result' && result && (
              <div className="space-y-8 animate-in fade-in slide-in-from-bottom-8 duration-700">
                <div className="flex items-center justify-between">
                  <h2 className="text-3xl font-bold text-white">Generated Blueprint</h2>
                  <div className="flex gap-2">
                    {/* GENERATE ASSETS BUTTON */}
                    <button
                      onClick={handleGenerateAssets}
                      disabled={generatingAssets}
                      className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-pink-600 to-purple-600 rounded-lg text-sm font-bold hover:shadow-lg hover:shadow-purple-500/20 transition-all disabled:opacity-50"
                    >
                      {generatingAssets ? (
                        <span className="animate-pulse">Generating Media...</span>
                      ) : (
                        <>
                          <Video className="w-4 h-4" />
                          Generate Media (Beta)
                        </>
                      )}
                    </button>

                    <button
                      onClick={() => setStep('input')}
                      className="text-sm text-gray-400 hover:text-white transition-colors"
                    >
                      Start Over
                    </button>
                  </div>
                </div>

                {/* Hook Section */}
                <div className="bg-gray-900/50 border border-purple-500/30 p-6 rounded-2xl backdrop-blur-sm">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="bg-purple-500/20 px-3 py-1 rounded-full text-purple-300 text-xs font-bold uppercase tracking-wider">
                      0:00 - 0:15
                    </div>
                    <h3 className="font-bold text-lg text-purple-100">The Hook</h3>
                  </div>
                  <p className="text-xl leading-relaxed text-gray-200 font-medium">"{result.hook}"</p>
                </div>

                {/* Structure Table */}
                <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-xl">
                  <div className="bg-gray-50 border-b border-gray-100 px-6 py-4">
                    <h3 className="font-bold text-gray-900">Script Structure</h3>
                  </div>
                  {(!result.structure || result.structure.length === 0) ? (
                    <div className="p-8 text-center text-gray-500">
                      No structure generated. Check raw output.
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-sm">
                        <thead>
                          <tr className="bg-gray-50 text-gray-500 uppercase tracking-wider text-xs border-b border-gray-100">
                            <th className="px-6 py-4 font-semibold w-24">Time</th>
                            <th className="px-6 py-4 font-semibold w-1/3">Visual Cue</th>
                            <th className="px-6 py-4 font-semibold">Voiceover</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {result.structure.map((scene: any, i: number) => {
                            const key = scene.timestamp || i.toString();
                            const asset = assets[key];
                            return (
                              <tr key={i} className="hover:bg-gray-50/50 transition-colors">
                                <td className="px-6 py-4 text-gray-500 font-medium whitespace-nowrap align-top">
                                  {scene.timestamp}
                                </td>
                                <td className="px-6 py-4 text-gray-700 align-top">
                                  <div className="flex flex-col gap-2">
                                    <span>{scene.visual_cue}</span>
                                    {asset?.image && (
                                      <div className="mt-2 rounded-lg overflow-hidden border border-gray-200 shadow-sm">
                                        {typeof asset.image === 'string' ? (
                                          <img src={asset.image} alt="Generated visual" className="w-full h-auto object-cover" />
                                        ) : (
                                          <div className="h-32 bg-gray-100 flex items-center justify-center text-xs text-gray-400">
                                            Image Object (Check Console)
                                          </div>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                </td>
                                <td className="px-6 py-4 text-gray-600 leading-relaxed align-top">
                                  <div className="flex flex-col gap-2">
                                    <span>"{scene.voiceover}"</span>
                                    {asset?.audio && (
                                      <div className="mt-2">
                                        {/* Assuming puter audio is a URL or playable object. 
                                      If it's an Audio element, we can't render it directly easily in React without ref.
                                      Let's assume it returns a src URL for MVP. 
                                      If it returns an Audio object, we might need a wrapper. */}
                                        {typeof asset.audio === 'string' ? (
                                          <audio controls src={asset.audio} className="w-full h-8" />
                                        ) : (
                                          <div className="text-xs text-amber-600 flex items-center gap-1">
                                            <Mic className="w-3 h-3" /> Audio Generated (Object)
                                          </div>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {/* Title Options */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="bg-gray-900/50 border border-white/10 p-6 rounded-2xl">
                    <h3 className="text-gray-400 text-sm font-bold uppercase tracking-wider mb-4 flex items-center gap-2">
                      <Type className="w-4 h-4" /> Viral Title Options
                    </h3>
                    <ul className="space-y-3">
                      {result.title_options && result.title_options.map((title: string, i: number) => (
                        <li key={i} className="text-white font-medium hover:text-purple-400 cursor-pointer transition-colors flex items-start gap-2">
                          <span className="text-gray-600 text-sm mt-1">0{i + 1}</span>
                          {title}
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="bg-gray-900/50 border border-white/10 p-6 rounded-2xl">
                    <h3 className="text-gray-400 text-sm font-bold uppercase tracking-wider mb-4 flex items-center gap-2">
                      <Sparkles className="w-4 h-4" /> Keywords & SEO
                    </h3>
                    <div className="flex flex-wrap gap-2 mb-6">
                      {result.keywords && result.keywords.map((tag: string, i: number) => (
                        <span key={i} className="px-3 py-1 bg-white/5 border border-white/10 rounded-full text-xs text-gray-300">
                          #{tag}
                        </span>
                      ))}
                    </div>
                    {/* Description simplified */}
                    <div className="text-xs text-gray-500 line-clamp-3">
                      {result.description}
                    </div>
                  </div>
                </div>

                {/* Raw Debug View - Temporary for MVP */}
                <div className="mt-8 p-4 bg-gray-900 rounded-xl overflow-x-auto">
                  <h4 className="text-gray-400 text-xs uppercase tracking-wider mb-2">Debug: Raw API Response</h4>
                  <pre className="text-green-400 text-xs font-mono">{JSON.stringify(result, null, 2)}</pre>
                </div>

                {/* DIRECTOR CONTROLS */}
                <div className="flex gap-2 justify-end mt-4 mb-2">
                  <span className="text-gray-500 text-xs font-mono self-center mr-2">DIRECTOR CONTROLS:</span>
                  <button onClick={() => fetch('http://localhost:3001/control', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'resume' }) })} className="px-3 py-1 bg-green-900/50 hover:bg-green-800 text-green-300 text-xs font-bold rounded border border-green-500/30">
                    ▶ RESUME
                  </button>
                  <button onClick={() => fetch('http://localhost:3001/control', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'pause' }) })} className="px-3 py-1 bg-yellow-900/50 hover:bg-yellow-800 text-yellow-300 text-xs font-bold rounded border border-yellow-500/30">
                    ⏸ PAUSE
                  </button>
                  <button onClick={() => fetch('http://localhost:3001/control', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'restart' }) })} className="px-3 py-1 bg-blue-900/50 hover:bg-blue-800 text-blue-300 text-xs font-bold rounded border border-blue-500/30">
                    🔄 RESTART
                  </button>
                  <button onClick={() => fetch('http://localhost:3001/control', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'stop' }) })} className="px-3 py-1 bg-red-900/50 hover:bg-red-800 text-red-300 text-xs font-bold rounded border border-red-500/30">
                    🛑 STOP
                  </button>
                </div>

                {/* DIRECTOR AGENT LOGS */}
                <div className="mt-8 p-6 bg-black border border-green-500/30 rounded-xl shadow-2xl relative overflow-hidden">
                  <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-green-500 to-transparent opacity-50"></div>
                  <h3 className="text-green-400 font-mono text-sm mb-4 flex items-center gap-2">
                    <span className="animate-pulse">●</span> DIRECTOR AGENT TERMINAL
                  </h3>
                  <div className="h-48 overflow-y-auto font-mono text-xs text-green-300/80 space-y-1 p-2 bg-black/50 rounded border border-white/5" id="director-logs">
                    {directorLogs.length === 0 && <span className="opacity-30 italic">Waiting for connection...</span>}
                    {directorLogs.map((log, i) => (
                      <div key={i} className="border-l-2 border-green-500/20 pl-2">{log}</div>
                    ))}
                    <div ref={logEndRef} />
                  </div>
                </div>

                <div className="flex justify-end gap-4">
                  <button
                    onClick={handleGenerateVoiceover}
                    disabled={isGeneratingAudio}
                    className={`flex items-center gap-2 px-6 py-3 rounded-xl font-bold transition-all shadow-lg hover:shadow-cyan-500/25 border border-cyan-500/20 ${isGeneratingAudio
                      ? 'bg-cyan-900/50 text-cyan-400 cursor-not-allowed'
                      : 'bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white'
                      }`}
                  >
                    {isGeneratingAudio ? (
                      <>
                        <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        Generating Audio ({audioProgress}%)...
                      </>
                    ) : (
                      <>
                        <Mic className="w-5 h-5" />
                        Generate Voiceover & Sync Visuals
                      </>
                    )}
                  </button>

                  {/* Video Generation Button (Provider-aware) */}
                  {(videoProvider === 'puter' || videoProvider === 'pollinations') ? (
                    <button
                      onClick={handleGenerateVideos}
                      disabled={isGeneratingVideos}
                      className={`px-6 py-2 text-white font-bold rounded-lg transition-all shadow-lg flex items-center gap-2 ${isGeneratingVideos
                        ? 'bg-gradient-to-r from-blue-600 to-purple-600 cursor-wait'
                        : videoProvider === 'pollinations'
                          ? 'bg-gradient-to-r from-pink-500 to-orange-500 hover:from-pink-600 hover:to-orange-600'
                          : 'bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600'
                        }`}
                    >
                      {isGeneratingVideos ? (
                        <>
                          <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                          Generating ({videoProgress}%)...
                        </>
                      ) : (
                        <>
                          <Video className="w-5 h-5" />
                          {videoProvider === 'pollinations' ? 'Generate Pollinations Visuals' : 'Generate Sora-2 Videos'}
                        </>
                      )}
                    </button>
                  ) : (
                    <button
                      onClick={async () => {
                        if (!result.structure[0].duration) {
                          if (!confirm("Warning: You haven't generated voiceovers yet. Timestamps might be inaccurate. Proceed?")) return;
                        }
                        try {
                          const res = await fetch('http://localhost:3001/generate-video', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ scriptData: result })
                          });
                          const data = await res.json();
                          if (res.ok) alert(`Director Agent Started: ${data.message}`);
                          else alert(`Error: ${data.error}`);
                        } catch (e: any) {
                          alert(`Failed to connect to Director Agent. Is the server running? (${e.message})`);
                        }
                      }}
                      className="px-6 py-2 bg-purple-600 hover:bg-purple-700 text-white font-bold rounded-lg transition-all shadow-lg hover:shadow-purple-500/25 flex items-center gap-2"
                    >
                      <span>🎬</span> Send to Meta.ai (Local)
                    </button>
                  )}

                  <button
                    onClick={() => {
                      const blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = `tubegen-script-${Date.now()}.json`;
                      a.click();
                    }}
                    className="text-gray-400 hover:text-white text-sm font-medium transition-colors"
                  >
                    Download JSON
                  </button>
                </div>
              </div>
            )
          }
        </div>

        {/* Generated Videos Download Section */}
        {generatedVideos.length > 0 && (
          <div className="max-w-5xl mx-auto px-6 py-8">
            <h3 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
              <Video className="w-6 h-6 text-cyan-400" />
              Generated Videos ({generatedVideos.length})
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {generatedVideos.map((video, idx) => {
                const isPollinations = video.url.includes('pollinations.ai');
                return (
                  <div key={idx} className="bg-white/5 rounded-lg p-3 border border-white/10 group">
                    {isPollinations ? (
                      <img
                        src={video.url}
                        alt={`Scene ${video.sceneIndex}, Shot ${video.shotIndex}`}
                        className="w-full rounded mb-2 aspect-video object-cover bg-black"
                        loading="lazy"
                      />
                    ) : (
                      <video
                        src={video.url}
                        controls
                        className="w-full rounded mb-2 aspect-video bg-black"
                      />
                    )}
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-gray-400">
                        Scene {video.sceneIndex}, Shot {video.shotIndex}
                      </span>
                      <a
                        href={video.url}
                        download={`scene_${video.sceneIndex}_shot_${video.shotIndex}${isPollinations ? '.jpg' : '.mp4'}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs bg-cyan-600 hover:bg-cyan-700 text-white px-2 py-1 rounded transition-colors"
                      >
                        Download
                      </a>
                    </div>
                  </div>
                );
              })}
            </div>
            <button
              onClick={() => {
                generatedVideos.forEach((video) => {
                  const a = document.createElement('a');
                  a.href = video.url;
                  a.download = `scene_${video.sceneIndex}_shot_${video.shotIndex}.mp4`;
                  a.click();
                });
              }}
              className="mt-4 px-4 py-2 bg-gradient-to-r from-cyan-500 to-blue-500 text-white font-bold rounded-lg hover:from-cyan-600 hover:to-blue-600 transition-all"
            >
              Download All Videos
            </button>
          </div>
        )}
      </main>

      <footer className="text-center py-6 text-slate-600 text-sm">
        <p>TubeGen AI • MVP Build v2.3 (Dynamic Visuals Active)</p>
      </footer>
      <ConsultantChat onApplyConfig={handleApplyConfig} onStartPipeline={handleStartPipeline} />
    </div>
  )
}

export default App
