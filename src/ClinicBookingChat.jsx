import React, { useState, useRef, useEffect } from 'react';

const ClinicBookingChat = () => {
  const initialMessage = { id: 1, sender: 'bot', text: 'Hello! I am your AI assistant. Tell me where and when you need a doctor.' };
  const [messages, setMessages] = useState([initialMessage]);
  const [inputText, setInputText] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  
  const [isAdminOpen, setIsAdminOpen] = useState(false);
  const [jsonInput, setJsonInput] = useState('');

  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const messagesEndRef = useRef(null);

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const clearChat = () => { if (window.confirm("Start a new conversation?")) setMessages([initialMessage]); };

  // --- ADMIN LOGIC ---
  const handleFileUpload = (e) => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try { setJsonInput(JSON.stringify(JSON.parse(event.target.result), null, 2)); } 
      catch (error) { alert("Invalid JSON format."); }
    };
    reader.readAsText(file); e.target.value = '';
  };

  const handleAdminUpdate = async () => {
    if (!jsonInput.trim()) return;
    try {
      const res = await fetch('https://webandmobile-clinic-backend.hf.space/api/admin/update-db', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(JSON.parse(jsonInput)),
      });
      const data = await res.json();
      alert(data.message || "Database Updated!"); setIsAdminOpen(false); setJsonInput('');
    } catch (e) { alert("Invalid JSON format."); }
  };

  // --- AUDIO LOGIC ---
  const toggleRecording = () => { isRecording ? stopRecording() : startRecording(); };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/ogg';
      const mediaRecorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) audioChunksRef.current.push(e.data); };
      mediaRecorder.onstop = async () => {
        if (audioChunksRef.current.length > 0) {
          await processAudio(new Blob(audioChunksRef.current, { type: mimeType }), mimeType.includes('webm') ? 'voice.webm' : 'voice.ogg');
        }
        stream.getTracks().forEach(track => track.stop());
      };
      mediaRecorder.start(1000); setIsRecording(true);
    } catch (error) { alert("Microphone access is required."); }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) { mediaRecorderRef.current.stop(); setIsRecording(false); }
  };

  const processAudio = async (audioBlob, fileName) => {
    setIsTyping(true);
    setMessages((prev) => [...prev, { id: Date.now(), sender: 'user', text: '🎤 Processing voice...' }]);
    try {
      const formData = new FormData(); formData.append("audio", audioBlob, fileName);
      const res = await fetch('https://webandmobile-clinic-backend.hf.space/api/transcribe', { method: 'POST', body: formData });
      const data = await res.json();
      if (data.status === "success") {
        setMessages((prev) => { const u = [...prev]; u[u.length - 1].text = `🎤 "${data.text}"`; return u; });
        await sendToChatAPI(data.text);
      }
    } catch (e) { setIsTyping(false); }
  };

  // --- API LOGIC ---
  const sendToChatAPI = async (text) => {
    setIsTyping(true);
    const chatHistory = messages.slice(1).map(m => ({ sender: m.sender, text: m.text }));
    try {
      const res = await fetch('https://webandmobile-clinic-backend.hf.space/api/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, history: chatHistory }),
      });
      const data = await res.json();
      
      if (data.status === "requires_confirmation") {
        setMessages((prev) => [...prev, { id: Date.now() + 1, sender: 'bot', text: data.message, booking_details: data.booking_details }]);
      } else {
        setMessages((prev) => [...prev, { id: Date.now() + 1, sender: 'bot', text: data.message, slots: data.slots || [] }]);
      }
    } catch (e) { setMessages((prev) => [...prev, { id: Date.now() + 1, sender: 'bot', text: 'Connection error.' }]); } 
    finally { setIsTyping(false); }
  };

  const handleSendMessage = async (e) => {
    e.preventDefault(); if (!inputText.trim()) return;
    const msg = inputText; setMessages((prev) => [...prev, { id: Date.now(), sender: 'user', text: msg }]);
    setInputText(''); await sendToChatAPI(msg);
  };

  const handleQuickBookClick = (slot) => {
    const msg = `I want to book the ${slot.start_time} slot on ${slot.day}.`;
    setMessages((prev) => [...prev, { id: Date.now(), sender: 'user', text: msg }]);
    sendToChatAPI(msg);
  };

  const confirmBooking = async (details, msgId) => {
    setIsTyping(true);
    setMessages(prev => prev.map(m => m.id === msgId ? { ...m, booking_details: null, text: m.text + " ✅ (Confirmed)" } : m));

    try {
      const res = await fetch('https://webandmobile-clinic-backend.hf.space/api/book', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slot_id: details.slot_id, time: details.time, patient_name: details.patient_name, phone_number: details.phone_number }),
      });
      const data = await res.json();
      setMessages((prev) => [...prev, { id: Date.now(), sender: 'bot', text: data.message }]);
    } catch (e) { setMessages((prev) => [...prev, { id: Date.now(), sender: 'bot', text: 'Booking failed.' }]); } 
    finally { setIsTyping(false); }
  };

  const cancelBooking = (msgId) => {
    setMessages(prev => prev.map(m => m.id === msgId ? { ...m, booking_details: null, text: "❌ Booking Cancelled." } : m));
    setMessages(prev => [...prev, { id: Date.now(), sender: 'bot', text: "No problem! Let me know if you want to look at other times." }]);
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-slate-100 p-4 font-sans sm:py-4">
      <div className="w-full max-w-lg bg-white sm:rounded-[2rem] shadow-2xl overflow-hidden flex flex-col h-[100dvh] sm:h-[700px] sm:max-h-[95vh] border border-slate-200 relative">
        
        {/* PREMIUM HEADER */}
        <div className="bg-gradient-to-r from-indigo-600 to-blue-700 text-white p-5 shadow-md flex justify-between items-center z-10 sm:rounded-t-[2rem]">
          <div className="font-extrabold text-xl flex items-center gap-3 tracking-wide">
            <div className="bg-white/20 p-2 rounded-xl backdrop-blur-sm">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6"><path fillRule="evenodd" d="M12 2.25c-5.385 0-9.75 4.365-9.75 9.75s4.365 9.75 9.75 9.75 9.75-4.365 9.75-9.75S17.385 2.25 12 2.25zM12.75 9a.75.75 0 00-1.5 0v2.25H9a.75.75 0 000 1.5h2.25V15a.75.75 0 001.5 0v-2.25H15a.75.75 0 000-1.5h-2.25V9z" clipRule="evenodd" /></svg>
            </div>
            Smart Clinic Assistant
          </div>
          <div className="flex items-center gap-2">
            <button onClick={clearChat} title="Reset Chat" className="p-2 bg-white/10 hover:bg-white/20 rounded-full backdrop-blur-sm transition-all text-white">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" /></svg>
            </button>
            <button onClick={() => setIsAdminOpen(true)} title="Settings" className="p-2 bg-white/10 hover:bg-white/20 rounded-full backdrop-blur-sm transition-all text-white">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
            </button>
          </div>
        </div>

        {/* GLASSMORPHISM ADMIN MODAL */}
        {isAdminOpen && (
          <div className="absolute inset-0 z-50 flex flex-col animate-in fade-in duration-200">
            <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={() => setIsAdminOpen(false)}></div>
            <div className="relative mt-auto bg-white rounded-t-3xl shadow-2xl p-6 flex flex-col gap-5 h-[80%] border-t border-slate-200">
              <div className="flex justify-between items-center">
                <h2 className="font-extrabold text-slate-800 text-xl">Database Manager</h2>
                <button onClick={() => setIsAdminOpen(false)} className="bg-slate-100 text-slate-500 hover:bg-slate-200 p-2 rounded-full transition-colors"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg></button>
              </div>
              
              <div className="bg-indigo-50/50 p-4 rounded-2xl border border-indigo-100">
                <label className="block text-xs font-bold text-indigo-700 uppercase tracking-wider mb-3">1. Upload JSON File</label>
                <input type="file" accept=".json" onChange={handleFileUpload} className="block w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-sm file:font-bold file:bg-indigo-600 file:text-white hover:file:bg-indigo-700 cursor-pointer transition-colors" />
              </div>

              <div className="flex-1 flex flex-col">
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">2. Or Paste Content Directly</label>
                <textarea className="flex-1 border border-slate-200 p-4 rounded-2xl font-mono text-xs focus:ring-2 focus:ring-indigo-500 outline-none resize-none bg-slate-50 text-slate-700 shadow-inner" value={jsonInput} onChange={(e) => setJsonInput(e.target.value)} placeholder='{ "clinics": [ ... ] }' />
              </div>
              
              <button onClick={handleAdminUpdate} className="bg-indigo-600 text-white py-4 rounded-2xl font-bold text-base hover:bg-indigo-700 transition-all shadow-lg hover:shadow-indigo-500/30">Sync to Server</button>
            </div>
          </div>
        )}

        {/* CHAT MESSAGES */}
        <div className="flex-1 p-5 overflow-y-auto bg-slate-50 flex flex-col gap-6 custom-scrollbar">
          {messages.map((msg, idx) => (
            <div key={msg.id} className={`flex w-full ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
              
              {/* BOT AVATAR */}
              {msg.sender === 'bot' && (
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-blue-600 flex items-center justify-center mr-2 shadow-sm flex-shrink-0 mt-1">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 text-white"><path d="M16.5 7.5h-9v9h9v-9z" /><path fillRule="evenodd" d="M8.25 2.25A.75.75 0 019 3v.75h2.25V3a.75.75 0 011.5 0v.75H15V3a.75.75 0 011.5 0v.75h.75a3 3 0 013 3v.75H21A.75.75 0 0121 9h-.75v2.25H21a.75.75 0 010 1.5h-.75V15H21a.75.75 0 010 1.5h-.75v.75a3 3 0 01-3 3h-.75V21a.75.75 0 01-1.5 0v-.75h-2.25V21a.75.75 0 01-1.5 0v-.75H9V21a.75.75 0 01-1.5 0v-.75h-.75a3 3 0 01-3-3v-.75H3A.75.75 0 013 15h.75v-2.25H3a.75.75 0 010-1.5h.75V9H3A.75.75 0 013 7.5h.75V6.75a3 3 0 013-3h.75V3a.75.75 0 01.75-.75zM6 6.75A1.5 1.5 0 017.5 5.25h9A1.5 1.5 0 0118 6.75v9a1.5 1.5 0 01-1.5 1.5h-9A1.5 1.5 0 016 15.75v-9zm4.5 4.5a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zm6 0a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z" clipRule="evenodd" /></svg>
                </div>
              )}

              <div className="flex flex-col max-w-[85%]"> 
                {/* MESSAGE BUBBLE */}
                <div className={`p-4 text-[15px] shadow-sm leading-relaxed ${
                    msg.sender === 'user' 
                      ? 'bg-indigo-600 text-white rounded-2xl rounded-tr-sm shadow-indigo-500/20' 
                      : 'bg-white text-slate-800 border border-slate-100 rounded-2xl rounded-tl-sm'
                }`}
                dangerouslySetInnerHTML={{ __html: msg.text.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>') }} 
                />
                
                {/* UPDATED UI: SIMPLE TIME SLOT PILLS */}
                {msg.slots && msg.slots.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2 w-full">
                    {msg.slots.map((slot, i) => (
                      <button 
                        key={i} 
                        onClick={() => handleQuickBookClick(slot)} 
                        className="bg-white border border-indigo-200 text-indigo-700 hover:bg-indigo-600 hover:text-white px-4 py-2 rounded-lg text-sm font-bold transition-all shadow-sm flex flex-col items-center justify-center min-w-[75px] hover:shadow-md"
                      >
                        <span>{slot.start_time}</span>
                        {/* Only shows the day abbreviation if the bot is showing mixed days */}
                        {msg.text.includes("other days") && (
                          <span className="text-[9px] font-normal uppercase mt-0.5 opacity-80">{slot.day.slice(0,3)}</span>
                        )}
                      </button>
                    ))}
                  </div>
                )}

                {/* PREMIUM CONFIRMATION TICKET */}
                {msg.booking_details && (
                  <div className="mt-4 bg-white border border-slate-200 rounded-2xl shadow-lg overflow-hidden flex flex-col">
                    <div className="bg-slate-50 border-b border-slate-100 p-3 flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-500 uppercase tracking-widest">Appointment Ticket</span>
                      <span className="flex h-2 w-2 relative"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span><span className="relative inline-flex rounded-full h-2 w-2 bg-indigo-500"></span></span>
                    </div>
                    <div className="p-5 flex flex-col gap-3">
                      <div>
                        <p className="text-[10px] text-slate-400 uppercase font-bold tracking-wider">Patient</p>
                        <p className="text-sm font-bold text-slate-800">{msg.booking_details.patient_name} <span className="text-slate-400 font-normal">({msg.booking_details.phone_number})</span></p>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <p className="text-[10px] text-slate-400 uppercase font-bold tracking-wider">Date & Time</p>
                          <p className="text-sm font-bold text-indigo-600">{msg.booking_details.day}, {msg.booking_details.time}</p>
                        </div>
                        <div>
                          <p className="text-[10px] text-slate-400 uppercase font-bold tracking-wider">Location</p>
                          <p className="text-sm font-bold text-slate-800 line-clamp-2">{msg.booking_details.clinic_name}</p>
                        </div>
                      </div>
                    </div>
                    <div className="p-3 bg-slate-50 border-t border-slate-100 flex gap-3">
                      <button onClick={() => confirmBooking(msg.booking_details, msg.id)} className="flex-1 bg-indigo-600 text-white py-2.5 rounded-xl text-sm font-bold hover:bg-indigo-700 transition-all shadow-md hover:shadow-indigo-500/30">Confirm</button>
                      <button onClick={() => cancelBooking(msg.id)} className="flex-1 bg-white border border-slate-200 text-slate-600 py-2.5 rounded-xl text-sm font-bold hover:bg-slate-100 transition-colors">Cancel</button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}

          {isTyping && (
            <div className="flex w-full justify-start items-center gap-2">
              <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center flex-shrink-0 animate-pulse">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 text-slate-400"><path d="M16.5 7.5h-9v9h9v-9z" /><path fillRule="evenodd" d="M8.25 2.25A.75.75 0 019 3v.75h2.25V3a.75.75 0 011.5 0v.75H15V3a.75.75 0 011.5 0v.75h.75a3 3 0 013 3v.75H21A.75.75 0 0121 9h-.75v2.25H21a.75.75 0 010 1.5h-.75V15H21a.75.75 0 010 1.5h-.75v.75a3 3 0 01-3 3h-.75V21a.75.75 0 01-1.5 0v-.75h-2.25V21a.75.75 0 01-1.5 0v-.75H9V21a.75.75 0 01-1.5 0v-.75h-.75a3 3 0 01-3-3v-.75H3A.75.75 0 013 15h.75v-2.25H3a.75.75 0 010-1.5h.75V9H3A.75.75 0 013 7.5h.75V6.75a3 3 0 013-3h.75V3a.75.75 0 01.75-.75zM6 6.75A1.5 1.5 0 017.5 5.25h9A1.5 1.5 0 0118 6.75v9a1.5 1.5 0 01-1.5 1.5h-9A1.5 1.5 0 016 15.75v-9zm4.5 4.5a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zm6 0a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z" clipRule="evenodd" /></svg>
              </div>
              <div className="bg-white border border-slate-100 p-3 rounded-2xl rounded-tl-sm flex gap-1 shadow-sm">
                <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce"></span>
                <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></span>
                <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '0.4s' }}></span>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* INPUT AREA */}
        <form onSubmit={handleSendMessage} className="p-4 bg-white border-t border-slate-100 flex gap-3 items-center sm:rounded-b-[2rem]">
          <button type="button" onClick={toggleRecording} className={`p-3 rounded-full transition-all duration-300 ${isRecording ? 'bg-red-500 text-white animate-pulse shadow-lg shadow-red-500/30 scale-110' : 'bg-slate-100 text-indigo-600 hover:bg-slate-200'}`}>
            {isRecording ? <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5"><path fillRule="evenodd" d="M4.5 7.5a3 3 0 013-3h9a3 3 0 013 3v9a3 3 0 01-3 3h-9a3 3 0 01-3-3v-9z" clipRule="evenodd" /></svg> : <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" /></svg>}
          </button>
          
          <input type="text" value={inputText} onChange={(e) => setInputText(e.target.value)} disabled={isRecording} placeholder={isRecording ? "Listening..." : "Message ClinicBot..."} className="flex-1 px-5 py-3 bg-slate-50 border border-slate-200 rounded-full focus:bg-white focus:border-indigo-500 focus:ring-4 focus:ring-indigo-50 outline-none text-[15px] transition-all disabled:opacity-50" />
          
          <button type="submit" disabled={!inputText.trim() || isTyping || isRecording} className="p-3 bg-indigo-600 text-white rounded-full transition-all disabled:opacity-50 hover:bg-indigo-700 shadow-md hover:shadow-indigo-500/30">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5 ml-0.5"><path d="M3.478 2.405a.75.75 0 00-.926.94l2.432 7.905H13.5a.75.75 0 010 1.5H4.984l-2.432 7.905a.75.75 0 00.926.94 60.519 60.519 0 0018.445-8.986.75.75 0 000-1.218A60.517 60.517 0 003.478 2.405z" /></svg>
          </button>
        </form>
      </div>
    </div>
  );
};

export default ClinicBookingChat;