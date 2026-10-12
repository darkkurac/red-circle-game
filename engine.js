/* Движок без DOM: время в секундах, расстояния нормированы на один круг. */
(function (root) {
  'use strict';
  // Общая геометрия для столкновений и Canvas: позиции и масштаб совпадают.
  const geometry = {
    horizon:205, playerY:567, playerScale:1.08,
    road(y, curve=0) {
      const t=Math.max(0,(y-205)/435);
      return {center:240+curve*105*(1-t)**2, half:12+310*t};
    },
    laneX(y,lane,curve=0) { const r=this.road(y,curve);return r.center+(lane-1)*r.half*.64; },
    project(z) { const q=1-z;return {y:205+q*q*362, scale:.13+q*.87}; },
    bounds(x,y,scale,angle=0) {
      const cos=Math.cos(angle),sin=Math.sin(angle);
      const corners=[[-43,-80],[43,-80],[43,-6],[-43,-6]].map(([cx,cy])=>({
        x:x+(cx*cos-(cy+43)*sin)*scale,
        y:y+(-43+cx*sin+(cy+43)*cos)*scale
      }));
      return {left:Math.min(...corners.map(p=>p.x)),right:Math.max(...corners.map(p=>p.x)),top:Math.min(...corners.map(p=>p.y)),bottom:Math.max(...corners.map(p=>p.y))};
    },
    overlap(a,b) {return a.left<b.right-3&&a.right>b.left+3&&a.top<b.bottom-3&&a.bottom>b.top+3;}
  };
  class RaceEngine {
    constructor(config, random = Math.random) { this.config = config; this.random = random; this.viewportScale=1; this.reset(); }
    reset() {
      this.state = 'ready'; this.lap = 1; this.completed = 0; this.progress = 0;
      this.score = 0; this.passes = 0; this.drifts = 0; this.lives = this.config.lives;
      this.lane = 1; this.x = 1; this.invincible = 0; this.slow = 0; this.boost = 0; this.drift = 0;
      this.turnDirection = 1; this.cars = []; this.pickups = []; this.spawnClock = 1;
      this.turnsSpawned = new Set(); this.events = []; this.distance = 0; this.time = 0; this.nextCarId=0;
      this.lastSafeLane = 1; this.countdown = 0;
    }
    start() { this.reset(); this.state = 'running'; }
    move(direction) {
      if (this.state !== 'running') return;
      this.lane = Math.max(0, Math.min(this.config.lanes - 1, this.lane + direction));
    }
    pause() { if (this.state === 'running' || this.state === 'countdown') { this.state = 'paused'; this.events.push({type:'pause'}); } }
    resume() { if (this.state === 'paused') { this.state = 'countdown'; this.countdown = 3; } }
    get speedFactor() { return (this.boost > 0 ? this.config.boostMultiplier : 1) * (this.slow > 0 ? 0.55 : 1); }
    get speed() { return this.state === 'running' ? Math.round((this.config.baseSpeed + (this.lap - 1) * this.config.speedPerLap) * this.speedFactor) : 0; }
    get approach() {return this.config.approachSpeed+(this.lap-1)*this.config.approachPerLap;}
    get lapDuration() {return Math.max(this.config.minLapSeconds,this.config.lapSeconds-(this.lap-1)*this.config.lapReductionPerLap);}
    get rowInterval() {return Math.max(this.config.minRowSeconds,this.config.rowSeconds-(this.lap-1)*this.config.rowReductionPerLap);}
    get doubleRowChance() {return Math.min(1,this.config.doubleRowChance+(this.lap-1)*this.config.doubleRowIncrease);}
    get laneShiftChance() {return Math.min(1,this.config.laneShiftChance+(this.lap-1)*this.config.laneShiftIncrease);}
    get gate() {
      const finish=this.progress>.8;
      const z=finish ? .28+4*(1-this.progress) : .28-4*this.progress;
      if(z<-.16||z>.98)return null;
      const gateLap=finish ? Math.min(this.config.laps,this.lap+1) : this.lap;
      return {z,label:gateLap===this.config.laps?'Финиш':gateLap+' круг'};
    }
    get playerAngle() {return this.drift>0 ? this.turnDirection*-.52*Math.min(1,this.drift*3) : (this.lane-this.x)*.075;}
    get playerBounds() {return geometry.bounds(geometry.laneX(geometry.playerY,this.x,this.curve),geometry.playerY*this.viewportScale,geometry.playerScale,this.playerAngle);}
    carBounds(car) { const p=geometry.project(car.z);return geometry.bounds(geometry.laneX(p.y,car.lane,this.curve),p.y*this.viewportScale,p.scale); }
    get curve() {
      let curve = 0;
      this.config.turnPositions.forEach((position, i) => {
        const t = (this.progress - position + 0.05) / 0.17;
        if (t > 0 && t < 1) curve += Math.sin(t * Math.PI) * (i % 2 ? -1 : 1);
      });
      return curve;
    }
    emit(type, data = {}) { this.events.push({type, ...data}); }
    collide(car) {
      car.hit = true;
      if (this.invincible > 0) return;
      this.lives--; this.invincible = this.config.protectionSeconds; this.slow = 1.1;
      this.boost = 0; this.drift = 0; this.emit('collision');
      if (this.lives <= 0) { this.state = 'lost'; this.emit('result'); }
    }
    spawnTraffic() {
      // Плотные ряды, но всегда есть достижимая свободная полоса.
      const adjacent=[this.lastSafeLane-1,this.lastSafeLane+1].filter(lane=>lane>=0&&lane<this.config.lanes);
      const safe = this.random()<this.laneShiftChance ? adjacent[Math.floor(this.random()*adjacent.length)] : this.lastSafeLane;
      // Резервировать только ближайший ряд рядом со знаком; уже видимые машины не исчезают.
      const reserved=this.pickups.find(p=>!p.collected&&p.z>.76);
      this.lastSafeLane = reserved ? reserved.lane : safe;
      const lanes = [0, 1, 2].filter(lane => lane !== this.lastSafeLane);
      if (this.random() > this.doubleRowChance) lanes.splice(Math.floor(this.random() * lanes.length), 1);
      lanes.forEach(lane => this.cars.push({id:this.nextCarId++,lane, z:1, color:Math.floor(this.random()*4), hit:false,passed:false}));
    }
    step(dt) {
      if (!Number.isFinite(dt) || dt <= 0) return;
      // Малые шаги исключают пропуск столкновений при нестабильной частоте кадров.
      while (dt > 0) { const slice = Math.min(dt, 1 / 60); this.tick(slice); dt -= slice; }
    }
    tick(dt) {
      if (this.state === 'countdown') {
        this.countdown -= dt;
        if (this.countdown <= 0) { this.state = 'running'; this.emit('go'); }
        return;
      }
      if (this.state !== 'running') return;
      this.time += dt;
      this.x += (this.lane - this.x) * (1 - Math.exp(-13 * dt));
      this.invincible = Math.max(0, this.invincible - dt); this.slow = Math.max(0, this.slow - dt);
      this.boost = Math.max(0, this.boost - dt); this.drift = Math.max(0, this.drift - dt);
      const factor = this.speedFactor;
      this.progress += dt / this.lapDuration * factor;
      this.distance += dt * factor;
      this.spawnClock -= dt * factor;
      if (this.spawnClock <= 0) { this.spawnTraffic(); this.spawnClock += this.rowInterval; }
      this.config.turnPositions.forEach((position, i) => {
        if (this.progress >= position - 0.095 && !this.turnsSpawned.has(i)) {
          this.turnsSpawned.add(i);
          const available=[0,1,2].filter(lane=>!this.cars.some(car=>car.lane===lane&&Math.abs(car.z-.95)<.25));
          const lane = available[Math.floor(this.random()*available.length)] ?? this.lastSafeLane;
          this.pickups.push({lane, z:0.95, direction:i % 2 ? -1 : 1, collected:false});
          this.emit('turn', {lane, direction:i % 2 ? -1 : 1});
        }
      });
      const velocity = this.approach * factor;
      for (const car of this.cars) {
        car.z -= velocity * dt;
        const bounds=this.carBounds(car),player=this.playerBounds;
        if (!car.hit && geometry.overlap(bounds,player)) {
          this.collide(car);
          if (this.state !== 'running') break;
        }
        if (!car.hit && !car.passed && bounds.top > player.bottom+6) {
          car.passed = true; this.score += this.config.passPoints; this.passes++; this.emit('pass');
        }
      }
      if (this.state !== 'running') return;
      for (const pickup of this.pickups) {
        pickup.z -= velocity * dt;
        if (!pickup.collected && pickup.z <= 0.08 && pickup.z >= -0.04 && Math.abs(pickup.lane - this.x) < 0.40) {
          pickup.collected = true; this.drift = this.config.boostSeconds; this.boost = this.config.boostSeconds;
          this.turnDirection = pickup.direction; this.drifts++; this.score += this.config.driftPoints; this.emit('drift');
        }
      }
      this.cars = this.cars.filter(car => car.z > -0.3);
      this.pickups = this.pickups.filter(p => p.z > -0.12 && !p.collected);
      if (this.progress >= 1) {
        this.completed++;
        if(this.completed===this.config.laps){this.progress=1;this.state='finished';this.emit('result');}
        else {this.progress-=1;this.lap++;this.turnsSpawned.clear();this.emit('lap',{lap:this.lap});}
      }
    }
  }
  root.RaceEngine = RaceEngine;
  root.RaceGeometry = geometry;
  if (typeof module !== 'undefined') module.exports = RaceEngine;
})(globalThis);
