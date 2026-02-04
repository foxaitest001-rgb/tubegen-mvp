
import React, { useState, useRef, useEffect } from 'react';
import { MessageSquare, X, Send, Sparkles, Loader2 } from 'lucide-react';
import { consultWithUser } from '../services/puter';

interface Message {
    role: 'user' | 'assistant';
    content: string;
}

interface ConsultantChatProps {
    onApplyConfig: (config: any) => void;
    onStartPipeline?: (config: any) => void; // NEW: Auto-start generation when ready=true
}

export const ConsultantChat: React.FC<ConsultantChatProps> = ({ onApplyConfig, onStartPipeline }) => {
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
            // Call AI
            const result = await consultWithUser(newHistory);

            const assistantMsg = result.message;
            setMessages(prev => [...prev, { role: 'assistant', content: assistantMsg }]);

            if (result.config) {
                // Always apply config to form
                onApplyConfig(result.config);

                // Check if ready=true → auto-start the pipeline
                if (result.config.ready === true && onStartPipeline) {
                    setMessages(prev => [...prev, { role: 'assistant', content: "🚀 Starting the Director Pipeline now! Generating script, voiceover, and visuals..." }]);
                    // Close chat and trigger pipeline
                    setIsOpen(false);
                    onStartPipeline(result.config);
                } else {
                    // Just update form
                    setMessages(prev => [...prev, { role: 'assistant', content: "✅ I've updated the form with these settings. Say 'send to director' when you're ready!" }]);
                }
            }

        } catch (e) {
            setMessages(prev => [...prev, { role: 'assistant', content: "Sorry, I lost my train of thought. Try again?" }]);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <>
            {/* Floating Button */}
            {!isOpen && (
                <button
                    onClick={() => setIsOpen(true)}
                    className="fixed bottom-6 right-6 z-50 flex items-center gap-2 px-4 py-3 bg-gradient-to-r from-purple-600 to-indigo-600 text-white rounded-full shadow-lg hover:shadow-purple-500/50 transition-all hover:scale-105"
                >
                    <MessageSquare className="w-5 h-5" />
                    <span className="font-semibold">Ask the Expert</span>
                </button>
            )}

            {/* Chat Window */}
            {isOpen && (
                <div className="fixed bottom-6 right-6 z-50 w-96 h-[500px] bg-slate-900 border border-slate-700 rounded-xl shadow-2xl flex flex-col overflow-hidden animate-in slide-in-from-bottom-10 fade-in duration-300">

                    {/* Header */}
                    <div className="p-4 bg-slate-800 border-b border-slate-700 flex justify-between items-center">
                        <div className="flex items-center gap-2 text-white font-semibold">
                            <Sparkles className="w-4 h-4 text-purple-400" />
                            Creative Consultant
                        </div>
                        <button
                            onClick={() => setIsOpen(false)}
                            className="text-slate-400 hover:text-white transition-colors"
                        >
                            <X className="w-5 h-5" />
                        </button>
                    </div>

                    {/* Messages */}
                    <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-950/50">
                        {messages.map((m, i) => (
                            <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                <div
                                    className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${m.role === 'user'
                                        ? 'bg-purple-600 text-white'
                                        : 'bg-slate-800 text-slate-200 border border-slate-700'
                                        }`}
                                >
                                    {m.content}
                                </div>
                            </div>
                        ))}
                        {isLoading && (
                            <div className="flex justify-start">
                                <div className="bg-slate-800 rounded-lg px-3 py-2 border border-slate-700">
                                    <Loader2 className="w-4 h-4 animate-spin text-purple-400" />
                                </div>
                            </div>
                        )}
                        <div ref={messagesEndRef} />
                    </div>

                    {/* Input */}
                    <div className="p-3 bg-slate-800 border-t border-slate-700 flex gap-2">
                        <input
                            type="text"
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                            placeholder="Describe your video idea..."
                            className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-purple-500"
                        />
                        <button
                            onClick={handleSend}
                            disabled={isLoading || !input.trim()}
                            className="p-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg disabled:opacity-50 transition-colors"
                        >
                            <Send className="w-4 h-4" />
                        </button>
                    </div>

                </div>
            )}
        </>
    );
};
