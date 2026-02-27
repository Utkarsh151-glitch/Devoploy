'use client';

import { useState } from 'react';
import { Rocket, Github, Cloud, Terminal, CheckCircle2, Lock, ArrowRight } from 'lucide-react';
import { motion } from 'framer-motion';

type CloudProvider = 'Vercel' | 'AWS' | 'Heroku';

export default function Launchpad() {
  const [repoUrl, setRepoUrl] = useState('');
  const [provider, setProvider] = useState<CloudProvider>('Vercel');
  const [loading, setLoading] = useState(false);
  const [logs, setLogs] = useState<{ id: string, message: string, type: string }[]>([]);

  const handleDeploy = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!repoUrl) return;

    setLoading(true);
    setLogs([{ id: crypto.randomUUID(), message: 'Submitting deployment request...', type: 'INFO' }]);

    try {
      const response = await fetch('/api/deploy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoUrl, targetCloud: provider }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || 'Failed to create deployment');
      }

      setLogs(prev => [
        ...prev,
        {
          id: crypto.randomUUID(),
          message: `Queued deployment ${data.deploymentId}. Worker will process it shortly.`,
          type: 'SUCCESS',
        },
      ]);
    } catch (error) {
      setLogs(prev => [
        ...prev,
        {
          id: crypto.randomUUID(),
          message: error instanceof Error ? error.message : 'Unknown deployment error',
          type: 'ERROR',
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-black text-white selection:bg-[#814AC8]/30 font-sans relative overflow-x-hidden">

      {/* Navbar Match */}
      <nav className="fixed top-0 w-full z-50 bg-black/50 backdrop-blur-md border-b border-white/5 px-6 lg:px-12 py-4 flex items-center justify-between">
        <div className="flex items-center space-x-2 font-bold tracking-widest text-lg">
          <Rocket className="w-5 h-5 text-[#814AC8]" />
          <span>DEVOPLOY</span>
        </div>
        <div className="hidden md:flex items-center space-x-8 text-sm text-white/60 font-medium">
          <a href="#" className="hover:text-white transition-colors">Platform</a>
          <a href="#" className="hover:text-white transition-colors">Documentation</a>
          <a href="#" className="hover:text-white transition-colors">Pricing</a>
        </div>
        <button className="px-5 py-2.5 rounded-lg bg-[#814AC8] text-white text-sm font-semibold hover:bg-[#6c3ea8] transition-colors shadow-[0_0_20px_rgba(129,74,200,0.3)]">
          Sign In
        </button>
      </nav>

      {/* Atmospheric Background Glows (Framer style) */}
      <div className="fixed inset-0 z-0 pointer-events-none">
        <div className="absolute top-[-10%] right-[-10%] w-[50vw] h-[50vw] rounded-full bg-[#814AC8]/10 blur-[130px] mix-blend-screen" />
        <div className="absolute bottom-[-20%] left-[-10%] w-[60vw] h-[60vw] rounded-full bg-[#814AC8]/5 blur-[150px] mix-blend-screen" />
      </div>

      <main className="relative z-10 max-w-7xl mx-auto px-6 py-32 lg:py-48 grid grid-cols-1 lg:grid-cols-12 gap-16 items-start">

        {/* Left Column: Form & Hero */}
        <div className="lg:col-span-5 space-y-12">

          <div className="space-y-6">
            {/* Pill Badge */}
            <div className="inline-flex items-center space-x-2 bg-white/5 border border-white/10 px-4 py-1.5 rounded-full text-xs font-medium text-white/80">
              <span className="w-2 h-2 rounded-full bg-[#814AC8] animate-pulse" />
              <span>Devoploy Engine v1.0</span>
            </div>

            <h1 className="text-5xl lg:text-7xl font-bold tracking-tight text-white leading-[1.1]">
              Ship Without <br /><span className="text-white/40">Containers.</span>
            </h1>
            <p className="text-lg text-white/60 leading-relaxed max-w-md">
              We clone your repository, analyze the stack, and refactor it in real-time to natively support your favorite cloud provider. Zero Dockerfiles Required.
            </p>
          </div>

          <form onSubmit={handleDeploy} className="space-y-6">

            {/* Repo Input */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-white/80">GitHub Repository URL</label>
              <div className="relative group">
                <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none text-white/40 group-focus-within:text-[#814AC8] transition-colors">
                  <Github className="w-4 h-4" />
                </div>
                <input
                  type="url"
                  placeholder="https://github.com/username/repo"
                  value={repoUrl}
                  onChange={(e) => setRepoUrl(e.target.value)}
                  required
                  className="w-full bg-white/[0.03] border border-white/10 rounded-xl pl-11 pr-4 py-4 text-white placeholder:text-white/30 focus:outline-none focus:border-[#814AC8]/50 focus:bg-[#814AC8]/[0.02] transition-all font-mono text-sm shadow-[inset_0_1px_1px_rgba(255,255,255,0.05)]"
                />
              </div>
            </div>

            {/* Cloud Selector */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-white/80">Target Cloud Environment</label>
              <div className="grid grid-cols-3 gap-3">
                {['Vercel', 'AWS', 'Heroku'].map((cloud) => (
                  <button
                    key={cloud}
                    type="button"
                    onClick={() => setProvider(cloud as CloudProvider)}
                    className={`px-4 py-3.5 rounded-xl border text-sm font-medium transition-all flex items-center justify-center space-x-2
                      ${provider === cloud
                        ? 'bg-[#814AC8]/10 border-[#814AC8]/50 text-white shadow-[0_0_15px_rgba(129,74,200,0.15)]'
                        : 'bg-white/[0.02] border-white/10 text-white/50 hover:bg-white/5 hover:text-white/80'}`}
                  >
                    {cloud === 'AWS' && <Cloud className="w-4 h-4 mr-1 opacity-70" />}
                    {cloud}
                  </button>
                ))}
              </div>
            </div>

            <button
              type="submit"
              disabled={loading || !repoUrl}
              className="w-full mt-4 bg-[#814AC8] text-white font-semibold py-4 rounded-xl hover:bg-[#6c3ea8] transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center space-x-2 shadow-[0_4px_14px_0_rgba(129,74,200,0.39)] hover:shadow-[0_6px_20px_rgba(129,74,200,0.23)] hover:-translate-y-0.5"
            >
              {loading ? (
                <>
                  <div className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                  <span>Transforming source...</span>
                </>
              ) : (
                <>
                  <span>Initialize Refactoring</span>
                  <ArrowRight className="w-5 h-5" />
                </>
              )}
            </button>
          </form>
        </div>

        {/* Right Column: Terminal Vislualizer */}
        <div className="lg:col-span-7 relative group perspective mt-12 lg:mt-0">

          <div className="relative bg-[#000000] border border-white/10 rounded-2xl overflow-hidden h-[600px] flex flex-col shadow-[0_0_50px_rgba(0,0,0,0.5)]">

            {/* Terminal Header */}
            <div className="bg-white/[0.02] border-b border-white/5 px-4 py-3 flex items-center justify-between">
              <div className="flex space-x-2">
                <div className="w-3 h-3 rounded-full bg-white/20"></div>
                <div className="w-3 h-3 rounded-full bg-white/20"></div>
                <div className="w-3 h-3 rounded-full bg-white/20"></div>
              </div>
              <div className="flex items-center space-x-2 text-xs text-white/40 font-mono">
                <Lock className="w-3 h-3" />
                <span>worker@devoploy-engine</span>
              </div>
              <div className="w-12"></div> {/* Spacer for balance */}
            </div>

            {/* Terminal Body */}
            <div className="p-6 flex-1 font-mono text-sm overflow-y-auto space-y-4">
              {logs.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-white/20 space-y-4">
                  <Terminal className="w-12 h-12" />
                  <p className="font-sans text-white/40">Awaiting deployment instructions...</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {logs.map((log, i) => (
                    <div
                      key={log.id}
                      className={`flex items-start space-x-3 transition-opacity duration-300 ${log.type === 'ERROR' ? 'text-red-400' :
                          log.type === 'SUCCESS' ? 'text-[#814AC8]' :
                            log.type === 'WARN' ? 'text-amber-400/80' : 'text-white/70'
                        }`}
                    >
                      <span className="text-white/30 shrink-0 select-none">[{new Date().toLocaleTimeString()}]</span>
                      <span className="flex-1 leading-relaxed">
                        {log.type === 'SUCCESS' && <CheckCircle2 className="w-4 h-4 inline mr-2 align-text-bottom" />}
                        {log.message}
                      </span>
                    </div>
                  ))}
                  {loading && (
                    <div className="flex items-center space-x-3 text-white/40 animate-pulse mt-4">
                      <span className="select-none">[{new Date().toLocaleTimeString()}]</span>
                      <span className="w-2 h-4 bg-white/40 animate-pulse"></span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

      </main>
    </div>
  );
}
