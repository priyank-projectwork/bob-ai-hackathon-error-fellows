import { useState, useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";

interface Message {
  id: string;
  sender: "user" | "ai";
  text: string;
  timestamp: Date;
}

export default function ChatCopilot() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "init",
      sender: "ai",
      text: "I am your Supply Chain AI Copilot. How can I assist you with operations today?",
      timestamp: new Date()
    }
  ]);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isTyping]);

  const handleSend = async () => {
    if (!input.trim()) return;

    const userMsg: Message = {
      id: Date.now().toString(),
      sender: "user",
      text: input,
      timestamp: new Date()
    };
    
    setMessages(prev => [...prev, userMsg]);
    setInput("");
    setIsTyping(true);

    try {
      const res = await fetch("http://127.0.0.1:4000/api/v1/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: userMsg.text })
      });
      
      const data = await res.json();
      
      const aiMsg: Message = {
        id: (Date.now() + 1).toString(),
        sender: "ai",
        text: data.reply || "I encountered an error analyzing the system state.",
        timestamp: new Date()
      };
      
      setMessages(prev => [...prev, aiMsg]);
    } catch (error) {
      const errorMsg: Message = {
        id: (Date.now() + 1).toString(),
        sender: "ai",
        text: "Connection to AI Copilot failed.",
        timestamp: new Date()
      };
      setMessages(prev => [...prev, errorMsg]);
    } finally {
      setIsTyping(false);
    }
  };

  return (
    <>
      {/* Floating Action Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="fixed bottom-6 right-6 w-14 h-14 bg-indigo-600 hover:bg-indigo-500 rounded-full shadow-xl shadow-indigo-600/30 flex items-center justify-center text-white transition-transform hover:scale-105 z-[100]"
        aria-label="Toggle AI Copilot"
      >
        {isOpen ? (
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
        ) : (
          <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" /></svg>
        )}
      </button>

      {/* Chat Window */}
      {isOpen && (
        <div className="fixed bottom-24 right-6 w-96 max-w-[calc(100vw-3rem)] h-[600px] max-h-[calc(100vh-120px)] bg-slate-800 border border-slate-700 rounded-2xl shadow-2xl flex flex-col overflow-hidden z-[100] animate-in slide-in-from-bottom-5">
          {/* Header */}
          <div className="bg-indigo-600 p-4 flex items-center gap-3 shadow-md">
            <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center text-white">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
            </div>
            <div>
              <h3 className="font-bold text-white text-sm">AI Operations Copilot</h3>
              <p className="text-indigo-200 text-xs">Live System Context Enabled</p>
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 p-4 overflow-y-auto bg-slate-900/50 space-y-4">
            {messages.map((msg) => (
              <div key={msg.id} className={`flex ${msg.sender === "user" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[85%] p-3 rounded-2xl text-sm leading-relaxed ${
                  msg.sender === "user" 
                    ? "bg-indigo-600 text-white rounded-tr-sm" 
                    : "bg-slate-800 border border-slate-700 text-slate-200 rounded-tl-sm shadow-sm"
                }`}>
                  <div className={msg.sender === "ai" ? "prose prose-sm prose-invert max-w-none" : "whitespace-pre-wrap"}>
                    <ReactMarkdown>
                      {msg.text}
                    </ReactMarkdown>
                  </div>
                </div>
              </div>
            ))}
            {isTyping && (
              <div className="flex justify-start">
                <div className="bg-slate-800 border border-slate-700 p-4 rounded-2xl rounded-tl-sm w-16 flex items-center justify-center gap-1 shadow-sm">
                  <div className="w-1.5 h-1.5 bg-slate-500 rounded-full animate-bounce" style={{ animationDelay: "0ms" }}></div>
                  <div className="w-1.5 h-1.5 bg-slate-500 rounded-full animate-bounce" style={{ animationDelay: "150ms" }}></div>
                  <div className="w-1.5 h-1.5 bg-slate-500 rounded-full animate-bounce" style={{ animationDelay: "300ms" }}></div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input Area */}
          <div className="p-3 bg-slate-800 border-t border-slate-700">
            <form 
              onSubmit={(e) => { e.preventDefault(); handleSend(); }}
              className="flex items-center gap-2"
            >
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask about active shipments or routes..."
                className="flex-1 bg-slate-900 border border-slate-700 rounded-full px-4 py-2.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors"
              />
              <button
                type="submit"
                disabled={!input.trim() || isTyping}
                className="w-10 h-10 rounded-full bg-indigo-600 flex items-center justify-center text-white hover:bg-indigo-500 disabled:bg-slate-700 disabled:text-slate-500 transition-colors"
              >
                <svg className="w-4 h-4 ml-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" /></svg>
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
