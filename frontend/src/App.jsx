import React, { useState, useEffect } from 'react';
import axios from 'axios';
import ReactECharts from 'echarts-for-react';
import { 
  Users, PhoneCall, Mail, MessageSquare, Check, X, 
  Settings, BarChart3, RotateCw, Play, Search, Sun, Moon, 
  ArrowUpRight, AlertTriangle, FileText, ChevronRight, XCircle, Plus, Sparkles, Volume2
} from 'lucide-react';
import { format, parseISO } from 'date-fns';

const API_BASE = window.location.origin.includes('localhost') ? 'http://localhost:8000/api' : '/api';

export default function App() {
  const [activeTab, setActiveTab] = useState('leads'); // leads, logs, settings, analytics
  const [leads, setLeads] = useState([]);
  const [logs, setLogs] = useState([]);
  const [analytics, setAnalytics] = useState(null);
  const [settings, setSettings] = useState({});
  const [selectedLead, setSelectedLead] = useState(null);
  const [isDark, setIsDark] = useState(true);
  
  // Search & Filter
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sourceFilter, setSourceFilter] = useState('all');

  // Loading states
  const [loading, setLoading] = useState(false);
  const [scraping, setScraping] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  
  // New Lead Modal state
  const [showAddModal, setShowAddModal] = useState(false);
  const [newLead, setNewLead] = useState({
    name: '', email: '', phone: '', company: '', title: '', source: 'Manual Entry'
  });

  // Fetch initial data
  useEffect(() => {
    fetchLeads();
    fetchLogs();
    fetchAnalytics();
    fetchSettings();
  }, []);

  // Sync theme
  useEffect(() => {
    if (isDark) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isDark]);

  // Set up polling for active calls or logs in simulation
  useEffect(() => {
    const interval = setInterval(() => {
      fetchLeads(false);
      fetchLogs(false);
      fetchAnalytics(false);
    }, 4000);
    return () => clearInterval(interval);
  }, []);

  const fetchLeads = async (showProgress = true) => {
    try {
      if (showProgress) setLoading(true);
      const res = await axios.get(`${API_BASE}/leads`, {
        params: { status: statusFilter, search, source: sourceFilter }
      });
      setLeads(res.data);
      // Keep selected lead state fresh
      if (selectedLead) {
        const updated = res.data.find(l => l.id === selectedLead.id);
        if (updated) setSelectedLead(updated);
      }
    } catch (err) {
      console.error("Error fetching leads:", err);
    } finally {
      if (showProgress) setLoading(false);
    }
  };

  const fetchLogs = async (showProgress = true) => {
    try {
      const res = await axios.get(`${API_BASE}/logs`);
      setLogs(res.data);
    } catch (err) {
      console.error("Error fetching logs:", err);
    }
  };

  const fetchAnalytics = async (showProgress = true) => {
    try {
      const res = await axios.get(`${API_BASE}/analytics`);
      setAnalytics(res.data);
    } catch (err) {
      console.error("Error fetching analytics:", err);
    }
  };

  const fetchSettings = async () => {
    try {
      const res = await axios.get(`${API_BASE}/settings`);
      setSettings(res.data);
    } catch (err) {
      console.error("Error fetching settings:", err);
    }
  };

  const triggerScraper = async () => {
    try {
      setScraping(true);
      await axios.post(`${API_BASE}/leads/scrape`);
      alert("Scraper run started! Fresh prospect leads will populate the table within 5-10 seconds.");
      setTimeout(() => {
        fetchLeads();
        fetchAnalytics();
        fetchLogs();
      }, 3000);
    } catch (err) {
      alert("Failed to start scraper: " + err.message);
    } finally {
      setScraping(false);
    }
  };

  const triggerSync = async () => {
    try {
      setSyncing(true);
      const res = await axios.post(`${API_BASE}/leads/sync`);
      alert(res.data.message || "Google Sheets sync complete!");
      fetchLeads();
      fetchLogs();
    } catch (err) {
      alert("Google Sheets sync failed: " + err.message);
    } finally {
      setSyncing(false);
    }
  };

  const handleStatusChange = async (leadId, action) => {
    try {
      setActionLoading(true);
      await axios.post(`${API_BASE}/leads/action`, {
        lead_ids: [leadId],
        action: action
      });
      fetchLeads();
      fetchLogs();
      fetchAnalytics();
    } catch (err) {
      alert(`Action '${action}' failed: ` + err.message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleAddLead = async (e) => {
    e.preventDefault();
    try {
      await axios.post(`${API_BASE}/leads`, newLead);
      setShowAddModal(false);
      setNewLead({ name: '', email: '', phone: '', company: '', title: '', source: 'Manual Entry' });
      fetchLeads();
      fetchAnalytics();
    } catch (err) {
      alert(err.response?.data?.detail || "Failed to add lead.");
    }
  };

  const handleSaveSettings = async (e) => {
    e.preventDefault();
    try {
      await axios.post(`${API_BASE}/settings`, settings);
      alert("Configurations saved successfully!");
      fetchSettings();
    } catch (err) {
      alert("Failed to save settings: " + err.message);
    }
  };

  // Re-run lead fetches when search or status filters change
  useEffect(() => {
    fetchLeads(false);
  }, [search, statusFilter, sourceFilter]);

  // ECharts Configurations
  const getFunnelChartOption = () => {
    if (!analytics) return {};
    const { scraped, approved, called, converted } = analytics.funnel;
    return {
      backgroundColor: 'transparent',
      tooltip: { trigger: 'item', formatter: '{a} <br/>{b} : {c}' },
      series: [
        {
          name: 'Conversion Funnel',
          type: 'funnel',
          left: '10%',
          top: 10,
          bottom: 10,
          width: '80%',
          min: 0,
          max: scraped || 100,
          minSize: '0%',
          maxSize: '100%',
          sort: 'descending',
          gap: 4,
          label: { show: true, position: 'inside', fontFamily: 'DM Sans', formatter: '{b}: {c}' },
          labelLine: { show: false },
          itemStyle: { borderColor: '#1f2937', borderWidth: 1 },
          data: [
            { value: scraped, name: 'Prospects Scraped', itemStyle: { color: '#3b82f6' } },
            { value: approved, name: 'Leads Approved', itemStyle: { color: '#8b5cf6' } },
            { value: called, name: 'AI Calls Placed', itemStyle: { color: '#eab308' } },
            { value: converted, name: 'Meetings Booked', itemStyle: { color: '#10b981' } }
          ]
        }
      ]
    };
  };

  const getOutcomesChartOption = () => {
    if (!analytics) return {};
    const outcomes = analytics.outcomes;
    const data = Object.keys(outcomes).map(key => {
      let color = '#71717a';
      if (key === 'interested') color = '#10b981';
      if (key === 'voicemail') color = '#f59e0b';
      if (key === 'not_interested') color = '#ef4444';
      
      return {
        name: key.toUpperCase().replace('_', ' '),
        value: outcomes[key],
        itemStyle: { color }
      };
    });
    
    return {
      backgroundColor: 'transparent',
      tooltip: { trigger: 'item' },
      legend: { bottom: '0%', textStyle: { color: isDark ? '#a1a1aa' : '#52525b', fontFamily: 'DM Sans' } },
      series: [
        {
          name: 'Call Outcomes',
          type: 'pie',
          radius: ['40%', '70%'],
          avoidLabelOverlap: false,
          itemStyle: { borderRadius: 8, borderColor: isDark ? '#0c0c0f' : '#ffffff', borderWidth: 2 },
          label: { show: false },
          data: data
        }
      ]
    };
  };

  const getTrendsChartOption = () => {
    if (!analytics || !analytics.trends.length) return {};
    const dates = analytics.trends.map(t => t.date);
    const counts = analytics.trends.map(t => t.count);
    return {
      backgroundColor: 'transparent',
      tooltip: { trigger: 'axis' },
      grid: { left: '3%', right: '4%', bottom: '3%', containLabel: true },
      xAxis: {
        type: 'category',
        data: dates,
        axisLine: { lineStyle: { color: isDark ? '#3f3f46' : '#e4e4e7' } },
        axisLabel: { color: isDark ? '#a1a1aa' : '#71717a', fontFamily: 'DM Sans' }
      },
      yAxis: {
        type: 'value',
        axisLine: { lineStyle: { color: isDark ? '#3f3f46' : '#e4e4e7' } },
        splitLine: { lineStyle: { color: isDark ? '#27272a' : '#f4f4f5' } },
        axisLabel: { color: isDark ? '#a1a1aa' : '#71717a', fontFamily: 'DM Sans' }
      },
      series: [
        {
          name: 'Scraped Leads',
          data: counts,
          type: 'bar',
          barWidth: '40%',
          itemStyle: {
            color: '#3b82f6',
            borderRadius: [4, 4, 0, 0]
          }
        }
      ]
    };
  };

  // Helper status color pill maps
  const getStatusBadge = (status) => {
    const badges = {
      scraped: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-900/40 dark:text-zinc-400 border-zinc-200 dark:border-zinc-800',
      approved: 'bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400 border-blue-100 dark:border-blue-800/30',
      rejected: 'bg-rose-50 text-rose-700 dark:bg-rose-900/20 dark:text-rose-400 border-rose-100 dark:border-rose-800/30',
      contacted: 'bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400 border-amber-100 dark:border-amber-800/30',
      converted: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400 border-emerald-100 dark:border-emerald-800/30',
    };
    return `px-2 py-0.5 rounded text-xs font-semibold border ${badges[status] || ''}`;
  };

  const getCallBadge = (status) => {
    const badges = {
      none: 'text-zinc-400 dark:text-zinc-600',
      pending: 'text-blue-400 animate-pulse font-medium',
      calling: 'text-yellow-500 font-semibold animate-pulse flex items-center gap-1',
      completed: 'text-emerald-500 font-semibold flex items-center gap-1',
      failed: 'text-rose-500 font-semibold flex items-center gap-1',
    };
    return badges[status] || 'text-zinc-500';
  };

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900 dark:bg-[#09090b] dark:text-[#fafafa] flex flex-col font-sans transition-colors duration-300">
      
      {/* 1. Header */}
      <header className="border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#0c0c0f] sticky top-0 z-30">
        <div className="max-w-[1600px] mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-blue-600 flex items-center justify-center text-white font-black text-xl shadow-md shadow-blue-500/20">
              W
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight">Wority AI SDR</h1>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 flex items-center gap-1.5 font-medium">
                <span className="relative flex h-2 w-2">
                  <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${settings.simulation_mode === 'true' ? 'bg-amber-400' : 'bg-emerald-400'}`}></span>
                  <span className={`relative inline-flex rounded-full h-2 w-2 ${settings.simulation_mode === 'true' ? 'bg-amber-500' : 'bg-emerald-500'}`}></span>
                </span>
                {settings.simulation_mode === 'true' ? 'Demo Sandbox Mode' : 'Production Active'}
              </p>
            </div>
          </div>
          
          {/* Tabs */}
          <nav className="flex gap-1 bg-zinc-100 dark:bg-[#09090b] p-1 rounded-lg border border-zinc-200 dark:border-zinc-800">
            <button 
              onClick={() => setActiveTab('leads')}
              className={`px-4 py-2 text-sm font-semibold rounded-md transition-all flex items-center gap-2 ${activeTab === 'leads' ? 'bg-white dark:bg-zinc-800 text-blue-600 dark:text-blue-400 shadow-sm' : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'}`}
            >
              <Users size={16} /> Prospect Review
            </button>
            <button 
              onClick={() => setActiveTab('analytics')}
              className={`px-4 py-2 text-sm font-semibold rounded-md transition-all flex items-center gap-2 ${activeTab === 'analytics' ? 'bg-white dark:bg-zinc-800 text-blue-600 dark:text-blue-400 shadow-sm' : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'}`}
            >
              <BarChart3 size={16} /> Performance Metrics
            </button>
            <button 
              onClick={() => setActiveTab('logs')}
              className={`px-4 py-2 text-sm font-semibold rounded-md transition-all flex items-center gap-2 ${activeTab === 'logs' ? 'bg-white dark:bg-zinc-800 text-blue-600 dark:text-blue-400 shadow-sm' : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'}`}
            >
              <FileText size={16} /> Operations Audit
            </button>
            <button 
              onClick={() => setActiveTab('settings')}
              className={`px-4 py-2 text-sm font-semibold rounded-md transition-all flex items-center gap-2 ${activeTab === 'settings' ? 'bg-white dark:bg-zinc-800 text-blue-600 dark:text-blue-400 shadow-sm' : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'}`}
            >
              <Settings size={16} /> Settings
            </button>
          </nav>

          {/* Theme Toggle & Sync Actions */}
          <div className="flex items-center gap-3">
            <button 
              onClick={async () => {
                try {
                  setSyncing(true);
                  const res = await axios.post(`${API_BASE}/outreach/cron-check`);
                  alert(res.data.message || "Outreach Cron executed!");
                  fetchLeads(false);
                  fetchLogs(false);
                  fetchAnalytics(false);
                } catch (err) {
                  alert("Cron run failed: " + err.message);
                } finally {
                  setSyncing(false);
                }
              }}
              disabled={syncing}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-zinc-700 dark:text-zinc-300 bg-white dark:bg-[#0c0c0f] border border-zinc-200 dark:border-zinc-800 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-50 transition"
            >
              <Sparkles size={14} className={syncing ? 'animate-pulse' : ''} />
              Run Cron Queue
            </button>
            <button 
              onClick={() => triggerSync()}
              disabled={syncing}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-zinc-700 dark:text-zinc-300 bg-white dark:bg-[#0c0c0f] border border-zinc-200 dark:border-zinc-800 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-50 transition"
            >
              <RotateCw size={14} className={syncing ? 'animate-spin' : ''} />
              GSheets Sync
            </button>
            <button 
              onClick={() => triggerScraper()}
              disabled={scraping}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition shadow-sm"
            >
              <Sparkles size={14} className={scraping ? 'animate-pulse' : ''} />
              Scrape Leads
            </button>
            <button 
              onClick={() => setIsDark(!isDark)}
              className="p-2 border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#0c0c0f] hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-400 rounded-lg transition-colors"
            >
              {isDark ? <Sun size={18} /> : <Moon size={18} />}
            </button>
          </div>
        </div>
      </header>

      {/* 2. KPI Cards Row */}
      <section className="bg-zinc-100/50 dark:bg-[#09090b] border-b border-zinc-200 dark:border-zinc-800 py-6">
        <div className="max-w-[1600px] mx-auto px-6 grid grid-cols-1 md:grid-cols-4 gap-6">
          <div className="bg-white dark:bg-[#0c0c0f] p-5 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-sm flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Prospects Scraped</p>
              <p className="text-3xl font-extrabold tracking-tight mt-1">{analytics?.funnel.scraped || 0}</p>
            </div>
            <div className="p-3 bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 rounded-xl">
              <Users size={24} />
            </div>
          </div>
          <div className="bg-white dark:bg-[#0c0c0f] p-5 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-sm flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Approved Queue</p>
              <p className="text-3xl font-extrabold tracking-tight mt-1">{analytics?.funnel.approved || 0}</p>
            </div>
            <div className="p-3 bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400 rounded-xl">
              <Check size={24} />
            </div>
          </div>
          <div className="bg-white dark:bg-[#0c0c0f] p-5 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-sm flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Calls Completed</p>
              <p className="text-3xl font-extrabold tracking-tight mt-1">{analytics?.funnel.called || 0}</p>
            </div>
            <div className="p-3 bg-yellow-50 dark:bg-yellow-900/20 text-yellow-600 dark:text-yellow-400 rounded-xl">
              <PhoneCall size={24} />
            </div>
          </div>
          <div className="bg-white dark:bg-[#0c0c0f] p-5 rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-sm flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">Appointments Booked</p>
              <p className="text-3xl font-extrabold tracking-tight mt-1 text-emerald-600 dark:text-emerald-400">{analytics?.funnel.converted || 0}</p>
            </div>
            <div className="p-3 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 rounded-xl">
              <ArrowUpRight size={24} />
            </div>
          </div>
        </div>
      </section>

      {/* 3. Main Dashboard Body */}
      <main className="flex-1 max-w-[1600px] w-full mx-auto px-6 py-8 flex gap-6">
        
        {/* LEADS TAB */}
        {activeTab === 'leads' && (
          <div className="flex-1 flex gap-6 relative transition-all duration-300">
            {/* Leads Table Container */}
            <div className={`transition-all duration-300 ${selectedLead ? 'w-2/3' : 'w-full'}`}>
              <div className="bg-white dark:bg-[#0c0c0f] border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden shadow-sm flex flex-col h-[700px]">
                
                {/* Table Toolbar */}
                <div className="p-4 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/40 flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3 flex-1 max-w-md">
                    <div className="relative w-full">
                      <Search className="absolute left-3 top-2.5 text-zinc-400" size={16} />
                      <input 
                        type="text" 
                        placeholder="Search leads, companies..." 
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="w-full bg-white dark:bg-[#09090b] border border-zinc-200 dark:border-zinc-800 rounded-lg pl-9 pr-4 py-2 text-sm focus:ring-2 focus:ring-blue-500/50 outline-none"
                      />
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-3">
                    <select 
                      value={statusFilter}
                      onChange={(e) => setStatusFilter(e.target.value)}
                      className="bg-white dark:bg-[#09090b] border border-zinc-200 dark:border-zinc-800 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500/50 outline-none"
                    >
                      <option value="all">All Statuses</option>
                      <option value="scraped">Scraped (New)</option>
                      <option value="approved">Approved (Queue)</option>
                      <option value="rejected">Rejected</option>
                      <option value="contacted">Called / Contacted</option>
                      <option value="converted">Meeting Booked</option>
                    </select>

                    <select 
                      value={sourceFilter}
                      onChange={(e) => setSourceFilter(e.target.value)}
                      className="bg-white dark:bg-[#09090b] border border-zinc-200 dark:border-zinc-800 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500/50 outline-none"
                    >
                      <option value="all">All Sources</option>
                      <option value="LinkedIn">LinkedIn</option>
                      <option value="Clutch Directory">Clutch Directory</option>
                      <option value="Google Maps/YellowPages">Google Maps</option>
                      <option value="Manual Entry">Manual Entry</option>
                    </select>

                    <button 
                      onClick={() => setShowAddModal(true)}
                      className="flex items-center gap-1.5 bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950 px-4 py-2 rounded-lg text-sm font-semibold hover:bg-zinc-800 dark:hover:bg-zinc-200 transition"
                    >
                      <Plus size={16} /> Add Lead
                    </button>
                  </div>
                </div>

                {/* Main Table */}
                <div className="flex-1 overflow-y-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="sticky top-0 bg-zinc-50 dark:bg-zinc-900 text-zinc-500 dark:text-zinc-400 font-semibold border-b border-zinc-200 dark:border-zinc-800 text-xs uppercase tracking-wider z-10">
                        <th className="px-6 py-4">Company</th>
                        <th className="px-6 py-4">Contact</th>
                        <th className="px-6 py-4">Source</th>
                        <th className="px-6 py-4">Lead Status</th>
                        <th className="px-6 py-4">Outbound Call</th>
                        <th className="px-6 py-4 text-right">Date</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800 text-sm">
                      {leads.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="text-center py-20 text-zinc-500 dark:text-zinc-400 font-semibold">
                            No prospects found. Run the lead scraper or add manually!
                          </td>
                        </tr>
                      ) : (
                        leads.map((lead) => (
                          <tr 
                            key={lead.id}
                            onClick={() => setSelectedLead(lead)}
                            className={`cursor-pointer hover:bg-zinc-100/50 dark:hover:bg-zinc-800/40 transition-colors ${selectedLead?.id === lead.id ? 'bg-blue-50/70 dark:bg-blue-950/20' : ''}`}
                          >
                            <td className="px-6 py-4">
                              <div className="font-bold text-zinc-950 dark:text-zinc-50">{lead.company}</div>
                              <div className="text-xs text-zinc-400">{lead.title || 'N/A'}</div>
                            </td>
                            <td className="px-6 py-4">
                              <div className="font-semibold text-zinc-950 dark:text-zinc-50">{lead.name}</div>
                              <div className="text-xs text-zinc-400">{lead.email}</div>
                            </td>
                            <td className="px-6 py-4 text-xs font-mono text-zinc-500 dark:text-zinc-400">
                              {lead.source}
                            </td>
                            <td className="px-6 py-4">
                              <span className={getStatusBadge(lead.status)}>
                                {lead.status}
                              </span>
                            </td>
                            <td className="px-6 py-4">
                              <div className={getCallBadge(lead.call_status)}>
                                {lead.call_status === 'calling' && <RotateCw size={14} className="animate-spin" />}
                                {lead.call_status === 'completed' && <Check size={14} />}
                                {lead.call_status === 'failed' && <XCircle size={14} />}
                                {lead.call_status}
                              </div>
                              {lead.call_outcome !== 'none' && (
                                <div className="text-[10px] text-zinc-500 font-semibold uppercase mt-0.5">
                                  {lead.call_outcome.replace('_', ' ')}
                                </div>
                              )}
                            </td>
                            <td className="px-6 py-4 text-right text-xs font-semibold text-zinc-500 dark:text-zinc-400">
                              {format(parseISO(lead.scraped_date), 'MMM dd, yyyy')}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* Selected Lead Details Panel (Slide-out) */}
            {selectedLead && (
              <div className="w-1/3 bg-white dark:bg-[#0c0c0f] border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-lg overflow-hidden flex flex-col h-[700px] animate-in slide-in-from-right duration-300">
                {/* Header */}
                <div className="p-4 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between bg-zinc-50 dark:bg-zinc-900/40">
                  <h3 className="font-bold text-md text-zinc-950 dark:text-zinc-50">Prospect Inspection</h3>
                  <button 
                    onClick={() => setSelectedLead(null)}
                    className="p-1 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  >
                    <X size={18} />
                  </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto p-5 space-y-6">
                  
                  {/* Lead Info */}
                  <div>
                    <span className={getStatusBadge(selectedLead.status)}>{selectedLead.status}</span>
                    <h2 className="text-xl font-bold text-zinc-950 dark:text-zinc-50 mt-2">{selectedLead.name}</h2>
                    <p className="text-sm font-semibold text-zinc-500 dark:text-zinc-400">{selectedLead.title} @ {selectedLead.company}</p>
                    
                    <div className="mt-4 grid grid-cols-2 gap-4 bg-zinc-50 dark:bg-zinc-900/40 border border-zinc-200 dark:border-zinc-800 rounded-lg p-3">
                      <div>
                        <p className="text-[10px] uppercase font-bold text-zinc-400">Email Address</p>
                        <p className="text-xs font-semibold text-zinc-800 dark:text-zinc-200 break-all">{selectedLead.email}</p>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase font-bold text-zinc-400">Phone Number</p>
                        <p className="text-xs font-semibold text-zinc-800 dark:text-zinc-200">{selectedLead.phone}</p>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase font-bold text-zinc-400">Data Source</p>
                        <p className="text-xs font-semibold text-zinc-800 dark:text-zinc-200">{selectedLead.source}</p>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase font-bold text-zinc-400">Scraped Date</p>
                        <p className="text-xs font-semibold text-zinc-800 dark:text-zinc-200">
                          {format(parseISO(selectedLead.scraped_date), 'yyyy-MM-dd HH:mm')}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Manual Approval Decision Actions */}
                  {selectedLead.status === 'scraped' && (
                    <div className="space-y-2 border-t border-zinc-200 dark:border-zinc-800 pt-4">
                      <p className="text-xs font-bold text-zinc-400 uppercase tracking-wider">Lead Approval Review</p>
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleStatusChange(selectedLead.id, 'approve')}
                          disabled={actionLoading}
                          className="flex-1 flex items-center justify-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold py-2 px-4 rounded-lg text-sm shadow-sm transition"
                        >
                          <Check size={16} /> Approve Queue
                        </button>
                        <button
                          onClick={() => handleStatusChange(selectedLead.id, 'reject')}
                          disabled={actionLoading}
                          className="flex-1 flex items-center justify-center gap-1.5 bg-rose-600 hover:bg-rose-700 text-white font-semibold py-2 px-4 rounded-lg text-sm shadow-sm transition"
                        >
                          <X size={16} /> Reject Lead
                        </button>
                      </div>
                    </div>
                  )}

                  {/* AI Outreach Control */}
                  {selectedLead.status !== 'scraped' && selectedLead.status !== 'rejected' && (
                    <div className="space-y-4 border-t border-zinc-200 dark:border-zinc-800 pt-4">
                      <div>
                        <p className="text-xs font-bold text-zinc-400 uppercase tracking-wider mb-2">Outreach Channels</p>
                        
                        <div className="space-y-2">
                          {/* LinkedIn Connection request */}
                          <div className="bg-zinc-50 dark:bg-zinc-900/40 p-3 rounded-lg border border-zinc-200 dark:border-zinc-800 space-y-2">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <Users size={16} className="text-blue-500" />
                                <div className="text-xs">
                                  <p className="font-bold">LinkedIn Connection</p>
                                  <p className="text-zinc-400 mt-0.5">
                                    Status: <span className="font-bold text-blue-500 uppercase">{selectedLead.linkedin_status || 'none'}</span>
                                  </p>
                                </div>
                              </div>
                              
                              {selectedLead.linkedin_status === 'queued' && (
                                <a 
                                  href={selectedLead.linkedin_url} 
                                  target="_blank" 
                                  rel="noopener noreferrer"
                                  onClick={async () => {
                                    try {
                                      await axios.post(`${API_BASE}/leads/${selectedLead.id}/linkedin-action?action=sent`);
                                      fetchLeads(false);
                                    } catch (err) { console.error(err); }
                                  }}
                                  className="flex items-center gap-1 px-2.5 py-1 bg-blue-600 hover:bg-blue-700 text-white font-bold text-[10px] rounded shadow transition"
                                >
                                  Connect URL
                                </a>
                              )}

                              {selectedLead.linkedin_status === 'request_sent' && (
                                <button
                                  onClick={async () => {
                                    try {
                                      await axios.post(`${API_BASE}/leads/${selectedLead.id}/linkedin-action?action=accept`);
                                      fetchLeads(false);
                                      fetchLogs(false);
                                    } catch (err) { alert(err.message); }
                                  }}
                                  className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[10px] rounded shadow transition"
                                >
                                  Simulate Accept
                                </button>
                              )}

                              {selectedLead.linkedin_status === 'accepted' && selectedLead.response_received === false && (
                                <button
                                  onClick={async () => {
                                    try {
                                      await axios.post(`${API_BASE}/leads/${selectedLead.id}/simulate-reply`);
                                      fetchLeads(false);
                                      fetchLogs(false);
                                    } catch (err) { alert(err.message); }
                                  }}
                                  className="px-2.5 py-1 bg-amber-600 hover:bg-amber-700 text-white font-bold text-[10px] rounded shadow transition"
                                >
                                  Simulate Reply
                                </button>
                              )}
                            </div>

                            {selectedLead.linkedin_status === 'accepted' && (
                              <div className="pt-2 border-t border-zinc-200 dark:border-zinc-800 text-[10px] text-zinc-400 space-y-1">
                                <p className="flex justify-between">
                                  <span>Email Sequence Step:</span>
                                  <span className="font-bold text-zinc-200">
                                    {selectedLead.email_sequence_step === 0 ? 'Queued' : 
                                     selectedLead.email_sequence_step === 1 ? 'Step 1 Sent' : 'Step 2 Sent'}
                                  </span>
                                </p>
                                <p className="flex justify-between">
                                  <span>Response Status:</span>
                                  <span className={`font-bold ${selectedLead.response_received ? 'text-emerald-500' : 'text-zinc-400'}`}>
                                    {selectedLead.response_received ? 'REPLIED (Halted)' : 'Awaiting Reply'}
                                  </span>
                                </p>
                              </div>
                            )}
                          </div>

                          {/* Voice Call */}
                          <div className="flex items-center justify-between bg-zinc-50 dark:bg-zinc-900/40 p-3 rounded-lg border border-zinc-200 dark:border-zinc-800">
                            <div className="flex items-center gap-2">
                              <PhoneCall size={16} className="text-yellow-500" />
                              <div className="text-xs">
                                <p className="font-bold">AI Voice Dialing (Vapi)</p>
                                <p className="text-zinc-400 flex items-center gap-1 mt-0.5">
                                  Status: <span className={getCallBadge(selectedLead.call_status)}>{selectedLead.call_status}</span>
                                </p>
                              </div>
                            </div>
                            {selectedLead.call_status !== 'completed' && selectedLead.call_status !== 'calling' && (
                              <button
                                onClick={() => handleStatusChange(selectedLead.id, 'call')}
                                disabled={actionLoading}
                                className="flex items-center gap-1 px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded shadow transition"
                              >
                                <Play size={12} /> Call
                              </button>
                            )}
                          </div>

                          {/* Email */}
                          <div className="flex items-center justify-between bg-zinc-50 dark:bg-zinc-900/40 p-3 rounded-lg border border-zinc-200 dark:border-zinc-800">
                            <div className="flex items-center gap-2">
                              <Mail size={16} className="text-blue-500" />
                              <div className="text-xs">
                                <p className="font-bold">SMTP Follow-up Email</p>
                                <p className="text-zinc-400 mt-0.5">
                                  Status: <span className={`font-semibold ${selectedLead.email_status === 'sent' ? 'text-emerald-500' : selectedLead.email_status === 'failed' ? 'text-rose-500' : 'text-zinc-500'}`}>{selectedLead.email_status}</span>
                                </p>
                              </div>
                            </div>
                          </div>

                          {/* WhatsApp */}
                          <div className="flex items-center justify-between bg-zinc-50 dark:bg-zinc-900/40 p-3 rounded-lg border border-zinc-200 dark:border-zinc-800">
                            <div className="flex items-center gap-2">
                              <MessageSquare size={16} className="text-emerald-500" />
                              <div className="text-xs">
                                <p className="font-bold">Meta WhatsApp Message</p>
                                <p className="text-zinc-400 mt-0.5">
                                  Status: <span className={`font-semibold ${selectedLead.whatsapp_status === 'sent' ? 'text-emerald-500' : selectedLead.whatsapp_status === 'failed' ? 'text-rose-500' : 'text-zinc-500'}`}>{selectedLead.whatsapp_status}</span>
                                </p>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Call Outcome details */}
                      {selectedLead.call_status === 'completed' && (
                        <div className="space-y-3 bg-zinc-50 dark:bg-zinc-900/40 border border-zinc-200 dark:border-zinc-800 rounded-lg p-3">
                          <div className="flex justify-between text-xs">
                            <div>
                              <p className="text-zinc-400 font-bold">Call Duration</p>
                              <p className="font-semibold">{selectedLead.call_duration} seconds</p>
                            </div>
                            <div className="text-right">
                              <p className="text-zinc-400 font-bold">Call Outcome</p>
                              <p className={`font-bold uppercase ${selectedLead.call_outcome === 'interested' ? 'text-emerald-500' : selectedLead.call_outcome === 'voicemail' ? 'text-amber-500' : 'text-rose-500'}`}>
                                {selectedLead.call_outcome.replace('_', ' ')}
                              </p>
                            </div>
                          </div>
                          
                          {/* Recording audio player */}
                          {selectedLead.recording_url && (
                            <div className="pt-2 border-t border-zinc-200 dark:border-zinc-800">
                              <p className="text-[10px] font-bold text-zinc-400 uppercase mb-1.5 flex items-center gap-1">
                                <Volume2 size={12} /> Call Recording Audio
                              </p>
                              <audio controls className="w-full h-8" src={selectedLead.recording_url}></audio>
                            </div>
                          )}
                          
                          {/* Transcript Box */}
                          {selectedLead.transcript && (
                            <div className="pt-2 border-t border-zinc-200 dark:border-zinc-800">
                              <p className="text-[10px] font-bold text-zinc-400 uppercase mb-1 flex items-center gap-1">
                                <FileText size={12} /> Conversation Transcript
                              </p>
                              <div className="bg-white dark:bg-zinc-950 rounded border border-zinc-200 dark:border-zinc-800 p-2 h-44 overflow-y-auto font-mono text-[11px] leading-relaxed whitespace-pre-line text-zinc-700 dark:text-zinc-300">
                                {selectedLead.transcript}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                </div>
              </div>
            )}
          </div>
        )}

        {/* ANALYTICS TAB */}
        {activeTab === 'analytics' && (
          <div className="flex-1 space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              
              {/* Funnel Chart Card */}
              <div className="bg-white dark:bg-[#0c0c0f] border border-zinc-200 dark:border-zinc-800 rounded-xl p-5 shadow-sm">
                <h3 className="text-md font-bold tracking-tight text-zinc-500 dark:text-zinc-400 mb-4 uppercase">Lead Conversion Funnel</h3>
                <div className="h-80">
                  {analytics ? (
                    <ReactECharts option={getFunnelChartOption()} style={{ height: '100%', width: '100%' }} />
                  ) : (
                    <div className="h-full flex items-center justify-center text-zinc-500">Loading Funnel Metrics...</div>
                  )}
                </div>
              </div>

              {/* Outcomes Chart Card */}
              <div className="bg-white dark:bg-[#0c0c0f] border border-zinc-200 dark:border-zinc-800 rounded-xl p-5 shadow-sm">
                <h3 className="text-md font-bold tracking-tight text-zinc-500 dark:text-zinc-400 mb-4 uppercase">AI Voice Dial Outcomes</h3>
                <div className="h-80">
                  {analytics ? (
                    <ReactECharts option={getOutcomesChartOption()} style={{ height: '100%', width: '100%' }} />
                  ) : (
                    <div className="h-full flex items-center justify-center text-zinc-500">Loading Outcomes...</div>
                  )}
                </div>
              </div>

            </div>

            {/* Daily Trends Chart Card */}
            <div className="bg-white dark:bg-[#0c0c0f] border border-zinc-200 dark:border-zinc-800 rounded-xl p-5 shadow-sm">
              <h3 className="text-md font-bold tracking-tight text-zinc-500 dark:text-zinc-400 mb-4 uppercase">Daily Scraped Lead Influx</h3>
              <div className="h-64">
                {analytics && analytics.trends.length ? (
                  <ReactECharts option={getTrendsChartOption()} style={{ height: '100%', width: '100%' }} />
                ) : (
                  <div className="h-full flex items-center justify-center text-zinc-500">No trend data available yet. Run the scraper!</div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* OPERATIONS AUDIT LOGS TAB */}
        {activeTab === 'logs' && (
          <div className="flex-1 bg-white dark:bg-[#0c0c0f] border border-zinc-200 dark:border-zinc-800 rounded-xl p-5 shadow-sm flex flex-col h-[700px]">
            <h3 className="text-md font-bold tracking-tight text-zinc-500 dark:text-zinc-400 mb-4 uppercase">System Audit Trail</h3>
            <div className="flex-1 overflow-y-auto border border-zinc-200 dark:border-zinc-800 rounded-lg bg-zinc-50 dark:bg-zinc-900/20 divide-y divide-zinc-200 dark:divide-zinc-800">
              {logs.length === 0 ? (
                <div className="text-center py-20 text-zinc-500">No operations logs registered.</div>
              ) : (
                logs.map((log) => (
                  <div key={log.id} className="p-3 text-xs flex items-start gap-4">
                    <span className="text-zinc-400 font-mono font-semibold shrink-0">{log.timestamp}</span>
                    <span className="font-bold text-blue-600 dark:text-blue-400 min-w-[100px]">{log.action.toUpperCase()}</span>
                    <div className="flex-1">
                      <span className="font-semibold text-zinc-900 dark:text-zinc-200">{log.lead_name} ({log.lead_company})</span>
                      <p className="text-zinc-500 dark:text-zinc-400 mt-0.5">{log.details}</p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* SETTINGS TAB */}
        {activeTab === 'settings' && (
          <form onSubmit={handleSaveSettings} className="flex-1 bg-white dark:bg-[#0c0c0f] border border-zinc-200 dark:border-zinc-800 rounded-xl p-6 shadow-sm space-y-8 overflow-y-auto h-[700px]">
            
            <div className="flex justify-between items-center border-b border-zinc-200 dark:border-zinc-800 pb-4">
              <div>
                <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-50">SDR System Parameters</h2>
                <p className="text-xs text-zinc-400">Configure credentials, call scripts, templates and database sync parameters</p>
              </div>
              <button 
                type="submit"
                className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold py-2 px-5 rounded-lg text-sm transition shadow-sm"
              >
                Save Configurations
              </button>
            </div>

            {/* Grid layout */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              
              {/* General Config */}
              <div className="space-y-4 bg-zinc-50 dark:bg-zinc-900/40 p-4 border border-zinc-200 dark:border-zinc-800 rounded-lg">
                <h3 className="text-sm font-bold text-blue-600 dark:text-blue-400 uppercase tracking-wider">General Settings</h3>
                
                <label className="flex items-center gap-2 cursor-pointer pt-2">
                  <input 
                    type="checkbox" 
                    checked={settings.simulation_mode === 'true'}
                    onChange={(e) => setSettings({...settings, simulation_mode: e.target.checked ? 'true' : 'false'})}
                    className="h-4 w-4 rounded border-zinc-300 text-blue-600 focus:ring-blue-500"
                  />
                  <div>
                    <span className="text-sm font-semibold">Enable Simulation Sandbox Mode</span>
                    <p className="text-[10px] text-zinc-400">Runs calls, emails, and WhatsApp as simulated processes for local evaluation without API keys.</p>
                  </div>
                </label>

                <div className="pt-2 border-t border-zinc-200 dark:border-zinc-800">
                  <label className="text-[10px] font-bold text-zinc-400 mb-1 block">Proxycurl API Key (LinkedIn Auto-Connection Detection)</label>
                  <input 
                    type="password" 
                    value={settings.proxycurl_api_key || ''}
                    onChange={(e) => setSettings({...settings, proxycurl_api_key: e.target.value})}
                    placeholder="Enter Nubela Proxycurl API key or 'sandbox'"
                    className="w-full bg-white dark:bg-[#09090b] border border-zinc-200 dark:border-zinc-800 rounded-lg px-3 py-1.5 text-xs outline-none focus:ring-2 focus:ring-blue-500/50"
                  />
                </div>

                <div className="border-t border-zinc-200 dark:border-zinc-800 my-4 pt-3">
                  <h4 className="text-xs font-bold uppercase text-zinc-400 mb-2">Google Sheets Database Sync</h4>
                  <div className="space-y-3">
                    <div>
                      <label className="text-[10px] font-bold text-zinc-400 mb-1 block">Spreadsheet ID</label>
                      <input 
                        type="text" 
                        value={settings.google_sheet_id || ''}
                        onChange={(e) => setSettings({...settings, google_sheet_id: e.target.value})}
                        placeholder="e.g. 1L2B4c..."
                        className="w-full bg-white dark:bg-[#09090b] border border-zinc-200 dark:border-zinc-800 rounded-lg px-3 py-1.5 text-xs outline-none focus:ring-2 focus:ring-blue-500/50"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-zinc-400 mb-1 block">Service Account Credentials JSON</label>
                      <textarea 
                        rows={3}
                        value={settings.google_sheet_credentials || ''}
                        onChange={(e) => setSettings({...settings, google_sheet_credentials: e.target.value})}
                        placeholder='{"type": "service_account", ...}'
                        className="w-full bg-white dark:bg-[#09090b] border border-zinc-200 dark:border-zinc-800 rounded-lg px-3 py-1.5 text-xs font-mono outline-none focus:ring-2 focus:ring-blue-500/50"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2 pt-2 border-t border-zinc-200 dark:border-zinc-800">
                    <div>
                      <label className="text-[10px] font-bold text-zinc-400 mb-1 block">LinkedIn Daily Connection Limit</label>
                      <input 
                        type="number" 
                        value={settings.linkedin_daily_limit || '5'}
                        onChange={(e) => setSettings({...settings, linkedin_daily_limit: e.target.value})}
                        placeholder="5"
                        className="w-full bg-white dark:bg-[#09090b] border border-zinc-200 dark:border-zinc-800 rounded-lg px-3 py-1.5 text-xs outline-none focus:ring-2 focus:ring-blue-500/50"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-zinc-400 mb-1 block">Email Sequence Delay (Hours)</label>
                      <input 
                        type="number" 
                        value={settings.email_followup_delay_hours || '48'}
                        onChange={(e) => setSettings({...settings, email_followup_delay_hours: e.target.value})}
                        placeholder="48"
                        className="w-full bg-white dark:bg-[#09090b] border border-zinc-200 dark:border-zinc-800 rounded-lg px-3 py-1.5 text-xs outline-none focus:ring-2 focus:ring-blue-500/50"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>



              {/* Vapi.ai Voice settings */}
              <div className="space-y-4 bg-zinc-50 dark:bg-zinc-900/40 p-4 border border-zinc-200 dark:border-zinc-800 rounded-lg">
                <h3 className="text-sm font-bold text-yellow-600 dark:text-yellow-400 uppercase tracking-wider">AI Voice Agent Configuration</h3>
                
                <div>
                  <label className="text-[10px] font-bold text-zinc-400 mb-1 block">Vapi API Secret Token</label>
                  <input 
                    type="password" 
                    value={settings.vapi_api_key || ''}
                    onChange={(e) => setSettings({...settings, vapi_api_key: e.target.value})}
                    placeholder="Vapi api key"
                    className="w-full bg-white dark:bg-[#09090b] border border-zinc-200 dark:border-zinc-800 rounded-lg px-3 py-1.5 text-xs outline-none focus:ring-2 focus:ring-blue-500/50"
                  />
                </div>

                <div>
                  <label className="text-[10px] font-bold text-zinc-400 mb-1 block">Vapi Assistant / Agent ID</label>
                  <input 
                    type="text" 
                    value={settings.vapi_assistant_id || ''}
                    onChange={(e) => setSettings({...settings, vapi_assistant_id: e.target.value})}
                    placeholder="Vapi assistant UUID"
                    className="w-full bg-white dark:bg-[#09090b] border border-zinc-200 dark:border-zinc-800 rounded-lg px-3 py-1.5 text-xs outline-none focus:ring-2 focus:ring-blue-500/50"
                  />
                </div>

                <div>
                  <label className="text-[10px] font-bold text-zinc-400 mb-1 block">Twilio SIP Trunking / Number Phone ID</label>
                  <input 
                    type="text" 
                    value={settings.twilio_sid || ''}
                    onChange={(e) => setSettings({...settings, twilio_sid: e.target.value})}
                    placeholder="Twilio phone number sid"
                    className="w-full bg-white dark:bg-[#09090b] border border-zinc-200 dark:border-zinc-800 rounded-lg px-3 py-1.5 text-xs outline-none focus:ring-2 focus:ring-blue-500/50"
                  />
                </div>
              </div>

              {/* SMTP Settings */}
              <div className="space-y-4 bg-zinc-50 dark:bg-zinc-900/40 p-4 border border-zinc-200 dark:border-zinc-800 rounded-lg">
                <h3 className="text-sm font-bold text-blue-500 dark:text-blue-400 uppercase tracking-wider">Email (SMTP) Follow-up Configuration</h3>
                
                <div className="grid grid-cols-3 gap-2">
                  <div className="col-span-2">
                    <label className="text-[10px] font-bold text-zinc-400 mb-1 block">SMTP Host</label>
                    <input 
                      type="text" 
                      value={settings.smtp_host || ''}
                      onChange={(e) => setSettings({...settings, smtp_host: e.target.value})}
                      placeholder="smtp.gmail.com"
                      className="w-full bg-white dark:bg-[#09090b] border border-zinc-200 dark:border-zinc-800 rounded-lg px-3 py-1.5 text-xs outline-none"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-zinc-400 mb-1 block">SMTP Port</label>
                    <input 
                      type="text" 
                      value={settings.smtp_port || ''}
                      onChange={(e) => setSettings({...settings, smtp_port: e.target.value})}
                      placeholder="587"
                      className="w-full bg-white dark:bg-[#09090b] border border-zinc-200 dark:border-zinc-800 rounded-lg px-3 py-1.5 text-xs outline-none"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-[10px] font-bold text-zinc-400 mb-1 block">SMTP Account Username / Address</label>
                  <input 
                    type="email" 
                    value={settings.smtp_user || ''}
                    onChange={(e) => setSettings({...settings, smtp_user: e.target.value})}
                    placeholder="sales@company.com"
                    className="w-full bg-white dark:bg-[#09090b] border border-zinc-200 dark:border-zinc-800 rounded-lg px-3 py-1.5 text-xs outline-none"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] font-bold text-zinc-400 mb-1 block">SMTP Password</label>
                    <input 
                      type="password" 
                      value={settings.smtp_password || ''}
                      onChange={(e) => setSettings({...settings, smtp_password: e.target.value})}
                      placeholder="••••••••"
                      className="w-full bg-white dark:bg-[#09090b] border border-zinc-200 dark:border-zinc-800 rounded-lg px-3 py-1.5 text-xs outline-none"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-zinc-400 mb-1 block">Sender Address</label>
                    <input 
                      type="email" 
                      value={settings.smtp_sender || ''}
                      onChange={(e) => setSettings({...settings, smtp_sender: e.target.value})}
                      placeholder="sales@company.com"
                      className="w-full bg-white dark:bg-[#09090b] border border-zinc-200 dark:border-zinc-800 rounded-lg px-3 py-1.5 text-xs outline-none"
                    />
                  </div>
                </div>
              </div>

              {/* Meta WhatsApp settings */}
              <div className="space-y-4 bg-zinc-50 dark:bg-zinc-900/40 p-4 border border-zinc-200 dark:border-zinc-800 rounded-lg">
                <h3 className="text-sm font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider">Meta WhatsApp Configuration</h3>
                
                <div>
                  <label className="text-[10px] font-bold text-zinc-400 mb-1 block">Meta System User Token</label>
                  <input 
                    type="password" 
                    value={settings.whatsapp_token || ''}
                    onChange={(e) => setSettings({...settings, whatsapp_token: e.target.value})}
                    placeholder="EAAGz..."
                    className="w-full bg-white dark:bg-[#09090b] border border-zinc-200 dark:border-zinc-800 rounded-lg px-3 py-1.5 text-xs outline-none"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] font-bold text-zinc-400 mb-1 block">Phone Number ID</label>
                    <input 
                      type="text" 
                      value={settings.whatsapp_phone_number_id || ''}
                      onChange={(e) => setSettings({...settings, whatsapp_phone_number_id: e.target.value})}
                      placeholder="1092837..."
                      className="w-full bg-white dark:bg-[#09090b] border border-zinc-200 dark:border-zinc-800 rounded-lg px-3 py-1.5 text-xs outline-none"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-zinc-400 mb-1 block">Template Name</label>
                    <input 
                      type="text" 
                      value={settings.whatsapp_template_name || ''}
                      onChange={(e) => setSettings({...settings, whatsapp_template_name: e.target.value})}
                      placeholder="outreach_followup"
                      className="w-full bg-white dark:bg-[#09090b] border border-zinc-200 dark:border-zinc-800 rounded-lg px-3 py-1.5 text-xs outline-none"
                    />
                  </div>
                </div>
              </div>

            </div>

            {/* Prompt script settings */}
            <div className="bg-zinc-50 dark:bg-zinc-900/40 p-4 border border-zinc-200 dark:border-zinc-800 rounded-lg space-y-2">
              <h3 className="text-sm font-bold text-purple-600 dark:text-purple-400 uppercase tracking-wider">AI Voice Agent Playbook & Call Script Prompt</h3>
              <div>
                <label className="text-[10px] font-bold text-zinc-400 mb-1 block">System instructions for the AI Voice caller</label>
                <textarea 
                  rows={4}
                  value={settings.system_prompt || ''}
                  onChange={(e) => setSettings({...settings, system_prompt: e.target.value})}
                  placeholder="You are an SDR..."
                  className="w-full bg-white dark:bg-[#09090b] border border-zinc-200 dark:border-zinc-800 rounded-lg p-3 text-xs outline-none focus:ring-2 focus:ring-blue-500/50"
                />
              </div>
            </div>

          </form>
        )}

      </main>

      {/* 4. Add Lead Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center">
          <div className="bg-white dark:bg-[#0c0c0f] rounded-xl border border-zinc-200 dark:border-zinc-800 max-w-md w-full p-6 shadow-2xl animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800 pb-3 mb-4">
              <h3 className="font-bold text-lg">Add New Prospect Manual Lead</h3>
              <button 
                onClick={() => setShowAddModal(false)}
                className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 rounded-lg p-1"
              >
                <X size={18} />
              </button>
            </div>
            
            <form onSubmit={handleAddLead} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 mb-1 block">Company Name</label>
                  <input 
                    type="text" required
                    value={newLead.company}
                    onChange={(e) => setNewLead({...newLead, company: e.target.value})}
                    placeholder="Acme Corp"
                    className="w-full bg-zinc-50 dark:bg-[#09090b] border border-zinc-200 dark:border-zinc-800 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500/50 outline-none"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 mb-1 block">Job Title</label>
                  <input 
                    type="text"
                    value={newLead.title}
                    onChange={(e) => setNewLead({...newLead, title: e.target.value})}
                    placeholder="IT Director"
                    className="w-full bg-zinc-50 dark:bg-[#09090b] border border-zinc-200 dark:border-zinc-800 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500/50 outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 mb-1 block">Full Name</label>
                <input 
                  type="text" required
                  value={newLead.name}
                  onChange={(e) => setNewLead({...newLead, name: e.target.value})}
                  placeholder="John Doe"
                  className="w-full bg-zinc-50 dark:bg-[#09090b] border border-zinc-200 dark:border-zinc-800 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500/50 outline-none"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 mb-1 block">Email Address</label>
                <input 
                  type="email" required
                  value={newLead.email}
                  onChange={(e) => setNewLead({...newLead, email: e.target.value})}
                  placeholder="john.doe@company.com"
                  className="w-full bg-zinc-50 dark:bg-[#09090b] border border-zinc-200 dark:border-zinc-800 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500/50 outline-none"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 mb-1 block">Phone Number</label>
                <input 
                  type="text" required
                  value={newLead.phone}
                  onChange={(e) => setNewLead({...newLead, phone: e.target.value})}
                  placeholder="+91 9876543210"
                  className="w-full bg-zinc-50 dark:bg-[#09090b] border border-zinc-200 dark:border-zinc-800 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500/50 outline-none"
                />
              </div>

              <div className="flex gap-2 justify-end pt-4 border-t border-zinc-200 dark:border-zinc-800">
                <button 
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 text-sm font-semibold rounded-lg border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition"
                >
                  Cancel
                </button>
                <button 
                  type="submit"
                  className="px-4 py-2 text-sm font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition"
                >
                  Save Lead
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
