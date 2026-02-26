import React, { useState, useRef, useEffect, useCallback } from 'react';

/* ─── Custom Dialog Hook ─── */
const useDialog = () => {
  const [dialog, setDialog] = useState(null);
  const resolveRef = useRef(null);

  const showAlert = useCallback((message, type = 'info') => {
    return new Promise((resolve) => {
      resolveRef.current = resolve;
      setDialog({ kind: 'alert', message, type });
    });
  }, []);

  const showConfirm = useCallback((message) => {
    return new Promise((resolve) => {
      resolveRef.current = resolve;
      setDialog({ kind: 'confirm', message });
    });
  }, []);

  const handleOk = () => { setDialog(null); resolveRef.current?.(true); };
  const handleCancel = () => { setDialog(null); resolveRef.current?.(false); };

  return { dialog, showAlert, showConfirm, handleOk, handleCancel };
};

const ClinicBookingChat = () => {
  const initialMessage = { id: 1, sender: 'bot', text: 'Hello! I am the Health4Travel Assistant. Tell me where and when you need a doctor.' };
  const [messages, setMessages] = useState([initialMessage]);
  const [inputText, setInputText] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isAdminOpen, setIsAdminOpen] = useState(false);
  const [jsonInput, setJsonInput] = useState('');
  const { dialog, showAlert, showConfirm, handleOk, handleCancel } = useDialog();

  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const messagesEndRef = useRef(null);

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const clearChat = async () => {
    const confirmed = await showConfirm("Start a new conversation? This will clear all messages.");
    if (confirmed) setMessages([initialMessage]);
  };

  const handleFileUpload = (e) => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try { setJsonInput(JSON.stringify(JSON.parse(event.target.result), null, 2)); }
      catch (error) { showAlert("Invalid JSON format. Please check your file.", 'error'); }
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
      await showAlert(data.message || "Database updated successfully!", 'success');
      setIsAdminOpen(false); setJsonInput('');
    } catch (e) { showAlert("Invalid JSON format. Please check your input.", 'error'); }
  };

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
    } catch (error) { showAlert("Microphone access is required to use voice input.", 'error'); }
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
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&family=DM+Serif+Display&display=swap');

        * { box-sizing: border-box; margin: 0; padding: 0; }

        .h4t-root {
          font-family: 'DM Sans', sans-serif;
          background: #e8f0f7;
          min-height: 100dvh;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 0;
        }

        /* subtle dot-grid background matching website feel */
        .h4t-root::before {
          content: '';
          position: fixed;
          inset: 0;
          background-image: radial-gradient(circle, #c5d8e8 1px, transparent 1px);
          background-size: 28px 28px;
          opacity: 0.35;
          pointer-events: none;
          z-index: 0;
        }

        .chat-shell {
          position: relative;
          z-index: 1;
          width: 100%;
          max-width: 480px;
          height: 100dvh;
          display: flex;
          flex-direction: column;
          background: #fff;
          border-radius: 0;
          overflow: hidden;
          box-shadow: 0 0 0 1px rgba(0,0,0,0.06);
        }

        @media (min-width: 600px) {
          .h4t-root { padding: 24px; }
          .chat-shell {
            height: min(780px, 95dvh);
            border-radius: 16px;
            box-shadow: 0 20px 60px rgba(18,50,80,0.18), 0 0 0 1px rgba(0,0,0,0.06);
          }
        }

        /* ─── HEADER ─── */
        .header-logo-bar {
          background: #fff;
          border-bottom: 1px solid #e2eaf1;
          padding: 14px 20px;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }
        .header-logo-bar img { height: 30px; display: block; }

        .header-nav {
          background: #183a59;
          padding: 10px 18px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          flex-shrink: 0;
        }

        .header-nav-left {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .status-badge {
          display: flex;
          align-items: center;
          gap: 6px;
          background: rgba(255,255,255,0.08);
          border: 1px solid rgba(255,255,255,0.12);
          padding: 5px 10px 5px 8px;
          border-radius: 20px;
        }

        .status-dot-ring {
          position: relative;
          width: 8px; height: 8px; flex-shrink: 0;
        }
        .status-dot-ring::before {
          content: '';
          position: absolute;
          inset: -2px;
          border-radius: 50%;
          background: rgba(52,211,153,0.35);
          animation: ping 1.5s cubic-bezier(0,0,0.2,1) infinite;
        }
        .status-dot-ring::after {
          content: '';
          position: absolute;
          inset: 0;
          border-radius: 50%;
          background: #34d399;
        }
        @keyframes ping {
          75%, 100% { transform: scale(2); opacity: 0; }
        }

        .status-label {
          font-size: 12.5px;
          font-weight: 600;
          color: #fff;
          letter-spacing: 0.01em;
        }

        .nav-actions { display: flex; gap: 6px; }

        .icon-btn {
          background: rgba(255,255,255,0.1);
          border: 1px solid rgba(255,255,255,0.12);
          color: #fff;
          width: 32px; height: 32px;
          border-radius: 8px;
          display: flex; align-items: center; justify-content: center;
          cursor: pointer;
          transition: background 0.15s;
        }
        .icon-btn:hover { background: rgba(255,255,255,0.2); }
        .icon-btn svg { width: 15px; height: 15px; }

        /* ─── MESSAGES ─── */
        .messages-body {
          flex: 1;
          overflow-y: auto;
          padding: 20px 16px;
          display: flex;
          flex-direction: column;
          gap: 16px;
          background: #f0f6fb;
          scroll-behavior: smooth;
        }
        .messages-body::-webkit-scrollbar { width: 4px; }
        .messages-body::-webkit-scrollbar-thumb { background: #c2d4e3; border-radius: 4px; }

        .msg-row { display: flex; width: 100%; }
        .msg-row.user { justify-content: flex-end; }
        .msg-row.bot { justify-content: flex-start; align-items: flex-end; gap: 8px; }

        .bot-avatar {
          width: 32px; height: 32px;
          border-radius: 50%;
          background: #183a59;
          display: flex; align-items: center; justify-content: center;
          flex-shrink: 0;
          box-shadow: 0 2px 8px rgba(24,58,89,0.25);
        }
        .bot-avatar svg { width: 16px; height: 16px; color: #fff; fill: #fff; }

        .msg-content { max-width: 82%; display: flex; flex-direction: column; gap: 8px; }

        .bubble {
          padding: 11px 15px;
          font-size: 14px;
          line-height: 1.55;
          word-break: break-word;
        }
        .bubble.bot {
          background: #fff;
          color: #1a2e3f;
          border-radius: 16px 16px 16px 4px;
          border: 1px solid #dce8f2;
          box-shadow: 0 2px 8px rgba(0,0,0,0.05);
        }
        .bubble.user {
          background: #183a59;
          color: #fff;
          border-radius: 16px 16px 4px 16px;
          box-shadow: 0 2px 10px rgba(24,58,89,0.3);
        }

        /* ─── SLOT BUTTONS ─── */
        .slots-grid {
          display: flex;
          flex-wrap: wrap;
          gap: 7px;
          padding-left: 2px;
        }

        .slot-btn {
          background: #fff;
          border: 1.5px solid #183a59;
          color: #183a59;
          padding: 7px 13px;
          border-radius: 8px;
          font-size: 13px;
          font-weight: 600;
          font-family: 'DM Sans', sans-serif;
          cursor: pointer;
          display: flex;
          flex-direction: column;
          align-items: center;
          transition: all 0.15s;
          min-width: 68px;
          box-shadow: 0 1px 4px rgba(0,0,0,0.06);
        }
        .slot-btn:hover {
          background: #183a59;
          color: #fff;
          transform: translateY(-1px);
          box-shadow: 0 4px 12px rgba(24,58,89,0.25);
        }
        .slot-btn-day {
          font-size: 10px;
          font-weight: 500;
          opacity: 0.7;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          margin-top: 2px;
        }

        /* ─── CONFIRMATION TICKET ─── */
        .ticket {
          background: #fff;
          border: 1px solid #dce8f2;
          border-radius: 12px;
          overflow: hidden;
          box-shadow: 0 4px 16px rgba(0,0,0,0.08);
        }

        .ticket-header {
          background: linear-gradient(135deg, #183a59 0%, #1e4d75 100%);
          padding: 12px 14px;
          display: flex;
          align-items: center;
          justify-content: space-between;
        }
        .ticket-header-label {
          font-size: 11px;
          font-weight: 700;
          color: rgba(255,255,255,0.7);
          text-transform: uppercase;
          letter-spacing: 0.08em;
        }
        .ticket-header-badge {
          background: rgba(52,211,153,0.2);
          border: 1px solid rgba(52,211,153,0.4);
          color: #34d399;
          font-size: 10px;
          font-weight: 700;
          padding: 2px 8px;
          border-radius: 20px;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }

        .ticket-body { padding: 14px; display: flex; flex-direction: column; gap: 12px; }

        .ticket-field label {
          display: block;
          font-size: 10px;
          font-weight: 700;
          color: #8fa9be;
          text-transform: uppercase;
          letter-spacing: 0.07em;
          margin-bottom: 3px;
        }
        .ticket-field p {
          font-size: 13.5px;
          font-weight: 600;
          color: #1a2e3f;
        }
        .ticket-field p span { color: #8fa9be; font-weight: 400; }
        .ticket-field.accent p { color: #183a59; }

        .ticket-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }

        .ticket-divider {
          border: none;
          border-top: 1px dashed #dce8f2;
          margin: 0 -14px;
        }

        .ticket-actions {
          display: flex;
          gap: 8px;
          padding: 12px 14px;
          background: #f7fafd;
          border-top: 1px solid #eef3f8;
        }

        .btn-confirm {
          flex: 1;
          background: #183a59;
          color: #fff;
          border: none;
          padding: 10px;
          border-radius: 8px;
          font-size: 13px;
          font-weight: 700;
          font-family: 'DM Sans', sans-serif;
          cursor: pointer;
          transition: background 0.15s, transform 0.1s;
        }
        .btn-confirm:hover { background: #112940; transform: translateY(-1px); }

        .btn-cancel {
          flex: 1;
          background: #fff;
          color: #64748b;
          border: 1.5px solid #dce8f2;
          padding: 10px;
          border-radius: 8px;
          font-size: 13px;
          font-weight: 600;
          font-family: 'DM Sans', sans-serif;
          cursor: pointer;
          transition: background 0.15s;
        }
        .btn-cancel:hover { background: #f1f5f9; }

        /* ─── TYPING ─── */
        .typing-row { display: flex; align-items: flex-end; gap: 8px; }
        .typing-bubble {
          background: #fff;
          border: 1px solid #dce8f2;
          border-radius: 16px 16px 16px 4px;
          padding: 12px 16px;
          display: flex;
          gap: 4px;
          align-items: center;
          box-shadow: 0 2px 8px rgba(0,0,0,0.05);
        }
        .typing-dot {
          width: 6px; height: 6px;
          background: #8fa9be;
          border-radius: 50%;
          animation: typingBounce 1.2s infinite;
        }
        .typing-dot:nth-child(2) { animation-delay: 0.2s; }
        .typing-dot:nth-child(3) { animation-delay: 0.4s; }
        @keyframes typingBounce {
          0%, 60%, 100% { transform: translateY(0); opacity: 0.5; }
          30% { transform: translateY(-5px); opacity: 1; }
        }

        /* ─── INPUT AREA ─── */
        .input-area {
          background: #fff;
          border-top: 1px solid #e2eaf1;
          padding: 12px 14px;
          display: flex;
          gap: 8px;
          align-items: center;
          flex-shrink: 0;
        }

        .mic-btn {
          width: 42px; height: 42px;
          border-radius: 50%;
          border: none;
          display: flex; align-items: center; justify-content: center;
          cursor: pointer;
          flex-shrink: 0;
          transition: all 0.2s;
        }
        .mic-btn.idle {
          background: #f0f6fb;
          color: #183a59;
        }
        .mic-btn.idle:hover { background: #dde9f4; }
        .mic-btn.recording {
          background: #ef4444;
          color: #fff;
          animation: recPulse 1.2s infinite;
        }
        .mic-btn svg { width: 18px; height: 18px; }
        @keyframes recPulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(239,68,68,0.4); }
          50% { box-shadow: 0 0 0 8px rgba(239,68,68,0); }
        }

        .text-input {
          flex: 1;
          height: 42px;
          padding: 0 16px;
          background: #f5f9fc;
          border: 1.5px solid #dce8f2;
          border-radius: 21px;
          font-size: 14px;
          font-family: 'DM Sans', sans-serif;
          color: #1a2e3f;
          outline: none;
          transition: border-color 0.15s, background 0.15s;
        }
        .text-input::placeholder { color: #a0b5c5; }
        .text-input:focus {
          border-color: #183a59;
          background: #fff;
          box-shadow: 0 0 0 3px rgba(24,58,89,0.08);
        }
        .text-input:disabled { opacity: 0.5; }

        .send-btn {
          width: 42px; height: 42px;
          border-radius: 50%;
          background: #183a59;
          border: none;
          color: #fff;
          display: flex; align-items: center; justify-content: center;
          cursor: pointer;
          flex-shrink: 0;
          transition: all 0.15s;
          box-shadow: 0 2px 8px rgba(24,58,89,0.3);
        }
        .send-btn:hover:not(:disabled) {
          background: #112940;
          transform: scale(1.05);
          box-shadow: 0 4px 14px rgba(24,58,89,0.4);
        }
        .send-btn:disabled { opacity: 0.4; cursor: not-allowed; }
        .send-btn svg { width: 17px; height: 17px; margin-left: 1px; }

        /* ─── ADMIN MODAL ─── */
        .modal-overlay {
          position: absolute;
          inset: 0;
          z-index: 50;
          display: flex;
          flex-direction: column;
        }
        .modal-backdrop {
          position: absolute;
          inset: 0;
          background: rgba(15,30,45,0.45);
          backdrop-filter: blur(4px);
        }
        .modal-sheet {
          position: relative;
          margin-top: auto;
          background: #fff;
          border-radius: 20px 20px 0 0;
          padding: 0;
          height: 80%;
          display: flex;
          flex-direction: column;
          border-top: 1px solid #dce8f2;
          box-shadow: 0 -8px 40px rgba(0,0,0,0.12);
          overflow: hidden;
        }
        .modal-handle {
          width: 36px; height: 4px;
          background: #dce8f2;
          border-radius: 2px;
          margin: 12px auto 0;
          flex-shrink: 0;
        }
        .modal-inner {
          flex: 1;
          overflow-y: auto;
          padding: 20px 20px 24px;
          display: flex;
          flex-direction: column;
          gap: 16px;
        }
        .modal-title-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
        }
        .modal-title {
          font-size: 18px;
          font-weight: 700;
          color: #1a2e3f;
          font-family: 'DM Serif Display', serif;
        }
        .modal-close {
          background: #f0f4f8;
          border: none;
          color: #64748b;
          width: 32px; height: 32px;
          border-radius: 50%;
          display: flex; align-items: center; justify-content: center;
          cursor: pointer;
        }
        .modal-close:hover { background: #e2e8f0; }
        .modal-close svg { width: 16px; height: 16px; }

        .upload-zone {
          background: #f5f9fc;
          border: 1.5px dashed #b8d0e4;
          border-radius: 10px;
          padding: 16px;
        }
        .upload-zone label {
          display: block;
          font-size: 11px;
          font-weight: 700;
          color: #183a59;
          text-transform: uppercase;
          letter-spacing: 0.07em;
          margin-bottom: 10px;
        }
        .file-input {
          display: block;
          width: 100%;
          font-size: 13px;
          color: #64748b;
          font-family: 'DM Sans', sans-serif;
        }
        .file-input::file-selector-button {
          background: #183a59;
          color: #fff;
          border: none;
          padding: 6px 14px;
          border-radius: 6px;
          font-size: 12px;
          font-weight: 600;
          font-family: 'DM Sans', sans-serif;
          cursor: pointer;
          margin-right: 10px;
          transition: background 0.15s;
        }
        .file-input::file-selector-button:hover { background: #112940; }

        .paste-label {
          font-size: 11px;
          font-weight: 700;
          color: #8fa9be;
          text-transform: uppercase;
          letter-spacing: 0.07em;
          margin-bottom: 6px;
          display: block;
        }
        .json-textarea {
          flex: 1;
          min-height: 160px;
          border: 1.5px solid #dce8f2;
          border-radius: 10px;
          padding: 12px;
          font-family: 'Courier New', monospace;
          font-size: 12px;
          color: #1a2e3f;
          background: #f8fbfd;
          outline: none;
          resize: none;
          transition: border-color 0.15s;
          width: 100%;
        }
        .json-textarea:focus { border-color: #183a59; }
        .json-textarea::placeholder { color: #b0c4d4; }

        .sync-btn {
          background: #183a59;
          color: #fff;
          border: none;
          padding: 13px;
          border-radius: 10px;
          font-size: 14px;
          font-weight: 700;
          font-family: 'DM Sans', sans-serif;
          cursor: pointer;
          width: 100%;
          transition: background 0.15s;
          letter-spacing: 0.02em;
        }
        .sync-btn:hover { background: #112940; }

        /* ─── CUSTOM DIALOG ─── */
        .dialog-overlay {
          position: fixed;
          inset: 0;
          z-index: 200;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 20px;
          background: rgba(10, 25, 40, 0.5);
          backdrop-filter: blur(6px);
          animation: dialogFadeIn 0.15s ease;
        }
        @keyframes dialogFadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        .dialog-box {
          background: #fff;
          border-radius: 16px;
          box-shadow: 0 24px 64px rgba(18, 50, 80, 0.22), 0 0 0 1px rgba(0,0,0,0.05);
          width: 100%;
          max-width: 340px;
          overflow: hidden;
          animation: dialogSlideUp 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
        }
        @keyframes dialogSlideUp {
          from { transform: translateY(16px) scale(0.97); opacity: 0; }
          to { transform: translateY(0) scale(1); opacity: 1; }
        }
        .dialog-icon-bar {
          padding: 24px 24px 0;
          display: flex;
          justify-content: center;
        }
        .dialog-icon {
          width: 52px; height: 52px;
          border-radius: 50%;
          display: flex; align-items: center; justify-content: center;
          flex-shrink: 0;
        }
        .dialog-icon.success { background: #ecfdf5; }
        .dialog-icon.error   { background: #fef2f2; }
        .dialog-icon.confirm { background: #eff6ff; }
        .dialog-icon.info    { background: #f0f6fb; }
        .dialog-icon svg { width: 26px; height: 26px; }

        .dialog-body {
          padding: 16px 24px 24px;
          text-align: center;
        }
        .dialog-title {
          font-size: 15px;
          font-weight: 700;
          color: #1a2e3f;
          margin-bottom: 6px;
          font-family: 'DM Sans', sans-serif;
        }
        .dialog-message {
          font-size: 13.5px;
          color: #5a7a92;
          line-height: 1.55;
          font-family: 'DM Sans', sans-serif;
        }
        .dialog-actions {
          padding: 0 16px 16px;
          display: flex;
          gap: 8px;
        }
        .dialog-btn-primary {
          flex: 1;
          padding: 11px;
          border-radius: 9px;
          border: none;
          font-size: 13.5px;
          font-weight: 700;
          font-family: 'DM Sans', sans-serif;
          cursor: pointer;
          transition: all 0.15s;
        }
        .dialog-btn-primary.navy {
          background: #183a59;
          color: #fff;
        }
        .dialog-btn-primary.navy:hover { background: #112940; }
        .dialog-btn-primary.green {
          background: #059669;
          color: #fff;
        }
        .dialog-btn-primary.green:hover { background: #047857; }
        .dialog-btn-primary.red {
          background: #dc2626;
          color: #fff;
        }
        .dialog-btn-primary.red:hover { background: #b91c1c; }
        .dialog-btn-secondary {
          flex: 1;
          padding: 11px;
          border-radius: 9px;
          border: 1.5px solid #dce8f2;
          background: #fff;
          color: #64748b;
          font-size: 13.5px;
          font-weight: 600;
          font-family: 'DM Sans', sans-serif;
          cursor: pointer;
          transition: background 0.15s;
        }
        .dialog-btn-secondary:hover { background: #f5f9fc; }

        /* ─── FOOTER WATERMARK ─── */
        .powered-by {
          text-align: center;
          padding: 6px;
          font-size: 10.5px;
          color: #a0b5c5;
          background: #f5f9fc;
          border-top: 1px solid #e8f0f7;
          letter-spacing: 0.02em;
          flex-shrink: 0;
        }
        .powered-by span { font-weight: 600; color: #183a59; }
      `}</style>

      <div className="h4t-root">
        <div className="chat-shell">

          {/* ── HEADER ── */}
          <div className="header-logo-bar">
            <img
              src="https://customer.health4travel.com/static/media/h4tLogo.3b3f9bb3bc531faa471910633d743d52.svg"
              alt="Health4Travel"
            />
          </div>

          <div className="header-nav">
            <div className="status-badge">
              <div className="status-dot-ring" />
              <span className="status-label">Smart Clinic Assistant</span>
            </div>
            <div className="nav-actions">
              <button onClick={clearChat} className="icon-btn" title="New conversation">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
                </svg>
              </button>
              <button onClick={() => setIsAdminOpen(true)} className="icon-btn" title="Database settings">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </button>
            </div>
          </div>

          {/* ── ADMIN MODAL ── */}
          {isAdminOpen && (
            <div className="modal-overlay">
              <div className="modal-backdrop" onClick={() => setIsAdminOpen(false)} />
              <div className="modal-sheet">
                <div className="modal-handle" />
                <div className="modal-inner">
                  <div className="modal-title-row">
                    <h2 className="modal-title">Database Manager</h2>
                    <button onClick={() => setIsAdminOpen(false)} className="modal-close">
                      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>

                  <div className="upload-zone">
                    <label>1. Upload JSON File</label>
                    <input type="file" accept=".json" onChange={handleFileUpload} className="file-input" />
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', flex: 1, gap: 6 }}>
                    <span className="paste-label">2. Or Paste Content Directly</span>
                    <textarea
                      className="json-textarea"
                      value={jsonInput}
                      onChange={(e) => setJsonInput(e.target.value)}
                      placeholder='{ "clinics": [ ... ] }'
                    />
                  </div>

                  <button onClick={handleAdminUpdate} className="sync-btn">Sync to Server</button>
                </div>
              </div>
            </div>
          )}

          {/* ── MESSAGES ── */}
          <div className="messages-body">
            {messages.map((msg) => (
              <div key={msg.id} className={`msg-row ${msg.sender}`}>
                {msg.sender === 'bot' && (
                  <div className="bot-avatar">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="white">
                      <path d="M11.25 4.533A9.707 9.707 0 006 3a9.735 9.735 0 00-3.25.555.75.75 0 00-.5.707v14.25a.75.75 0 001 .707A8.237 8.237 0 016 17.25c1.74 0 3.354.536 4.688 1.44a.75.75 0 00.824 0A8.237 8.237 0 0116.25 17.25c1.74 0 3.354.536 4.688 1.44a.75.75 0 001-.707V4.262a.75.75 0 00-.5-.707A9.735 9.735 0 0018 3a9.707 9.707 0 00-5.25 1.533.75.75 0 00-.75 0zM12 8.25a.75.75 0 01.75.75v1.5h1.5a.75.75 0 010 1.5h-1.5v1.5a.75.75 0 01-1.5 0v-1.5h-1.5a.75.75 0 010-1.5h1.5V9a.75.75 0 01.75-.75z" />
                    </svg>
                  </div>
                )}

                <div className="msg-content">
                  <div
                    className={`bubble ${msg.sender}`}
                    dangerouslySetInnerHTML={{ __html: msg.text.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>') }}
                  />

                  {msg.slots && msg.slots.length > 0 && (
                    <div className="slots-grid">
                      {msg.slots.map((slot, i) => (
                        <button key={i} onClick={() => handleQuickBookClick(slot)} className="slot-btn">
                          <span>{slot.start_time}</span>
                          {msg.text.includes("other days") && (
                            <span className="slot-btn-day">{slot.day.slice(0, 3)}</span>
                          )}
                        </button>
                      ))}
                    </div>
                  )}

                  {msg.booking_details && (
                    <div className="ticket">
                      <div className="ticket-header">
                        <span className="ticket-header-label">Appointment Ticket</span>
                        <span className="ticket-header-badge">Pending</span>
                      </div>
                      <div className="ticket-body">
                        <div className="ticket-field">
                          <label>Patient</label>
                          <p>{msg.booking_details.patient_name} <span>({msg.booking_details.phone_number})</span></p>
                        </div>
                        <hr className="ticket-divider" />
                        <div className="ticket-grid">
                          <div className="ticket-field accent">
                            <label>Date &amp; Time</label>
                            <p>{msg.booking_details.day}, {msg.booking_details.time}</p>
                          </div>
                          <div className="ticket-field">
                            <label>Location</label>
                            <p style={{ fontSize: 12.5 }}>{msg.booking_details.clinic_name}</p>
                          </div>
                        </div>
                      </div>
                      <div className="ticket-actions">
                        <button onClick={() => confirmBooking(msg.booking_details, msg.id)} className="btn-confirm">Confirm</button>
                        <button onClick={() => cancelBooking(msg.id)} className="btn-cancel">Cancel</button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))}

            {isTyping && (
              <div className="typing-row">
                <div className="bot-avatar">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="white">
                    <path d="M11.25 4.533A9.707 9.707 0 006 3a9.735 9.735 0 00-3.25.555.75.75 0 00-.5.707v14.25a.75.75 0 001 .707A8.237 8.237 0 016 17.25c1.74 0 3.354.536 4.688 1.44a.75.75 0 00.824 0A8.237 8.237 0 0116.25 17.25c1.74 0 3.354.536 4.688 1.44a.75.75 0 001-.707V4.262a.75.75 0 00-.5-.707A9.735 9.735 0 0018 3a9.707 9.707 0 00-5.25 1.533.75.75 0 00-.75 0zM12 8.25a.75.75 0 01.75.75v1.5h1.5a.75.75 0 010 1.5h-1.5v1.5a.75.75 0 01-1.5 0v-1.5h-1.5a.75.75 0 010-1.5h1.5V9a.75.75 0 01.75-.75z" />
                  </svg>
                </div>
                <div className="typing-bubble">
                  <div className="typing-dot" />
                  <div className="typing-dot" />
                  <div className="typing-dot" />
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* ── INPUT ── */}
          <form onSubmit={handleSendMessage} className="input-area">
            <button
              type="button"
              onClick={toggleRecording}
              className={`mic-btn ${isRecording ? 'recording' : 'idle'}`}
              title={isRecording ? 'Stop recording' : 'Start voice input'}
            >
              {isRecording
                ? <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path fillRule="evenodd" d="M4.5 7.5a3 3 0 013-3h9a3 3 0 013 3v9a3 3 0 01-3 3h-9a3 3 0 01-3-3v-9z" clipRule="evenodd" /></svg>
                : <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" /></svg>
              }
            </button>

            <input
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              disabled={isRecording}
              placeholder={isRecording ? 'Listening…' : 'Message H4T Assistant…'}
              className="text-input"
            />

            <button
              type="submit"
              disabled={!inputText.trim() || isTyping || isRecording}
              className="send-btn"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
                <path d="M3.478 2.405a.75.75 0 00-.926.94l2.432 7.905H13.5a.75.75 0 010 1.5H4.984l-2.432 7.905a.75.75 0 00.926.94 60.519 60.519 0 0018.445-8.986.75.75 0 000-1.218A60.517 60.517 0 003.478 2.405z" />
              </svg>
            </button>
          </form>

        <div className="powered-by">Powered by <span>Health4Travel</span></div>
        </div>

        {/* ── CUSTOM DIALOG ── */}
        {dialog && (
          <div className="dialog-overlay" onClick={(e) => { if (e.target === e.currentTarget && dialog.kind === 'alert') handleOk(); }}>
            <div className="dialog-box">
              <div className="dialog-icon-bar">
                {dialog.kind === 'confirm' && (
                  <div className="dialog-icon confirm">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="#2563eb">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
                    </svg>
                  </div>
                )}
                {dialog.kind === 'alert' && dialog.type === 'success' && (
                  <div className="dialog-icon success">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="#059669">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                )}
                {dialog.kind === 'alert' && dialog.type === 'error' && (
                  <div className="dialog-icon error">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="#dc2626">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                    </svg>
                  </div>
                )}
                {dialog.kind === 'alert' && dialog.type === 'info' && (
                  <div className="dialog-icon info">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="#183a59">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
                    </svg>
                  </div>
                )}
              </div>

              <div className="dialog-body">
                <p className="dialog-title">
                  {dialog.kind === 'confirm' && 'New Conversation'}
                  {dialog.kind === 'alert' && dialog.type === 'success' && 'Success'}
                  {dialog.kind === 'alert' && dialog.type === 'error' && 'Something went wrong'}
                  {dialog.kind === 'alert' && dialog.type === 'info' && 'Notice'}
                </p>
                <p className="dialog-message">{dialog.message}</p>
              </div>

              <div className="dialog-actions">
                {dialog.kind === 'confirm' && (
                  <>
                    <button onClick={handleCancel} className="dialog-btn-secondary">Keep Chat</button>
                    <button onClick={handleOk} className="dialog-btn-primary navy">Yes, Reset</button>
                  </>
                )}
                {dialog.kind === 'alert' && dialog.type === 'success' && (
                  <button onClick={handleOk} className="dialog-btn-primary green" style={{flex:'unset',width:'100%'}}>Got it</button>
                )}
                {dialog.kind === 'alert' && dialog.type === 'error' && (
                  <button onClick={handleOk} className="dialog-btn-primary red" style={{flex:'unset',width:'100%'}}>Dismiss</button>
                )}
                {dialog.kind === 'alert' && dialog.type === 'info' && (
                  <button onClick={handleOk} className="dialog-btn-primary navy" style={{flex:'unset',width:'100%'}}>OK</button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
};

export default ClinicBookingChat;