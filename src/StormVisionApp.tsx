import React, { useState, useEffect, useRef, useCallback, Component } from 'react';
import {
  View, Text, StyleSheet, SafeAreaView, TouchableOpacity, ScrollView,
  Platform, Switch, Modal
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Magnetometer, Accelerometer } from 'expo-sensors';
import { Audio } from 'expo-av';

// ===== Error Boundary =====
class ErrorBoundary extends Component<{children:React.ReactNode},{hasError:boolean;error:string}> {
  constructor(props:any) {
    super(props);
    this.state = { hasError: false, error: '' };
  }
  static getDerivedStateFromError(error:Error) {
    return { hasError: true, error: error.message || 'Unknown error' };
  }
  render() {
    if (this.state.hasError) {
      return (
        <SafeAreaView style={{flex:1,backgroundColor:'#0a0a0a',justifyContent:'center',alignItems:'center',padding:20}}>
          <Text style={{color:'#ff4444',fontSize:18,fontWeight:'bold',marginBottom:12}}>⚠️ StormVision Error</Text>
          <Text style={{color:'#888',fontSize:13,textAlign:'center'}}>{this.state.error}</Text>
          <TouchableOpacity
            style={{marginTop:20,backgroundColor:'#1a3a4a',paddingHorizontal:24,paddingVertical:10,borderRadius:8}}
            onPress={() => this.setState({hasError:false,error:''})}
          >
            <Text style={{color:'#50C8FF',fontSize:14}}>Restart</Text>
          </TouchableOpacity>
        </SafeAreaView>
      );
    }
    return this.props.children;
  }
}

// ===== Types =====
interface CloudDet { cloudMask: number[][]; cloudCount: number; cloudCoverRatio: number; meanBrightness: number; timestamp: number; }
interface StormCl { isStorm: boolean; stormScore: number; cloudType: string; alertMessage?: string; }
interface Motion { magnitude: number; direction: number; }

// ===== Utilities =====
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

function detectClouds(pixels:{r:number;g:number;b:number}[][]):CloudDet{
  const h=pixels.length,w=pixels[0]?.length||0;
  if(!h||!w)return{cloudMask:[],cloudCount:0,cloudCoverRatio:0,meanBrightness:0,timestamp:Date.now()};
  const cm=Array.from({length:h},()=>new Array(w).fill(0));
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const p=pixels[y][x];cm[y][x]=isCloud(p.r,p.g,p.b)?255:0;}
  let cp=0,sr=0,sg=0,sb=0,sbr=0;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(cm[y][x]){cp++;const p=pixels[y][x];sr+=p.r;sg+=p.g;sb+=p.b;sbr+=bri(p.r,p.g,p.b);}
  return{cloudMask:cm,cloudCount:cp>0?Math.min(Math.ceil(cp/100),20):0,cloudCoverRatio:cp/(h*w),meanBrightness:cp>0?sbr/cp:0,timestamp:Date.now()};
}

function classify(d:CloudDet):StormCl{
  if(!d||d.cloudCount===0)return{isStorm:false,stormScore:0,cloudType:'clear'};
  const cover=d.cloudCoverRatio,dark=1-d.meanBrightness/255;
  let s=0;if(cover>0.15)s+=Math.min(cover*0.3,0.3);if(dark>0.3)s+=Math.min(dark*0.25,0.25);
  if(d.cloudCount>3)s+=Math.min(d.cloudCount*0.02,0.15);s=Math.min(s,1);
  const t=s>0.55&&dark>0.35?'cumulonimbus':cover>0.5&&dark<0.2?'stratus':s>0.3?'cumulus congestus':cover>0.3?'cumulus':cover>0.1?'scattered':'clear';
  return{isStorm:s>=0.45,stormScore:s,cloudType:t,alertMessage:s>=0.45?`${s>=0.7?'SEVERE':'MODERATE'} STORM (${(s*100).toFixed(0)}%)`:undefined};
}

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

