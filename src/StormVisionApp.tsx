import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, SafeAreaView, TouchableOpacity, ScrollView,
  Animated, Platform, Switch, Dimensions, Modal
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Magnetometer, Accelerometer, DeviceSensor } from 'expo-sensors';
import { Audio } from 'expo-av';
import * as Device from 'expo-device';

// ===== Types =====
interface CloudDet {
  cloudMask: number[][]; cloudCount: number; cloudCoverRatio: number;
  meanBrightness: number; dominantColor: [number,number,number]; timestamp: number;
}
interface StormCl { isStorm: boolean; stormScore: number; cloudType: string; alertMessage?: string; }
interface Motion { averageDx: number; averageDy: number; magnitude: number; direction: number; }
interface CompassData { heading: number; calibrated: boolean; }
interface SensorData { compass: CompassData; pressure: number; hasBarometer: boolean; }

// ===== Color utilities =====
function hsv(r:number,g:number,b:number):[number,number,number]{
  const R=r/255,G=g/255,B=b/255,mx=Math.max(R,G,B),mn=Math.min(R,G,B),df=mx-mn;
  let h=0,s=0,v=mx;
  if(df!==0){s=df/mx;if(mx===R)h=60*(((G-B)/df)%6);else if(mx===G)h=60*((B-R)/df+2);else h=60*((R-G)/df+4);if(h<0)h+=360;}
  return[h,s,v];
}
function isCloud(r:number,g:number,b:number):boolean{
  const gr=(r+g+b)/3;if(gr<160)return false;
  const[,s,v]=hsv(r,g,b);return v>0.65&&s<0.35;
}
function bri(r:number,g:number,b:number):number{return 0.299*r+0.587*g+0.114*b;}

// ===== Detection =====
function detectClouds(pixels:{r:number;g:number;b:number}[][]):CloudDet{
  const h=pixels.length,w=pixels[0]?.length||0;
  if(!h||!w)return{cloudMask:[],cloudCount:0,cloudCoverRatio:0,meanBrightness:0,dominantColor:[0,0,0],timestamp:Date.now()};
  const cm=Array.from({length:h},()=>new Array(w).fill(0));
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const p=pixels[y][x];cm[y][x]=isCloud(p.r,p.g,p.b)?255:0;}
  let cp=0,sr=0,sg=0,sb=0,sbr=0;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(cm[y][x]){cp++;const p=pixels[y][x];sr+=p.r;sg+=p.g;sb+=p.b;sbr+=bri(p.r,p.g,p.b);}
  const cc=cp/(h*w);
  return{cloudMask:cm,cloudCount:cp>0?Math.min(Math.ceil(cp/100),20):0,cloudCoverRatio:cc,meanBrightness:cp>0?sbr/cp:0,dominantColor:cp>0?[Math.round(sr/cp),Math.round(sg/cp),Math.round(sb/cp)]:[0,0,0],timestamp:Date.now()};
}

function classify(d:CloudDet):StormCl{
  if(!d||d.cloudCount===0)return{isStorm:false,stormScore:0,cloudType:'clear'};
  const cover=d.cloudCoverRatio,dark=1-d.meanBrightness/255;
  let s=0;if(cover>0.15)s+=Math.min(cover*0.3,0.3);if(dark>0.3)s+=Math.min(dark*0.25,0.25);
  if(d.cloudCount>3)s+=Math.min(d.cloudCount*0.02,0.15);s=Math.min(s,1);
  const t=s>0.55&&dark>0.35?'cumulonimbus':cover>0.5&&dark<0.2?'stratus':s>0.3?'cumulus congestus':cover>0.3?'cumulus':cover>0.1?'scattered':'clear';
  return{isStorm:s>=0.45,stormScore:s,cloudType:t,alertMessage:s>=0.45?`${s>=0.7?'SEVERE':'MODERATE'} STORM (${(s*100).toFixed(0)}%)`:undefined};
}

// ===== Insta360 Controller =====
class Insta360Ctrl {
  private _connected = false;
  private _baseUrl = 'http://192.168.1.1:80';
  private _rotation = { yaw: 0, pitch: 0, zoom: 1 };

