import React,{useEffect,useRef,useState} from 'react';
import {Icon} from './ui.jsx';

function writeString(view, offset, string) {
 for (let i = 0; i < string.length; i++) {
  view.setUint8(offset + i, string.charCodeAt(i));
 }
}

function downsampleBuffer(buffer, fromRate, toRate = 16000) {
 if (fromRate === toRate) return buffer;
 const ratio = fromRate / toRate;
 const newLength = Math.round(buffer.length / ratio);
 const result = new Float32Array(newLength);
 let offsetResult = 0;
 let offsetBuffer = 0;
 while (offsetResult < result.length) {
  const nextOffsetBuffer = Math.round((offsetResult + 1) * ratio);
  let accum = 0, count = 0;
  for (let i = offsetBuffer; i < nextOffsetBuffer && i < buffer.length; i++) {
   accum += buffer[i];
   count++;
  }
  result[offsetResult] = count > 0 ? accum / count : 0;
  offsetResult++;
  offsetBuffer = nextOffsetBuffer;
 }
 return result;
}

function encodeWav(samples, sampleRate = 16000) {
 const buffer = new ArrayBuffer(44 + samples.length * 2);
 const view = new DataView(buffer);

 writeString(view, 0, 'RIFF');
 view.setUint32(4, 36 + samples.length * 2, true);
 writeString(view, 8, 'WAVE');
 writeString(view, 12, 'fmt ');
 view.setUint32(16, 16, true);
 view.setUint16(20, 1, true); // PCM
 view.setUint16(22, 1, true); // mono
 view.setUint32(24, sampleRate, true);
 view.setUint32(28, sampleRate * 2, true); // byte rate (sampleRate * 1 channel * 2 bytes/sample)
 view.setUint16(32, 2, true); // block align
 view.setUint16(34, 16, true); // 16-bit
 writeString(view, 36, 'data');
 view.setUint32(40, samples.length * 2, true);

 let offset = 44;
 for (let i = 0; i < samples.length; i++, offset += 2) {
  const s = Math.max(-1, Math.min(1, samples[i]));
  view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
 }
 return new Blob([buffer], { type: 'audio/wav' });
}

export default function VoiceInput({disabled,visible,onListening,onVoiceNote}){
 const recorder=useRef(null),chunks=useRef([]),started=useRef(0);
 const pcmChunksRef=useRef([]);
 const isRecordingRef=useRef(false);
 const isPausedRef=useRef(false);
 const processorRef=useRef(null);
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
  if(processorRef.current){
   try{ processorRef.current.disconnect(); }catch(_){}
   processorRef.current=null;
  }
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
   let mimeType='';
   if(typeof MediaRecorder!=='undefined'&&MediaRecorder.isTypeSupported){
    if(MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) mimeType='audio/webm;codecs=opus';
    else if(MediaRecorder.isTypeSupported('audio/mp4')) mimeType='audio/mp4';
    else if(MediaRecorder.isTypeSupported('audio/webm')) mimeType='audio/webm';
    else if(MediaRecorder.isTypeSupported('audio/aac')) mimeType='audio/aac';
   }
   const r=mimeType?new MediaRecorder(stream,{mimeType}):new MediaRecorder(stream);
   chunks.current=[];
   pcmChunksRef.current=[];
   discardRef.current=false;
   isRecordingRef.current=true;
   isPausedRef.current=false;

   r.ondataavailable=e=>{if(e.data&&e.data.size)chunks.current.push(e.data)};
   r.onstop=async()=>{
    isRecordingRef.current=false;
    isPausedRef.current=false;
    setRecording(false);
    setPaused(false);
    onListening(false);
    if(discardRef.current){
     cleanupMedia();
     chunks.current=[];
     pcmChunksRef.current=[];
     return;
    }

    let finalBlob=null;
    if(pcmChunksRef.current.length>0){
     try{
      let total=0;
      for(const c of pcmChunksRef.current) total+=c.length;
      const merged=new Float32Array(total);
      let offset=0;
      for(const c of pcmChunksRef.current){
       merged.set(c,offset);
       offset+=c.length;
      }
      const sampleRate=audioCtxRef.current?.sampleRate||44100;
      const downsampled=downsampleBuffer(merged,sampleRate,16000);
      finalBlob=encodeWav(downsampled,16000);
     }catch(err){
      console.warn('WAV encode error, fallback to container:',err);
     }
    }
    if(!finalBlob&&chunks.current.length>0){
     finalBlob=new Blob(chunks.current,{type:r.mimeType||mimeType||'audio/webm'});
    }
    cleanupMedia();
    chunks.current=[];
    pcmChunksRef.current=[];
    if(!finalBlob||!finalBlob.size) return;
    setSending(true);
    try{
     await onVoiceNote(finalBlob);
    }finally{
     setSending(false);
    }
   };

   // Audio visualizer analysis and PCM recording
   try{
    const AudioContext=window.AudioContext||window.webkitAudioContext;
    if(AudioContext){
     const ctx=new AudioContext();
     if(ctx.state==='suspended'){
      try{ await ctx.resume(); }catch(_){}
     }
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

     try{
      const processor=ctx.createScriptProcessor?ctx.createScriptProcessor(4096,1,1):null;
      if(processor){
       processor.onaudioprocess=e=>{
        if(!discardRef.current&&isRecordingRef.current&&!isPausedRef.current){
         const channel=e.inputBuffer.getChannelData(0);
         pcmChunksRef.current.push(new Float32Array(channel));
        }
       };
       src.connect(processor);
       processor.connect(ctx.destination);
       processorRef.current=processor;
      }
     }catch(procErr){
      console.warn('AudioProcessor fallback:',procErr);
     }
    }
   }catch(_){}

   recorder.current=r;
   started.current=Date.now();
   setElapsed(0);
   setMessage('');
   setPaused(false);
   setRecording(true);
   onListening(true);
   r.start();
  }catch(e){
   setMessage(e.name==='NotAllowedError'?'Microphone permission was denied.':'Could not start recording.');
   onListening(false);
  }
 }

 function stopAndSend(){
  if(recorder.current?.state==='recording'||recorder.current?.state==='paused'){
   discardRef.current=false;
   isRecordingRef.current=false;
   recorder.current.stop();
  }
 }

 function discard(){
  discardRef.current=true;
  isRecordingRef.current=false;
  isPausedRef.current=false;
  if(recorder.current?.state==='recording'||recorder.current?.state==='paused'){
   recorder.current.stop();
  }else{
   cleanupMedia();
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
   isPausedRef.current=true;
   if(audioCtxRef.current?.state==='running') audioCtxRef.current.suspend();
  }else if(recorder.current.state==='paused'){
   recorder.current.resume();
   setPaused(false);
   isPausedRef.current=false;
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
