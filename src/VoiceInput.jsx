import React,{useEffect,useRef,useState} from 'react';
import {Icon} from './ui.jsx';

export default function VoiceInput({disabled,visible,onListening,onVoiceNote}){
 const recorder=useRef(null),chunks=useRef([]),started=useRef(0);
 const [recording,setRecording]=useState(false);
 const [paused,setPaused]=useState(false);
 const [sending,setSending]=useState(false);
 const [elapsed,setElapsed]=useState(0);
 const [message,setMessage]=useState('');
 const [amplitudes,setAmplitudes]=useState([20,35,50,30,65,40,25,55,30,45,60,35,20,50,40,25,55,30,60,35]);
 
 const audioCtxRef=useRef(null);
 const analyserRef=useRef(null);
 const animFrameRef=useRef(null);
 const streamRef=useRef(null);
 const discardRef=useRef(false);

 const supported=typeof window!=='undefined'&&!!navigator.mediaDevices?.getUserMedia&&!!window.MediaRecorder;

 useEffect(()=>{
  return ()=>{
   cleanupMedia();
  };
 },[]);

 useEffect(()=>{
  if(disabled||(!visible&&recording)) discard();
 },[disabled,visible,recording]);

 useEffect(()=>{
  if(!recording||paused) return;
  const timer=setInterval(()=>setElapsed(Math.floor((Date.now()-started.current)/1000)),250);
  return()=>clearInterval(timer);
 },[recording,paused]);

 function cleanupMedia(){
  if(animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
  if(audioCtxRef.current){
   try{ audioCtxRef.current.close() }catch(_){}
   audioCtxRef.current=null;
  }
  if(streamRef.current){
   streamRef.current.getTracks().forEach(t=>t.stop());
   streamRef.current=null;
  }
 }

 async function start(){
  if(!supported){setMessage('Voice notes are unavailable in this browser.');return}
  if(!window.isSecureContext){setMessage('Microphone access requires HTTPS or localhost.');return}
  try{
   const stream=await navigator.mediaDevices.getUserMedia({audio:true});
   streamRef.current=stream;
   const type=MediaRecorder.isTypeSupported('audio/webm;codecs=opus')?'audio/webm;codecs=opus':'audio/mp4';
   const r=new MediaRecorder(stream,{mimeType:type});
   chunks.current=[];
   discardRef.current=false;

   r.ondataavailable=e=>{if(e.data.size)chunks.current.push(e.data)};
   r.onstop=async()=>{
    cleanupMedia();
    setRecording(false);
    setPaused(false);
    onListening(false);
    if(discardRef.current){
     chunks.current=[];
     return;
    }
    const blob=new Blob(chunks.current,{type:r.mimeType});
    if(!blob.size) return;
    setSending(true);
    try{
     await onVoiceNote(blob);
    }finally{
     setSending(false);
    }
   };

   // Audio visualizer analysis for dynamic WhatsApp-like waveform
   try{
    const AudioContext=window.AudioContext||window.webkitAudioContext;
    if(AudioContext){
     const ctx=new AudioContext();
     audioCtxRef.current=ctx;
     const src=ctx.createMediaStreamSource(stream);
     const analyser=ctx.createAnalyser();
     analyser.fftSize=64;
     src.connect(analyser);
     analyserRef.current=analyser;

     const dataArray=new Uint8Array(analyser.frequencyBinCount);
     const updateWaveform=()=>{
      if(!analyserRef.current) return;
      analyserRef.current.getByteFrequencyData(dataArray);
      let sum=0;
      for(let i=0;i<dataArray.length;i++) sum+=dataArray[i];
      const avg=sum/dataArray.length;
      const normalized=Math.min(100,Math.max(15,Math.round((avg/128)*100)));
      setAmplitudes(prev=>[...prev.slice(1),normalized]);
      animFrameRef.current=requestAnimationFrame(updateWaveform);
     };
     updateWaveform();
    }
   }catch(_){}

   recorder.current=r;
   started.current=Date.now();
   setElapsed(0);
   setMessage('');
   setPaused(false);
   setRecording(true);
   onListening(true);
   r.start(100);
  }catch(e){
   setMessage(e.name==='NotAllowedError'?'Microphone permission was denied.':'Could not start recording.');
   onListening(false);
  }
 }

 function stopAndSend(){
  if(recorder.current?.state==='recording'||recorder.current?.state==='paused'){
   discardRef.current=false;
   recorder.current.stop();
  }
 }

 function discard(){
  discardRef.current=true;
  if(recorder.current?.state==='recording'||recorder.current?.state==='paused'){
   recorder.current.stop();
  }else{
   setRecording(false);
   setPaused(false);
   onListening(false);
  }
 }

 function togglePause(){
  if(!recorder.current) return;
  if(recorder.current.state==='recording'){
   recorder.current.pause();
   setPaused(true);
   if(audioCtxRef.current?.state==='running') audioCtxRef.current.suspend();
  }else if(recorder.current.state==='paused'){
   recorder.current.resume();
   setPaused(false);
   if(audioCtxRef.current?.state==='suspended') audioCtxRef.current.resume();
  }
 }

 const time=`${Math.floor(elapsed/60)}:${String(elapsed%60).padStart(2,'0')}`;

 if(recording){
  return (
   <div className="whatsapp-audio-bar" role="region" aria-label="Audio recording">
    <button type="button" className="wa-btn wa-trash-btn" onClick={discard} title="Delete recording" aria-label="Delete recording">
     <Icon name="trash" size={18}/>
    </button>
    <div className="wa-rec-indicator">
     <span className={'wa-red-dot'+(paused?' paused':'')}/>
     <span className="wa-time">{time}</span>
    </div>
    <div className="wa-waveform" aria-hidden="true">
     {amplitudes.map((height,i)=>(
      <span
       key={i}
       className="wa-bar"
       style={{
        height:`${paused?18:Math.max(6,height*0.28)}px`,
        opacity:i<amplitudes.length/2?0.6:1
       }}
      />
     ))}
    </div>
    <button type="button" className="wa-btn wa-pause-btn" onClick={togglePause} title={paused?'Resume recording':'Pause recording'} aria-label={paused?'Resume':'Pause'}>
     <Icon name={paused?'mic':'pause'} size={18}/>
    </button>
    <button type="button" className="wa-btn wa-send-btn" onClick={stopAndSend} title="Send voice note" aria-label="Send voice note">
     <Icon name="send" size={18}/>
    </button>
   </div>
  );
 }

 return (
  <div className="voice-note-control">
   <button
    type="button"
    className={'voice-button'+(sending?' sending':'')}
    aria-label="Record voice note"
    title="Record voice note"
    disabled={disabled||sending}
    onClick={start}
   >
    <Icon name="mic" size={20}/>
   </button>
   {sending&&<span className="voice-status" role="status">Sending voice note…</span>}
   {message&&<span className="voice-status" role="status">{message}</span>}
  </div>
 );
}