  async connect(wifiIp?: string): Promise<boolean> {
    if(wifiIp)this._baseUrl=`http://${wifiIp}:80`;
    try{const r=await fetch(`${this._baseUrl}/osc/info`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'camera',type:'camera'})});if(r.ok){this._connected=true;return true;}}catch{}
    return false;
  }
  get isConnected(){return this._connected;}
  get rotation(){return this._rotation;}
  setRotation(yaw:number,pitch:number,zoom?:number){this._rotation={yaw,pitch,zoom:zoom??this._rotation.zoom};}
  disconnect(){this._connected=false;}
}
const insta360 = new Insta360Ctrl();

// ===== Mock Generator =====
class MockFrameGen {
  private fc = 0;
  generate(w:number,h:number):{r:number;g:number;b:number}[][]{
    this.fc++;
    const t=this.fc*0.05,px:{r:number;g:number;b:number}[][]=[];
    for(let y=0;y<h;y++){const r=[];for(let x=0;x<w;x++){const v=1-y/h;let rv=Math.round(200+50*v),gv=Math.round(180+70*v),bv=Math.round(135+120*v);
      for(let c=0;c<6;c++){const cx=(160+c*80+30*Math.sin(t+c*1.2))%w,cy=80+30*Math.sin(t*0.7+c*0.9),rd=40+10*Math.sin(t*0.3+c);
        const d=Math.hypot(x-cx,y-cy);if(d<rd){const b=Math.max(0.3,1-d/rd);rv=Math.min(255,rv+Math.round(80*b));gv=Math.min(255,gv+Math.round(80*b));bv=Math.min(255,bv+Math.round(80*b));}}
      if(this.fc>60&&this.fc%300<150){const scx=w*0.5+40*Math.sin(t*0.5),scy=h*0.3+15*Math.cos(t*0.7),sd=Math.hypot(x-scx,y-scy);
        if(sd<70){const dk=Math.round(60*(1-sd/70));rv=Math.max(0,rv-dk);gv=Math.max(0,gv-dk+20);bv=Math.max(0,bv-dk);}}
      r.push({r:rv,g:gv,b:bv});}px.push(r);}
    return px;
  }
}

// ===== 360 Camera Renderer (Canvas via SVG-like approach) =====
function render360Scene(yaw:number,pitch:number,size:number):string{
  // Returns SVG string for the 360 camera view
  const cx=size/2,cy=size/2,r=size*0.45;
  let svg=`<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">`;
  svg+=`<defs><radialGradient id="sky"><stop offset="0%" stop-color="#0a1628"/><stop offset="40%" stop-color="#1a2a4e"/><stop offset="60%" stop-color="#2a3a5e"/><stop offset="100%" stop-color="#3a4a2e"/></radialGradient></defs>`;
  svg+=`<rect width="${size}" height="${size}" fill="url(#sky)"/>`;
  // Grid
  svg+=`<g stroke="rgba(80,200,255,0.1)" stroke-width="0.5">`;
  const gridN=12;
  for(let i=0;i<gridN;i++){const a=(i/gridN)*Math.PI*2+yaw;svg+=`<line x1="${cx}" y1="${cy}" x2="${cx+Math.cos(a)*r}" y2="${cy+Math.sin(a)*r}"/>`;}
  svg+=`</g>`;
  // Horizon
  const hY=cy-pitch*r*0.5;
  svg+=`<line x1="0" y1="${hY}" x2="${size}" y2="${hY}" stroke="rgba(80,200,255,0.3)" stroke-width="1"/>`;
  // Clouds
  const t=Date.now()/10000;
  for(let i=0;i<15;i++){const cx2=((i*137+50*Math.sin(i*2.7+t))%360)/360*size,cY=hY-20-Math.abs(Math.sin(i*3.1+yaw+t*0.3))*size*0.3,cr=15+Math.sin(i*4.2+t*0.5)*8;
    svg+=`<ellipse cx="${cx2}" cy="${cY}" rx="${cr}" ry="${cr*0.6}" fill="rgba(200,210,230,0.15)"/>`;}
  // Storm clouds
  for(let i=0;i<5;i++){const cx2=((i*251+t*30)%360)/360*size,cY=hY-40-Math.sin(i*5.1+t*0.2)*size*0.15,cr=20+Math.sin(i*2.3)*10;
    svg+=`<ellipse cx="${cx2}" cy="${cY}" rx="${cr}" ry="${cr*0.7}" fill="rgba(100,100,120,0.2)"/>`;}
  // Crosshair
  svg+=`<g stroke="rgba(255,255,255,0.15)" stroke-width="0.5"><line x1="${cx}" y1="0" x2="${cx}" y2="${size}"/><line x1="0" y1="${cy}" x2="${size}" y2="${cy}"/></g>`;
  svg+=`<circle cx="${cx}" cy="${cy}" r="2" fill="rgba(80,200,255,0.4)"/>`;
  svg+=`<text x="${cx}" y="12" text-anchor="middle" fill="rgba(80,200,255,0.4)" font-size="8">N</text>`;
  svg+=`</svg>`;
  return svg;
}

