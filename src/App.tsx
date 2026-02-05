
import { useState, useRef, useEffect } from 'react'
import { Sparkles, Settings, Send, Zap } from 'lucide-react';
import { ConsultantChat } from './components/ConsultantChat'
import { generateNarrative } from './services/puter'

function App() {
  const [step, setStep] = useState<'input' | 'generating' | 'result'>('input')
  const [niche, setNiche] = useState('')
  const [topic, setTopic] = useState('')
  const [result, setResult] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)

  // State for director logs
  const [directorLogs, setDirectorLogs] = useState<string[]>([]);
  const logEndRef = useRef<HTMLDivElement>(null)

  // Remote Server State
  const [serverUrl, setServerUrl] = useState(() => {
    const saved = localStorage.getItem('foxtubeServerUrl');
    return saved || 'http://localhost:3001';
  });
  const [showServerConfig, setShowServerConfig] = useState(false);

  useEffect(() => {
    localStorage.setItem('foxtubeServerUrl', serverUrl);
  }, [serverUrl]);

  const handleApplyConfig = (config: any) => {
    if (config.topic) setTopic(config.topic);
    if (config.niche) setNiche(config.niche);
    console.log("Config Applied:", config);
  };

  const handleStartPipeline = async (config: any) => {
    const addLog = (msg: string) => {
      console.log(msg);
      setDirectorLogs(prev => [...prev, msg]);
    };

    setDirectorLogs(["[Pipeline] 🔄 Initializing production pipeline..."]);

    try {
      await fetch(`${serverUrl}/control`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cancel' })
      });
      addLog("[Pipeline] ✅ Ready for new production.");
    } catch (e) {
      console.warn("Could not cancel previous job:", e);
    }

    addLog("[Pipeline] 🚀 Starting auto-generation...");
    addLog(`[Pipeline] 📡 Server: ${serverUrl}`);
    setStep('generating');

    try {
      addLog("[Pipeline] 📝 Generating Script...");
      const scriptResult = await generateNarrative(
        config.topic || topic,
        config.niche || niche,
        '',
        config.videoLength || '5-7 minutes',
        config.voiceStyle || 'Conversational',
        config.visualStyle || 'Cinematic',
        config.aspectRatio || '16:9',
        config.platform || 'YouTube',
        config.mood || 'Cinematic'
      );

      if (!scriptResult || !scriptResult.structure) throw new Error("Script generation failed");
      addLog(`[Pipeline] ✅ Script ready! ${scriptResult.structure.length} scenes`);

      // Voiceovers
      addLog("[Pipeline] 🎙️ Generating voiceovers...");
      try {
        const { generateSpeechWithPiper } = await import('./services/puter');

        for (let i = 0; i < scriptResult.structure.length; i++) {
          const scene = scriptResult.structure[i];
          if (scene.voiceover) {
            try {
              const url = await generateSpeechWithPiper(scene.voiceover, config.voiceStyle);
              if (url) {
                scene.audioUrl = url;
                scene.duration = Math.ceil(scene.voiceover.split(' ').length / 2.5);
                addLog(`[Pipeline] ✓ Scene ${i + 1} audio ready`);
              }
            } catch {
              scene.duration = Math.ceil(scene.voiceover.split(' ').length / 2.5);
              addLog(`[Pipeline] ⚠ Scene ${i + 1} audio skipped`);
            }
          }
        }
      } catch {
        addLog("[Pipeline] ⚠ Voiceover generation skipped");
      }

      // Upload assets
      addLog("[Pipeline] 📤 Uploading assets...");
      const projectName = scriptResult.title_options?.[0] || config.topic || 'video_project';

      const blobToBase64 = (blob: Blob): Promise<string> => {
        return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
      };

      for (let i = 0; i < scriptResult.structure.length; i++) {
        const scene = scriptResult.structure[i];
        if (scene.audioUrl) {
          try {
            const resp = await fetch(scene.audioUrl);
            const blob = await resp.blob();
            const base64 = await blobToBase64(blob);
            await fetch(`${serverUrl}/save-audio`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ filename: `scene_${i + 1}_audio.wav`, audioData: base64, projectName })
            });
          } catch { }
        }
      }
      addLog("[Pipeline] ✅ Assets uploaded");

      // Start Director
      addLog("[Pipeline] 🎬 Starting Director Agent...");
      scriptResult.title = projectName;
      scriptResult.visualStyle = config.visualStyle || 'Cinematic';
      scriptResult.aspectRatio = config.aspectRatio || '16:9';
      scriptResult.platform = config.platform || 'YouTube';
      scriptResult.mood = config.mood || 'Cinematic';

      await fetch(`${serverUrl}/generate-video`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scriptData: scriptResult })
      });

      addLog("[Pipeline] 🚀 Director is working! Watch logs below...");
      setResult(scriptResult);
      setStep('result');
    } catch (e: any) {
      setError(e.message);
      setStep('input');
    }
  };

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [directorLogs]);

  useEffect(() => {
    const handleBeforeUnload = () => {
      navigator.sendBeacon(`${serverUrl}/control`, JSON.stringify({ action: 'cancel' }));
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [serverUrl]);

  useEffect(() => {
    let evtSource: EventSource | null = null;
    let retryTimeout: any;

    const connect = () => {
      evtSource = new EventSource(`${serverUrl}/events`);
      evtSource.onopen = () => {
        setDirectorLogs(prev => [...prev, `--- Connected to Director ---`]);
      };
      evtSource.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.type === 'completed') {
          setDirectorLogs(prev => [...prev, `🎉 ${data.message}`]);
          const finalVideo = data.files?.find((f: any) => f.isFinal || f.name === 'final_video.mp4');
          if (finalVideo) {
            const downloadUrl = `${serverUrl}${finalVideo.path}`;
            setDirectorLogs(prev => [...prev, `⬇️ Downloading from: ${downloadUrl}`]);

            // Use fetch + blob for cross-origin download
            fetch(downloadUrl)
              .then(response => {
                if (!response.ok) throw new Error('Download failed');
                return response.blob();
              })
              .then(blob => {
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'final_video.mp4';
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                window.URL.revokeObjectURL(url);
                setDirectorLogs(prev => [...prev, `✅ Download started! Check your Downloads folder.`]);
              })
              .catch(err => {
                setDirectorLogs(prev => [...prev, `❌ Download error: ${err.message}`]);
                // Fallback: open in new tab
                window.open(downloadUrl, '_blank');
              });
          }
        } else if (data.type === 'log') {
          setDirectorLogs(prev => [...prev, data.message]);
        }
      };
      evtSource.onerror = () => {
        evtSource?.close();
        retryTimeout = setTimeout(connect, 3000);
      };
    };
    connect();
    return () => { evtSource?.close(); clearTimeout(retryTimeout); };
  }, [serverUrl]);

  return (
    <div className="min-h-screen bg-[#0a0a0f] flex flex-col">
      {/* Gradient Background */}
      <div className="fixed inset-0 bg-gradient-to-br from-purple-900/20 via-transparent to-cyan-900/20 pointer-events-none" />
      <div className="fixed top-0 left-1/2 -translate-x-1/2 w-[800px] h-[600px] bg-purple-500/10 blur-[120px] rounded-full pointer-events-none" />

      {/* Header */}
      <header className="relative z-10 px-6 py-4 flex justify-between items-center border-b border-white/5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center shadow-lg shadow-purple-500/30">
            <Zap className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent">
              FoxTubeGen
            </h1>
            <p className="text-xs text-gray-500">AI Video Production</p>
          </div>
        </div>

        <button
          onClick={() => setShowServerConfig(!showServerConfig)}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all
            ${showServerConfig
              ? 'bg-purple-500/20 text-purple-300 ring-1 ring-purple-500/50'
              : 'bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white'}`}
        >
          <Settings className="w-4 h-4" />
          {serverUrl.includes('localhost') ? 'Local Mode' : 'Remote Mode'}
        </button>
      </header>

      {/* Server Config */}
      {showServerConfig && (
        <div className="relative z-10 px-6 py-4 bg-black/40 border-b border-white/5 backdrop-blur-sm">
          <div className="max-w-2xl mx-auto">
            <label className="block text-sm font-medium text-gray-300 mb-2">Director Server URL</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={serverUrl}
                onChange={(e) => setServerUrl(e.target.value)}
                placeholder="https://xxx.trycloudflare.com"
                className="flex-1 px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500/50 focus:border-purple-500/50 transition-all"
              />
              <button
                onClick={() => setShowServerConfig(false)}
                className="px-6 py-3 bg-purple-500 hover:bg-purple-400 text-white font-medium rounded-xl transition-colors"
              >
                Save
              </button>
            </div>
            <p className="text-xs text-gray-500 mt-2">
              💡 Paste Cloudflare tunnel URL for RDP, or localhost:3001 for local testing
            </p>
          </div>
        </div>
      )}

      {/* Main Content */}
      <main className="relative z-10 flex-1 flex flex-col overflow-hidden">
        <div className="flex-1 overflow-hidden">
          <ConsultantChat
            onApplyConfig={handleApplyConfig}
            onStartPipeline={handleStartPipeline}
          />
        </div>

        {/* Director Logs */}
        {directorLogs.length > 0 && (
          <div className="h-56 border-t border-white/5 bg-black/60 backdrop-blur-sm flex flex-col">
            <div className="px-4 py-3 border-b border-white/5 flex justify-between items-center">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                <span className="text-sm font-semibold text-white">Director Logs</span>
                <span className="text-xs text-gray-500">({directorLogs.length} entries)</span>
              </div>
              <button
                onClick={() => setDirectorLogs([])}
                className="text-xs px-3 py-1 bg-white/5 hover:bg-red-500/20 hover:text-red-400 text-gray-400 rounded-lg transition-colors"
              >
                Clear
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 font-mono text-xs space-y-1">
              {directorLogs.map((log, i) => (
                <div
                  key={i}
                  className={`${log.includes('✅') || log.includes('🎉') ? 'text-green-400' :
                    log.includes('⚠') ? 'text-yellow-400' :
                      log.includes('❌') ? 'text-red-400' :
                        log.includes('🚀') || log.includes('🎬') ? 'text-purple-400' :
                          'text-gray-400'
                    }`}
                >
                  {log}
                </div>
              ))}
              <div ref={logEndRef} />
            </div>
          </div>
        )}
      </main>

      {/* Error Toast */}
      {error && (
        <div className="fixed bottom-6 right-6 z-50 bg-red-500/90 backdrop-blur text-white px-5 py-3 rounded-xl shadow-2xl shadow-red-500/20 flex items-center gap-3">
          <span className="text-sm">{error}</span>
          <button onClick={() => setError(null)} className="text-white/80 hover:text-white font-bold">×</button>
        </div>
      )}
    </div>
  )
}

export default App
