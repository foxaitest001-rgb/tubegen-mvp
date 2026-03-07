import { useState, useRef } from 'react';
import { Film, Play, ArrowUp, ArrowDown, Trash2, RefreshCw, Download, Eye } from 'lucide-react';

interface TimelineScene {
    sceneNum: number;
    voiceover: string;
    motionPrompt: string;
    videoPath: string | null;
    imagePath: string | null;
    audioPath: string | null;
    hasVideo: boolean;
    hasAudio: boolean;
    section: string;
}

interface TimelineEditorProps {
    scenes: TimelineScene[];
    projectFolder: string;
    serverUrl: string;
    onRenderComplete: () => void;
}

export function TimelineEditor({ scenes: initialScenes, projectFolder, serverUrl, onRenderComplete }: TimelineEditorProps) {
    const [scenes, setScenes] = useState<TimelineScene[]>(initialScenes);
    const [previewScene, setPreviewScene] = useState<number | null>(null);
    const [isRendering, setIsRendering] = useState(false);
    const [renderProgress, setRenderProgress] = useState('');
    const videoRef = useRef<HTMLVideoElement>(null);

    const moveScene = (idx: number, dir: -1 | 1) => {
        const newScenes = [...scenes];
        const target = idx + dir;
        if (target < 0 || target >= newScenes.length) return;
        [newScenes[idx], newScenes[target]] = [newScenes[target], newScenes[idx]];
        setScenes(newScenes);
    };

    const removeScene = (idx: number) => {
        setScenes(prev => prev.filter((_, i) => i !== idx));
    };

    const handleRender = async () => {
        setIsRendering(true);
        setRenderProgress('Assembling video...');

        try {
            const sceneOrder = scenes.map(s => s.sceneNum);
            const resp = await fetch(`${serverUrl}/assemble`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ projectFolder, sceneOrder })
            });

            const data = await resp.json();
            if (data.success) {
                setRenderProgress(`✅ Done! ${data.sizeMB}MB`);
                onRenderComplete();
            } else {
                setRenderProgress(`❌ ${data.error}`);
            }
        } catch (err: any) {
            setRenderProgress(`❌ ${err.message}`);
        } finally {
            setIsRendering(false);
        }
    };

    return (
        <div className="tl-editor">
            <div className="tl-header">
                <div className="tl-header-left">
                    <Film className="tl-icon" />
                    <h3>Timeline Editor</h3>
                    <span className="tl-badge">{scenes.length} scenes</span>
                </div>
                <button
                    className="tl-render-btn"
                    onClick={handleRender}
                    disabled={isRendering || scenes.length === 0}
                >
                    {isRendering ? (
                        <><RefreshCw className="tl-icon tl-spin" /> Rendering...</>
                    ) : (
                        <><Download className="tl-icon" /> Render Final Video</>
                    )}
                </button>
            </div>

            {renderProgress && (
                <div className={`tl-progress ${renderProgress.includes('✅') ? 'tl-progress--ok' : renderProgress.includes('❌') ? 'tl-progress--err' : ''}`}>
                    {renderProgress}
                </div>
            )}

            {/* Video Preview Modal */}
            {previewScene !== null && (
                <div className="tl-preview-overlay" onClick={() => setPreviewScene(null)}>
                    <div className="tl-preview-modal" onClick={e => e.stopPropagation()}>
                        <video
                            ref={videoRef}
                            src={`${serverUrl}${scenes.find(s => s.sceneNum === previewScene)?.videoPath}`}
                            controls
                            autoPlay
                            className="tl-preview-video"
                        />
                        <button className="tl-preview-close" onClick={() => setPreviewScene(null)}>×</button>
                    </div>
                </div>
            )}

            {/* Scene Cards */}
            <div className="tl-track">
                {scenes.map((scene, idx) => (
                    <div key={scene.sceneNum} className="tl-card">
                        {/* Thumbnail / Preview */}
                        <div className="tl-card-thumb" onClick={() => scene.hasVideo && setPreviewScene(scene.sceneNum)}>
                            {scene.imagePath ? (
                                <img src={`${serverUrl}${scene.imagePath}`} alt={`Scene ${scene.sceneNum}`} className="tl-thumb-img" />
                            ) : (
                                <div className="tl-thumb-placeholder">
                                    <Film />
                                </div>
                            )}
                            {scene.hasVideo && (
                                <div className="tl-play-overlay">
                                    <Play className="tl-play-icon" />
                                </div>
                            )}
                            <div className="tl-card-num">#{scene.sceneNum}</div>
                        </div>

                        {/* Scene Info */}
                        <div className="tl-card-info">
                            <div className="tl-card-section">{scene.section}</div>
                            <p className="tl-card-voiceover">{scene.voiceover.substring(0, 100)}{scene.voiceover.length > 100 ? '...' : ''}</p>
                            <div className="tl-card-status">
                                <span className={`tl-status-dot ${scene.hasVideo ? 'tl-dot-ok' : 'tl-dot-err'}`} />
                                <span>{scene.hasVideo ? 'Video' : 'No Video'}</span>
                                <span className={`tl-status-dot ${scene.hasAudio ? 'tl-dot-ok' : 'tl-dot-err'}`} />
                                <span>{scene.hasAudio ? 'Audio' : 'No Audio'}</span>
                            </div>
                        </div>

                        {/* Controls */}
                        <div className="tl-card-controls">
                            <button onClick={() => moveScene(idx, -1)} disabled={idx === 0} title="Move up" className="tl-ctrl-btn">
                                <ArrowUp size={14} />
                            </button>
                            <button onClick={() => moveScene(idx, 1)} disabled={idx === scenes.length - 1} title="Move down" className="tl-ctrl-btn">
                                <ArrowDown size={14} />
                            </button>
                            {scene.hasVideo && (
                                <button onClick={() => setPreviewScene(scene.sceneNum)} title="Preview" className="tl-ctrl-btn tl-ctrl-preview">
                                    <Eye size={14} />
                                </button>
                            )}
                            <button onClick={() => removeScene(idx)} title="Remove" className="tl-ctrl-btn tl-ctrl-delete">
                                <Trash2 size={14} />
                            </button>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