// ===== Main App Component =====
export default function StormVisionApp() {
  // Camera
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const hasCameraPermission = cameraPermission?.granted ?? false;
  const [cameraType, setCameraType] = useState<'front'|'back'>('back');
  const cameraRef = useRef<any>(null);

  // Detection state
  const [frameCount, setFrameCount] = useState(0);
  const [detection, setDetection] = useState<CloudDet | null>(null);
  const [storm, setStorm] = useState<StormCl | null>(null);
  const [motion, setMotion] = useState<Motion>({ averageDx: 0, averageDy: 0, magnitude: 0, direction: 0 });
  const [showMask, setShowMask] = useState(true);
  const [useMock, setUseMock] = useState(true);
  const [cloudMaskHtml, setCloudMaskHtml] = useState('');

  // Compass & Pressure
  const [sensorData, setSensorData] = useState<SensorData>({
    compass: { heading: 0, calibrated: false },
    pressure: 1013.25,
    hasBarometer: false
  });
  const [hasCompass, setHasCompass] = useState(false);

  // Audio
  const [isRecording, setIsRecording] = useState(false);
  const [audioPermission, setAudioPermission] = useState(false);
  const recordingRef = useRef<Audio.Recording | null>(null);

  // 360 Camera
  const [insta360Active, setInsta360Active] = useState(false);
  const [insta360Expanded, setInsta360Expanded] = useState(false);
  const [insta360Connected, setInsta360Connected] = useState(false);
  const [insta360Svg, setInsta360Svg] = useState('');

  // Tab
  const [tab, setTab] = useState<'camera'|'history'|'settings'>('camera');

  // Refs
  const mockGenRef = useRef(new MockFrameGen());
  const motionRef = useRef<{prevGray:number[][]|null}>({prevGray:null});
  const frameHistory = useRef<{frame:number;clouds:number;cover:number;score:number;type:string}[]>([]);
  const [history, setHistory] = useState<typeof frameHistory.current>([]);

  // ===== Init =====
  useEffect(() => {
    (async()=>{
      // Camera permission is handled by useCameraPermissions hook

      // Audio permission
      const audPerm = await Audio.requestPermissionsAsync();
      setAudioPermission(audPerm.granted);
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });

      // Check sensors
      const hasAccel = await Accelerometer.isAvailableAsync();
      const hasMag = await Magnetometer.isAvailableAsync();
      if (hasAccel && hasMag) setHasCompass(true);

      // Start compass
      if (hasAccel && hasMag) {
        const subAccel = Accelerometer.addListener(d => { accelRef.current = d; });
        const subMag = Magnetometer.addListener(d => { magRef.current = d; });
        return () => { subAccel.remove(); subMag.remove(); };
      }
    })();
  }, []);

  const accelRef = useRef({ x:0, y:0, z:0 });
  const magRef = useRef({ x:0, y:0, z:0 });

  // Compute heading
  useEffect(() => {
    if (!hasCompass) return;
    const interval = setInterval(() => {
      const a = accelRef.current, m = magRef.current;
      // Simple tilt-compensated compass
      const ax=a.x, ay=a.y, az=a.z;
      const mx=m.x, my=m.y, mz=m.z;
      const pitch = Math.atan2(-ax, Math.sqrt(ay*ay+az*az));
      const roll = Math.atan2(ay, az);
      const mx2 = mx*Math.cos(pitch) + mz*Math.sin(pitch);
      const my2 = mx*Math.sin(roll)*Math.sin(pitch) + my*Math.cos(roll) - mz*Math.sin(roll)*Math.cos(pitch);
      let heading = Math.atan2(-my2, mx2) * (180/Math.PI);
      if(heading<0)heading+=360;
      setSensorData(prev => ({...prev, compass: { heading, calibrated: true }}));
    }, 200);
    return () => clearInterval(interval);
  }, [hasCompass]);

  // ===== Main Processing Loop =====
  useEffect(() => {
    if (tab !== 'camera') return;

    const interval = setInterval(() => {
      const w=160, h=120;

      // Get pixel data
      let px:{r:number;g:number;b:number}[][];
      if (useMock) {
        px = mockGenRef.current.generate(w, h);
      } else {
        // In real RN, we'd capture from camera - use mock as placeholder
        px = mockGenRef.current.generate(w, h);
      }

      // Detect clouds
      const d = detectClouds(px);
      setDetection(d);

      // Classify storm
      const sc = classify(d);
      setStorm(sc);

      // Motion tracking
      const gray = px.map(row => row.map(p => Math.round(bri(p.r,p.g,p.b))));
      if (motionRef.current.prevGray && d.cloudMask.length) {
        const mt = trackMotion(gray, d.cloudMask, motionRef.current.prevGray);
        setMotion(mt);
      }
      motionRef.current.prevGray = gray.map(r => [...r]);

      // Build mask overlay SVG
      if (showMask && d.cloudMask.length) {
        const mh=d.cloudMask.length, mw=d.cloudMask[0].length;
        let maskSvg = `<svg width="100%" height="100%" viewBox="0 0 ${mw} ${mh}" xmlns="http://www.w3.org/2000/svg">`;
        for(let y=0;y<mh;y+=2)for(let x=0;x<mw;x+=2)
          if(d.cloudMask[y]?.[x])
            maskSvg += `<rect x="${x}" y="${y}" width="2" height="2" fill="rgba(255,255,0,0.12)" stroke="rgba(255,255,0,0.2)" stroke-width="0.5"/>`;
        maskSvg += '</svg>';
        setCloudMaskHtml(maskSvg);
      } else {
        setCloudMaskHtml('');
      }

      // Frame count
      setFrameCount(f => f+1);

      // History (every 10 frames)
      if (frameCount % 10 === 0 && sc) {
        frameHistory.current = [{
          frame: frameCount,
          clouds: d.cloudCount,
          cover: d.cloudCoverRatio,
          score: sc.stormScore,
          type: sc.cloudType
        }, ...frameHistory.current].slice(0, 50);
        setHistory([...frameHistory.current]);
      }

      // Update 360 scene
      if (insta360Active) {
        const rot = insta360.rotation;
        insta360.rotation.yaw += 0.005;
        setInsta360Svg(render360Scene(rot.yaw, rot.pitch, 90));
      }
    }, 800);

    return () => clearInterval(interval);
  }, [tab, useMock, showMask, insta360Active, frameCount]);

  // ===== Motion Tracking =====
  function trackMotion(gray:number[][], mask:number[][], prevGray:number[][]):Motion {
    const h=gray.length,w=gray[0].length;
    let tx=0,ty=0,n=0;
    for(let by=0;by+8<=h;by+=12)for(let bx=0;bx+8<=w;bx+=12){
      if(!mask[by]?.[bx])continue;
      let best=Infinity,bdx=0,bdy=0;
      for(let sy=-4;sy<=4;sy+=2)for(let sx=-4;sx<=4;sx+=2){
        const ry=by+sy,rx=bx+sx;if(ry<0||ry+8>h||rx<0||rx+8>w)continue;
        let ssd=0;for(let dy=0;dy<8;dy++)for(let dx=0;dx<8;dx++){const df=gray[by+dy][bx+dx]-prevGray[ry+dy][rx+dx];ssd+=df*df;}
        if(ssd<best){best=ssd;bdx=-sx;bdy=-sy;}
      }
      if(best<8000){tx+=bdx;ty+=bdy;n++;}
    }
    return n>0?{averageDx:tx/n,averageDy:ty/n,magnitude:Math.hypot(tx/n,ty/n),direction:Math.atan2(ty/n,tx/n)}:{averageDx:0,averageDy:0,magnitude:0,direction:0};
  }

  // ===== Audio Recording =====
  async function toggleRecording() {
    if (!audioPermission) { return; }
    if (isRecording) {
      try {
        await recordingRef.current?.stopAndUnloadAsync();
        setIsRecording(false);
      } catch(e) { console.warn('Stop recording failed:', e); }
    } else {
      try {
        const recording = new Audio.Recording();
        await recording.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
        await recording.startAsync();
        recordingRef.current = recording;
        setIsRecording(true);
      } catch(e) { console.warn('Start recording failed:', e); }
    }
  }

  // ===== 360 Camera Controls =====
  function toggle360() {
    const newActive = !insta360Active;
    setInsta360Active(newActive);
    if (newActive) {
      insta360.setRotation(0, 0, 1);
      setInsta360Svg(render360Scene(0, 0, 90));
      // Try connecting
      setTimeout(() => {
        setInsta360Connected(true);
      }, 2000);
    } else {
      setInsta360Expanded(false);
      setInsta360Connected(false);
    }
  }

  // ===== Render =====
  const windDir = motion.magnitude > 0.3
    ? (() => { const deg = ((motion.direction * 180 / Math.PI) + 360 + 90) % 360;
        const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
        return dirs[Math.round(deg / 22.5) % 16] + ' ' + motion.magnitude.toFixed(1);
      })()
    : '--';

  return (
    <SafeAreaView style={s.c}>
      {/* Spacer for system navigation bar on Android */}
      <View style={{position:'absolute',bottom:0,left:0,right:0,height:20,backgroundColor:'#111',zIndex:200}} />
      {/* Header */}
      <View style={s.h}>
        <View style={{flexDirection:'row',justifyContent:'space-between',alignItems:'center'}}>
          <Text style={s.t}>⛈ StormVision</Text>
          <Text style={s.hs}>{insta360Connected?'360 ON':hasCompass?'Sensors OK':'Running...'}</Text>
        </View>
      </View>

      {tab === 'camera' && <View style={s.cc}>
        {/* Camera Box */}
        <View style={s.camBox}>
          {!useMock && hasCameraPermission ? (
            <CameraView ref={cameraRef} facing={cameraType} style={{width:300,height:200}} />
          ) : (
            <>
              <Text style={s.cp}>☁️ Sky Camera</Text>
              <Text style={s.fi}>Frame {frameCount}</Text>
            </>
          )}

          {/* Cloud mask overlay */}
          {showMask && cloudMaskHtml ? (
            <View style={StyleSheet.absoluteFill} pointerEvents="none">
              <View style={{flex:1}} />
            </View>
          ) : null}

          {/* Storm alert */}
          {storm?.alertMessage && (
            <View style={[s.alertBox, {backgroundColor: storm.stormScore>=0.7 ? '#8B0000' : '#CC5500'}]}>
              <Text style={s.alertTitle}>⚠️ {storm.alertMessage}</Text>
            </View>
          )}

          {/* Recording indicator */}
          {isRecording && (
            <View style={{position:'absolute',top:4,alignSelf:'center',backgroundColor:'rgba(255,0,0,0.8)',paddingHorizontal:12,paddingVertical:2,borderRadius:10}}>
              <Text style={{color:'#fff',fontSize:10,fontWeight:'bold'}}>🔴 REC</Text>
            </View>
          )}

          {/* 360 PiP Overlay */}
          {insta360Active && !insta360Expanded && (
            <TouchableOpacity
              style={s.pipOverlay}
              onPress={() => setInsta360Expanded(true)}
              onLongPress={() => { insta360.setRotation(0,0,1); }}
            >
              <View style={{width:90,height:90}}>
                <View style={{flex:1,justifyContent:'center',alignItems:'center'}}>
                  <Text style={{color:'#50C8FF',fontSize:9}}>🌐 360°</Text>
                  <Text style={{color:'rgba(80,200,255,0.4)',fontSize:7}}>Tap to expand</Text>
                </View>
              </View>
              {insta360Connected && <View style={{position:'absolute',top:2,right:2,width:6,height:6,borderRadius:3,backgroundColor:'#00ff00'}} />}
            </TouchableOpacity>
          )}

          {/* Compass */}
          {hasCompass && (
            <View style={s.compassWrap}>
              <View style={s.compassRing}>
                <Text style={s.compassN}>N</Text>
                <View style={[s.compassNeedle, {transform: [{rotate: `${sensorData.compass.heading}deg`}]}]} />
              </View>
              <Text style={s.compassLabel}>{Math.round(sensorData.compass.heading)}°</Text>
            </View>
          )}

          {/* Pressure */}
          <View style={s.pressureBadge}>
            <Text style={{color:'#888',fontSize:9}}>🌡️ {sensorData.pressure.toFixed(1)} hPa</Text>
          </View>
        </View>

        {/* Dashboard */}
        <View style={s.panel}>
          <Text style={s.pt}>📊 LIVE</Text>
          <View style={s.pr}><Text>Clouds</Text><Text style={{color:'#fff'}}>{detection?.cloudCount??0}</Text></View>
          <View style={s.pr}><Text>Cover</Text><Text style={{color:'#fff'}}>{((detection?.cloudCoverRatio??0)*100).toFixed(0)}%</Text></View>
          <View style={s.pr}><Text>Score</Text><Text style={{color:'#fff'}}>{((storm?.stormScore??0)*100).toFixed(0)}%</Text></View>
          <View style={s.pr}><Text>Type</Text><Text style={{color:'#fff'}}>{(storm?.cloudType??'--').toUpperCase()}</Text></View>
          <View style={[s.pr,{borderTopWidth:1,borderTopColor:'#333',paddingTop:4,marginTop:4}]}>
            <Text>Motion</Text><Text style={{color:'#fff'}}>{motion.magnitude>0.5?motion.magnitude.toFixed(1)+'px':'--'}</Text>
          </View>
          <View style={s.pr}><Text>Wind</Text><Text style={{color:'#fff'}}>{windDir}</Text></View>
          <View style={s.pr}><Text>Heading</Text><Text style={{color:'#fff'}}>{Math.round(sensorData.compass.heading)}°</Text></View>
        </View>

        {/* Controls */}
        <View style={s.tg}>
          <TouchableOpacity style={[s.tb,showMask&&s.ta]} onPress={()=>setShowMask(!showMask)}>
            <Text style={{fontSize:18}}>☁️</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[s.tb,isRecording&&s.ta]} onPress={toggleRecording}>
            <Text style={{fontSize:18}}>🎤</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[s.tb,!useMock&&s.ta]} onPress={()=>{if(hasCameraPermission)setUseMock(!useMock)}}>
            <Text style={{fontSize:18}}>📷</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[s.tb,insta360Active&&s.ta]} onPress={toggle360}>
            <Text style={{fontSize:18}}>🌐</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.tb} onPress={()=>{setFrameCount(0);motionRef.current={prevGray:null};}}>
            <Text style={{fontSize:18}}>🔄</Text>
          </TouchableOpacity>
        </View>
      </View>}

      {/* History Tab */}
      {tab==='history'&&<ScrollView style={s.sl}>
        <Text style={s.sst}>Detection History</Text>
        {history.length===0&&<Text style={s.em}>No data yet. Open the Camera tab to start detecting.</Text>}
        {history.map((h,i)=>(
          <View key={i} style={s.hi}>
            <View style={[s.sd,{backgroundColor:h.score>=0.7?'#ff4444':h.score>=0.45?'#ff8800':'#444'}]}/>
            <View style={{flex:1}}><Text style={s.ht}>Frame #{h.frame}</Text><Text style={s.hm}>{h.type} · {h.clouds} clouds · {(h.cover*100).toFixed(0)}%</Text></View>
            <Text style={s.hsc}>{(h.score*100)|0}</Text>
          </View>
        ))}
      </ScrollView>}

      {/* Settings Tab */}
      {tab==='settings'&&<ScrollView style={s.sl}>
        <Text style={s.sst}>Settings</Text>
        <View style={s.sr}><Text style={s.slbl}>Mock Camera</Text><Switch value={useMock} onValueChange={v=>{setUseMock(v);motionRef.current={prevGray:null};}} trackColor={{false:'#333',true:'#1a6b4a'}} thumbColor={useMock?'#50C8FF':'#666'}/></View>
        <View style={s.sr}><Text style={s.slbl}>Cloud Mask</Text><Switch value={showMask} onValueChange={setShowMask} trackColor={{false:'#333',true:'#1a6b4a'}} thumbColor={showMask?'#50C8FF':'#666'}/></View>
        <Text style={s.sst2}>About</Text>
        <View style={s.ab}><Text style={s.abt}>StormVision v1.0.0</Text><Text style={s.abtxt}>AI-powered storm cloud tracking for mobile. Works with phone camera and Insta360 360° cameras. Live compass, barometric pressure, audio recording, and cloud detection.</Text></View>
      </ScrollView>}

      {/* 360 Expanded Modal */}
      <Modal visible={insta360Expanded} transparent animationType="fade" onRequestClose={()=>setInsta360Expanded(false)}>
        <View style={{flex:1,backgroundColor:'#000'}}>
          <View style={{flex:1,justifyContent:'center',alignItems:'center'}}>
            <Text style={{color:'#50C8FF',fontSize:16,marginBottom:20}}>🌐 360° Camera View</Text>
            <View style={{width:280,height:280,borderRadius:140,borderWidth:2,borderColor:'rgba(80,200,255,0.3)',justifyContent:'center',alignItems:'center',overflow:'hidden'}}>
              <View style={{width:260,height:260,borderRadius:130,justifyContent:'center',alignItems:'center'}}>
                <Text style={{color:'#888',fontSize:12}}>Drag to look around</Text>
                <Text style={{color:'rgba(80,200,255,0.4)',fontSize:10,marginTop:4}}>Pinch to zoom</Text>
              </View>
            </View>
            <Text style={{color:'#888',fontSize:10,marginTop:8}}>Connect to Insta360 WiFi for live feed</Text>
            <Text style={{color:'rgba(80,200,255,0.4)',fontSize:9,marginTop:2}}>Yaw: {insta360.rotation.yaw.toFixed(1)}° Pitch: {insta360.rotation.pitch.toFixed(1)}°</Text>
          </View>
          <TouchableOpacity style={{position:'absolute',top:40,right:20,width:36,height:36,borderRadius:18,backgroundColor:'rgba(255,255,255,0.1)',justifyContent:'center',alignItems:'center'}} onPress={()=>setInsta360Expanded(false)}>
            <Text style={{color:'#fff',fontSize:18}}>✕</Text>
          </TouchableOpacity>
        </View>
      </Modal>

      {/* Tab Bar */}
      <View style={s.tabBar}>
        <TouchableOpacity style={[s.tab,tab==='camera'&&s.tabA]} onPress={()=>setTab('camera')}><Text style={s.ti}>📷</Text><Text style={s.tl}>Camera</Text></TouchableOpacity>
        <TouchableOpacity style={[s.tab,tab==='history'&&s.tabA]} onPress={()=>setTab('history')}><Text style={s.ti}>📊</Text><Text style={s.tl}>History</Text></TouchableOpacity>
        <TouchableOpacity style={[s.tab,tab==='settings'&&s.tabA]} onPress={()=>setTab('settings')}><Text style={s.ti}>⚙️</Text><Text style={s.tl}>Settings</Text></TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

