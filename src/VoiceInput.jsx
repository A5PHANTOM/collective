import React,{useEffect,useRef,useState} from 'react';
import {Icon} from './ui.jsx';

export default function VoiceInput({disabled,visible,onListening,onVoiceNote}){
 const recorder=useRef(null),chunks=useRef([]),started=useRef(0);
 const [recording,setRecording]=useState(false),[preview,setPreview]=useState(null),[elapsed,setElapsed]=useState(0),[message,setMessage]=useState('');
 const supported=typeof window!=='undefined'&&!!navigator.mediaDevices?.getUserMedia&&!!window.MediaRecorder;
 useEffect(()=>()=>{recorder.current?.stream?.getTracks().forEach(track=>track.stop());if(preview)URL.revokeObjectURL(preview.url)},[preview]);
 useEffect(()=>{if(disabled||!visible&&recording)stop()},[disabled,visible,recording]);
 useEffect(()=>{if(!recording)return;const timer=setInterval(()=>setElapsed(Math.floor((Date.now()-started.current)/1000)),250);return()=>clearInterval(timer)},[recording]);
 async function start(){if(!supported){setMessage('Voice notes are unavailable in this browser. Try Chrome or Safari over HTTPS or localhost.');return}if(!window.isSecureContext){setMessage('Microphone access requires HTTPS or localhost.');return}try{const stream=await navigator.mediaDevices.getUserMedia({audio:true});const type=MediaRecorder.isTypeSupported('audio/webm;codecs=opus')?'audio/webm;codecs=opus':'audio/mp4';const r=new MediaRecorder(stream,{mimeType:type});chunks.current=[];r.ondataavailable=e=>{if(e.data.size)chunks.current.push(e.data)};r.onstop=()=>{stream.getTracks().forEach(track=>track.stop());const blob=new Blob(chunks.current,{type:r.mimeType});const url=URL.createObjectURL(blob);setPreview({blob,url});setRecording(false);onListening(false)};recorder.current=r;started.current=Date.now();setElapsed(0);setMessage('');setRecording(true);onListening(true);r.start()}catch(e){setMessage(e.name==='NotAllowedError'?'Microphone permission was denied. Allow access and try again.':'Could not start recording. Please try again.');onListening(false)}}
 function stop(){if(recorder.current?.state==='recording')recorder.current.stop()}
 function discard(){if(preview)URL.revokeObjectURL(preview.url);setPreview(null);setElapsed(0);setMessage('')}
 function send(){if(preview){onVoiceNote(preview.blob);discard()}}
 const time=`${Math.floor(elapsed/60)}:${String(elapsed%60).padStart(2,'0')}`;
 return <div className="voice-note-control">{preview?<><audio className="voice-preview" controls src={preview.url}/><span className="voice-duration">{time}</span><button type="button" className="voice-note-action" onClick={discard} aria-label="Discard voice note"><Icon name="close"/></button><button type="button" className="voice-note-action send-voice" onClick={send} disabled={disabled} aria-label="Send voice note"><Icon name="send"/></button></>:<><button type="button" className={'voice-button'+(recording?' listening':'')} aria-label={recording?'Stop recording':'Record voice note'} aria-pressed={recording} title={recording?'Stop recording':'Record voice note'} disabled={disabled&&!recording} onClick={recording?stop:start}><Icon name={recording?'stop':'mic'}/></button><span className="voice-status" role="status">{recording?`Recording ${time}… Tap stop when finished.`:message}</span></>}</div>;
}