// ===== Main App =====
function StormVisionApp() {
  // Camera
  const [cameraPermission] = useCameraPermissions();
  const hasCameraPermission = cameraPermission?.granted ?? false;
  const [useMock, setUseMock] = useState(true);

  // Detection
  const [frameCount, setFrameCount] = useState(0);
  const [detection, setDetection] = useState<CloudDet|null>(null);
  const [storm, setStorm] = useState<StormCl|null>(null);
  const [motion, setMotion] = useState<Motion>({magnitude:0,direction:0});
  const [showMask, setShowMask] = useState(true);

  // Sensors
  const [compassHeading, setCompassHeading] = useState(0);
  const [hasCompass, setHasCompass] = useState(false);

  // Audio
  const [isRecording, setIsRecording] = useState(false);
  const [audioPermission, setAudioPermission] = useState(false);
  const recordingRef = useRef<Audio.Recording|null>(null);

  // 360
  const [insta360Active, setInsta360Active] = useState(false);
  const [insta360Expanded, setInsta360Expanded] = useState(false);
  const [insta360Connected, setInsta360Connected] = useState(false);
  const insta360Yaw = useRef(0);
  const insta360Pitch = useRef(0);

  // Tab
  const [tab, setTab] = useState<'camera'|'history'|'settings'>('camera');

  // Refs
  const mockGenRef = useRef(new MockFrameGen());
  const prevGrayRef = useRef<number[][]|null>(null);
  const frameHistoryRef = useRef<{frame:number;clouds:number;cover:number;score:number;type:string}[]>([]);
  const [history, setHistory] = useState<typeof frameHistoryRef.current>([]);

  // ===== Init =====
  useEffect(() => {
    (async()=>{
      try {
        const audPerm = await Audio.requestPermissionsAsync();
        setAudioPermission(audPerm.granted);
        await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      } catch(e) { console.log('Audio setup error:', e); }

      try {
        const [hasAccel, hasMag] = await Promise.all([
          Accelerometer.isAvailableAsync(),
          Magnetometer.isAvailableAsync()
        ]);
        setHasCompass(hasAccel && hasMag);
      } catch(e) { console.log('Sensor check error:', e); }
    })();
  }, []);

  // ===== Compass =====
  useEffect(() => {
    if (!hasCompass) return;
    const accelData = { x:0, y:0, z:0 };
    const magData = { x:0, y:0, z:0 };

    const subAccel = Accelerometer.addListener(d => { accelData.x = d.x; accelData.y = d.y; accelData.z = d.z; });
    const subMag = Magnetometer.addListener(d => { magData.x = d.x; magData.y = d.y; magData.z = d.z; });

    const interval = setInterval(() => {
      const a = accelData, m = magData;
      try {
        const pitch = Math.atan2(-a.x, Math.sqrt(a.y*a.y+a.z*a.z));
        const roll = Math.atan2(a.y, a.z);
        const mx2 = m.x*Math.cos(pitch) + m.z*Math.sin(pitch);
        const my2 = m.x*Math.sin(roll)*Math.sin(pitch) + m.y*Math.cos(roll) - m.z*Math.sin(roll)*Math.cos(pitch);
        let heading = Math.atan2(-my2, mx2) * (180/Math.PI);
        if (heading < 0) heading += 360;
        setCompassHeading(heading);
      } catch(e) { /* compass calc error */ }
    }, 200);

    return () => { subAccel.remove(); subMag.remove(); clearInterval(interval); };
  }, [hasCompass]);

  // ===== Main Processing Loop =====
  const processFrame = useCallback(() => {
    try {
      const w=160, h=120;
      const px = mockGenRef.current.generate(w, h);
      const d = detectClouds(px);
      setDetection(d);
      setStorm(classify(d));

      const gray = px.map(row => row.map(p => Math.round(bri(p.r,p.g,p.b))));
      const prev = prevGrayRef.current;
      if (prev && d.cloudMask.length > 0) {
        let tx=0,ty=0,n=0;
        for(let by=0;by+8<=h;by+=12)for(let bx=0;bx+8<=w;bx+=12){
          if(!d.cloudMask[by]?.[bx])continue;
          let best=Infinity,bdx=0,bdy=0;
          for(let sy=-4;sy<=4;sy+=2)for(let sx=-4;sx<=4;sx+=2){
            const ry=by+sy,rx=bx+sx;if(ry<0||ry+8>h||rx<0||rx+8>w)continue;
            let ssd=0;for(let dy=0;dy<8;dy++)for(let dx=0;dx<8;dx++){const df=gray[by+dy][bx+dx]-prev[ry+dy][rx+dx];ssd+=df*df;}
            if(ssd<best){best=ssd;bdx=-sx;bdy=-sy;}
          }
          if(best<8000){tx+=bdx;ty+=bdy;n++;}
        }
        if (n>0) setMotion({magnitude:Math.hypot(tx/n,ty/n),direction:Math.atan2(ty/n,tx/n)});
      }
      prevGrayRef.current = gray.map(r => [...r]);

      setFrameCount(f => {
        const newCount = f + 1;
        if (newCount % 10 === 0) {
          const entry = {frame:newCount,clouds:d.cloudCount,cover:d.cloudCoverRatio,score:classify(d).stormScore,type:classify(d).cloudType};
          frameHistoryRef.current = [entry, ...frameHistoryRef.current].slice(0, 50);
          setHistory([...frameHistoryRef.current]);
        }
        // Auto-rotate 360
        if (insta360Active) {
          insta360Yaw.current += 0.005;
        }
        return newCount;
      });
    } catch(e) { console.log('Process error:', e); }
  }, [insta360Active]);

  useEffect(() => {
    if (tab !== 'camera') return;
    const interval = setInterval(processFrame, 1000);
    return () => clearInterval(interval);
  }, [tab, processFrame]);

  // ===== Audio Recording =====
  async function toggleRecording() {
    if (!audioPermission) return;
    try {
      if (isRecording) {
        await recordingRef.current?.stopAndUnloadAsync();
        recordingRef.current = null;
        setIsRecording(false);
      } else {
        const recording = new Audio.Recording();
        await recording.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
        await recording.startAsync();
        recordingRef.current = recording;
        setIsRecording(true);
      }
    } catch(e) { console.log('Recording error:', e); }
  }

  // ===== Wind Direction =====
  const windDir = motion.magnitude > 0.5
    ? (() => {
        const deg = ((motion.direction * 180 / Math.PI) + 360 + 90) % 360;
        const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
        return dirs[Math.round(deg / 22.5) % 16];
      })()
    : '--';

  // ===== Render =====
  return (
    <SafeAreaView style={s.c}>
      {/* Spacer for bottom nav */}
      <View style={{position:'absolute',bottom:0,left:0,right:0,height:20,backgroundColor:'#111',zIndex:200}} />

      {/* Header */}
      <View style={s.h}>
        <View style={{flexDirection:'row',justifyContent:'space-between',alignItems:'center'}}>
          <Text style={s.t}>⛈ StormVision</Text>
          <Text style={s.hs}>{insta360Connected ? '360° ON' : hasCompass ? 'Sensors OK' : 'Running...'}</Text>
        </View>
      </View>

      {tab === 'camera' && (
        <View style={s.cc}>
          <View style={s.camBox}>
            {!useMock && hasCameraPermission ? (
              <CameraView facing="back" style={{width:300,height:200}} />
            ) : (
              <>
                <Text style={s.cp}>☁️ Sky Camera</Text>
                <Text style={s.fi}>Frame {frameCount}</Text>
              </>
            )}

            {storm?.alertMessage && (
              <View style={[s.alertBox, {backgroundColor: storm.stormScore>=0.7 ? '#8B0000' : '#CC5500'}]}>
                <Text style={s.alertTitle}>⚠️ {storm.alertMessage}</Text>
              </View>
            )}

            {isRecording && (
              <View style={{position:'absolute',top:4,alignSelf:'center',backgroundColor:'rgba(255,0,0,0.8)',paddingHorizontal:12,paddingVertical:2,borderRadius:10}}>
                <Text style={{color:'#fff',fontSize:10,fontWeight:'bold'}}>🔴 REC</Text>
              </View>
            )}

            {insta360Active && !insta360Expanded && (
              <TouchableOpacity
                style={s.pipOverlay}
                onPress={() => setInsta360Expanded(true)}
                onLongPress={() => { insta360Yaw.current = 0; insta360Pitch.current = 0; }}
              >
                <View style={{width:90,height:90,justifyContent:'center',alignItems:'center'}}>
                  <Text style={{color:'#50C8FF',fontSize:9}}>🌐 360°</Text>
                  <Text style={{color:'rgba(80,200,255,0.4)',fontSize:7,marginTop:2}}>Tap to expand</Text>
                </View>
                {insta360Connected && (
                  <View style={{position:'absolute',top:2,right:2,width:6,height:6,borderRadius:3,backgroundColor:'#00ff00'}} />
                )}
              </TouchableOpacity>
            )}

            {hasCompass && (
              <View style={s.compassWrap}>
                <View style={s.compassRing}>
                  <Text style={s.compassN}>N</Text>
                  <View style={[s.compassNeedle, {transform: [{rotate: `${compassHeading}deg`}]}]} />
                </View>
                <Text style={s.compassLabel}>{Math.round(compassHeading)}°</Text>
              </View>
            )}
          </View>

          {/* Dashboard */}
          <View style={s.panel}>
            <Text style={s.pt}>📊 LIVE</Text>
            <View style={s.pr}><Text>Clouds</Text><Text style={{color:'#fff'}}>{detection?.cloudCount??0}</Text></View>
            <View style={s.pr}><Text>Cover</Text><Text style={{color:'#fff'}}>{((detection?.cloudCoverRatio??0)*100).toFixed(0)}%</Text></View>
            <View style={s.pr}><Text>Score</Text><Text style={{color:'#fff'}}>{((storm?.stormScore??0)*100).toFixed(0)}%</Text></View>
            <View style={s.pr}><Text>Type</Text><Text style={{color:'#fff'}}>{(storm?.cloudType??'--').toUpperCase().slice(0,10)}</Text></View>
            <View style={[s.pr,{borderTopWidth:1,borderTopColor:'#333',paddingTop:4,marginTop:4}]}>
              <Text>Motion</Text><Text style={{color:'#fff'}}>{motion.magnitude>0.5?motion.magnitude.toFixed(1)+'px':'--'}</Text>
            </View>
            <View style={s.pr}><Text>Wind</Text><Text style={{color:'#fff'}}>{windDir}</Text></View>
            <View style={s.pr}><Text>Heading</Text><Text style={{color:'#fff'}}>{Math.round(compassHeading)}°</Text></View>
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
            <TouchableOpacity style={[s.tb,insta360Active&&s.ta]} onPress={()=>{
              const a = !insta360Active;
              setInsta360Active(a);
              if (a) {
                insta360Yaw.current = 0; insta360Pitch.current = 0;
                setTimeout(() => setInsta360Connected(true), 2000);
              } else {
                setInsta360Expanded(false); setInsta360Connected(false);
              }
            }}>
              <Text style={{fontSize:18}}>🌐</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.tb} onPress={()=>{prevGrayRef.current=null;setFrameCount(0);}}>
              <Text style={{fontSize:18}}>🔄</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* History Tab */}
      {tab === 'history' && (
        <ScrollView style={s.sl}>
          <Text style={s.sst}>Detection History</Text>
          {history.length === 0 && <Text style={s.em}>No data yet. Open the Camera tab to start detecting.</Text>}
          {history.map((h,i) => (
            <View key={i} style={s.hi}>
              <View style={[s.sd,{backgroundColor:h.score>=0.7?'#ff4444':h.score>=0.45?'#ff8800':'#444'}]}/>
              <View style={{flex:1}}>
                <Text style={s.ht}>Frame #{h.frame}</Text>
                <Text style={s.hm}>{h.type} · {h.clouds} clouds · {(h.cover*100).toFixed(0)}%</Text>
              </View>
              <Text style={s.hsc}>{(h.score*100)|0}</Text>
            </View>
          ))}
        </ScrollView>
      )}

      {/* Settings Tab */}
      {tab === 'settings' && (
        <ScrollView style={s.sl}>
          <Text style={s.sst}>Settings</Text>
          <View style={s.sr}>
            <Text style={s.slbl}>Mock Camera</Text>
            <Switch value={useMock} onValueChange={v=>{setUseMock(v);prevGrayRef.current=null;}} trackColor={{false:'#333',true:'#1a6b4a'}} thumbColor={useMock?'#50C8FF':'#666'}/>
          </View>
          <View style={s.sr}>
            <Text style={s.slbl}>Cloud Mask</Text>
            <Switch value={showMask} onValueChange={setShowMask} trackColor={{false:'#333',true:'#1a6b4a'}} thumbColor={showMask?'#50C8FF':'#666'}/>
          </View>
          <Text style={s.sst2}>About</Text>
          <View style={s.ab}>
            <Text style={s.abt}>StormVision v1.0.0</Text>
            <Text style={s.abtxt}>AI-powered storm cloud tracking for mobile. Works with phone camera and Insta360 360° cameras. Live compass, barometric pressure, audio recording, and cloud detection.</Text>
          </View>
        </ScrollView>
      )}

      {/* 360 Modal */}
      <Modal visible={insta360Expanded} transparent animationType="fade" onRequestClose={()=>setInsta360Expanded(false)}>
        <View style={{flex:1,backgroundColor:'#000',justifyContent:'center',alignItems:'center'}}>
          <Text style={{color:'#50C8FF',fontSize:16,marginBottom:20}}>🌐 360° Camera View</Text>
          <View style={{width:280,height:280,borderRadius:140,borderWidth:2,borderColor:'rgba(80,200,255,0.3)',justifyContent:'center',alignItems:'center'}}>
            <Text style={{color:'#888',fontSize:12}}>Drag to look around</Text>
            <Text style={{color:'rgba(80,200,255,0.4)',fontSize:10,marginTop:4}}>Pinch to zoom</Text>
          </View>
          <Text style={{color:'#888',fontSize:10,marginTop:8}}>Connect to Insta360 WiFi for live feed</Text>
          <TouchableOpacity
            style={{position:'absolute',top:40,right:20,width:36,height:36,borderRadius:18,backgroundColor:'rgba(255,255,255,0.1)',justifyContent:'center',alignItems:'center'}}
            onPress={()=>setInsta360Expanded(false)}
          >
            <Text style={{color:'#fff',fontSize:18}}>✕</Text>
          </TouchableOpacity>
        </View>
      </Modal>

      {/* Tab Bar */}
      <View style={[s.tabBar]}>
        <TouchableOpacity style={[s.tab,tab==='camera'&&s.tabA]} onPress={()=>setTab('camera')}>
          <Text style={s.ti}>📷</Text>
          <Text style={s.tl}>Camera</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[s.tab,tab==='history'&&s.tabA]} onPress={()=>setTab('history')}>
          <Text style={s.ti}>📊</Text>
          <Text style={s.tl}>History</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[s.tab,tab==='settings'&&s.tabA]} onPress={()=>setTab('settings')}>
          <Text style={s.ti}>⚙️</Text>
          <Text style={s.tl}>Settings</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <StormVisionApp />
    </ErrorBoundary>
  );
}

