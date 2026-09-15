import { useState, useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";

interface Message {
  id: string;
  sender: "user" | "ai";
  text: string;
  timestamp: Date;
}

export default function ChatCopilot() {
  const [isOpen, setIsOpen]     = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "init",
      sender: "ai",
      text: "Hello. I'm your Supply Chain AI Copilot with live system context. Ask me about active disruptions, at-risk shipments, temperature excursions, or fleet redeployment options.",
      timestamp: new Date(),
    },
  ]);
  const [input, setInput]       = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const messagesEndRef          = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isTyping]);

  const handleSend = async () => {
    if (!input.trim()) return;

    const userMsg: Message = {
      id: Date.now().toString(),
      sender: "user",
      text: input,
      timestamp: new Date(),
    };
    setMessages(prev => [...prev, userMsg]);
    setInput("");
    setIsTyping(true);

    try {
      const res = await fetch("http://127.0.0.1:4000/api/v1/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: userMsg.text }),
      });
      const data = await res.json();
      setMessages(prev => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          sender: "ai",
          text: data.reply || "I couldn't analyse the current system state.",
          timestamp: new Date(),
        },
      ]);
    } catch {
      setMessages(prev => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          sender: "ai",
          text: "Connection to AI Copilot lost. Please check the backend.",
          timestamp: new Date(),
        },
      ]);
    } finally {
      setIsTyping(false);
    }
  };

  return (
    <>
      {/* FAB */}
      <button
        data-tour="chat"
        onClick={() => setIsOpen(!isOpen)}
        className={`
          fixed bottom-6 right-6 z-[99999]
          w-12 h-12 rounded-full shadow-2xl
          flex items-center justify-center
          transition-all duration-200 hover:scale-105
          ${isOpen
            ? "bg-slate-700 hover:bg-slate-600 text-slate-300"
            : "bg-indigo-600 hover:bg-indigo-500 text-white shadow-indigo-600/40"}
        `}
        aria-label="Toggle AI Copilot"
      >
        {isOpen ? (
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
        ) : (
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" /></svg>
        )}
      </button>

      {/* Chat panel */}
      {isOpen && (
        <div className="fixed bottom-20 right-6 z-[100] w-[380px] max-w-[calc(100vw-2rem)] h-[520px] max-h-[calc(100vh-100px)] flex flex-col rounded-2xl border border-slate-700/60 bg-[#0d1424] shadow-2xl shadow-black/60 overflow-hidden">

          {/* Header */}
          <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-800 bg-slate-900/80">
            <div className="w-7 h-7 rounded-lg bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center flex-shrink-0">
              <svg className="w-4 h-4 text-indigo-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path d="M13 10V3L4 14h7v7l9-11h-7z" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <div className="min-w-0">
              <div className="text-xs font-bold text-white">AI Operations Copilot</div>
              <div className="text-[10px] text-indigo-400 uppercase tracking-widest font-semibold">Live Context Active</div>
            </div>
            <div className="ml-auto flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-[10px] text-emerald-400 font-semibold">Online</span>
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 scrollbar-thin scrollbar-track-transparent scrollbar-thumb-slate-700">
            {messages.map((msg) => (
              <div key={msg.id} className={`flex ${msg.sender === "user" ? "justify-end" : "justify-start"}`}>
                {msg.sender === "ai" && (
                  <div className="w-5 h-5 rounded flex-shrink-0 mr-2 mt-0.5 bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center">
                    <svg className="w-3 h-3 text-indigo-400" fill="currentColor" viewBox="0 0 24 24"><path d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
                  </div>
                )}
                <div className={`max-w-[82%] px-3 py-2 rounded-xl text-xs leading-relaxed ${
                  msg.sender === "user"
                    ? "bg-indigo-600 text-white rounded-tr-sm"
                    : "bg-slate-800/80 border border-slate-700/50 text-slate-300 rounded-tl-sm"
                }`}>
                  {msg.sender === "ai" ? (
                    <div className="prose prose-xs prose-invert max-w-none [&_p]:my-0.5 [&_ul]:my-1 [&_li]:my-0">
                      <ReactMarkdown>{msg.text}</ReactMarkdown>
                    </div>
                  ) : (
                    <span className="whitespace-pre-wrap">{msg.text}</span>
                  )}
                </div>
              </div>
            ))}

            {isTyping && (
              <div className="flex justify-start">
                <div className="w-5 h-5 rounded flex-shrink-0 mr-2 mt-0.5 bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center">
                  <svg className="w-3 h-3 text-indigo-400" fill="currentColor" viewBox="0 0 24 24"><path d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
                </div>
                <div className="bg-slate-800/80 border border-slate-700/50 px-3 py-2.5 rounded-xl rounded-tl-sm flex items-center gap-1">
                  <span className="w-1.5 h-1.5 bg-slate-500 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                  <span className="w-1.5 h-1.5 bg-slate-500 rounded-full animate-bounce" style={{ animationDelay: "120ms" }} />
                  <span className="w-1.5 h-1.5 bg-slate-500 rounded-full animate-bounce" style={{ animationDelay: "240ms" }} />
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Suggested prompts — shown only when no user message yet */}
          {messages.length === 1 && (
            <div className="px-4 pb-2 flex flex-wrap gap-1.5">
              {["What shipments are at risk?", "Any temperature excursions?", "Recommend rerouting options"].map(p => (
                <button
                  key={p}
                  onClick={() => { setInput(p); }}
                  className="text-[10px] px-2.5 py-1 rounded-full border border-slate-700 text-slate-400 hover:border-indigo-500/50 hover:text-indigo-400 transition-colors bg-slate-800/50"
                >
                  {p}
                </button>
              ))}
            </div>
          )}

          {/* Input */}
          <div className="px-3 py-3 border-t border-slate-800 bg-slate-900/60">
            <form onSubmit={(e) => { e.preventDefault(); handleSend(); }} className="flex items-center gap-2">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask about shipments, routes, temperature…"
                className="flex-1 bg-slate-800/80 border border-slate-700/50 rounded-full px-3.5 py-2 text-xs text-white placeholder:text-slate-600 focus:outline-none focus:border-indigo-500/60 focus:ring-1 focus:ring-indigo-500/30 transition-colors"
              />
              <button
                type="submit"
                disabled={!input.trim() || isTyping}
                className="w-8 h-8 rounded-full flex items-center justify-center text-white bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-700 disabled:text-slate-500 transition-colors flex-shrink-0"
              >
                <svg className="w-3.5 h-3.5 ml-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" /></svg>
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
