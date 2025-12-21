"use client";

import { useState, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";

export default function Home() {
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
    fetchConcepts();
  }, []);

  const fetchMaterials = async () => {
    try {
      const res = await fetch(`${backendUrl}/materials`, {
        headers: { "bypass-tunnel-reminder": "true" }
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
        headers: { "bypass-tunnel-reminder": "true" }
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
          headers: { "bypass-tunnel-reminder": "true" }
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
          "bypass-tunnel-reminder": "true"
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
        headers: { "bypass-tunnel-reminder": "true" }
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
        setError(data.detail || "Analysis failed");
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
          "bypass-tunnel-reminder": "true" 
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
        setError(data.detail || "Quiz generation failed");
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
          "bypass-tunnel-reminder": "true" 
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
        headers: { "bypass-tunnel-reminder": "true" }
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
        headers: { "bypass-tunnel-reminder": "true" }
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
    <div className={`min-h-screen transition-colors duration-300 ${isDark ? "bg-slate-950 text-slate-50" : "bg-slate-50 text-slate-900"} font-sans`}>
      <header className={`border-b sticky top-0 z-10 ${isDark ? "bg-slate-900/80 border-slate-800 backdrop-blur-md" : "bg-white/80 border-slate-200 backdrop-blur-md"}`}>
        <div className="max-w-6xl mx-auto px-6 py-4 flex justify-between items-center">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center shadow-lg shadow-blue-500/20">
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18 18.246 18.477 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
              </svg>
            </div>
            <h1 className="text-xl font-bold tracking-tight">ScholarSync</h1>
            <div className="flex items-center gap-1.5 ml-2 px-2 py-0.5 rounded-full bg-slate-800/50 border border-slate-700/50">
              <div className={`w-1.5 h-1.5 rounded-full ${
                backendStatus === 'online' ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)]' : 
                backendStatus === 'checking' ? 'bg-amber-500 animate-pulse' : 'bg-red-500'
              }`} />
              <span className="text-[10px] font-bold uppercase tracking-wider opacity-50">
                {backendStatus === 'online' ? 'Backend Live' : 
                 backendStatus === 'checking' ? 'Waking up...' : 'Offline'}
              </span>
            </div>
          </div>
          
          <div className="flex items-center gap-6">
            <nav className="hidden md:flex items-center gap-4 text-sm font-medium opacity-70">
              <span>Research</span>
              <span>Library</span>
              <span>Analysis</span>
            </nav>
            <button 
              onClick={toggleTheme}
              className={`p-2 rounded-full transition-colors ${isDark ? "bg-slate-800 hover:bg-slate-700 text-yellow-400" : "bg-slate-200 hover:bg-slate-300 text-slate-600"}`}
              title="Toggle Theme"
            >
              {isDark ? (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 18v1m9-9h1M3 12h1m15.364-6.364l.707.707M6.343 17.657l.707.707m0-11.314l-.707.707m11.314 11.314l-.707.707M12 7a5 5 0 100 10 5 5 0 000-10z" />
                </svg>
              ) : (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                </svg>
              )}
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6 lg:py-10 grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-10 h-auto lg:h-[calc(100vh-80px)] overflow-y-auto lg:overflow-hidden">
        {/* Left Sidebar: Upload and Materials - Sticky */}
        <div className="lg:col-span-4 space-y-8 overflow-y-auto pr-2 custom-scrollbar">
          <section className={`p-6 rounded-2xl border transition-all ${isDark ? "bg-slate-900 border-slate-800" : "bg-white border-slate-200 shadow-sm"}`}>
            <h2 className="text-lg font-semibold mb-6 flex items-center gap-2">
              <svg className="w-5 h-5 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
              Upload Materials
            </h2>
            <form onSubmit={handleUpload} className="space-y-6">
              <div className={`border-2 border-dashed rounded-xl p-8 text-center transition-all cursor-pointer group
                ${isDark ? "border-slate-700 hover:border-blue-500 hover:bg-blue-500/5" : "border-slate-200 hover:border-blue-400 hover:bg-blue-50"}`}>
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
                <label htmlFor="file-upload" className="cursor-pointer space-y-2 block">
                  <div className="text-3xl mb-2">📄</div>
                  {files.length > 0 ? (
                    <div className="space-y-1">
                      <span className="text-blue-500 font-semibold block">{files.length} files selected</span>
                      <span className="text-xs opacity-50 block truncate max-w-xs mx-auto">
                        {files.map(f => f.name).join(", ")}
                      </span>
                    </div>
                  ) : (
                    <div className="space-y-1">
                      <span className="font-medium block">Click to select PDFs</span>
                      <span className="text-xs opacity-50 block">Upload multiple files at once</span>
                    </div>
                  )}
                </label>
              </div>
              <button
                type="submit"
                disabled={files.length === 0 || uploading}
                className={`w-full py-3 rounded-xl font-bold transition-all transform active:scale-95 shadow-lg
                  ${files.length > 0 && !uploading 
                    ? "bg-blue-600 text-white hover:bg-blue-700 shadow-blue-600/20" 
                    : "bg-slate-800 text-slate-500 cursor-not-allowed"}`}
              >
                {uploading ? (
                  <span className="flex items-center justify-center gap-2">
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Uploading...
                  </span>
                ) : (
                  "Upload Documents"
                )}
              </button>
            </form>
          </section>

          <section className={`p-6 rounded-2xl border transition-all
            ${isDark ? "bg-slate-900 border-slate-800" : "bg-white border-slate-200 shadow-sm"}`}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <svg className="w-5 h-5 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                </svg>
                My Library
              </h2>
              {materials.length > 0 && (
                <button 
                  onClick={clearMaterials}
                  className="text-[10px] uppercase tracking-wider font-bold text-red-500 hover:text-red-400 transition-colors"
                >
                  Clear All
                </button>
              )}
            </div>
            {materials.length === 0 ? (
              <p className="text-sm opacity-50 text-center py-4 italic">No materials yet.</p>
            ) : (
              <div className="space-y-2 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
                {materials.map((m, i) => (
                  <div 
                    key={i} 
                    className={`group flex items-center justify-between p-3 rounded-xl border transition-all
                      ${isDark ? "bg-slate-800/50 border-slate-700/50 hover:border-slate-600" : "bg-slate-50 border-slate-200 hover:border-slate-300"}`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                <div className={`p-2 rounded-lg ${isDark ? 'bg-slate-900' : 'bg-white shadow-sm'}`}>
                    <svg className="w-4 h-4 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                    </svg>
                </div>
                <div className="flex flex-col min-w-0">
                  <span className="text-sm font-medium truncate">{m.filename}</span>
                  <div className="flex items-center gap-2">
                    <span className="flex h-1.5 w-1.5 rounded-full bg-green-500"></span>
                    <span className="text-[10px] opacity-40 font-bold uppercase tracking-tighter">Processed</span>
                  </div>
                </div>
            </div>
                    <button 
                      onClick={() => deleteMaterial(m.filename)}
                      className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg text-slate-500 hover:text-red-500 hover:bg-red-500/10 transition-all"
                      title="Delete material"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            )}
            {materials.length > 0 && (
              <div className="mt-6 space-y-4">
                <div className={`p-4 rounded-xl border ${isDark ? 'bg-slate-800/30 border-slate-700' : 'bg-slate-50 border-slate-200'}`}>
                  <label className="text-[10px] font-black uppercase tracking-widest opacity-50 block mb-2">
                    Items to generate
                  </label>
                  <div className="flex items-center gap-3">
                    <input 
                      type="range" 
                      min="1" 
                      max="10" 
                      value={itemCount} 
                      onChange={(e) => setItemCount(parseInt(e.target.value))}
                      className="flex-grow h-1.5 bg-blue-600/20 rounded-lg appearance-none cursor-pointer accent-blue-500"
                    />
                    <span className="text-sm font-bold w-4 text-center">{itemCount}</span>
                  </div>
                </div>

                <div className="space-y-3">
                  <button
                    onClick={handleAnalyze}
                  disabled={loading || uploading}
                  className={`w-full flex items-center justify-center gap-2 py-3 rounded-xl font-bold transition-all border-2
                    ${isDark 
                      ? "border-purple-500/30 text-purple-400 hover:bg-purple-500/10" 
                      : "border-purple-200 text-purple-600 hover:bg-purple-50"}`}
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                  Analyze Connections
                </button>
                <button
                  onClick={handleGenerateQuiz}
                  disabled={loading || uploading || quizLoading}
                  className={`w-full flex items-center justify-center gap-2 py-3 rounded-xl font-bold transition-all border-2
                    ${isDark 
                      ? "border-amber-500/30 text-amber-400 hover:bg-amber-500/10" 
                      : "border-amber-200 text-amber-600 hover:bg-amber-50"}`}
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                  </svg>
                  {quizLoading ? "Generating..." : "Practice Quiz"}
                </button>
                <button
                  onClick={handleGenerateFlashcards}
                  disabled={loading || uploading || flashcardsLoading}
                  className={`w-full flex items-center justify-center gap-2 py-3 rounded-xl font-bold transition-all border-2
                    ${isDark 
                      ? "border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10" 
                      : "border-emerald-200 text-emerald-600 hover:bg-emerald-50"}`}
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                  </svg>
                  {flashcardsLoading ? "Generating..." : "Study Flashcards"}
                </button>
              </div>
            </div>
            )}
          </section>
          {concepts.length > 0 && (
            <section className={`p-6 rounded-2xl border transition-all animate-in fade-in slide-in-from-left-4
              ${isDark ? "bg-slate-900 border-slate-800" : "bg-white border-slate-200 shadow-sm"}`}>
              <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <svg className="w-5 h-5 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
                Key Concepts
              </h2>
              {conceptsLoading ? (
                <div className="flex flex-wrap gap-2 animate-pulse">
                  {[...Array(6)].map((_, i) => (
                    <div key={i} className={`h-7 w-20 rounded-lg ${isDark ? 'bg-slate-800' : 'bg-slate-100'}`} />
                  ))}
                </div>
              ) : (
                <div className="flex flex-wrap gap-2 overflow-visible">
                  {concepts.map((c, i) => (
                    <div 
                      key={i} 
                      className={`group relative px-3 py-1.5 rounded-lg text-xs font-medium border transition-all cursor-help
                        ${isDark 
                          ? "bg-slate-800 border-slate-700 text-slate-300 hover:border-amber-500/50 hover:bg-amber-500/5" 
                          : "bg-slate-50 border-slate-200 text-slate-600 hover:border-amber-400 hover:bg-amber-50"}`}
                    >
                      {c.term}
                      <div className={`absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 p-3 rounded-xl shadow-xl border text-[11px] leading-relaxed z-20 opacity-0 group-hover:opacity-100 pointer-events-none transition-all
                        ${isDark ? "bg-slate-800 border-slate-700 text-slate-200" : "bg-white border-slate-200 text-slate-600"}`}>
                        <div className="font-bold mb-1 text-amber-500">{c.term}</div>
                        {c.definition}
                        <div className="mt-2 flex items-center gap-1 opacity-50">
                          <span className="font-bold">Importance:</span>
                          <div className="flex gap-0.5">
                            {[...Array(5)].map((_, star) => (
                              <div key={star} className={`w-1.5 h-1.5 rounded-full ${star < Math.ceil(c.importance/2) ? 'bg-amber-500' : 'bg-slate-600'}`} />
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}
        </div>

        {/* Main: Query Interface - ChatGPT Style */}
        <div className="lg:col-span-8 flex flex-col h-full overflow-hidden">
          <section className={`rounded-3xl border flex flex-col flex-grow overflow-hidden transition-all
            ${isDark ? "bg-slate-900 border-slate-800" : "bg-white border-slate-200 shadow-xl shadow-slate-200/50"}`}>
            
            <div className={`p-6 border-b flex justify-between items-center ${isDark ? "border-slate-800" : "border-slate-100"}`}>
              <h2 className="text-xl font-bold flex items-center gap-3">
                <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse"></span>
                Research Assistant
              </h2>
              <div className="flex items-center gap-4">
                <div className={`flex p-1 rounded-xl ${isDark ? 'bg-slate-900' : 'bg-slate-100'}`}>
                  <button 
                    onClick={() => setActiveTab('research')}
                    className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all
                      ${activeTab === 'research' 
                        ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20' 
                        : (isDark ? 'text-slate-400 hover:text-slate-200' : 'text-slate-500 hover:text-slate-700')}`}
                  >
                    Research
                  </button>
                  <button 
                    onClick={() => setActiveTab('analysis')}
                    className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all
                      ${activeTab === 'analysis' 
                        ? 'bg-purple-600 text-white shadow-lg shadow-purple-600/20' 
                        : (isDark ? 'text-slate-400 hover:text-slate-200' : 'text-slate-500 hover:text-slate-700')}`}
                  >
                    Analysis
                  </button>
                </div>
                {chatHistory.length > 0 && activeTab === 'research' && (
                  <button 
                    onClick={() => setChatHistory([])}
                    className="text-xs opacity-50 hover:opacity-100 transition-opacity"
                  >
                    Clear Chat
                  </button>
                )}
              </div>
            </div>
            
            <div className="flex-grow p-4 overflow-y-auto space-y-6 custom-scrollbar" id="chat-container">
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

                      <div className="flex flex-wrap justify-center gap-3">
                        <button 
                          onClick={handleAnalyze}
                          disabled={materials.length === 0}
                          className={`px-4 py-2 rounded-xl text-xs font-bold transition-all border
                            ${materials.length > 0 ? (isDark ? 'border-blue-500/30 bg-blue-500/10 text-blue-400 hover:bg-blue-500/20' : 'border-blue-200 bg-blue-50 text-blue-600 hover:bg-blue-100') : 'opacity-30 cursor-not-allowed'}`}
                        >
                          Summarize Everything
                        </button>
                        <button 
                          onClick={handleGenerateQuiz}
                          disabled={materials.length === 0}
                          className={`px-4 py-2 rounded-xl text-xs font-bold transition-all border
                            ${materials.length > 0 ? (isDark ? 'border-purple-500/30 bg-purple-500/10 text-purple-400 hover:bg-purple-500/20' : 'border-purple-200 bg-purple-50 text-purple-600 hover:bg-purple-100') : 'opacity-30 cursor-not-allowed'}`}
                        >
                          Take a Quiz
                        </button>
                        <button 
                          onClick={() => {
                            setActiveTab('analysis');
                            if (concepts.length === 0) fetchConcepts();
                          }}
                          disabled={materials.length === 0}
                          className={`px-4 py-2 rounded-xl text-xs font-bold transition-all border
                            ${materials.length > 0 ? (isDark ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20' : 'border-emerald-200 bg-emerald-50 text-emerald-600 hover:bg-emerald-100') : 'opacity-30 cursor-not-allowed'}`}
                        >
                          View Concept Map
                        </button>
                      </div>
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
                          <div className="mt-6 flex flex-wrap gap-4 justify-center">
                            {msg.flashcards.map((fc, fci) => (
                              <div 
                                key={fci}
                                onClick={(e) => {
                                  const target = e.currentTarget;
                                  target.classList.toggle('flashcard-flipped');
                                }}
                                className="group w-64 h-40 [perspective:1000px] cursor-pointer"
                              >
                                <div className="flashcard-inner relative w-full h-full shadow-xl rounded-2xl">
                                  {/* Front */}
                                  <div className={`flashcard-front absolute inset-0 w-full h-full p-6 flex flex-col items-center justify-center text-center rounded-2xl border-2
                                    ${isDark ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-200'}`}>
                                    <span className="text-[8px] font-black uppercase tracking-widest text-amber-500 mb-2">Question</span>
                                    <p className="text-xs font-bold leading-relaxed">{fc.front}</p>
                                    <div className="mt-4 text-[8px] opacity-40 uppercase tracking-tighter">Click to flip</div>
                                  </div>
                                  {/* Back */}
                                  <div className={`flashcard-back absolute inset-0 w-full h-full p-6 flex flex-col items-center justify-center text-center rounded-2xl border-2
                                    ${isDark ? 'bg-amber-900/20 border-amber-500/50' : 'bg-amber-50 border-amber-200'}`}>
                                    <span className="text-[8px] font-black uppercase tracking-widest text-amber-500 mb-2">Answer</span>
                                    <p className="text-xs leading-relaxed">{fc.back}</p>
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
                  {concepts.length === 0 && !conceptsLoading ? (
                    <div className="flex flex-col items-center justify-center py-20 text-center">
                      <div className={`w-20 h-20 rounded-full flex items-center justify-center mb-6 
                        ${isDark ? 'bg-purple-500/10' : 'bg-purple-50'}`}>
                        <svg className="w-10 h-10 text-purple-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                        </svg>
                      </div>
                      <h3 className="text-xl font-bold mb-2">Knowledge Graph Analysis</h3>
                      <p className="text-sm opacity-50 max-w-sm mb-8 leading-relaxed">
                        I'll analyze your materials to extract key concepts and visualize how they connect to each other.
                      </p>
                      <button 
                        onClick={fetchConcepts}
                        className="px-8 py-3 rounded-xl bg-purple-600 hover:bg-purple-700 text-white font-bold transition-all shadow-lg shadow-purple-600/30 flex items-center gap-2"
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                        </svg>
                        Start Analysis
                      </button>
                    </div>
                  ) : conceptsLoading ? (
                    <div className="flex flex-col items-center justify-center py-20 text-center">
                      <div className="relative w-20 h-20 mb-8">
                        <div className="absolute inset-0 rounded-full border-4 border-purple-500/20 border-t-purple-500 animate-spin" />
                        <div className="absolute inset-3 rounded-full border-4 border-blue-500/20 border-b-blue-500 animate-spin-slow" />
                      </div>
                      <h3 className="text-xl font-bold mb-2">Analyzing Concepts...</h3>
                      <p className="text-sm opacity-50 animate-pulse">Scanning through all uploaded materials for connections</p>
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

            <div className={`p-6 border-t transition-all ${isDark ? "bg-slate-900/50 border-slate-800" : "bg-slate-50 border-slate-100"}`}>
              {activeTab === 'research' ? (
                <form onSubmit={handleQuery} className="relative flex gap-3 max-w-4xl mx-auto">
                  <input
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Ask a question about your study materials..."
                    className={`flex-grow px-6 py-4 rounded-2xl outline-none transition-all font-medium
                      ${isDark 
                        ? "bg-slate-800 border-2 border-slate-700 focus:border-blue-500/50 text-slate-100" 
                        : "bg-white border-2 border-slate-200 focus:border-blue-500 shadow-sm text-slate-900"}`}
                  />
                  <button
                    type="submit"
                    disabled={!query || loading}
                    className={`px-6 py-4 rounded-2xl font-bold transition-all transform active:scale-95 flex items-center gap-2
                      ${query && !loading 
                        ? "bg-blue-600 text-white hover:bg-blue-700 shadow-lg shadow-blue-600/30" 
                        : "bg-slate-800 text-slate-500 cursor-not-allowed"}`}
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                    <span>Ask</span>
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

      <footer className={`py-8 text-center border-t transition-colors ${isDark ? "bg-slate-950 border-slate-900" : "bg-white border-slate-100"}`}>
        <p className="text-xs font-bold tracking-widest opacity-20 uppercase">
          ScholarSync AI &copy; 2025 • Research with Confidence
        </p>
      </footer>

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
