import React, { useState, useRef, useEffect } from 'react';

const ClinicBookingChat = () => {
  const initialMessage = { id: 1, sender: 'bot', text: 'Hello! I am the Health4Travel Assistant. Tell me where and when you need a doctor.' };
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
    <div className="flex flex-col items-center justify-center min-h-screen bg-[#edf5fa] text-black p-4 font-sans sm:py-8">
      <div className="w-full max-w-lg bg-white sm:rounded-2xl shadow-xl overflow-hidden flex flex-col h-[100dvh] sm:h-[720px] sm:max-h-[95vh] border border-gray-200 relative">
        
        {/* EXACT HEALTH4TRAVEL HEADER */}
        <div className="flex flex-col z-10 sm:rounded-t-2xl overflow-hidden shadow-sm border-b border-gray-200">
          
          {/* Top Header: White Background with Official Logo */}
          <div className="bg-white py-4 flex justify-center items-center">
            <img 
              src="https://customer.health4travel.com/static/media/h4tLogo.3b3f9bb3bc531faa471910633d743d52.svg" 
              alt="Health4Travel Logo" 
              className="h-8" 
            />
          </div>

          {/* Bottom Header Navigation: #183a59 Background with White Text */}
          <div className="bg-[#183a59] text-white p-3 flex justify-between items-center px-5">
            <div className="font-semibold text-[16px] tracking-wide flex items-center gap-2">
              Smart Clinic Assistant
            </div>
            <div className="flex items-center gap-2">
              <button onClick={clearChat} title="Reset Chat" className="p-1.5 bg-white/10 hover:bg-white/20 rounded-md transition-colors text-white">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" /></svg>
              </button>
              <button onClick={() => setIsAdminOpen(true)} title="Settings" className="p-1.5 bg-white/10 hover:bg-white/20 rounded-md transition-colors text-white">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
              </button>
            </div>
          </div>
        </div>

        {/* GLASSMORPHISM ADMIN MODAL */}
        {isAdminOpen && (
          <div className="absolute inset-0 z-50 flex flex-col animate-in fade-in duration-200">
            <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={() => setIsAdminOpen(false)}></div>
            <div className="relative mt-auto bg-white rounded-t-2xl shadow-2xl p-6 flex flex-col gap-5 h-[80%] border-t border-gray-200">
              <div className="flex justify-between items-center">
                <h2 className="font-bold text-black text-xl">Database Manager</h2>
                <button onClick={() => setIsAdminOpen(false)} className="bg-gray-100 text-gray-500 hover:bg-gray-200 p-2 rounded-full transition-colors"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg></button>
              </div>
              
              <div className="bg-[#edf5fa] p-4 rounded-xl border border-blue-100">
                <label className="block text-xs font-bold text-[#183a59] uppercase tracking-wider mb-3">1. Upload JSON File</label>
                <input type="file" accept=".json" onChange={handleFileUpload} className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-[#183a59] file:text-white hover:file:bg-[#112940] cursor-pointer transition-colors" />
              </div>

              <div className="flex-1 flex flex-col">
                <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">2. Or Paste Content Directly</label>
                <textarea className="flex-1 border border-gray-200 p-4 rounded-xl font-mono text-xs focus:ring-2 focus:ring-[#183a59] outline-none resize-none bg-gray-50 text-black shadow-inner" value={jsonInput} onChange={(e) => setJsonInput(e.target.value)} placeholder='{ "clinics": [ ... ] }' />
              </div>
              
              <button onClick={handleAdminUpdate} className="bg-[#183a59] text-white py-4 rounded-xl font-bold text-base hover:bg-[#112940] transition-colors shadow-md">Sync to Server</button>
            </div>
          </div>
        )}

        {/* CHAT MESSAGES BODY: Uses #edf5fa (Body Background Color) */}
        <div className="flex-1 p-5 overflow-y-auto bg-[#edf5fa] flex flex-col gap-5 custom-scrollbar">
          {messages.map((msg, idx) => (
            <div key={msg.id} className={`flex w-full ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
              
              {/* BOT AVATAR */}
              {msg.sender === 'bot' && (
                <div className="w-8 h-8 rounded-full bg-[#183a59] flex items-center justify-center mr-2 shadow flex-shrink-0 mt-1">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 text-white"><path d="M11.25 4.533A9.707 9.707 0 006 3a9.735 9.735 0 00-3.25.555.75.75 0 00-.5.707v14.25a.75.75 0 001 .707A8.237 8.237 0 016 17.25c1.74 0 3.354.536 4.688 1.44a.75.75 0 00.824 0A8.237 8.237 0 0116.25 17.25c1.74 0 3.354.536 4.688 1.44a.75.75 0 001-.707V4.262a.75.75 0 00-.5-.707A9.735 9.735 0 0018 3a9.707 9.707 0 00-5.25 1.533.75.75 0 00-.75 0zM12 8.25a.75.75 0 01.75.75v1.5h1.5a.75.75 0 010 1.5h-1.5v1.5a.75.75 0 01-1.5 0v-1.5h-1.5a.75.75 0 010-1.5h1.5V9a.75.75 0 01.75-.75z" /></svg>
                </div>
              )}

              <div className="flex flex-col max-w-[85%]"> 
                {/* MESSAGE BUBBLE */}
                <div className={`p-4 text-[15px] shadow-sm leading-relaxed ${
                    msg.sender === 'user' 
                      ? 'bg-[#183a59] text-white rounded-2xl rounded-tr-sm' 
                      : 'bg-white text-black border border-gray-200 rounded-2xl rounded-tl-sm'
                }`}
                dangerouslySetInnerHTML={{ __html: msg.text.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>') }} 
                />
                
                {/* BUTTONS (H4T Blue outline) */}
                {msg.slots && msg.slots.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2 w-full">
                    {msg.slots.map((slot, i) => (
                      <button 
                        key={i} 
                        onClick={() => handleQuickBookClick(slot)} 
                        className="bg-white border border-[#183a59] text-[#183a59] hover:bg-[#183a59] hover:text-white px-4 py-2 rounded-lg text-sm font-semibold transition-colors shadow-sm flex flex-col items-center justify-center min-w-[75px]"
                      >
                        <span>{slot.start_time}</span>
                        {msg.text.includes("other days") && (
                          <span className="text-[10px] font-medium uppercase mt-0.5 opacity-80">{slot.day.slice(0,3)}</span>
                        )}
                      </button>
                    ))}
                  </div>
                )}

                {/* PREMIUM CONFIRMATION TICKET */}
                {msg.booking_details && (
                  <div className="mt-4 bg-white border border-gray-200 rounded-xl shadow-md overflow-hidden flex flex-col">
                    <div className="bg-gray-50 border-b border-gray-200 p-3 flex items-center justify-between">
                      <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">Appointment Ticket</span>
                      <span className="flex h-2 w-2 relative"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span><span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span></span>
                    </div>
                    <div className="p-4 flex flex-col gap-3">
                      <div>
                        <p className="text-[10px] text-gray-400 uppercase font-semibold tracking-wider">Patient</p>
                        <p className="text-sm font-bold text-black">{msg.booking_details.patient_name} <span className="text-gray-400 font-normal">({msg.booking_details.phone_number})</span></p>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <p className="text-[10px] text-gray-400 uppercase font-semibold tracking-wider">Date & Time</p>
                          <p className="text-sm font-bold text-[#183a59]">{msg.booking_details.day}, {msg.booking_details.time}</p>
                        </div>
                        <div>
                          <p className="text-[10px] text-gray-400 uppercase font-semibold tracking-wider">Location</p>
                          <p className="text-sm font-bold text-black line-clamp-2">{msg.booking_details.clinic_name}</p>
                        </div>
                      </div>
                    </div>
                    <div className="p-3 bg-gray-50 border-t border-gray-200 flex gap-2">
                      <button onClick={() => confirmBooking(msg.booking_details, msg.id)} className="flex-1 bg-[#183a59] text-white py-2 rounded-lg text-sm font-bold hover:bg-[#112940] transition-colors shadow-sm">Confirm</button>
                      <button onClick={() => cancelBooking(msg.id)} className="flex-1 bg-white border border-gray-300 text-gray-600 py-2 rounded-lg text-sm font-bold hover:bg-gray-100 transition-colors">Cancel</button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>

        {/* INPUT AREA */}
        <form onSubmit={handleSendMessage} className="p-3 bg-white border-t border-gray-200 flex gap-2 items-center sm:rounded-b-2xl">
          <button type="button" onClick={toggleRecording} className={`p-3 rounded-full transition-all duration-300 ${isRecording ? 'bg-red-500 text-white animate-pulse shadow-md scale-105' : 'bg-gray-100 text-[#183a59] hover:bg-gray-200'}`}>
            {isRecording ? <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5"><path fillRule="evenodd" d="M4.5 7.5a3 3 0 013-3h9a3 3 0 013 3v9a3 3 0 01-3 3h-9a3 3 0 01-3-3v-9z" clipRule="evenodd" /></svg> : <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" /></svg>}
          </button>
          
          <input type="text" value={inputText} onChange={(e) => setInputText(e.target.value)} disabled={isRecording} placeholder={isRecording ? "Listening..." : "Message H4T Assistant..."} className="flex-1 px-4 py-3 bg-gray-50 border border-gray-200 rounded-full focus:bg-white focus:border-[#183a59] focus:ring-2 focus:ring-[#edf5fa] outline-none text-[15px] transition-all disabled:opacity-50 text-black" />
          
          <button type="submit" disabled={!inputText.trim() || isTyping || isRecording} className="p-3 bg-[#183a59] text-white rounded-full transition-colors disabled:opacity-50 hover:bg-[#112940] shadow-md">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5 ml-0.5"><path d="M3.478 2.405a.75.75 0 00-.926.94l2.432 7.905H13.5a.75.75 0 010 1.5H4.984l-2.432 7.905a.75.75 0 00.926.94 60.519 60.519 0 0018.445-8.986.75.75 0 000-1.218A60.517 60.517 0 003.478 2.405z" /></svg>
          </button>
        </form>
      </div>
    </div>
  );
};

export default ClinicBookingChat;