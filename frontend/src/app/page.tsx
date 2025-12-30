"use client";

import { useState, useEffect, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";

type Material = { filename: string };

// Use Render backend URL directly (no trailing slash)
const backendUrl = "https://scholarsync-jh4j.onrender.com";

export default function Home() {
  /* ================= SESSION ================= */
  const [sessionId] = useState(() => {
    if (typeof window !== "undefined") {
      let id = localStorage.getItem("scholar_sync_session");
      if (!id) {
        id = "user_" + Math.random().toString(36).substring(2, 9);
        localStorage.setItem("scholar_sync_session", id);
      }
      return id;
    }
    return "default";
  });

  /* ================= STATE ================= */
  const [files, setFiles] = useState<File[]>([]);
  const [query, setQuery] = useState("");
  const [materials, setMaterials] = useState<Material[]>([]);
  const [chatHistory, setChatHistory] = useState<any[]>([]);
  const [error, setError] = useState("");

  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [concepts, setConcepts] = useState<any[]>([]);
  const [conceptLinks, setConceptLinks] = useState<any[]>([]);

  const [backendStatus, setBackendStatus] =
    useState<"checking" | "online" | "offline">("checking");

  const [isDark, setIsDark] = useState(true);
  const [activeTab, setActiveTab] =
    useState<"research" | "analysis" | "quiz" | "study">("research");

  /* ================= QUIZ STATE ================= */
  const [quizQuestions, setQuizQuestions] = useState<any[]>([]);
  const [currentQuestionIdx, setCurrentQuestionIdx] = useState(0);
  const [quizScore, setQuizScore] = useState(0);
  const [quizStarted, setQuizStarted] = useState(false);
  const [quizFinished, setQuizFinished] = useState(false);
  const [quizLoading, setQuizLoading] = useState(false);

  /* ================= STUDY STATE ================= */
  const [flashcards, setFlashcards] = useState<any[]>([]);
  const [studyLoading, setStudyLoading] = useState(false);
  const [currentCardIdx, setCurrentCardIdx] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);

  /* ================= BACKEND ================= */
  const checkBackend = useCallback(async () => {
    setBackendStatus("checking");
    try {
      const controller = new AbortController();
      // PATIENCE: 90s timeout for "Engine Wakeup" (Cold Start)
      const timeoutId = setTimeout(() => controller.abort(), 90000); 

      const res = await fetch(`${backendUrl}/`, {
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      if (res.ok) {
        setBackendStatus("online");
        setError("");
      } else {
        setBackendStatus("offline");
        setError("Engine is warming up. Please wait 30-60 seconds...");
      }
    } catch (err: any) {
      setBackendStatus("offline");
      if (err.name === 'AbortError') {
        setError("Engine wake-up timed out. Click 'Retry' to try again.");
      } else {
        setError("System Offline: Connecting to engine...");
      }
    }
  }, []);

  useEffect(() => {
    checkBackend();
    const interval = setInterval(() => {
      if (backendStatus !== 'online') {
        checkBackend();
      }
    }, 20000); // Heartbeat ping every 20s
    return () => clearInterval(interval);
  }, [backendStatus, checkBackend]);

  const fetchMaterials = useCallback(async () => {
    try {
      const res = await fetch(`${backendUrl}/materials`, {
        headers: { "X-Session-ID": sessionId },
      });
      if (res.ok) setMaterials(await res.json());
    } catch {
      console.error("Failed to fetch materials");
    }
  }, [sessionId]);

  const fetchConcepts = useCallback(async (force = false) => {
    if (!force && concepts.length > 0) return;
    try {
      const res = await fetch(`${backendUrl}/concepts`, {
        method: "POST",
        headers: { "X-Session-ID": sessionId },
      });
      if (res.ok) {
        const data = await res.json();
        setConcepts(data.concepts || []);
        setConceptLinks(data.links || []);
      }
    } catch {
      console.error("Failed to fetch concepts");
    }
  }, [sessionId, concepts.length]);

  const deleteMaterial = async (filename: string) => {
    try {
      const res = await fetch(
        `${backendUrl}/materials/${encodeURIComponent(filename)}`,
        {
          method: "DELETE",
          headers: { "X-Session-ID": sessionId },
        }
      );

      if (res.ok) {
        const updated = materials.filter(m => m.filename !== filename);
        setMaterials(updated);
        // Reset concepts if no materials left, otherwise refresh
        if (updated.length === 0) {
          setConcepts([]);
          setConceptLinks([]);
        } else {
          fetchConcepts(true);
        }
      } else {
        const errorData = await res.json();
        setError(errorData.detail || "Failed to delete material");
      }
    } catch {
      setError("Failed to delete material");
    }
  };

  const clearMaterials = async () => {
    try {
      const res = await fetch(`${backendUrl}/materials`, {
        method: "DELETE",
        headers: { "X-Session-ID": sessionId },
      });

      if (res.ok) {
        setMaterials([]);
        setConcepts([]);
        setConceptLinks([]);
      } else {
        const errorData = await res.json();
        setError(errorData.detail || "Failed to clear library");
      }
    } catch {
      setError("Failed to clear library");
    }
  };


  useEffect(() => {
    fetchMaterials();
    if (materials.length > 0) fetchConcepts();
  }, [fetchMaterials, fetchConcepts, materials.length]);

  /* ================= ACTIONS ================= */

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!files.length) return;

    setUploading(true);
    setError("");

    try {
      const fd = new FormData();
      let totalSize = 0;
      files.forEach(f => {
        fd.append("files", f);
        totalSize += f.size;
      });

      if (totalSize > 100 * 1024 * 1024) {
        throw new Error("Total file size exceeds 100MB limit");
      }

      const res = await fetch(`${backendUrl}/upload`, {
        method: "POST",
        body: fd,
        headers: { "X-Session-ID": sessionId },
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.detail || "Upload failed");
      }

      setFiles([]);
      fetchMaterials();
      fetchConcepts(true);
    } catch (e: any) {
      setError(e.message || "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const handleQuery = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim() || loading) return;

    const currentQuery = query;
    setQuery("");
    setChatHistory(h => [...h, { role: "user", content: currentQuery }]);
    setLoading(true);

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 120000); // 120s for query

      const res = await fetch(`${backendUrl}/query`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Session-ID": sessionId,
        },
        body: JSON.stringify({ prompt: currentQuery }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);
      if (res.ok) {
        const data = await res.json();
        setChatHistory(h => [
          ...h,
          { role: "assistant", content: data.answer },
        ]);
      } else {
        const errorData = await res.json().catch(() => ({ detail: "Engine is processing... please wait." }));
        setChatHistory(h => [
          ...h,
          { role: "assistant", content: `⚠️ **Error:** ${errorData.detail || "The server encountered an error."}` },
        ]);
      }
    } catch (e: any) {
      console.error("Query Error:", e);
      const isTimeout = e.name === 'AbortError';
      setChatHistory(h => [
        ...h,
        { role: "assistant", content: isTimeout 
          ? "⏳ **Query Timeout:** The engine is taking too long to answer. It might be waking up or processing a large amount of data."
          : `❌ **System Error:** Failed to connect to engine at \`${backendUrl}\`.` 
        },
      ]);
      checkBackend(); 
    } finally {
      setLoading(false);
    }
  };

  const handleAnalyze = async () => {
    if (materials.length === 0) {
      setError("Please upload materials to analyze.");
      return;
    }
    
    if (loading) return;
    setLoading(true);
    setError(""); // Clear previous errors
    setActiveTab("research");

    try {
      console.log("Starting Deep Analysis...");
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 120000); 

      const res = await fetch(`${backendUrl}/analyze`, {
        method: "POST",
        headers: { 
          "X-Session-ID": sessionId,
          "Accept": "application/json"
        },
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (res.ok) {
        const data = await res.json();
        setChatHistory(h => [
          ...h,
          { 
            role: "assistant", 
            content: data.analysis, 
            learningPath: data.learning_path,
            isAnalysis: true 
          },
        ]);
        fetchConcepts(true);
      } else if (res.status === 504 || res.status === 429) {
        // Handle "Busy" or "Gateway Timeout" gracefully
        setError("Analysis engine is warming up. Please wait 10 seconds and try again.");
      } else {
        const errorData = await res.json().catch(() => ({ detail: "Analysis engine is busy or timed out." }));
        setError(errorData.detail || "Analysis failed.");
      }
    } catch (err: any) {
      console.error("Analysis Error:", err);
      if (err.name === 'AbortError') {
        setError("Analysis timed out. Try analyzing fewer documents (e.g., 2-3) to stay within limits.");
      } else {
        setError("Connection lost. Please check if the backend is live.");
      }
      checkBackend(); 
    } finally {
      setLoading(false);
    }
  };

  const handleStartQuiz = async () => {
    setQuizLoading(true);
    setQuizStarted(false);
    setQuizFinished(false);
    setCurrentQuestionIdx(0);
    setQuizScore(0);
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 120000);

      const res = await fetch(`${backendUrl}/quiz`, {
        method: "POST",
        headers: { "X-Session-ID": sessionId },
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      if (res.ok) {
        const data = await res.json();
        setQuizQuestions(data.questions || []);
        setQuizStarted(true);
      } else {
        setError("Failed to generate quiz. Try again.");
      }
    } catch {
      setError("Connection error during quiz generation.");
    } finally {
      setQuizLoading(false);
    }
  };

  const handleAnswer = (idx: number) => {
    if (idx === quizQuestions[currentQuestionIdx].correct_answer) {
      setQuizScore(s => s + 1);
    }
    if (currentQuestionIdx < quizQuestions.length - 1) {
      setCurrentQuestionIdx(i => i + 1);
    } else {
      setQuizFinished(true);
    }
  };

  const handleStartStudy = async () => {
    if (materials.length === 0) {
      setError("Please upload materials to generate flashcards.");
      return;
    }
    setStudyLoading(true);
    setFlashcards([]);
    setCurrentCardIdx(0);
    setIsFlipped(false);
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 120000);

      const res = await fetch(`${backendUrl}/study`, {
        method: "POST",
        headers: { "X-Session-ID": sessionId },
        signal: controller.signal
      });

      clearTimeout(timeoutId);
      if (res.ok) {
        const data = await res.json();
        setFlashcards(data.flashcards || []);
      } else {
        setError("Failed to generate flashcards.");
      }
    } catch {
      setError("Connection error during study generation.");
    } finally {
      setStudyLoading(false);
    }
  };

  /* ================= UI ================= */

  return (
    <div className={`min-h-screen flex flex-col font-sans transition-colors duration-500 ${isDark ? "bg-[#020617] text-slate-200" : "bg-slate-50 text-slate-900"}`}>
      <header className="px-8 py-4 flex items-center justify-between border-b border-slate-900/30 backdrop-blur-md sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center shadow-lg shadow-blue-600/10">
            <span className="text-white font-black text-xs">S</span>
          </div>
          <h1 className="text-[10px] font-black uppercase tracking-[0.3em] opacity-70">ScholarSync <span className="text-blue-500">v1.1</span></h1>
        </div>
        
        <div className="flex items-center gap-4">
          <button 
            onClick={() => checkBackend()}
            className="flex items-center gap-2 px-3 py-1.5 bg-slate-900/30 rounded-full border border-slate-800/50 hover:border-blue-500/30 transition-colors group"
          >
            <div className={`w-1.5 h-1.5 rounded-full ${backendStatus === 'online' ? 'bg-emerald-500 animate-pulse' : backendStatus === 'checking' ? 'bg-amber-500 animate-bounce' : 'bg-rose-500'}`} />
            <span className="text-[8px] font-black uppercase tracking-[0.2em] opacity-40 group-hover:opacity-100">{backendStatus === 'online' ? 'Engine Live' : backendStatus === 'checking' ? 'Waking up...' : 'Reconnect'}</span>
          </button>
          <button onClick={() => setIsDark(!isDark)} className="p-1.5 hover:bg-slate-800 rounded-lg transition-colors text-xs">{isDark ? "🌙" : "☀️"}</button>
        </div>
      </header>

      <main className="flex-1 grid grid-cols-12 gap-6 p-6 overflow-hidden">
        {/* Sidebar */}
        <aside className="col-span-3 flex flex-col gap-4 overflow-y-auto custom-scrollbar pr-2">
          <div className={`flex-1 flex flex-col gap-6 p-6 rounded-[2.5rem] backdrop-blur-xl ${isDark ? "bg-slate-900/40 border border-slate-800" : "bg-white shadow-xl shadow-slate-200/50"}`}>
            <section>
              <h2 className="text-[10px] font-black uppercase tracking-[0.3em] mb-6 opacity-30">Vault</h2>
              <form onSubmit={handleUpload} className="relative isolate space-y-4">
                <div className="relative border-2 border-dashed border-slate-800 rounded-3xl p-8 text-center hover:border-blue-500 transition-colors cursor-pointer group">
                  <input 
                    type="file" 
                    multiple 
                    accept=".pdf" 
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFiles(Array.from(e.target.files || []))} 
                    className="absolute inset-0 opacity-0 cursor-pointer z-[5]" 
                  />
                  <div className="text-2xl mb-2 group-hover:scale-110 transition-transform">☁️</div>
                  <div className="text-[10px] font-bold opacity-40 uppercase tracking-wider">{files.length > 0 ? `${files.length} Selected` : 'Drop PDFs'}</div>
                </div>
                <button 
                  type="submit"
                  disabled={files.length === 0 || uploading} 
                  className="relative z-[50] w-full py-4 bg-blue-600 rounded-2xl font-black text-[10px] uppercase tracking-[0.3em] hover:bg-blue-700 disabled:opacity-50 transition-all shadow-2xl shadow-blue-600/20 active:scale-95"
                >
                  {uploading ? "Processing..." : "Sync"}
                </button>
              </form>
            </section>

            <section className="flex-1 flex flex-col min-h-0">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-[10px] font-black uppercase tracking-[0.3em] opacity-30">Library</h2>
                <button onClick={clearMaterials} className="text-rose-500 hover:scale-110 transition-transform">🗑️</button>
              </div>
              <div className="space-y-2 overflow-y-auto custom-scrollbar pr-2">
                {materials.map((m, i) => (
                  <div key={i} className="flex items-center justify-between p-3 bg-slate-950/50 rounded-2xl border border-slate-900 group">
                    <span className="text-[10px] font-bold truncate pr-2">{m.filename}</span>
                    <button onClick={() => deleteMaterial(m.filename)} className="opacity-0 group-hover:opacity-100 transition-opacity text-rose-500">×</button>
                  </div>
                ))}
                {materials.length === 0 && <div className="text-[10px] opacity-20 text-center py-4 uppercase tracking-widest">Empty</div>}
              </div>
            </section>
          </div>
        </aside>

        {/* Main Content */}
        <div className="col-span-9 flex flex-col gap-4 overflow-hidden relative">
          <div className={`flex-1 rounded-[2.5rem] overflow-hidden ${isDark ? "bg-slate-900/10 border border-slate-900/50" : "bg-white shadow-2xl shadow-slate-200/50"}`}>
            {activeTab === 'research' ? (
              <div className="h-full flex flex-col p-8">
                <div className="flex-1 overflow-y-auto custom-scrollbar space-y-8 pr-4 mb-6">
                  {chatHistory.length === 0 && (
                    <div className="h-full flex flex-col items-center justify-center opacity-20 gap-4">
                      <div className="text-4xl">✨</div>
                      <p className="text-[10px] font-black uppercase tracking-[0.3em]">Start your research journey</p>
                    </div>
                  )}
                  {chatHistory.map((msg, i) => (
                    <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[80%] p-6 rounded-[2rem] ${msg.role === 'user' ? 'bg-blue-600 text-white' : isDark ? 'bg-slate-900 border border-slate-800' : 'bg-slate-50'}`}>
                        <div className="text-sm leading-relaxed prose prose-invert max-w-none">
                          <ReactMarkdown 
                            remarkPlugins={[remarkMath as any]} 
                            rehypePlugins={[rehypeKatex as any]}
                          >
                            {String(msg.content || "")}
                          </ReactMarkdown>
                        </div>
                        {msg.learningPath && (
                          <div className="mt-6 p-4 bg-blue-500/10 border border-blue-500/20 rounded-2xl">
                            <h4 className="text-[10px] font-black uppercase tracking-widest text-blue-400 mb-3">Learning Path</h4>
                            <ul className="space-y-2">
                              {msg.learningPath.map((item: string, idx: number) => (
                                <li key={idx} className="text-xs flex gap-2"><span className="text-blue-500">→</span> {item}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                  {loading && <div className="animate-pulse flex gap-2"><div className="w-2 h-2 bg-blue-600 rounded-full" /><div className="w-2 h-2 bg-blue-600 rounded-full" /><div className="w-2 h-2 bg-blue-600 rounded-full" /></div>}
                </div>
                <form onSubmit={handleQuery} className="relative mt-auto pt-4">
                  <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Ask anything about your materials..." className="w-full py-4 px-6 bg-slate-950/30 border border-slate-800/50 rounded-2xl text-xs focus:outline-none focus:border-blue-500/50 transition-all" />
                  <button type="submit" className="absolute right-3 top-1/2 -translate-y-1/2 w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center shadow-lg shadow-blue-600/20 hover:bg-blue-700 transition-all">🏹</button>
                </form>
              </div>
            ) : activeTab === 'analysis' ? (
              <div className="h-full flex flex-col p-8 bg-[#020617] relative overflow-hidden">
                {/* Background Tech Grid Effect */}
                <div className="absolute inset-0 opacity-[0.03] pointer-events-none" 
                     style={{ backgroundImage: 'radial-gradient(#3b82f6 1px, transparent 1px)', backgroundSize: '30px 30px' }}></div>
                
                <div className="flex-1 overflow-y-auto custom-scrollbar space-y-6 relative z-10">
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {concepts.map((concept, i) => (
                      <div key={i} className="group relative">
                        {/* Node Connection Line (Visual Only) */}
                        <div className="absolute -left-3 top-1/2 w-3 h-[2px] bg-blue-500/20 group-hover:bg-blue-500/50 transition-colors"></div>
                        
                        <div className="p-6 bg-slate-900/40 border border-slate-800/50 rounded-2xl hover:border-blue-500/50 transition-all duration-500 hover:shadow-[0_0_30px_rgba(59,130,246,0.1)] hover:-translate-y-1 relative overflow-hidden backdrop-blur-sm">
                          {/* Glow Effect */}
                          <div className="absolute -right-8 -top-8 w-24 h-24 bg-blue-600/5 rounded-full blur-2xl group-hover:bg-blue-600/10 transition-all"></div>
                          
                          <div className="flex justify-between items-start mb-4">
                            <div className="space-y-1">
                              <h3 className="text-sm font-black text-blue-400 tracking-wider uppercase group-hover:text-blue-300 transition-colors">
                                {concept.term}
                              </h3>
                              <div className="flex gap-1">
                                {[...Array(5)].map((_, idx) => (
                                  <div key={idx} className={`w-3 h-1 rounded-full ${idx < Math.ceil(concept.importance/2) ? 'bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.5)]' : 'bg-slate-800'}`}></div>
                                ))}
                              </div>
                            </div>
                            <span className="text-[9px] font-black px-2 py-1 rounded-md bg-blue-500/10 text-blue-400 border border-blue-500/20 uppercase tracking-tighter">
                              Level {concept.importance}
                            </span>
                          </div>
                          
                          <p className="text-[11px] leading-relaxed text-slate-400 group-hover:text-slate-300 transition-colors font-medium">
                            {concept.definition}
                          </p>

                          {/* Tech Decorative Corner */}
                          <div className="absolute bottom-2 right-2 w-4 h-4 border-r-2 border-b-2 border-slate-800 group-hover:border-blue-500/30 transition-colors rounded-br-sm"></div>
                        </div>
                      </div>
                    ))}
                  </div>
                  
                  {concepts.length === 0 && (
                    <div className="h-full flex items-center justify-center flex-col gap-6 py-20">
                      <div className="relative">
                        <div className="absolute inset-0 bg-blue-500/20 blur-3xl rounded-full"></div>
                        <div className="text-6xl relative animate-pulse">🕸️</div>
                      </div>
                      <div className="space-y-2 text-center">
                        <p className="text-[10px] font-black uppercase tracking-[0.4em] text-blue-500/60">Neural Map Offline</p>
                        <p className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">Click 'Deep Analysis' to initialize tech-tree</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ) : activeTab === 'quiz' ? (
              <div className="h-full flex flex-col p-8 bg-[#020617] relative overflow-hidden">
                <div className="absolute inset-0 opacity-[0.03] pointer-events-none" 
                     style={{ backgroundImage: 'radial-gradient(#3b82f6 1px, transparent 1px)', backgroundSize: '30px 30px' }}></div>
                
                <div className="flex-1 flex flex-col items-center justify-center relative z-10 max-w-2xl mx-auto w-full">
                  {!quizStarted && !quizFinished ? (
                    <div className="text-center space-y-8">
                      <div className="relative inline-block">
                        <div className="absolute inset-0 bg-blue-500/20 blur-3xl rounded-full"></div>
                        <div className="text-7xl relative">📝</div>
                      </div>
                      <div className="space-y-4">
                        <h2 className="text-xl font-black uppercase tracking-[0.4em] text-blue-500">Knowledge Assessment</h2>
                        <p className="text-[11px] font-bold text-slate-500 uppercase tracking-widest max-w-xs mx-auto leading-relaxed">
                          Generate a dynamic quiz based on your uploaded library to test your technical mastery.
                        </p>
                      </div>
                      <button 
                        onClick={handleStartQuiz}
                        disabled={quizLoading || materials.length === 0}
                        className="px-12 py-4 bg-blue-600 rounded-2xl text-[10px] font-black uppercase tracking-[0.3em] hover:bg-blue-700 transition-all shadow-2xl shadow-blue-600/20 active:scale-95 disabled:opacity-50"
                      >
                        {quizLoading ? "Calibrating Questions..." : "Initialize Quiz"}
                      </button>
                    </div>
                  ) : quizStarted && !quizFinished ? (
                    <div className="w-full space-y-8">
                      <div className="flex justify-between items-end">
                        <div className="space-y-1">
                          <span className="text-[9px] font-black text-blue-500 uppercase tracking-widest">Question {currentQuestionIdx + 1} of {quizQuestions.length}</span>
                          <div className="flex gap-1">
                            {quizQuestions.map((_, i) => (
                              <div key={i} className={`w-8 h-1 rounded-full ${i === currentQuestionIdx ? 'bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.5)]' : i < currentQuestionIdx ? 'bg-emerald-500/50' : 'bg-slate-800'}`}></div>
                            ))}
                          </div>
                        </div>
                        <span className="text-[9px] font-black text-slate-500 uppercase tracking-widest">Score: {quizScore}</span>
                      </div>

                      <div className="p-8 bg-slate-900/40 border border-slate-800 rounded-3xl backdrop-blur-sm">
                        <h3 className="text-lg font-bold text-slate-200 mb-8 leading-relaxed">
                          {quizQuestions[currentQuestionIdx].question}
                        </h3>
                        <div className="grid gap-4">
                          {quizQuestions[currentQuestionIdx].options.map((opt: string, i: number) => (
                            <button 
                              key={i}
                              onClick={() => handleAnswer(i)}
                              className="w-full p-4 bg-slate-950/50 border border-slate-800 rounded-2xl text-left text-xs font-bold hover:border-blue-500 hover:bg-blue-500/5 transition-all group flex items-center gap-4"
                            >
                              <span className="w-8 h-8 rounded-lg bg-slate-900 flex items-center justify-center text-[10px] text-slate-500 group-hover:text-blue-500 border border-slate-800 group-hover:border-blue-500/30">{String.fromCharCode(65 + i)}</span>
                              {opt}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="text-center space-y-8">
                      <div className="relative inline-block">
                        <div className="absolute inset-0 bg-emerald-500/20 blur-3xl rounded-full"></div>
                        <div className="text-7xl relative">🏆</div>
                      </div>
                      <div className="space-y-4">
                        <h2 className="text-xl font-black uppercase tracking-[0.4em] text-emerald-500">Assessment Complete</h2>
                        <div className="flex justify-center gap-4">
                          <div className="p-4 bg-slate-900/40 border border-slate-800 rounded-2xl">
                            <div className="text-2xl font-black text-slate-200">{quizScore}/{quizQuestions.length}</div>
                            <div className="text-[8px] font-black uppercase tracking-widest text-slate-500">Total Score</div>
                          </div>
                          <div className="p-4 bg-slate-900/40 border border-slate-800 rounded-2xl">
                            <div className="text-2xl font-black text-slate-200">{Math.round((quizScore/quizQuestions.length)*100)}%</div>
                            <div className="text-[8px] font-black uppercase tracking-widest text-slate-500">Mastery Rate</div>
                          </div>
                        </div>
                      </div>
                      <button 
                        onClick={handleStartQuiz}
                        className="px-12 py-4 bg-slate-900 border border-slate-800 rounded-2xl text-[10px] font-black uppercase tracking-[0.3em] hover:border-blue-500 transition-all active:scale-95"
                      >
                        Retake Assessment
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ) : activeTab === 'study' ? (
              <div className="h-full flex flex-col p-8 bg-[#020617] relative overflow-hidden">
                <div className="absolute inset-0 opacity-[0.03] pointer-events-none" 
                     style={{ backgroundImage: 'radial-gradient(#3b82f6 1px, transparent 1px)', backgroundSize: '30px 30px' }}></div>
                
                <div className="flex-1 flex flex-col items-center justify-center relative z-10 max-w-2xl mx-auto w-full">
                  {flashcards.length === 0 ? (
                    <div className="text-center space-y-8">
                      <div className="relative inline-block">
                        <div className="absolute inset-0 bg-blue-500/20 blur-3xl rounded-full"></div>
                        <div className="text-7xl relative">🃏</div>
                      </div>
                      <div className="space-y-4">
                        <h2 className="text-xl font-black uppercase tracking-[0.4em] text-blue-500">Flashcard Engine</h2>
                        <p className="text-[11px] font-bold text-slate-500 uppercase tracking-widest max-w-xs mx-auto leading-relaxed">
                          Generate interactive 3D flashcards to master complex concepts through active recall.
                        </p>
                      </div>
                      <button 
                        onClick={handleStartStudy}
                        disabled={studyLoading || materials.length === 0}
                        className="px-12 py-4 bg-blue-600 rounded-2xl text-[10px] font-black uppercase tracking-[0.3em] hover:bg-blue-700 transition-all shadow-2xl shadow-blue-600/20 active:scale-95 disabled:opacity-50"
                      >
                        {studyLoading ? "Forging Cards..." : "Initialize Study Session"}
                      </button>
                    </div>
                  ) : (
                    <div className="w-full space-y-12">
                      <div className="flex justify-between items-center">
                        <div className="space-y-1">
                          <span className="text-[9px] font-black text-blue-500 uppercase tracking-widest">Card {currentCardIdx + 1} of {flashcards.length}</span>
                          <div className="flex gap-1">
                            {flashcards.map((_, i) => (
                              <div key={i} className={`w-6 h-1 rounded-full ${i === currentCardIdx ? 'bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.5)]' : i < currentCardIdx ? 'bg-emerald-500/50' : 'bg-slate-800'}`}></div>
                            ))}
                          </div>
                        </div>
                        <button onClick={() => setFlashcards([])} className="text-[9px] font-black text-slate-500 uppercase tracking-widest hover:text-rose-500 transition-colors">Reset</button>
                      </div>

                      <div className="perspective-1000 w-full h-[400px]">
                        <div 
                          className={`flashcard-inner relative w-full h-full cursor-pointer ${isFlipped ? 'flashcard-flipped' : ''}`}
                          onClick={() => setIsFlipped(!isFlipped)}
                        >
                          {/* Front */}
                          <div className={`flashcard-front absolute inset-0 bg-slate-900/40 border border-slate-800 rounded-[3rem] p-12 flex flex-col items-center justify-center text-center backdrop-blur-sm backface-hidden`}>
                            <span className="text-[10px] font-black text-blue-500 uppercase tracking-[0.4em] mb-8">Question</span>
                            <h3 className="text-2xl font-bold text-slate-200 leading-relaxed">{flashcards[currentCardIdx].front}</h3>
                            <div className="mt-12 text-[9px] font-bold text-slate-500 uppercase tracking-[0.2em] animate-pulse">Click to Reveal</div>
                          </div>

                          {/* Back */}
                          <div className={`flashcard-back absolute inset-0 bg-blue-600 border border-blue-500 rounded-[3rem] p-12 flex flex-col items-center justify-center text-center backface-hidden`}>
                            <span className="text-[10px] font-black text-blue-100 uppercase tracking-[0.4em] mb-8">Answer</span>
                            <p className="text-xl font-bold text-white leading-relaxed">{flashcards[currentCardIdx].back}</p>
                            <div className="mt-12 text-[9px] font-bold text-blue-200 uppercase tracking-[0.2em]">Click to flip back</div>
                          </div>
                        </div>
                      </div>

                      <div className="flex justify-center gap-6">
                        <button 
                          disabled={currentCardIdx === 0}
                          onClick={() => { setCurrentCardIdx(i => i - 1); setIsFlipped(false); }}
                          className="px-8 py-4 bg-slate-900 border border-slate-800 rounded-2xl text-[10px] font-black uppercase tracking-[0.3em] hover:border-blue-500 transition-all disabled:opacity-20"
                        >
                          Previous
                        </button>
                        <button 
                          disabled={currentCardIdx === flashcards.length - 1}
                          onClick={() => { setCurrentCardIdx(i => i + 1); setIsFlipped(false); }}
                          className="px-8 py-4 bg-slate-900 border border-slate-800 rounded-2xl text-[10px] font-black uppercase tracking-[0.3em] hover:border-blue-500 transition-all disabled:opacity-20"
                        >
                          Next Card
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="h-full flex items-center justify-center p-8 text-center opacity-40 flex-col gap-6">
                <div className="text-6xl">✨</div>
                <h3 className="text-sm font-black uppercase tracking-[0.4em]">Initialize Analysis</h3>
                <p className="text-[10px] font-bold max-w-xs leading-relaxed opacity-50">Upload documents and run 'Deep Analysis' to populate the knowledge graph.</p>
              </div>
            )}
          </div>
        </div>
      </main>

      <footer className="px-8 py-8 flex flex-col items-center gap-6">
        {/* MacOS Action Dock */}
        <div className="bg-slate-900/80 backdrop-blur-2xl border border-slate-800 p-2 rounded-[2.5rem] flex items-center gap-2 shadow-2xl">
          <button 
            onClick={() => setActiveTab('research')} 
            className={`px-8 py-4 rounded-[2rem] text-[10px] font-black uppercase tracking-[0.2em] transition-all flex items-center gap-3 ${activeTab === 'research' ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20' : 'hover:bg-slate-800 text-slate-400'}`}
          >
            <span>🔍</span> Research
          </button>
          <button 
            onClick={() => setActiveTab('analysis')} 
            className={`px-8 py-4 rounded-[2rem] text-[10px] font-black uppercase tracking-[0.2em] transition-all flex items-center gap-3 ${activeTab === 'analysis' ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20' : 'hover:bg-slate-800 text-slate-400'}`}
          >
            <span>🕸️</span> Graph
          </button>
          
          <div className="w-[1px] h-8 bg-slate-800 mx-2" />
          
          <button 
            onClick={() => setActiveTab('quiz')} 
            className={`px-8 py-4 rounded-[2rem] text-[10px] font-black uppercase tracking-[0.2em] transition-all flex items-center gap-3 ${activeTab === 'quiz' ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20' : 'hover:bg-slate-800 text-slate-400'}`}
          >
            <span>📝</span> Quiz
          </button>
          <button 
            onClick={() => setActiveTab('study')} 
            className={`px-8 py-4 rounded-[2rem] text-[10px] font-black uppercase tracking-[0.2em] transition-all flex items-center gap-3 ${activeTab === 'study' ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20' : 'hover:bg-slate-800 text-slate-400'}`}
          >
            <span>🃏</span> Study
          </button>

          <div className="w-[1px] h-8 bg-slate-800 mx-2" />

          <button 
            onClick={handleAnalyze} 
            disabled={loading || materials.length === 0}
            className="px-8 py-4 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 rounded-[2rem] text-[10px] font-black uppercase tracking-[0.2em] text-white transition-all flex items-center gap-3 shadow-lg shadow-indigo-600/20"
          >
            <span>✨</span> {loading ? 'Analyzing...' : 'Deep Analysis'}
          </button>
          
          {error && (
            <div className="flex items-center gap-3 ml-4 pr-4 border-l border-slate-800 pl-4">
              <span className="text-[10px] font-bold text-rose-500 animate-pulse">{error}</span>
              <button 
                onClick={() => checkBackend()} 
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 rounded-xl text-[9px] font-black uppercase tracking-widest text-slate-300 transition-all"
              >
                Retry
              </button>
            </div>
          )}
        </div>

        <p className="text-[10px] font-bold uppercase tracking-widest opacity-30">ScholarSync AI &copy; 2025 &bull; Research with Confidence</p>
      </footer>

      <style jsx global>{`
        .flashcard-inner {
          transform-style: preserve-3d;
          transition: transform 0.7s cubic-bezier(0.4, 0, 0.2, 1);
        }
        .flashcard-back {
          transform: rotateY(180deg);
        }
        .flashcard-flipped .flashcard-inner {
          transform: rotateY(180deg);
        }
      `}</style>
    </div>
  );
}
