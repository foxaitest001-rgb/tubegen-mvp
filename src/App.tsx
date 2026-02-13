
import { useState, useRef, useEffect } from 'react'
import { Settings, Download, Play, Monitor, Zap } from 'lucide-react';
import { ConsultantChat } from './components/ConsultantChat'
import { generateNarrative } from './services/puter'

type VideoSource = 'meta' | 'grok';

function App() {
  const [niche, setNiche] = useState('')
  const [topic, setTopic] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [videoSource, setVideoSource] = useState<VideoSource>('meta')

  // State for director logs
  const [directorLogs, setDirectorLogs] = useState<string[]>([]);
  const logEndRef = useRef<HTMLDivElement>(null)

  // Final video download state
  const [finalVideoUrl, setFinalVideoUrl] = useState<string | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);

  // Remote Server State
  const [serverUrl, setServerUrl] = useState(() => {
    const saved = localStorage.getItem('foxtubeServerUrl');
    return saved || 'http://localhost:3001';
  });
  const [showServerConfig, setShowServerConfig] = useState(false);

  // State for result
  const [projectFolder, setProjectFolder] = useState<string | null>(null);

  useEffect(() => {
    localStorage.setItem('foxtubeServerUrl', serverUrl);
  }, [serverUrl]);

  // Parse Logs for Download URL
  useEffect(() => {
    if (!directorLogs.length) return;
    const lastLog = directorLogs[directorLogs.length - 1];

    if (lastLog.includes('Output folder:')) {
      const parts = lastLog.split('Output folder:');
      if (parts.length > 1) {
        const folder = parts[1].trim();
        console.log("Captured Project Folder:", folder);
        setProjectFolder(folder);
      }
    }

    if (!projectFolder) {
      const folderLog = directorLogs.find(l => l.includes('Output folder:'));
      if (folderLog) {
        const parts = folderLog.split('Output folder:');
        if (parts.length > 1) {
          setProjectFolder(parts[1].trim());
        }
      }
    }

    if (lastLog.includes('Final video created') && projectFolder) {
      const dlUrl = `${serverUrl}/output/${projectFolder}/final_video.mp4`;
      console.log("Download URL Available:", dlUrl);
      setFinalVideoUrl(dlUrl);
    }
  }, [directorLogs, projectFolder, serverUrl]);

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

    setDirectorLogs([`[Pipeline] 🔄 Initializing production pipeline (${videoSource === 'grok' ? 'Grok' : 'Meta.ai'})...`]);

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

    addLog(`[Pipeline] 🚀 Starting auto-generation via ${videoSource === 'grok' ? 'Grok.com' : 'Meta.ai'}...`);
    addLog(`[Pipeline] 📡 Server: ${serverUrl}`);

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

      addLog("[Pipeline] 🎬 Initializing Director Job...");
      const rawName = scriptResult.title_options?.[0] || config.topic || 'video_project';
      const projectName = rawName.replace(/[^a-zA-Z0-9_\-]/g, '_').toLowerCase();

      scriptResult.title = projectName;
      scriptResult.visualStyle = config.visualStyle || 'Cinematic';
      scriptResult.aspectRatio = config.aspectRatio || '16:9';
      scriptResult.platform = config.platform || 'YouTube';
      scriptResult.mood = config.mood || 'Cinematic';
      scriptResult.videoSource = videoSource; // Pass source to server

      await fetch(`${serverUrl}/generate-video`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scriptData: scriptResult })
      });
      addLog("[Pipeline] ✅ Director Job Started.");

      addLog("[Pipeline] 🎙️ Requesting Server-Side Audio Generation...");
      try {
        const { generateAudioOnServer } = await import('./services/puter');

        for (let i = 0; i < scriptResult.structure.length; i++) {
          const scene = scriptResult.structure[i];
          if (scene.voiceover) {
            try {
              const success = await generateAudioOnServer(scene.voiceover, config.voiceStyle, i + 1, serverUrl);
              if (success) {
                addLog(`[Pipeline] ✓ Audio generated for Scene ${i + 1}`);
              } else {
                addLog(`[Pipeline] ⚠ Audio Start Failed for Scene ${i + 1}`);
              }
            } catch (e) {
              addLog(`[Pipeline] ⚠ Audio Request Error Scene ${i + 1}`);
            }
          }
        }
      } catch (e) {
        addLog("[Pipeline] ⚠ Audio Generation Module Failed");
      }

      addLog("[Pipeline] ✅ All assets requested. Director is working...");

      setDirectorLogs(prev => [...prev, "[Pipeline] 🚀 Director is working! Watch logs below..."]);
    } catch (e: any) {
      setError(e.message);
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
            setFinalVideoUrl(downloadUrl);
            setDirectorLogs(prev => [...prev, `⬇️ Auto-downloading from: ${downloadUrl}`]);
            handleDownloadVideo(downloadUrl);
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

  const handleDownloadVideo = (url: string) => {
    setIsDownloading(true);
    setDirectorLogs(prev => [...prev, `⬇️ Downloading video...`]);

    fetch(url)
      .then(res => {
        if (!res.ok) throw new Error("Download failed");
        return res.blob();
      })
      .then(blob => {
        const blobUrl = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = 'final_video.mp4';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(blobUrl);
        setIsDownloading(false);
        setDirectorLogs(prev => [...prev, `✅ Download saved to disk.`]);
      })
      .catch(err => {
        console.error(err);
        setIsDownloading(false);
        setDirectorLogs(prev => [...prev, `❌ Download failed. Opening in new tab...`]);
        window.open(url, '_blank');
      });
  };

  const sourceLabel = videoSource === 'grok' ? 'Grok' : 'Meta.ai';

  return (
    <div className="ftg-app">
      {/* Subtle gradient overlay */}
      <div className="ftg-bg-glow" />

      {/* Header */}
      <header className="ftg-header">
        <div className="ftg-header-left">
          <div className="ftg-logo-icon">
            <Zap className="w-5 h-5" />
          </div>
          <div>
            <div className="ftg-logo-row">
              <h1 className="ftg-logo-text">FoxTubeGen</h1>
              <span className="ftg-version-badge">V4</span>
            </div>
            <p className="ftg-subtitle">AI Video Production • Style DNA</p>
          </div>
        </div>

        {/* Source Selector — Grok-style pill toggle */}
        <div className="ftg-source-selector">
          <button
            onClick={() => setVideoSource('meta')}
            className={`ftg-source-btn ${videoSource === 'meta' ? 'ftg-source-active' : ''}`}
          >
            <Monitor className="w-4 h-4" />
            Meta.ai
          </button>
          <button
            onClick={() => setVideoSource('grok')}
            className={`ftg-source-btn ${videoSource === 'grok' ? 'ftg-source-active' : ''}`}
          >
            <Play className="w-4 h-4" />
            Grok
          </button>
        </div>

        <div className="ftg-header-right">
          {(finalVideoUrl || (projectFolder && directorLogs.some(l => l.includes('finished successfully')))) && (
            <button
              onClick={() => handleDownloadVideo(finalVideoUrl || `${serverUrl}/output/${projectFolder}/final_video.mp4`)}
              disabled={isDownloading}
              className="ftg-btn ftg-btn-download"
            >
              <Download className={`w-4 h-4 ${isDownloading ? 'ftg-spin' : ''}`} />
              {isDownloading ? 'Downloading...' : 'Download Video'}
            </button>
          )}

          <button
            onClick={() => {
              const folder = prompt("Enter project folder name (from logs):", projectFolder || "2026-02-06_my_video");
              if (folder) {
                const url = `${serverUrl}/output/${folder}/final_video.mp4`;
                window.open(url, '_blank');
              }
            }}
            className="ftg-btn ftg-btn-secondary"
            title="Manually download by entering folder name"
          >
            <Download className="w-4 h-4" />
            Manual DL
          </button>

          <button
            onClick={() => setShowServerConfig(!showServerConfig)}
            className={`ftg-btn ${showServerConfig ? 'ftg-btn-active' : 'ftg-btn-ghost'}`}
          >
            <Settings className="w-4 h-4" />
            {serverUrl.includes('localhost') ? 'Local' : 'Remote'}
          </button>
        </div>
      </header>

      {/* Server Config Panel */}
      {showServerConfig && (
        <div className="ftg-config-panel">
          <div className="ftg-config-inner">
            <label className="ftg-config-label">Director Server URL</label>
            <div className="ftg-config-row">
              <input
                type="text"
                value={serverUrl}
                onChange={(e) => setServerUrl(e.target.value)}
                placeholder="https://xxx.trycloudflare.com"
                className="ftg-input"
              />
              <button
                onClick={() => setShowServerConfig(false)}
                className="ftg-btn ftg-btn-primary"
              >
                Save
              </button>
            </div>
            <p className="ftg-config-hint">
              💡 Paste Cloudflare tunnel URL for RDP, or localhost:3001 for local testing
            </p>
          </div>
        </div>
      )}

      {/* Main Content */}
      <main className="ftg-main">
        <div className="ftg-chat-area">
          <ConsultantChat
            onApplyConfig={handleApplyConfig}
            onStartPipeline={handleStartPipeline}
            videoSource={videoSource}
          />
        </div>

        {/* Director Logs */}
        {directorLogs.length > 0 && (
          <div className="ftg-logs">
            <div className="ftg-logs-header">
              <div className="ftg-logs-title">
                <div className="ftg-pulse-dot" />
                <span>Director • {sourceLabel}</span>
                <span className="ftg-logs-count">{directorLogs.length}</span>
              </div>
              <button
                onClick={() => setDirectorLogs([])}
                className="ftg-btn-clear"
              >
                Clear
              </button>
            </div>
            <div className="ftg-logs-body">
              {directorLogs.map((log, i) => (
                <div
                  key={i}
                  className={`ftg-log-line ${log.includes('✅') || log.includes('🎉') ? 'ftg-log-success' :
                      log.includes('⚠') ? 'ftg-log-warn' :
                        log.includes('❌') ? 'ftg-log-error' :
                          log.includes('🚀') || log.includes('🎬') ? 'ftg-log-action' :
                            ''
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
        <div className="ftg-error-toast">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="ftg-error-close">×</button>
        </div>
      )}
    </div>
  )
}

export default App