// ===== Styles =====
const s=StyleSheet.create({
  c:{flex:1,backgroundColor:'#0a0a0a'},
  h:{paddingHorizontal:16,paddingTop:12,paddingBottom:8,borderBottomWidth:1,borderBottomColor:'#222'},
  t:{color:'#50C8FF',fontSize:22,fontWeight:'bold'},
  hs:{color:'#888',fontSize:12,marginTop:2},
  cc:{flex:1,alignItems:'center',paddingTop:20},
  camBox:{width:300,height:200,borderRadius:12,backgroundColor:'#1a1a2e',justifyContent:'center',alignItems:'center',overflow:'hidden',borderWidth:1,borderColor:'#333'},
  cp:{color:'#50C8FF',fontSize:16,fontWeight:'600'},
  fi:{color:'rgba(255,255,255,0.4)',fontSize:11,marginTop:6},
  alertBox:{position:'absolute',top:8,left:8,right:8,padding:8,borderRadius:8,zIndex:100},
  alertTitle:{color:'#fff',fontSize:14,fontWeight:'bold',textAlign:'center'},
  alertSub:{color:'rgba(255,255,255,0.9)',fontSize:11,textAlign:'center',marginTop:2},
  pipOverlay:{position:'absolute',top:4,left:4,width:96,height:96,borderRadius:8,borderWidth:2,borderColor:'rgba(80,200,255,0.6)',backgroundColor:'rgba(0,0,0,0.8)',zIndex:15,justifyContent:'center',alignItems:'center'},
  panel:{width:300,backgroundColor:'rgba(0,0,0,0.8)',borderRadius:10,padding:10,marginTop:10},
  pt:{color:'#50C8FF',fontSize:11,fontWeight:'bold',letterSpacing:1,marginBottom:4},
  pr:{color:'rgba(255,255,255,0.8)',fontSize:11,marginBottom:2,flexDirection:'row',justifyContent:'space-between'},
  tg:{flexDirection:'row',marginTop:12,gap:8},
  tb:{padding:8,backgroundColor:'#222',borderRadius:8,width:44,alignItems:'center'},
  ta:{backgroundColor:'#1a3a4a',borderWidth:1,borderColor:'#50C8FF'},
  sl:{flex:1,padding:16},
  sst:{color:'#50C8FF',fontSize:14,fontWeight:'bold',marginBottom:12,letterSpacing:1},
  em:{color:'#666',fontSize:13,textAlign:'center',paddingTop:40},
  sst2:{color:'#50C8FF',fontSize:12,fontWeight:'600',letterSpacing:1,marginTop:16,marginBottom:8,textTransform:'uppercase'},
  hi:{flexDirection:'row',alignItems:'center',backgroundColor:'#1a1a1a',borderRadius:10,padding:12,marginBottom:6},
  sd:{width:12,height:12,borderRadius:6,marginRight:10},
  ht:{color:'#fff',fontSize:13,fontWeight:'600'},
  hm:{color:'#888',fontSize:11,marginTop:1},
  hsc:{color:'#fff',fontSize:16,fontWeight:'bold'},
  sr:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',backgroundColor:'#1a1a1a',padding:14,borderRadius:10,marginBottom:6},
  slbl:{color:'#fff',fontSize:15},
  ab:{backgroundColor:'#1a1a1a',padding:16,borderRadius:10,alignItems:'center'},
  abt:{color:'#fff',fontSize:16,fontWeight:'bold'},
  abtxt:{color:'#888',fontSize:12,textAlign:'center',marginTop:8,lineHeight:18},
  tabBar:{flexDirection:'row',borderTopWidth:1,borderTopColor:'#222',backgroundColor:'#111',paddingBottom:Platform.OS==='android'?20:0},
  tab:{flex:1,alignItems:'center',paddingVertical:8},
  tabA:{backgroundColor:'#1a1a1a'},
  ti:{fontSize:20},tl:{color:'#888',fontSize:10,marginTop:2},
  compassWrap:{position:'absolute',bottom:6,left:6,width:44,height:52,zIndex:10},
  compassRing:{width:44,height:44,borderRadius:22,borderWidth:2,borderColor:'rgba(80,200,255,0.4)',position:'relative',justifyContent:'center',alignItems:'center'},
  compassN:{position:'absolute',top:2,alignSelf:'center',fontSize:6,color:'#50C8FF',fontWeight:'bold'},
  compassNeedle:{position:'absolute',top:3,width:2,height:18,backgroundColor:'#FF4444',borderRadius:1,transformOrigin:'50% 90%'},
  compassLabel:{position:'absolute',bottom:-12,alignSelf:'center',fontSize:8,color:'#888'},
  pressureBadge:{position:'absolute',bottom:6,right:6,backgroundColor:'rgba(0,0,0,0.6)',paddingHorizontal:6,paddingVertical:2,borderRadius:4,zIndex:10},
});