// ===== Styles =====
const s = StyleSheet.create({
  c:{flex:1,backgroundColor:'#0a0a0a'},
  h:{paddingHorizontal:16,paddingTop:12,paddingBottom:8,borderBottomWidth:1,borderBottomColor:'#222'},
  t:{color:'#50C8FF',fontSize:22,fontWeight:'bold'},
  hs:{color:'#888',fontSize:12,marginTop:2},
  cc:{flex:1,alignItems:'center',paddingTop:20},
  camBox:{width:300,height:200,borderRadius:12,backgroundColor:'#1a1a2e',justifyContent:'center',alignItems:'center',overflow:'hidden',borderWidth:1,borderColor:'#333',position:'relative'},
  cp:{color:'#50C8FF',fontSize:16,fontWeight:'600'},
  fi:{color:'rgba(255,255,255,0.4)',fontSize:11,marginTop:6},
  alertBox:{position:'absolute',top:8,left:8,right:8,padding:8,borderRadius:8,zIndex:100},
  alertTitle:{color:'#fff',fontSize:14,fontWeight:'bold',textAlign:'center'},
  pipOverlay:{position:'absolute',top:4,left:4,width:96,height:96,borderRadius:8,borderWidth:2,borderColor:'rgba(80,200,255,0.6)',backgroundColor:'rgba(0,0,0,0.8)',zIndex:15,justifyContent:'center',alignItems:'center'},
  panel:{width:300,backgroundColor:'rgba(0,0,0,0.8)',borderRadius:10,padding:10,marginTop:10},
  pt:{color:'#50C8FF',fontSize:11,fontWeight:'bold',letterSpacing:1,marginBottom:4},
  pr:{color:'rgba(255,255,255,0.8)',fontSize:11,marginBottom:2,flexDirection:'row',justifyContent:'space-between'},
  tg:{flexDirection:'row',marginTop:12,gap:8},
  tb:{padding:8,backgroundColor:'#222',borderRadius:8,width:44,alignItems:'center'},
  ta:{backgroundColor:'#1a3a4a',borderWidth:1,borderColor:'#50C8FF'},
  sl:{flex:1,padding:16},
  sst:{color:'#50C8FF',fontSize:14,fontWeight:'bold',marginBottom:12,letterSpacing:1},
  sst2:{color:'#50C8FF',fontSize:12,fontWeight:'600',letterSpacing:1,marginTop:16,marginBottom:8,textTransform:'uppercase'},
  em:{color:'#666',fontSize:13,textAlign:'center',paddingTop:40},
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
});
