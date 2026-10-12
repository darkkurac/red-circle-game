(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const config = globalThis.RED_RING_CONFIG;
  const race = new RaceEngine(config);
  const frame = $('game'), canvas = $('scene'), ctx = canvas.getContext('2d', {alpha:false});
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  ctx.imageSmoothingEnabled = false;
  const storage = {
    get(key, fallback) { try { return localStorage.getItem('red-ring-' + key) ?? fallback; } catch { return fallback; } },
    set(key, value) { try { localStorage.setItem('red-ring-' + key, String(value)); } catch { /* Сессионный рекорд сохраняется в памяти. */ } }
  };
  const storedNumber=(key)=>{const n=Number(storage.get(key,0));return Number.isFinite(n)?Math.max(0,Math.floor(n)):0;};
  let best = storedNumber('best');
  let factCursor = storedNumber('fact-cursor') % config.facts.length;
  let soundEnabled = storage.get('sound', 'true') !== 'false';
  let noticeTime = 0, flash = 0, previous = 0, visualTime = 0, recorded = false, emissionTime=0;
  const smoke = [], skidMarks = [];
  const panels = ['start-panel','fact-panel','pause-panel','result-panel'];
  const audio = {
    context:null, engine:null, volume:null,
    init() {
      try {
        if (!this.context) {
          const Audio = window.AudioContext || window.webkitAudioContext;
          if (!Audio) return;
          this.context = new Audio(); this.engine = this.context.createOscillator();
          this.engine.type = 'sawtooth'; this.volume = this.context.createGain();
          const filter = this.context.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 240;
          this.engine.connect(filter); filter.connect(this.volume); this.volume.connect(this.context.destination);
          this.volume.gain.value = 0; this.engine.start();
        }
        const promise = this.context.resume(); if (promise) promise.catch(() => {});
      } catch { /* Отсутствие аудио не препятствует игре. */ }
    },
    update() {
      if (!this.context) return;
      const time = this.context.currentTime;
      this.volume.gain.setTargetAtTime(soundEnabled && race.state === 'running' ? 0.025 : 0, time, 0.08);
      this.engine.frequency.setTargetAtTime(42 + race.speed * 0.47, time, 0.1);
    },
    effect(kind) {
      if (!this.context || !soundEnabled) return;
      const time = this.context.currentTime;
      if (kind === 'collision' || kind === 'drift') {
        const duration = kind === 'collision' ? 0.24 : 0.7;
        const buffer = this.context.createBuffer(1, this.context.sampleRate * duration, this.context.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
        const source = this.context.createBufferSource(); source.buffer = buffer;
        const filter = this.context.createBiquadFilter(); filter.type = 'bandpass'; filter.frequency.value = kind === 'drift' ? 1800 : 180;
        const gain = this.context.createGain(); gain.gain.setValueAtTime(kind === 'drift' ? 0.065 : 0.17, time);
        source.connect(filter); filter.connect(gain); gain.connect(this.context.destination); source.start();
      } else {
        const tone = this.context.createOscillator(), gain = this.context.createGain();
        tone.type = 'sine'; tone.frequency.setValueAtTime(kind === 'pass' ? 660 : 880, time);
        tone.frequency.exponentialRampToValueAtTime(kind === 'pass' ? 920 : 1320, time + 0.12);
        gain.gain.setValueAtTime(0.04, time); gain.gain.exponentialRampToValueAtTime(0.001, time + 0.18);
        tone.connect(gain); gain.connect(this.context.destination); tone.start(); tone.stop(time + 0.2);
      }
    }
  };
  function updateSoundButton() {
    $('sound').setAttribute('aria-pressed', String(soundEnabled));
    $('sound').setAttribute('aria-label', soundEnabled ? 'Выключить звук' : 'Включить звук');
    $('sound').title = soundEnabled ? 'Выключить звук' : 'Включить звук';
  }
  function showPanel(id) {
    $('overlay').hidden = false;
    panels.forEach(panel => $(panel).hidden = panel !== id);
    $('countdown').hidden = true;
    frame.classList.remove('playing');
    if($(id))$(id).scrollTop=0;
    const button = $(id)?.querySelector('button');
    if (button) button.focus({preventScroll:true});
  }
  function showCountdown() {
    $('overlay').hidden = false; panels.forEach(panel => $(panel).hidden = true);
    $('countdown').hidden = false; frame.classList.remove('playing'); frame.focus({preventScroll:true});
  }
  function hideOverlay() {
    $('overlay').hidden = true; frame.classList.add('playing'); frame.focus({preventScroll:true});
  }
  function notify(text, seconds = 1.5) { $('notice').textContent = text; noticeTime = seconds; }
  function start() {
    audio.init(); race.start(); smoke.length = 0; skidMarks.length = 0; noticeTime = 0; flash = 0; recorded = false;emissionTime=0;
    hideOverlay(); notify('СТАРТ', 1);
  }
  function pause() {
    if (race.state !== 'running' && race.state !== 'countdown') return;
    race.pause(); showPanel('pause-panel'); audio.update();
  }
  function result() {
    const won = race.state === 'finished';
    const newRecord = race.score > best;
    if (!recorded) { best = Math.max(best, race.score); storage.set('best', best); recorded = true; }
    $('result-title').textContent = won ? 'Финиш' : 'Заезд завершён';
    $('result-score').textContent = race.score.toLocaleString('ru-RU');
    $('result-laps').textContent = race.completed + ' / ' + config.laps;
    $('result-passes').textContent = race.passes; $('result-drifts').textContent = race.drifts;
    $('record').textContent = (newRecord ? '↗ Новый личный рекорд: ' : 'Личный рекорд: ') + best.toLocaleString('ru-RU');
    if(won)showPanel('result-panel');
    else {
      $('fact-kicker').textContent='ЗАЕЗД ЗАВЕРШЁН / ИСТОРИЯ '+(factCursor+1)+' ИЗ '+config.facts.length;
      $('fact-text').textContent=config.facts[factCursor];
      factCursor=(factCursor+1)%config.facts.length;storage.set('fact-cursor',factCursor);
      showPanel('fact-panel');
    }
  }
  $('start').addEventListener('click', start); $('restart').addEventListener('click', start);
  $('pause').addEventListener('click', pause);
  $('resume').addEventListener('click', () => { audio.init(); race.resume(); showCountdown(); });
  $('next').addEventListener('click', () => {
    if(race.state==='lost')showPanel('result-panel');
  });
  $('sound').addEventListener('click', () => { soundEnabled = !soundEnabled; storage.set('sound', soundEnabled); audio.init(); updateSoundButton(); audio.update(); });
  $('left').addEventListener('pointerdown', event => { event.preventDefault(); frame.focus({preventScroll:true}); race.move(-1); });
  $('right').addEventListener('pointerdown', event => { event.preventDefault(); frame.focus({preventScroll:true}); race.move(1); });
  document.addEventListener('keydown', event => {
    if (!frame.contains(document.activeElement) && document.activeElement !== frame) return;
    if (race.state === 'running' && ['ArrowLeft','ArrowRight','a','A','d','D','ф','Ф','в','В'].includes(event.key)) {
      event.preventDefault(); if (event.repeat) return;
      race.move(['ArrowLeft','a','A','ф','Ф'].includes(event.key) ? -1 : 1);
    } else if (event.key === 'Escape' && ['running','countdown'].includes(race.state)) { event.preventDefault(); pause(); }
  });
  let swipe = null;
  canvas.addEventListener('pointerdown', event => {
    frame.focus({preventScroll:true});
    if (race.state !== 'running') return;
    swipe = {x:event.clientX, y:event.clientY, id:event.pointerId}; canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove', event => {
    if (!swipe || swipe.id !== event.pointerId) return;
    const dx = event.clientX - swipe.x, dy = event.clientY - swipe.y;
    if (Math.abs(dx) > 28 && Math.abs(dx) > Math.abs(dy)) { race.move(Math.sign(dx)); swipe.x = event.clientX; swipe.y = event.clientY; }
  });
  const endSwipe = () => swipe = null;
  canvas.addEventListener('pointerup', endSwipe); canvas.addEventListener('pointercancel', endSwipe);
  window.addEventListener('blur', pause);
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
  frame.addEventListener('focusout', event => { if (!frame.contains(event.relatedTarget)) pause(); });
  window.addEventListener('orientationchange', pause);
  if (screen.orientation?.addEventListener) screen.orientation.addEventListener('change', pause);

  function handleEvents() {
    for (const event of race.events.splice(0)) {
      if (event.type === 'pass') { audio.effect('pass'); notify('+100 · ЧИСТЫЙ ОБГОН', 0.85); }
      if (event.type === 'collision') { audio.effect('collision'); flash = 0.35; notify('КОНТАКТ · −1 ЖИЗНЬ', 1.5); }
      if (event.type === 'drift') { audio.effect('drift'); notify('+300 · КРАСИВЫЙ ЗАНОС!', 2); }
      if (event.type === 'turn') { notify('ДРИФТ → ' + ['ЛЕВАЯ ПОЛОСА','СРЕДНЯЯ ПОЛОСА','ПРАВАЯ ПОЛОСА'][event.lane], 2.2); }
      if (event.type === 'go') { hideOverlay(); audio.effect('go'); notify('КРУГ ' + race.lap + ' · ПОЕХАЛИ!', 1.5); }
      if (event.type === 'lap') notify('КРУГ '+event.lap+' / '+config.laps+' · ТЕМП ВЫШЕ', 2);
      if (event.type === 'result') result();
    }
  }
  function hud() {
    $('lap').textContent = String(race.lap).padStart(2,'0'); $('score').textContent = String(race.score).padStart(5,'0');
    $('speed').textContent = race.speed; $('lives').textContent = '◆ '.repeat(race.lives) + '◇ '.repeat(config.lives - race.lives);
    $('lives').setAttribute('aria-label', 'Осталось жизней: ' + race.lives);
    $('progress').style.width = (race.progress * 100) + '%';
    $('pause').disabled = race.state !== 'running';
    $('drift-status').textContent = race.drift > 0 ? 'ДРИФТ / УСКОРЕНИЕ ↗' : race.slow > 0 ? 'ЗАМЕДЛЕНИЕ' : '';
    $('drift-status').style.color = race.drift > 0 ? '#f4ce68' : '';
    $('notice').classList.toggle('visible', noticeTime > 0 && race.state === 'running');
    if (race.state === 'countdown') $('countdown').textContent = Math.max(1, Math.ceil(race.countdown));
  }

  // Все изображения рисуются здесь; игра не загружает картинки и шрифты из сети.
  function rect(x,y,w,h,color) { ctx.fillStyle = color; ctx.fillRect(Math.round(x),Math.round(y),Math.ceil(w),Math.ceil(h)); }
  function polygon(points,color) { ctx.fillStyle=color; ctx.beginPath(); points.forEach(([x,y],i) => i ? ctx.lineTo(Math.round(x),Math.round(y)) : ctx.moveTo(Math.round(x),Math.round(y))); ctx.closePath(); ctx.fill(); }
  const geometry=globalThis.RaceGeometry, horizon=geometry.horizon;
  function road(y) {return geometry.road(y,race.curve);}
  function lanePosition(y,lane) {return geometry.laneX(y,lane,race.curve);}
  let sceneScaleY=1;
  function resizeScene() {
    const bounds=canvas.getBoundingClientRect();
    if(bounds.width<=0||bounds.height<=0)return;
    const height=Math.round(480*bounds.height/bounds.width);
    if(canvas.height!==height){canvas.height=height;ctx.imageSmoothingEnabled=false;}
    sceneScaleY=height/640;race.viewportScale=sceneScaleY;
  }
  if(window.ResizeObserver)new ResizeObserver(resizeScene).observe(frame);
  else window.addEventListener('resize',resizeScene);
  resizeScene();
  function mountain(points,color) { polygon(points.concat([[480,208],[0,208]]),color); }
  function cloud(x,y,s) {
    rect(x,y,44*s,8*s,'#dcecf0');rect(x+9*s,y-8*s,27*s,10*s,'#e8f1ec');rect(x+18*s,y-13*s,14*s,10*s,'#e8f1ec');
    rect(x+4*s,y+7*s,32*s,4*s,'#adcedd');
  }
  function pine(x,y,size) {
    rect(x-size*.07,y-size*.05,size*.14,size*.25,'#655b42');
    polygon([[x,y-size],[x-size*.28,y-size*.55],[x-size*.13,y-size*.55],[x-size*.4,y-size*.15],[x+size*.4,y-size*.15],[x+size*.13,y-size*.55],[x+size*.28,y-size*.55]],'#254a45');
    polygon([[x,y-size],[x-size*.28,y-size*.55],[x-size*.13,y-size*.55],[x-size*.4,y-size*.15],[x,y-size*.15]],'#356354');
    rect(x-size*.1,y-size*.7,size*.1,size*.12,'#487363');
  }
  function scenery() {
    rect(0,0,480,205,'#86b9cc');rect(0,80,480,75,'#9ec8d3');rect(0,155,480,55,'#bdd8d6');
    cloud(25,99,1.5);cloud(318,82,1.4);cloud(192,131,.7);
    mountain([[0,169],[24,157],[40,161],[75,137],[91,145],[121,122],[155,148],[180,133],[219,153],[241,145],[279,165],[310,145],[355,161],[401,137],[449,153],[480,144]],'#91adb1');
    mountain([[0,182],[46,173],[69,181],[110,159],[156,184],[195,167],[237,176],[287,159],[344,184],[379,178],[417,156],[453,167],[480,161]],'#6c9495');
    mountain([[0,199],[33,182],[61,190],[87,178],[115,193],[142,181],[179,196],[208,189],[249,199],[283,180],[319,195],[348,184],[382,197],[416,179],[452,183],[480,175]],'#567e77');
    // Дальние здания и башня автодрома.
    for (let i=0;i<9;i++) {
      const x=14+i*21,h=9+(i*7)%19;
      rect(x,204-h,14,h,'#ccd2c2');rect(x+2,205-h,10,2,'#e7e5ce');
      for(let row=0;row<3;row++) rect(x+3,210-h+row*5,7,2,'#839da0');
    }
    rect(387,129,3,59,'#4e6764');rect(385,137,7,3,'#dae0cf');rect(385,148,7,3,'#e9e3cc');rect(385,157,7,3,'#d03c35');rect(388,119,1,13,'#425e5b');
    rect(0,205,480,435,'#83915a');
    polygon([[0,248],[136,205],[196,205],[0,370]],'#9ca46e');
    polygon([[355,205],[480,238],[480,480],[295,256]],'#75885a');
    // Главная трибуна в перспективе.
    ctx.save();ctx.translate(34,0);
    polygon([[355,191],[480,142],[480,284],[329,223]],'#d0d4c7');
    polygon([[355,187],[480,139],[480,157],[350,201]],'#303e40');
    polygon([[353,200],[480,157],[480,187],[345,213]],'#566d70');
    for(let i=0;i<8;i++) {
      const x=358+i*17; const top=201-i*5.5;
      rect(x,top,3,17+i,'#abbeb9');rect(x+4,top+1,10,10+i*.8,'#718b88');
    }
    polygon([[344,218],[480,200],[480,213],[338,225]],'#cc3f39');
    polygon([[333,229],[480,243],[480,257],[328,235]],'#63776e');
    for(let i=0;i<7;i++) {
      const x=350+i*20;
      rect(x,228+i*3,15,3,'#ede6d3');rect(x+1,233+i*3,13,3,'#a23230');rect(x,239+i*3,15,3,'#f0e8d4');
    }
    ctx.restore();
    for(let i=0;i<10;i++) {
      const y=219+((i*29)%155),size=18+((i*17)%60),r=road(y);
      pine(r.center-r.half-35-size*.45-(i*19)%40,y,size);
    }
    for(let i=0;i<6;i++) {
      const y=290+i*51,size=40+i*10,r=road(y);
      pine(r.center+r.half+36+size*.45,y,size);
    }
  }
  function drawRoad() {
    const offset=race.distance*115;
    // Единая подложка исключает цветные швы между полосами растровой дороги.
    const left=[],right=[];
    for(let y=horizon;y<=642;y+=3){const r=road(y);left.push([r.center-r.half,y]);right.push([r.center+r.half,y]);}
    polygon([...left,...right.reverse()],'#646c6a');
    for(let y=horizon;y<640;y+=3) {
      const a=road(y), b=road(y+3); const t=(y-horizon)/435;
      const world=1/(t+.026)*32+offset;
      const stripe=Math.floor(world/18)%2;
      const edge=3+12*t;
      polygon([[a.center-a.half-edge,y],[a.center-a.half,y],[b.center-b.half,y+3],[b.center-b.half-edge,y+3]],stripe ? '#efe7d1' : '#c4423a');
      polygon([[a.center+a.half,y],[a.center+a.half+edge,y],[b.center+b.half+edge,y+3],[b.center+b.half,y+3]],stripe ? '#efe7d1' : '#c4423a');
      polygon([[a.center-a.half,y],[a.center+a.half,y],[b.center+b.half,y+3],[b.center-b.half,y+3]],Math.floor(world/7)%2 ? '#646c6a' : '#616967');
      for(const lane of [-1/3,1/3]) {
        if(Math.floor(world/13)%2) rect(a.center+a.half*lane-1,y,Math.max(1,3*t),3,'#d6d8c7');
      }
      if(t>.07) {
        const tex=(Math.floor(y*6+offset*.8)%31)/31;
        rect(a.center-a.half+tex*a.half*2,y,1+2*t,1,'#79817a');
        rect(a.center-a.half+((tex+.47)%1)*a.half*2,y,1+2*t,1,'#535d5a');
      }
    }
    // Две линии отбойников, сетка и стойки вдоль внешнего края.
    for(const side of [-1,1]) {
      for(let y=horizon+8;y<640;y+=5) {
        const t=(y-horizon)/435,r=road(y),r2=road(y+5),shift=20*t;
        const x=r.center+side*(r.half+shift+10),x2=r2.center+side*(r2.half+shift+10);
        polygon([[x,y-20*t],[x2,y+5-20*t],[x2,y+5-13*t],[x,y-13*t]],'#b4bbb1');
        polygon([[x,y-12*t],[x2,y+5-12*t],[x2,y+5-5*t],[x,y-5*t]],'#4d5d58');
      }
      for(let i=0;i<10;i++) {
        const p=((i/10 + race.distance*.014)%1),y=horizon+16+p*p*420,r=road(y),t=(y-horizon)/435;
        const x=r.center+side*(r.half+23*t+9);
        rect(x,y-68*t,Math.max(1,4*t),70*t,'#5e7169');
        if(side===-1) rect(x-2,y-68*t,Math.max(2,6*t),2+2*t,'#d0d7c9');
      }
    }
    // Флаги по краям, за границей полос.
    for(const side of [-1,1]) for(let i=0;i<3;i++) {
      const p=.15+i*.18,y=205+p*p*435,r=road(y),x=r.center+side*(r.half+25+p*35);
      rect(x,y-26-p*70,2,26+p*70,'#d5d5bd');
      polygon([[x+2,y-26-p*70],[x+10+p*14,y-24-p*70],[x+9+p*14,y-9-p*59],[x+2,y-11-p*59]],'#d33232');
    }
  }
  function gateAlpha(gate){return Math.max(0,Math.min(1,(gate.z+.16)/.14));}
  function drawGateMark(gate){
    const p=geometry.project(gate.z),r=road(p.y),height=Math.max(2,8*p.scale/sceneScaleY),cell=r.half/10;
    ctx.save();ctx.globalAlpha=gateAlpha(gate);
    for(let row=0;row<2;row++)for(let col=0;col<20;col++){
      rect(r.center-r.half+col*cell,p.y+row*height/2,cell+1,height/2,(row+col)%2?'#293b38':'#eee8d3');
    }
    ctx.restore();
  }
  function drawGate(gate){
    const p=geometry.project(gate.z),r=road(p.y),s=p.scale;
    const support=12*s,half=r.half+18*s;
    // Положение в перспективе общее с машинами; сама арка рисуется в их очереди по глубине.
    ctx.save();ctx.globalAlpha=gateAlpha(gate);
    ctx.translate(Math.round(r.center),Math.round(p.y));ctx.scale(1,1/sceneScaleY);
    const top=-230*s,beamHeight=40*s;
    for(const side of [-1,1]){
      const x=side*half-support/2;
      rect(x,top,support,-top,'#263b39');rect(x+2*s,top,3*s,-top,'#758980');
      for(let y=-18*s;y>top+beamHeight;y-=26*s)rect(x+3*s,y,support-5*s,10*s,'#d9d6c2');
      rect(x-4*s,-5*s,support+8*s,9*s,'#213330');
    }
    rect(-half-support/2,top,2*half+support,beamHeight,'#1b2c2c');
    rect(-half-support/2,top,2*half+support,4*s,'#d92f30');
    rect(-half-support/2,top+beamHeight-3*s,2*half+support,3*s,'#9ca89b');
    const checkSize=5*s;
    for(const side of [-1,1])for(let row=0;row<2;row++)for(let col=0;col<3;col++){
      rect(side*(half-10*s)-col*checkSize,top+12*s+row*checkSize,checkSize,checkSize,(row+col)%2?'#1b2c2c':'#ece6d2');
    }
    ctx.fillStyle='#f5f0df';ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.font='bold '+Math.max(8,Math.round(26*s))+'px Arial';
    ctx.fillText(gate.label,0,Math.round(top+beamHeight*.53));ctx.restore();
  }
  const carColors=[['#deb946','#f7db79','#927a34'],['#477a9c','#73a8be','#2e556f'],['#b9c4b1','#e1dec6','#768c80'],['#816a91','#b7a3b7','#514c65']];
  function drawCar(x,y,scale,color,angle=0,player=false) {
    ctx.save();ctx.translate(Math.round(x),Math.round(y));ctx.scale(scale,scale/sceneScaleY);
    polygon([[-48,1],[-40,-8],[45,-7],[60,4],[52,10],[-42,10]],'#1f2d2b99');
    ctx.translate(0,-43);ctx.rotate(angle);ctx.translate(0,43);
    const [base,light,dark]=color;
    rect(-47,-49,8,43,'#1e292b');rect(39,-49,8,43,'#1e292b');
    polygon([[-31,-85],[28,-85],[38,-69],[42,-46],[48,-40],[47,-10],[40,-4],[-40,-4],[-47,-10],[-48,-40],[-42,-46],[-37,-69]],dark);
    polygon([[-29,-82],[27,-82],[34,-65],[37,-46],[-36,-46],[-34,-65]],base);
    rect(-24,-78,48,4,light);polygon([[-27,-72],[26,-72],[31,-51],[-31,-51]],'#243b42');
    polygon([[-23,-69],[-5,-69],[19,-53],[7,-53]],'#759795');rect(-24,-50,47,3,'#162c31');
    if(player){polygon([[-21,-69],[-18,-69],[23,-52],[20,-52]],'#a1aaa0');polygon([[21,-69],[18,-69],[-23,-52],[-20,-52]],'#a1aaa0');}
    polygon([[-36,-45],[36,-45],[43,-34],[42,-12],[-42,-12],[-43,-34]],base);
    rect(-36,-43,72,5,light);rect(-43,-33,86,12,base);
    rect(-39,-28,22,7,'#571e23');rect(17,-28,22,7,'#571e23');
    rect(-37,-27,18,3,'#ffd3a4');rect(19,-27,18,3,'#ffd3a4');
    rect(-16,-26,32,5,dark);rect(-42,-18,84,5,dark);rect(-38,-11,76,8,'#1b2c2e');
    rect(-22,-12,44,7,'#384444');for(let i=0;i<5;i++)rect(-20+i*9,-10,3,7,'#111d22');
    rect(-8,-20,16,5,'#e1ddc9');rect(-32,-8,8,4,'#9eaaa3');rect(25,-8,8,4,'#9eaaa3');
    rect(-39,-41,4,12,'#18262b');rect(35,-41,4,12,'#18262b');
    rect(-52,-43,104,5,'#17272d');rect(-48,-44,96,2,light);
    rect(-42,-38,5,3,base);rect(37,-38,5,3,base);
    rect(-43,-59,7,5,dark);rect(36,-59,7,5,dark);
    if(player && race.boost>0){rect(-30,-1,6,12,'#69d4e1');rect(27,-1,6,12,'#69d4e1');rect(-29,1,4,6,'#e9f3d1');rect(28,1,4,6,'#e9f3d1');}
    ctx.restore();
  }
  function drawPickup(p) {
    const projection=geometry.project(p.z),y=projection.y,scale=projection.scale,x=lanePosition(y,p.lane),bob=reducedMotion?0:Math.sin(visualTime*5)*3;
    ctx.save();ctx.translate(Math.round(x),Math.round(y-(35*scale-bob)/sceneScaleY));ctx.scale(scale,scale/sceneScaleY);
    // Пиксельная золотая рамка и силуэт автомобиля боком.
    polygon([[-16,-27],[16,-27],[27,-16],[27,16],[16,27],[-16,27],[-27,16],[-27,-16]],'#a6782c');
    polygon([[-15,-24],[15,-24],[24,-15],[24,15],[15,24],[-15,24],[-24,15],[-24,-15]],'#f5d47a');
    polygon([[-12,-20],[12,-20],[20,-12],[20,12],[12,20],[-12,20],[-20,12],[-20,-12]],'#243c39');
    rect(-11,-1,23,7,'#f1d47e');rect(-6,-7,13,7,'#f1d47e');rect(-3,-6,7,4,'#496465');
    rect(-8,5,5,5,'#172c2b');rect(6,5,5,5,'#172c2b');rect(-18,9,5,2,'#f1d47e');rect(-20,13,9,2,'#f1d47e');
    polygon([[9,-13],[16,-13],[16,-6],[13,-9],[6,-3],[4,-5],[11,-11]],'#f1d47e');ctx.restore();
  }
  function drawScene(dt) {
    ctx.setTransform(1,0,0,sceneScaleY,0,0);ctx.globalAlpha=1;
    scenery();drawRoad();
    const gate=race.gate;
    if(gate)drawGateMark(gate);
    const active=race.state==='running'; const px=lanePosition(geometry.playerY,race.x);
    if(active && race.drift>0 && !reducedMotion) {
      emissionTime+=dt;
      while(emissionTime>=.035){
        emissionTime-=.035;
        if(smoke.length<50)smoke.push({x:px+(Math.random()-.5)*85,y:559,size:9+Math.random()*14,age:0});
        if(skidMarks.length<45){skidMarks.push({x:px-31,y:562,age:0});skidMarks.push({x:px+31,y:562,age:0});}
      }
    }
    if(active){smoke.forEach(p=>{p.age+=dt;p.y+=dt*60;p.x+=race.turnDirection*dt*28;});skidMarks.forEach(p=>{p.age+=dt;p.y+=dt*105;});}
    while(smoke.length && smoke[0].age>1.2)smoke.shift();while(skidMarks.length && skidMarks[0].age>1)skidMarks.shift();
    skidMarks.forEach(p=>rect(p.x,p.y,4,14,'#34433d'));
    const cars=race.state==='ready' ? [{lane:0,z:.39,color:1},{lane:2,z:.61,color:0},{lane:1,z:.85,color:2}] : race.cars;
    const objects=[...cars.map(car=>({...car,type:'car'})),...race.pickups.map(p=>({...p,type:'pickup'})),{z:0,type:'player'},...(gate?[{...gate,type:'gate'}]:[])].sort((a,b)=>b.z-a.z);
    for(const o of objects) {
      if(o.type==='pickup')drawPickup(o);
      else if(o.type==='gate')drawGate(o);
      else if(o.type==='player'){
        smoke.forEach(p=>{ctx.globalAlpha=Math.max(0,.40*(1-p.age/1.2));rect(p.x-p.size/2,p.y-p.size/2,p.size,p.size,'#e1e1d4');});ctx.globalAlpha=1;
        if(race.invincible>0&&!reducedMotion&&Math.floor(visualTime*12)%2===0)ctx.globalAlpha=.4;
        drawCar(px,geometry.playerY,geometry.playerScale,['#d93532','#f56b51','#952e2d'],race.playerAngle,true);ctx.globalAlpha=1;
      } else {
        const p=geometry.project(o.z);if(o.hit)ctx.globalAlpha=.45;
        drawCar(lanePosition(p.y,o.lane),p.y,p.scale,carColors[o.color] || carColors[0],0);ctx.globalAlpha=1;
      }
    }
    if(flash>0 && !reducedMotion){ctx.globalAlpha=flash*.6;rect(0,0,480,640,'#ed3933');ctx.globalAlpha=1;}
  }
  function loop(timestamp) {
    const dt=previous ? Math.max(0,Math.min((timestamp-previous)/1000,.1)) : 0;previous=timestamp;
    if(race.state==='running' || race.state==='ready')visualTime+=dt;
    race.step(dt);handleEvents();
    if(race.state==='running')noticeTime=Math.max(0,noticeTime-dt);
    flash=Math.max(0,flash-dt);
    drawScene(dt);hud();audio.update();requestAnimationFrame(loop);
  }
  updateSoundButton();requestAnimationFrame(loop);
})();
