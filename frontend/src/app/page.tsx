"use client";

import { useState, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";

export default function Home() {
  const [sessionId] = useState(() => {
    if (typeof window !== 'undefined') {
      let id = localStorage.getItem('scholar_sync_session');
      if (!id) {
        id = 'user_' + Math.random().toString(36).substring(2, 9);
        localStorage.setItem('scholar_sync_session', id);
      }
      return id;
    }
    return 'default';
  });
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [query, setQuery] = useState("");
  const [answer, setAnswer] = useState("");
  const [loading, setLoading] = useState(false);
  const [conceptsLoading, setConceptsLoading] = useState(false);
  const [materials, setMaterials] = useState<{ filename: string }[]>([]);
  const [concepts, setConcepts] = useState<{ term: string, definition: string, importance: number }[]>([]);
  const [conceptLinks, setConceptLinks] = useState<{ source: string, target: string, relationship: string }[]>([]);
  const [showGraph, setShowGraph] = useState(false);
  const [activeTab, setActiveTab] = useState<'research' | 'analysis'>('research');
  const [error, setError] = useState("");
  const [chatHistory, setChatHistory] = useState<{ 
    role: 'user' | 'assistant', 
    content: string, 
    sources?: { filename: string, snippet: string }[], 
    isAnalysis?: boolean, 
    quiz?: any[],
    flashcards?: { front: string, back: string }[],
    learningPath?: string[],
    selectedAnswers?: { [key: number]: string }
  }[]>([]);
  const [isAnalysisMode, setIsAnalysisMode] = useState(false);
  const [quizLoading, setQuizLoading] = useState(false);
  const [flashcardsLoading, setFlashcardsLoading] = useState(false);
  const [isDark, setIsDark] = useState(true);
  const [itemCount, setItemCount] = useState(5);
  const [backendStatus, setBackendStatus] = useState<'checking' | 'online' | 'offline'>('checking');
  const [showSidebar, setShowSidebar] = useState(false);

  useEffect(() => {
    const container = document.getElementById('chat-container');
    if (container) {
      container.scrollTop = container.scrollHeight;
    }
  }, [chatHistory, loading]);

  const backendUrl = (process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000").replace(/\/$/, "");

  useEffect(() => {
    if (!process.env.NEXT_PUBLIC_BACKEND_URL) {
      console.warn("⚠️ NEXT_PUBLIC_BACKEND_URL is not set. Defaulting to localhost:8000");
    }
    
    const checkBackend = async () => {
      setBackendStatus('checking');
      const startTime = Date.now();
      
      try {
        console.log(`Checking backend connection to: ${backendUrl}`);
        
        // Use a longer timeout for the initial wake-up call (Render free tier can take 30s+)
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 45000);

        const res = await fetch(`${backendUrl}/`, { 
          headers: { 
            "bypass-tunnel-reminder": "true",
            "Accept": "application/json"
          },
          signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        if (res.ok) {
          console.log(`✅ Backend online! (Response time: ${Date.now() - startTime}ms)`);
          setBackendStatus('online');
        } else {
          console.error(`❌ Backend error: ${res.status} ${res.statusText}`);
          setBackendStatus('offline');
        }
      } catch (err: any) {
        const duration = Date.now() - startTime;
        if (err.name === 'AbortError') {
          console.error(`❌ Connection timed out after ${duration}ms. Server might be cold-starting.`);
        } else {
          console.error(`❌ Connection failed to ${backendUrl} after ${duration}ms:`, err.message);
        }
        setBackendStatus('offline');
      }
    };
    
    checkBackend();
    fetchMaterials();
  }, []);

  useEffect(() => {
    if (materials.length > 0 && concepts.length === 0 && !conceptsLoading) {
      fetchConcepts();
    }
  }, [materials]);

  const fetchMaterials = async () => {
    try {
      const res = await fetch(`${backendUrl}/materials`, {
        headers: { 
          "bypass-tunnel-reminder": "true",
          "X-Session-ID": sessionId
        }
      });
      if (res.ok) {
        const data = await res.json();
        setMaterials(data);
      }
    } catch (err) {
      console.error("Failed to fetch materials", err);
    }
  };

  const fetchConcepts = async () => {
    if (materials.length === 0) return;
    setConceptsLoading(true);
    try {
      const res = await fetch(`${backendUrl}/concepts`, { 
        method: "POST",
        headers: { 
          "bypass-tunnel-reminder": "true",
          "X-Session-ID": sessionId
        }
      });
      if (res.ok) {
        const data = await res.json();
        setConcepts(data.concepts || []);
        setConceptLinks(data.links || []);
      }
    } catch (err) {
      console.error("Failed to fetch concepts", err);
    } finally {
      setConceptsLoading(false);
    }
  };

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (files.length === 0) return;

    setUploading(true);
    setError("");
    
    try {
      for (const file of files) {
        const formData = new FormData();
        formData.append("file", file);
        
        const res = await fetch(`${backendUrl}/upload`, {
          method: "POST",
          body: formData,
          headers: { 
            "bypass-tunnel-reminder": "true",
            "X-Session-ID": sessionId
          }
        });

        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.detail || `Upload failed for ${file.name}`);
        }
      }
      
      setFiles([]);
      fetchMaterials();
      fetchConcepts();
      alert(`Successfully uploaded ${files.length} file(s)!`);
    } catch (err: any) {
      setError(`Connection Error: ${err.message || "Could not reach backend"}. If you just pushed, the server might still be waking up (can take 60s).`);
    } finally {
      setUploading(false);
    }
  };

  const handleQuery = async (e?: React.FormEvent, overrideQuery?: string) => {
    if (e) e.preventDefault();
    const searchTerms = overrideQuery || query;
    if (!searchTerms) return;

    setQuery("");
    setLoading(true);
    setError("");
    setIsAnalysisMode(false);
    
    // Add user message to history
    setChatHistory(prev => [...prev, { role: 'user', content: searchTerms }]);

    try {
      const res = await fetch(`${backendUrl}/query`, {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "bypass-tunnel-reminder": "true",
          "X-Session-ID": sessionId
        },
        body: JSON.stringify({ prompt: searchTerms }),
      });

      if (res.ok) {
        const data = await res.json();
        setChatHistory(prev => [...prev, { 
          role: 'assistant', 
          content: data.answer,
          sources: data.sources
        }]);
      } else {
        const data = await res.json();
        setError(data.detail || "Query failed");
      }
    } catch (err) {
      setError("Connection Error: Could not reach backend. Please check if the server is running and CORS is configured.");
    } finally {
      setLoading(false);
    }
  };

  const handleAnalyze = async () => {
    if (materials.length === 0) return;
    setActiveTab('research');
    
    setLoading(true);
    setError("");
    setIsAnalysisMode(true);
    
    // Add user-like analysis request to history
    setChatHistory(prev => [...prev, { role: 'user', content: "Analyze connections across all my materials." }]);

    try {
      const res = await fetch(`${backendUrl}/analyze`, {
        method: "POST",
        headers: { 
          "bypass-tunnel-reminder": "true",
          "X-Session-ID": sessionId
        }
      });

      if (res.ok) {
        const data = await res.json();
        setChatHistory(prev => [...prev, { 
          role: 'assistant', 
          content: data.analysis,
          isAnalysis: true,
          learningPath: data.learning_path
        }]);
      } else {
        const data = await res.json();
        const errorMessage = data.detail || "Analysis failed";
        setError(errorMessage);
        setChatHistory(prev => [...prev, { role: 'assistant', content: `Sorry, I couldn't perform the analysis: ${errorMessage}` }]);
      }
    } catch (err) {
      setError("Failed to connect to backend");
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateQuiz = async () => {
    if (materials.length === 0) return;
    setActiveTab('research');
    
    setQuizLoading(true);
    setError("");
    
    setChatHistory(prev => [...prev, { role: 'user', content: "Generate a practice quiz for me." }]);

    try {
      const res = await fetch(`${backendUrl}/quiz`, {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "bypass-tunnel-reminder": "true",
          "X-Session-ID": sessionId
        },
        body: JSON.stringify({ count: itemCount })
      });

      if (res.ok) {
        const data = await res.json();
        setChatHistory(prev => [...prev, { 
          role: 'assistant', 
          content: "I've generated a practice quiz based on your materials. Good luck!",
          quiz: data.questions
        }]);
      } else {
        const data = await res.json();
        const errorMessage = data.detail || "Quiz generation failed";
        setError(errorMessage);
        setChatHistory(prev => [...prev, { role: 'assistant', content: `Sorry, I couldn't generate the quiz: ${errorMessage}` }]);
      }
    } catch (err) {
      setError("Failed to connect to backend");
    } finally {
      setQuizLoading(false);
    }
  };

  const handleGenerateFlashcards = async () => {
    if (materials.length === 0) return;
    setActiveTab('research');
    
    setFlashcardsLoading(true);
    setError("");
    
    setChatHistory(prev => [...prev, { role: 'user', content: "Generate study flashcards." }]);

    try {
      const res = await fetch(`${backendUrl}/flashcards`, {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "bypass-tunnel-reminder": "true",
          "X-Session-ID": sessionId
        },
        body: JSON.stringify({ count: itemCount })
      });

      if (res.ok) {
        const data = await res.json();
        setChatHistory(prev => [...prev, { 
          role: 'assistant', 
          content: "I've created a set of flashcards for you. Click on them to reveal the answer!",
          flashcards: data.flashcards
        }]);
      } else {
        const data = await res.json();
        setError(data.detail || "Flashcard generation failed");
      }
    } catch (err) {
      setError("Failed to connect to backend");
    } finally {
      setFlashcardsLoading(false);
    }
  };

  const deleteMaterial = async (filename: string) => {
    try {
      const res = await fetch(`${backendUrl}/materials/${encodeURIComponent(filename)}`, {
        method: "DELETE",
        headers: { 
          "bypass-tunnel-reminder": "true",
          "X-Session-ID": sessionId
        }
      });
      if (res.ok) {
        fetchMaterials();
        fetchConcepts();
      }
    } catch (err) {
      setError("Failed to delete material");
    }
  };

  const clearMaterials = async () => {
    try {
      await fetch(`${backendUrl}/materials`, { 
        method: "DELETE",
        headers: { 
          "bypass-tunnel-reminder": "true",
          "X-Session-ID": sessionId
        }
      });
      setMaterials([]);
      setConcepts([]);
      setChatHistory([]);
    } catch (err) {
      setError("Failed to clear materials");
    }
  };

  const toggleTheme = () => {
    setIsDark(!isDark);
  };

  return (
    <div className={`min-h-screen transition-colors duration-500 ${isDark ? "bg-slate-950 text-slate-50" : "bg-slate-50 text-slate-900"} font-sans relative overflow-hidden`}>
      {/* Mesh Gradient Background */}
      <div className="fixed inset-0 z-0 mesh-gradient pointer-events-none opacity-50" />

      <header className="fixed top-4 left-1/2 -translate-x-1/2 z-50 w-full max-w-5xl px-4">
        <div className={`rounded-2xl border shadow-xl backdrop-blur-2xl transition-all duration-500 ${isDark ? "bg-slate-900/40 border-slate-800/50" : "bg-white/40 border-white/50"}`}>
          <div className="px-4 py-2 flex justify-between items-center">
            <div className="flex items-center gap-3">
              <div className="relative group">
                <div className="absolute -inset-1 bg-gradient-to-r from-blue-600 to-indigo-600 rounded-xl blur opacity-25 group-hover:opacity-50 transition duration-1000" />
                <div className="relative w-8 h-8 bg-slate-900 rounded-xl flex items-center justify-center shadow-2xl border border-slate-800 transform transition-transform group-hover:scale-105 active:scale-95">
                  <svg className="w-4 h-4 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18 18.246 18.477 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                  </svg>
                </div>
              </div>
              <div className="flex flex-col">
                <h1 className="text-base font-black tracking-tighter bg-clip-text text-transparent bg-gradient-to-r from-blue-500 to-indigo-500">ScholarSync</h1>
                <div className="flex items-center gap-1.5">
                  <div className={`w-1 h-1 rounded-full ${
                    backendStatus === 'online' ? 'bg-green-500' : 
                    backendStatus === 'checking' ? 'bg-amber-500 animate-pulse' : 'bg-red-500'
                  }`} />
                  <span className="text-[8px] font-black uppercase tracking-[0.1em] opacity-40">
                    {backendStatus === 'online' ? 'Live' : 
                     backendStatus === 'checking' ? 'Wait' : 'Offline'}
                  </span>
                </div>
              </div>
            </div>
            
            <div className="flex items-center gap-2">
              <button 
                onClick={() => setShowSidebar(!showSidebar)}
                className={`lg:hidden w-8 h-8 rounded-xl flex items-center justify-center transition-all border ${isDark ? "bg-slate-800 border-slate-700 text-slate-400" : "bg-white border-slate-200 text-slate-600 shadow-sm"}`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </button>
              <button 
                onClick={toggleTheme}
                className={`w-8 h-8 rounded-xl flex items-center justify-center transition-all hover:scale-110 active:scale-90 border ${isDark ? "bg-slate-800 border-slate-700 text-yellow-400" : "bg-white border-slate-200 text-slate-600 shadow-sm"}`}
                title="Toggle Theme"
              >
                {isDark ? (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 18v1m9-9h1M3 12h1m15.364-6.364l.707.707M6.343 17.657l.707.707m0-11.314l-.707.707m11.314 11.314l-.707.707M12 7a5 5 0 100 10 5 5 0 000-10z" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                  </svg>
                )}
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="relative z-10 max-w-7xl mx-auto px-4 pt-20 pb-10 flex flex-col lg:grid lg:grid-cols-12 gap-6 h-screen overflow-hidden">
        {/* Sidebar: Now collapsible on mobile */}
        <div className={`lg:col-span-3 space-y-4 overflow-y-auto pr-2 custom-scrollbar pb-10 
          ${showSidebar ? 'fixed inset-0 z-[60] bg-slate-950/90 backdrop-blur-xl p-8 block' : 'hidden lg:block'}`}>
          
          {showSidebar && (
            <button 
              onClick={() => setShowSidebar(false)}
              className="absolute top-4 right-4 p-2 text-slate-400 hover:text-white"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}

          <div className={`p-2 rounded-3xl border backdrop-blur-3xl transition-all duration-700
            ${isDark ? "bg-slate-900/20 border-slate-800/50" : "bg-white/20 border-slate-200/50"}`}>
            
            <section className={`p-4 rounded-2xl transition-all duration-500 hover:scale-[1.01] active:scale-[0.99] group
              ${isDark ? "bg-slate-900/40 hover:bg-slate-900/60" : "bg-white/40 hover:bg-white/60 shadow-xl shadow-slate-200/20"}`}>
              <div className="flex items-center gap-2 mb-4 opacity-40 group-hover:opacity-100 transition-opacity">
                <div className="w-6 h-6 rounded-lg bg-blue-500/10 flex items-center justify-center">
                  <svg className="w-3.5 h-3.5 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                  </svg>
                </div>
                <h2 className="text-[9px] font-black uppercase tracking-[0.2em]">Vault</h2>
              </div>
              <form onSubmit={handleUpload} className="space-y-4">
                <div className={`border-2 border-dashed rounded-[2rem] p-6 text-center transition-all cursor-pointer group/upload
                  ${isDark ? "border-slate-800/50 hover:border-blue-500/50 hover:bg-blue-500/5" : "border-slate-200 hover:border-blue-400 hover:bg-blue-50"}`}>
                  <input
                    type="file"
                    accept=".pdf"
                    multiple
                    onChange={(e) => {
                      const selectedFiles = Array.from(e.target.files || []);
                      setFiles(selectedFiles);
                    }}
                    className="hidden"
                    id="file-upload"
                  />
                  <label htmlFor="file-upload" className="cursor-pointer space-y-3 block">
                    <div className="text-3xl grayscale group-hover/upload:grayscale-0 transition-all transform group-hover/upload:scale-110 duration-500">☁️</div>
                    {files.length > 0 ? (
                      <div className="space-y-1">
                        <span className="text-blue-500 text-[10px] font-black uppercase tracking-widest block">{files.length} Files</span>
                      </div>
                    ) : (
                      <div className="space-y-1">
                        <span className="text-[10px] font-black uppercase tracking-[0.2em] block opacity-30 group-hover/upload:opacity-100 transition-opacity">Import</span>
                      </div>
                    )}
                  </label>
                </div>
                <button
                  type="submit"
                  disabled={files.length === 0 || uploading}
                  className={`w-full py-4 rounded-2xl font-black text-[10px] uppercase tracking-[0.3em] transition-all transform active:scale-95 shadow-2xl
                    ${files.length > 0 && !uploading 
                      ? "bg-blue-600 text-white hover:bg-blue-700 shadow-blue-600/20" 
                      : "bg-slate-800/20 text-slate-600 cursor-not-allowed"}`}
                >
                  {uploading ? "Processing..." : "Sync"}
                </button>
              </form>
            </section>

            <div className="h-px w-2/3 mx-auto my-4 bg-slate-800/20" />

            <section className={`p-6 rounded-[2.5rem] transition-all duration-500 hover:scale-[1.01] active:scale-[0.99] group
              ${isDark ? "bg-slate-900/40 hover:bg-slate-900/60" : "bg-white/40 hover:bg-white/60 shadow-xl shadow-slate-200/20"}`}>
              <div className="flex items-center justify-between mb-6 opacity-40 group-hover:opacity-100 transition-opacity">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-xl bg-indigo-500/10 flex items-center justify-center">
                    <svg className="w-4 h-4 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                    </svg>
                  </div>
                  <h2 className="text-[10px] font-black uppercase tracking-[0.3em]">Library</h2>
                </div>
              </div>
              {materials.length === 0 ? (
                <div className="text-center py-6">
                  <div className="text-2xl mb-2 opacity-10">📚</div>
                  <p className="text-[9px] font-black uppercase tracking-[0.2em] opacity-20">No materials</p>
                </div>
              ) : (
                <div className="space-y-2 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar no-scrollbar">
                  {materials.map((m, i) => (
                    <div 
                      key={i} 
                      className={`group/item flex items-center justify-between p-3 rounded-2xl border transition-all duration-300
                        ${isDark ? "bg-slate-800/20 border-slate-700/30 hover:bg-slate-800/40 hover:border-slate-600" : "bg-slate-50 border-slate-200 hover:border-slate-300"}`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className={`p-2 rounded-xl ${isDark ? 'bg-slate-900 border border-slate-800' : 'bg-white shadow-sm'}`}>
                          <svg className="w-3 h-3 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                          </svg>
                        </div>
                        <div className="flex flex-col min-w-0">
                          <span className="text-[10px] font-bold truncate opacity-80 group-hover/item:opacity-100 transition-opacity">{m.filename}</span>
                          <span className="text-[7px] font-black uppercase tracking-tighter opacity-30">PDF</span>
                        </div>
                      </div>
                      <button 
                        onClick={() => deleteMaterial(m.filename)}
                        className="opacity-0 group-hover/item:opacity-100 p-1.5 rounded-lg hover:bg-rose-500/10 hover:text-rose-500 transition-all"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        </div>

        {/* Main: Query Interface - ChatGPT Style */}
        <div className="lg:col-span-9 flex flex-col h-full overflow-hidden pb-20">
          <section className={`rounded-3xl border flex flex-col flex-grow overflow-hidden transition-all duration-500
            ${isDark ? "bg-slate-900/60 border-slate-800" : "bg-white border-slate-200 shadow-xl shadow-slate-200/50"}`}>
            
            <div className={`p-4 border-b flex justify-between items-center ${isDark ? "border-slate-800" : "border-slate-100"}`}>
              <h2 className="text-lg font-black tracking-tight flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse-aura"></span>
                Assistant
              </h2>
              <div className="flex items-center gap-2">
                <div className={`flex p-1 rounded-xl relative ${isDark ? 'bg-slate-950/80' : 'bg-slate-100'}`}>
                  {/* Sliding Background */}
                  <div 
                    className={`absolute top-1 bottom-1 transition-all duration-300 ease-out rounded-lg shadow-sm
                      ${activeTab === 'research' ? 'left-1 w-[calc(50%-1px-0.25rem)] bg-blue-600' : 'left-[calc(50%+0.25rem-1px)] w-[calc(50%-1px-0.25rem)] bg-purple-600'}`}
                  />
                  <button 
                    onClick={() => setActiveTab('research')}
                    className={`relative z-10 px-4 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-[0.1em] transition-all duration-300
                      ${activeTab === 'research' ? 'text-white' : (isDark ? 'text-slate-500 hover:text-slate-300' : 'text-slate-400 hover:text-slate-600')}`}
                  >
                    Research
                  </button>
                  <button 
                    onClick={() => setActiveTab('analysis')}
                    className={`relative z-10 px-4 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-[0.1em] transition-all duration-300
                      ${activeTab === 'analysis' ? 'text-white' : (isDark ? 'text-slate-500 hover:text-slate-300' : 'text-slate-400 hover:text-slate-600')}`}
                  >
                    Analysis
                  </button>
                </div>
              </div>
            </div>
            
            <div className="flex-grow p-3 overflow-y-auto space-y-4 custom-scrollbar" id="chat-container">
              {activeTab === 'research' ? (
                <>
                  {error && (
                    <div className={`p-4 rounded-xl flex items-center gap-3 mx-auto max-w-2xl
                      ${isDark ? "bg-rose-500/10 text-rose-400 border border-rose-500/20" : "bg-rose-50 text-rose-600 border border-rose-100"}`}>
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <span className="font-medium text-sm">{error}</span>
                    </div>
                  )}
                  
                  {chatHistory.length === 0 && !loading && (
                    <div className="flex flex-col items-center justify-center h-full text-center py-20 animate-in fade-in duration-1000">
                      <div className={`w-24 h-24 rounded-full flex items-center justify-center mb-8
                        ${isDark ? "bg-slate-800" : "bg-slate-50"}`}>
                        <svg className="w-12 h-12 opacity-20" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                        </svg>
                      </div>
                      <h3 className="text-2xl font-bold mb-3 opacity-80">Ready to assist</h3>
                      <p className="text-sm max-w-sm mx-auto leading-relaxed opacity-40 font-medium mb-10">
                        Upload your study materials and ask anything. 
                        I'll find connections across all your documents.
                      </p>
                    </div>
                  )}

                  {chatHistory.map((msg, idx) => (
                    <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} animate-in fade-in slide-in-from-bottom-2 duration-300`}>
                      <div className={`max-w-[85%] p-4 rounded-2xl shadow-sm border
                        ${msg.role === 'user' 
                          ? (isDark ? 'bg-blue-600 border-blue-500 text-white' : 'bg-blue-600 border-blue-500 text-white')
                          : (isDark ? 'bg-slate-800 border-slate-700 text-slate-100' : 'bg-slate-50 border-slate-200 text-slate-800')}`}>
                        
                        <div className="prose prose-sm dark:prose-invert max-w-none">
                          <ReactMarkdown 
                            remarkPlugins={[remarkMath]} 
                            rehypePlugins={[rehypeKatex]}
                            components={{
                              h4: ({node, ...props}) => <h4 className={`font-bold mt-3 mb-1 ${msg.role === 'user' ? 'text-blue-100' : (msg.isAnalysis ? 'text-purple-400' : 'text-blue-400')}`} {...props} />,
                              p: ({node, ...props}) => <p className="mb-1 leading-relaxed" {...props} />,
                            }}
                          >
                            {msg.content}
                          </ReactMarkdown>
                        </div>

                        {msg.sources && msg.sources.length > 0 && (
                          <div className="mt-4 pt-3 border-t border-slate-700/50 flex flex-wrap gap-1.5">
                            {msg.sources.map((s, si) => (
                              <div key={si} className="group/source relative">
                                <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-900/50 text-slate-400 border border-slate-700/50 cursor-help hover:border-blue-500/50 transition-colors">
                                  {s.filename}
                                </span>
                                <div className={`absolute bottom-full left-0 mb-2 w-64 p-3 rounded-xl shadow-2xl border text-[10px] leading-relaxed z-30 opacity-0 group-hover/source:opacity-100 pointer-events-none transition-all
                                  ${isDark ? "bg-slate-900 border-slate-700 text-slate-300" : "bg-white border-slate-200 text-slate-600"}`}>
                                  <div className="font-bold mb-1 text-blue-500">Source Snippet:</div>
                                  <div className="italic">"{s.snippet}"</div>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}

                        {msg.learningPath && msg.learningPath.length > 0 && (
                          <div className="mt-6">
                            <h4 className="text-xs font-black uppercase tracking-widest text-purple-500 mb-3 flex items-center gap-2">
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                              </svg>
                              Recommended Learning Path
                            </h4>
                            <div className="space-y-3">
                              {msg.learningPath.map((step, si) => (
                                <div key={si} className={`flex gap-3 p-3 rounded-xl border ${isDark ? 'bg-slate-900/50 border-slate-700/50' : 'bg-white border-slate-200 shadow-sm'}`}>
                                  <div className="flex-shrink-0 w-6 h-6 rounded-full bg-purple-600 text-white flex items-center justify-center text-[10px] font-bold">
                                    {si + 1}
                                  </div>
                                  <p className="text-xs leading-relaxed">{step}</p>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {msg.flashcards && (
                          <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-6 justify-items-center pb-4">
                            {msg.flashcards.map((fc, fci) => (
                              <div 
                                key={fci}
                                onClick={(e) => {
                                  const target = e.currentTarget;
                                  target.classList.toggle('flashcard-flipped');
                                }}
                                className="group w-full max-w-[320px] h-64 [perspective:1000px] cursor-pointer"
                              >
                                <div className="flashcard-inner relative w-full h-full transition-all duration-700" style={{ transformStyle: 'preserve-3d' }}>
                                  {/* Front */}
                                  <div className={`flashcard-front absolute inset-0 w-full h-full p-8 flex flex-col items-center justify-center text-center rounded-[2.5rem] border-2 shadow-xl
                                    ${isDark ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-100 shadow-slate-200/50'}`}
                                    style={{ backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden' }}>
                                    <div className="absolute top-6 left-1/2 -translate-x-1/2 flex items-center gap-2">
                                      <div className="w-1.5 h-1.5 rounded-full bg-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.5)]" />
                                      <span className="text-[10px] font-black uppercase tracking-[0.3em] text-blue-500/50">Question</span>
                                    </div>
                                    <div className="text-sm font-bold leading-relaxed opacity-90 max-h-full overflow-y-auto custom-scrollbar">{fc.front}</div>
                                    <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-1.5 opacity-20 group-hover:opacity-40 transition-opacity">
                                      <svg className="w-3 h-3 animate-bounce" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                      </svg>
                                      <span className="text-[9px] font-black uppercase tracking-widest">Flip Card</span>
                                    </div>
                                  </div>
                                  {/* Back */}
                                  <div className={`flashcard-back absolute inset-0 w-full h-full p-8 flex flex-col items-center justify-center text-center rounded-[2.5rem] border-2 shadow-2xl
                                    ${isDark ? 'bg-indigo-600 border-indigo-500 shadow-indigo-900/40' : 'bg-blue-600 border-blue-500 shadow-blue-200'}`}
                                    style={{ backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}>
                                    <div className="absolute top-6 left-1/2 -translate-x-1/2 flex items-center gap-2">
                                      <div className="w-1.5 h-1.5 rounded-full bg-white shadow-[0_0_10px_rgba(255,255,255,0.5)]" />
                                      <span className="text-[10px] font-black uppercase tracking-[0.3em] text-white/50">Answer</span>
                                    </div>
                                    <div className="text-sm font-bold leading-relaxed text-white max-h-full overflow-y-auto custom-scrollbar">{fc.back}</div>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}

                        {msg.quiz && (
                          <div className="mt-6 space-y-6">
                            {msg.quiz.map((q, qi) => (
                              <div key={qi} className={`p-4 rounded-xl border ${isDark ? 'bg-slate-900/50 border-slate-700' : 'bg-white border-slate-200 shadow-sm'}`}>
                                <p className="font-bold mb-4 text-sm">{qi + 1}. {q.question}</p>
                                <div className="grid grid-cols-1 gap-2">
                                  {q.options?.map((opt: string, oi: number) => (
                                    <button
                                      key={oi}
                                      onClick={() => {
                                        const newHistory = [...chatHistory];
                                        if (!newHistory[idx].selectedAnswers) {
                                          newHistory[idx].selectedAnswers = {};
                                        }
                                        newHistory[idx].selectedAnswers[qi] = opt;
                                        setChatHistory(newHistory);
                                      }}
                                      className={`text-left px-4 py-2.5 rounded-lg text-xs transition-all border
                                        ${msg.selectedAnswers?.[qi] === opt 
                                          ? (opt === q.correct_answer ? 'bg-green-500/20 border-green-500 text-green-500' : 'bg-red-500/20 border-red-500 text-red-500')
                                          : (isDark ? 'bg-slate-800 border-slate-700 hover:border-slate-500' : 'bg-slate-50 border-slate-200 hover:border-slate-300')}`}
                                    >
                                      {opt}
                                    </button>
                                  ))}
                                </div>
                                {msg.selectedAnswers?.[qi] && (
                                  <div className={`mt-3 p-3 rounded-lg text-[11px] animate-in fade-in slide-in-from-top-1
                                    ${msg.selectedAnswers[qi] === q.correct_answer 
                                      ? (isDark ? 'bg-green-500/10 text-green-400' : 'bg-green-50 text-green-700')
                                      : (isDark ? 'bg-red-500/10 text-red-400' : 'bg-red-50 text-red-700')}`}>
                                    <span className="font-bold uppercase tracking-wider text-[10px] block mb-1">
                                      {msg.selectedAnswers[qi] === q.correct_answer ? "✓ Correct" : "✗ Incorrect"}
                                    </span>
                                    {q.explanation}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </>
              ) : (
                <div className="h-full flex flex-col animate-in fade-in duration-500">
                  {materials.length === 0 ? (
                    <div className="flex-1 flex flex-col items-center justify-center text-center p-8 space-y-6">
                      <div className="relative">
                        <div className="absolute -inset-4 bg-blue-500/20 rounded-full blur-2xl animate-pulse" />
                        <div className="relative w-20 h-20 bg-slate-900 rounded-3xl border border-slate-800 flex items-center justify-center shadow-2xl">
                          <svg className="w-10 h-10 text-slate-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                          </svg>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <h3 className="text-xl font-bold">No Materials Found</h3>
                        <p className="text-slate-400 max-w-sm mx-auto text-sm">
                          Upload your study materials in the Vault to start the deep analysis.
                        </p>
                      </div>
                    </div>
                  ) : conceptsLoading ? (
                    <div className="flex-1 flex flex-col items-center justify-center space-y-4">
                      <div className="w-12 h-12 border-4 border-blue-500/20 border-t-blue-500 rounded-full animate-spin" />
                      <p className="text-[10px] font-black uppercase tracking-widest opacity-40">Analyzing Knowledge Base...</p>
                    </div>
                  ) : concepts.length === 0 ? (
                    <div className="flex-1 flex flex-col items-center justify-center text-center p-8 space-y-6">
                       <div className="w-12 h-12 border-4 border-blue-500/20 border-t-blue-500 rounded-full animate-spin" />
                       <p className="text-slate-400">Extracting concepts...</p>
                    </div>
                  ) : (
                    <div className="space-y-8 pb-10">
                      <div className={`p-6 rounded-2xl border ${isDark ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200 shadow-sm'}`}>
                        <div className="flex items-center justify-between mb-8">
                          <div>
                            <h3 className="text-lg font-bold mb-1">Concept Map</h3>
                            <p className="text-xs opacity-50">Visualizing {concepts.length} key terms and their relationships</p>
                          </div>
                          <button 
                            onClick={fetchConcepts}
                            className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                            title="Refresh Analysis"
                          >
                            <svg className="w-5 h-5 text-purple-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                            </svg>
                          </button>
                        </div>
                        
                        <div className={`relative h-[500px] rounded-xl overflow-hidden border ${isDark ? 'bg-slate-950/50 border-slate-800' : 'bg-slate-50 border-slate-200'}`}>
                          {/* Background SVG for links */}
                          <svg className="absolute inset-0 w-full h-full pointer-events-none">
                            <defs>
                              <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
                                <polygon points="0 0, 10 3.5, 0 7" fill={isDark ? "#475569" : "#cbd5e1"} />
                              </marker>
                            </defs>
                            {conceptLinks.map((link, i) => {
                              const sourceIdx = concepts.findIndex(c => c.term === link.source);
                              const targetIdx = concepts.findIndex(c => c.term === link.target);
                              
                              if (sourceIdx === -1 || targetIdx === -1) return null;
                              
                              // Calculate coordinates based on hierarchical layout
                              const getPos = (index: number) => {
                                const nodesPerRow = 2; // Fewer nodes per row for more vertical look
                                const row = Math.floor(index / nodesPerRow);
                                const col = index % nodesPerRow;
                                const xSpacing = 220; // More horizontal space
                                const ySpacing = 160; // More vertical space
                                return {
                                  x: 100 + col * xSpacing + (row % 2 === 0 ? 0 : 20),
                                  y: 80 + row * ySpacing
                                };
                              };
                              
                              const start = getPos(sourceIdx);
                              const end = getPos(targetIdx);
                              
                              return (
                                <line 
                                  key={i}
                                  x1={start.x} y1={start.y}
                                  x2={end.x} y2={end.y}
                                  stroke={isDark ? "#334155" : "#e2e8f0"}
                                  strokeWidth="2"
                                  strokeDasharray="4 2"
                                  markerEnd="url(#arrowhead)"
                                />
                              );
                            })}
                          </svg>

                          {/* Concept Nodes */}
                          <div className="absolute inset-0">
                            {concepts.map((concept, i) => {
                              const nodesPerRow = 2;
                              const row = Math.floor(i / nodesPerRow);
                              const col = i % nodesPerRow;
                              const xSpacing = 220;
                              const ySpacing = 160;
                              const x = 100 + col * xSpacing + (row % 2 === 0 ? 0 : 20);
                              const y = 80 + row * ySpacing;

                              return (
                                <div 
                                  key={i}
                                  onClick={() => {
                                    setActiveTab('research');
                                    handleQuery(undefined, `Explain ${concept.term} in the context of these materials.`);
                                  }}
                                  className={`group absolute -translate-x-1/2 -translate-y-1/2 p-3 rounded-xl border-2 transition-all cursor-pointer max-w-[150px]
                                    ${isDark ? 'bg-slate-900 border-slate-800 hover:border-purple-500 hover:shadow-lg hover:shadow-purple-500/20' : 'bg-white border-slate-200 hover:border-purple-500 hover:shadow-lg hover:shadow-purple-500/10'}`}
                                  style={{
                                    left: `${x}px`,
                                    top: `${y}px`,
                                    transform: `translate(-50%, -50%) scale(${0.8 + (concept.importance / 10) * 0.4})`,
                                    zIndex: 10
                                  }}
                                >
                                  <div className="text-[8px] font-black uppercase tracking-wider text-purple-500 mb-0.5">Rank {concept.importance}</div>
                                  <div className="font-bold text-xs truncate">{concept.term}</div>
                                  
                                  {/* Tooltip */}
                                  <div className={`absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 p-3 rounded-xl shadow-2xl border text-[10px] z-50 opacity-0 group-hover:opacity-100 pointer-events-none transition-all
                                    ${isDark ? 'bg-slate-800 border-slate-700 text-slate-100' : 'bg-white border-slate-200 shadow-xl text-slate-800'}`}>
                                    <div className="font-bold mb-1 text-purple-400">{concept.term}</div>
                                    <div className="leading-relaxed opacity-80">{concept.definition}</div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className={`p-6 rounded-2xl border ${isDark ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'}`}>
                          <h4 className="font-bold mb-4 flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-blue-500" />
                            Relationship Links
                          </h4>
                          <div className="space-y-3">
                            {conceptLinks.length > 0 ? conceptLinks.map((link, i) => (
                              <div key={i} className={`p-3 rounded-lg text-xs flex items-center justify-between ${isDark ? 'bg-slate-800/50' : 'bg-slate-50'}`}>
                                <span className="font-bold text-blue-400">{link.source}</span>
                                <div className="flex-grow mx-3 border-t border-dashed border-slate-700 opacity-30 relative">
                                  <span className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 px-2 py-0.5 rounded-full bg-slate-900 text-[8px] font-bold uppercase tracking-tighter">
                                    {link.relationship}
                                  </span>
                                </div>
                                <span className="font-bold text-purple-400">{link.target}</span>
                              </div>
                            )) : (
                              <p className="text-xs opacity-40 italic">No specific relationships identified yet.</p>
                            )}
                          </div>
                        </div>

                        <div className={`p-6 rounded-2xl border ${isDark ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'}`}>
                          <h4 className="font-bold mb-4 flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-purple-500" />
                            Analysis Insights
                          </h4>
                          <p className="text-xs leading-relaxed opacity-60">
                            Based on your {materials.length} documents, I've identified {concepts.length} core concepts. 
                            The most central theme appears to be <span className="text-purple-400 font-bold underline decoration-purple-500/30">
                              {[...concepts].sort((a,b) => b.importance - a.importance)[0]?.term || "N/A"}
                            </span>. 
                            {conceptLinks.length > 0 ? ` There are ${conceptLinks.length} primary inter-document connections detected.` : ""}
                          </p>
                          <div className="mt-6 pt-6 border-t border-slate-800 flex justify-center">
                            <button 
                              onClick={() => {
                                setActiveTab('research');
                                handleQuery(undefined, "Explain the connection between " + (concepts[0]?.term || "these materials") + " and " + (concepts[1]?.term || "the core concepts"));
                              }}
                              className="text-xs font-bold text-blue-500 hover:text-blue-400 transition-colors flex items-center gap-1"
                            >
                              Explore these connections in Research →
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
              
              {loading && activeTab === 'research' && (
                <div className="flex justify-start animate-in fade-in duration-300">
                  <div className={`p-4 rounded-2xl border ${isDark ? 'bg-slate-800 border-slate-700' : 'bg-slate-50 border-slate-200'}`}>
                    <div className="flex gap-2">
                      <div className="w-2 h-2 rounded-full bg-blue-500 animate-bounce" />
                      <div className="w-2 h-2 rounded-full bg-blue-500 animate-bounce [animation-delay:-0.15s]" />
                      <div className="w-2 h-2 rounded-full bg-blue-500 animate-bounce [animation-delay:-0.3s]" />
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className={`p-4 border-t transition-all ${isDark ? "bg-slate-900/50 border-slate-800" : "bg-slate-50 border-slate-100"}`}>
              {activeTab === 'research' ? (
                <form onSubmit={handleQuery} className="relative flex gap-2 max-w-4xl mx-auto">
                  <input
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Ask a question..."
                    className={`flex-grow px-4 py-3 rounded-xl outline-none transition-all text-sm
                      ${isDark 
                        ? "bg-slate-800 border border-slate-700 focus:border-blue-500/50 text-slate-100" 
                        : "bg-white border border-slate-200 focus:border-blue-500 shadow-sm text-slate-900"}`}
                  />
                  <button
                    type="submit"
                    disabled={!query || loading}
                    className={`px-4 py-3 rounded-xl font-bold transition-all transform active:scale-95 flex items-center gap-2
                      ${query && !loading 
                        ? "bg-blue-600 text-white hover:bg-blue-700 shadow-lg shadow-blue-600/30" 
                        : "bg-slate-800 text-slate-500 cursor-not-allowed"}`}
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                    <span className="text-xs">Ask</span>
                  </button>
                </form>
              ) : (
                <div className="flex justify-center gap-4 max-w-4xl mx-auto h-0 p-0 overflow-hidden opacity-0 pointer-events-none">
                  {/* Buttons moved to sidebar */}
                </div>
              )}
            </div>
          </section>
        </div>
      </main>

      {/* MacOS-style Action Dock */}
      <div className="fixed bottom-10 left-1/2 -translate-x-1/2 z-50 hidden lg:block group/dock">
        <div className={`flex items-center gap-1 p-1.5 rounded-[2.5rem] border shadow-[0_20px_50px_rgba(0,0,0,0.3)] backdrop-blur-3xl transition-all duration-500 hover:scale-[1.02]
          ${isDark ? 'bg-slate-900/40 border-slate-700/50 hover:bg-slate-900/60' : 'bg-white/40 border-white/50 hover:bg-white/60'}`}>
          
          <button 
            onClick={handleAnalyze}
            disabled={materials.length === 0 || loading}
            className={`flex items-center gap-3 px-6 py-3 rounded-[2rem] transition-all transform active:scale-95 group relative overflow-hidden
              ${materials.length === 0 || loading ? 'opacity-40 cursor-not-allowed' : 'hover:bg-purple-500/10 hover:shadow-inner'}`}
          >
            <div className={`w-10 h-10 rounded-2xl flex items-center justify-center transition-all group-hover:scale-110 group-hover:rotate-6
              ${isDark ? 'bg-purple-500/20 text-purple-400' : 'bg-purple-50 text-purple-600'}`}>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <div className="flex flex-col items-start">
              <span className="text-[10px] font-black uppercase tracking-[0.2em]">Analyze</span>
              <span className="text-[8px] opacity-40 font-bold uppercase tracking-wider">Deep Insights</span>
            </div>
            {activeTab === 'analysis' && (
              <div className="absolute bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-purple-500" />
            )}
          </button>

          <div className="w-px h-8 bg-slate-700/20 mx-1" />

          <button 
            onClick={handleGenerateQuiz}
            disabled={materials.length === 0 || quizLoading}
            className={`flex items-center gap-3 px-6 py-3 rounded-[2rem] transition-all transform active:scale-95 group relative
              ${materials.length === 0 || quizLoading ? 'opacity-40 cursor-not-allowed' : 'hover:bg-amber-500/10 hover:shadow-inner'}`}
          >
            <div className={`w-10 h-10 rounded-2xl flex items-center justify-center transition-all group-hover:scale-110 group-hover:-rotate-6
              ${isDark ? 'bg-amber-500/20 text-amber-400' : 'bg-amber-50 text-amber-600'}`}>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
              </svg>
            </div>
            <div className="flex flex-col items-start">
              <span className="text-[10px] font-black uppercase tracking-[0.2em]">Quiz</span>
              <span className="text-[8px] opacity-40 font-bold uppercase tracking-wider">Self Test</span>
            </div>
          </button>

          <div className="w-px h-8 bg-slate-700/20 mx-1" />

          <button 
            onClick={handleGenerateFlashcards}
            disabled={materials.length === 0 || flashcardsLoading}
            className={`flex items-center gap-3 px-6 py-3 rounded-[2rem] transition-all transform active:scale-95 group relative
              ${materials.length === 0 || flashcardsLoading ? 'opacity-40 cursor-not-allowed' : 'hover:bg-emerald-500/10 hover:shadow-inner'}`}
          >
            <div className={`w-10 h-10 rounded-2xl flex items-center justify-center transition-all group-hover:scale-110 group-hover:rotate-12
              ${isDark ? 'bg-emerald-500/20 text-emerald-400' : 'bg-emerald-50 text-emerald-600'}`}>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
              </svg>
            </div>
            <div className="flex flex-col items-start">
              <span className="text-[10px] font-black uppercase tracking-[0.2em]">Study</span>
              <span className="text-[8px] opacity-40 font-bold uppercase tracking-wider">Flashcards</span>
            </div>
          </button>

          <div className="w-px h-8 bg-slate-700/20 mx-1" />

          <div className="flex items-center gap-1 px-2">
            <button 
              onClick={clearMaterials}
              className="w-10 h-10 rounded-xl flex items-center justify-center text-slate-500 hover:bg-rose-500/10 hover:text-rose-500 transition-all duration-500 transform hover:scale-110 active:scale-90"
              title="Clear All Materials"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      <footer className={`py-12 text-center border-t transition-colors pb-32 ${isDark ? "bg-slate-950 border-slate-900" : "bg-white border-slate-100"}`}>
        <p className="text-xs font-bold tracking-widest opacity-20 uppercase">
          ScholarSync AI &copy; 2025 • Research with Confidence
        </p>
      </footer>

      {/* Mobile Floating Action Bar */}
      <div className="lg:hidden fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 w-full max-w-md">
        <div className={`flex items-center justify-around p-2 rounded-2xl border shadow-2xl backdrop-blur-xl
          ${isDark ? 'bg-slate-900/80 border-slate-700/50' : 'bg-white/80 border-slate-200/50'}`}>
          <button 
            onClick={handleAnalyze}
            disabled={materials.length === 0 || loading}
            className="flex flex-col items-center gap-1 p-2 rounded-xl transition-all active:scale-90"
          >
            <div className={`p-2 rounded-lg ${isDark ? 'bg-purple-500/20 text-purple-400' : 'bg-purple-50 text-purple-600'}`}>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <span className="text-[10px] font-bold opacity-60">Analyze</span>
          </button>
          
          <button 
            onClick={handleGenerateQuiz}
            disabled={materials.length === 0 || quizLoading}
            className="flex flex-col items-center gap-1 p-2 rounded-xl transition-all active:scale-90"
          >
            <div className={`p-2 rounded-lg ${isDark ? 'bg-amber-500/20 text-amber-400' : 'bg-amber-50 text-amber-600'}`}>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
              </svg>
            </div>
            <span className="text-[10px] font-bold opacity-60">Quiz</span>
          </button>

          <button 
            onClick={handleGenerateFlashcards}
            disabled={materials.length === 0 || flashcardsLoading}
            className="flex flex-col items-center gap-1 p-2 rounded-xl transition-all active:scale-90"
          >
            <div className={`p-2 rounded-lg ${isDark ? 'bg-emerald-500/20 text-emerald-400' : 'bg-emerald-50 text-emerald-600'}`}>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
              </svg>
            </div>
            <span className="text-[10px] font-bold opacity-60">Study</span>
          </button>
        </div>
      </div>

      <style jsx global>{`
        @keyframes spin-slow {
          from { transform: rotate(360deg); }
          to { transform: rotate(0deg); }
        }
        .animate-spin-slow {
          animation: spin-slow 3s linear infinite;
        }
        .custom-scrollbar::-webkit-scrollbar {
          width: 6px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: ${isDark ? '#334155' : '#cbd5e1'};
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: ${isDark ? '#475569' : '#94a3b8'};
        }
        /* Hide scrollbar for Chrome, Safari and Opera */
        .no-scrollbar::-webkit-scrollbar {
          display: none;
        }
        /* Hide scrollbar for IE, Edge and Firefox */
        .no-scrollbar {
          -ms-overflow-style: none;  /* IE and Edge */
          scrollbar-width: none;  /* Firefox */
        }
      `}</style>
    </div>
  );
}