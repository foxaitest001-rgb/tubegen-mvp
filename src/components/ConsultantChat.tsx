
import React, { useState, useRef, useEffect } from 'react';
import { MessageSquare, X, Send, Sparkles, Loader2 } from 'lucide-react';
import { consultWithUser } from '../services/puter';

interface Message {
    role: 'user' | 'assistant';
    content: string;
}

interface ConsultantChatProps {
    onApplyConfig: (config: any) => void;
    onStartPipeline?: (config: any) => void;
    videoSource?: 'meta' | 'grok';
}

export const ConsultantChat: React.FC<ConsultantChatProps> = ({ onApplyConfig, onStartPipeline, videoSource = 'meta' }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [messages, setMessages] = useState<Message[]>([
        { role: 'assistant', content: "Hi! I'm your Creative Consultant. Tell me about the video you want to make, and I'll set everything up for you." }
    ]);
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages, isOpen]);

    const handleSend = async () => {
        if (!input.trim() || isLoading) return;

        const userMsg = input.trim();
        setInput('');
        setIsLoading(true);

        const newHistory: Message[] = [...messages, { role: 'user', content: userMsg }];
        setMessages(newHistory);

        try {
            const result = await consultWithUser(newHistory);

            const assistantMsg = result.message;
            setMessages(prev => [...prev, { role: 'assistant', content: assistantMsg }]);

            if (result.config) {
                onApplyConfig(result.config);

                if (result.config.ready === true && onStartPipeline) {
                    const sourceLabel = videoSource === 'grok' ? 'Grok' : 'Meta.ai';
                    setMessages(prev => [...prev, { role: 'assistant', content: `🚀 Starting Director via ${sourceLabel}! Generating script, voiceover, and visuals...` }]);
                    setIsOpen(false);
                    onStartPipeline(result.config);
                } else {
                    setMessages(prev => [...prev, { role: 'assistant', content: "✅ Settings updated. Say 'send to director' when you're ready!" }]);
                }
            }

        } catch (e) {
            setMessages(prev => [...prev, { role: 'assistant', content: "Sorry, I lost my train of thought. Try again?" }]);
        } finally {
            setIsLoading(false);
        }
    };

    const sourceLabel = videoSource === 'grok' ? 'Grok' : 'Meta.ai';

    return (
        <>
            {/* Floating Button */}
            {!isOpen && (
                <button
                    onClick={() => setIsOpen(true)}
                    className="ftg-chat-fab"
                >
                    <MessageSquare className="w-5 h-5" />
                    <span>Ask the Expert</span>
                </button>
            )}

            {/* Chat Window */}
            {isOpen && (
                <div className="ftg-chat-window">
                    {/* Header */}
                    <div className="ftg-chat-header">
                        <div className="ftg-chat-title">
                            <Sparkles className="w-4 h-4" />
                            Creative Consultant
                            <span className="ftg-source-badge">{sourceLabel}</span>
                        </div>
                        <button
                            onClick={() => setIsOpen(false)}
                            className="ftg-chat-close"
                        >
                            <X className="w-5 h-5" />
                        </button>
                    </div>

                    {/* Messages */}
                    <div className="ftg-chat-messages">
                        {messages.map((m, i) => (
                            <div key={i} className={`ftg-msg-row ${m.role === 'user' ? 'ftg-msg-row-user' : 'ftg-msg-row-ai'}`}>
                                <div className={`ftg-msg-bubble ${m.role === 'user' ? 'ftg-msg-user' : 'ftg-msg-ai'}`}>
                                    {m.content}
                                </div>
                            </div>
                        ))}
                        {isLoading && (
                            <div className="ftg-chat-loading">
                                <div className="ftg-chat-loader">
                                    <Loader2 className="w-4 h-4" />
                                </div>
                            </div>
                        )}
                        <div ref={messagesEndRef} />
                    </div>

                    {/* Input */}
                    <div className="ftg-chat-input-bar">
                        <input
                            type="text"
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                            placeholder="Describe your video idea..."
                            className="ftg-chat-input"
                        />
                        <button
                            onClick={handleSend}
                            disabled={isLoading || !input.trim()}
                            className="ftg-chat-send"
                        >
                            <Send className="w-4 h-4" />
                        </button>
                    </div>
                </div>
            )}
        </>
    );
};
