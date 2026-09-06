export const DAY_SECONDS=600;
export const TIME_SCALES=[.25,.5,1,2,4,8,16] as const;
export type ClockSnapshot={day:number;minutes:number};
const wrap=(n:number,size:number)=>((n%size)+size)%size;
const smooth=(a:number,b:number,n:number)=>{const t=Math.max(0,Math.min(1,(n-a)/(b-a)));return t*t*(3-2*t);};

export function formatClock(minutes:number){
  const m=Math.floor(wrap(minutes,1440));
  return `${String(Math.floor(m/60)).padStart(2,"0")}:${String(m%60).padStart(2,"0")}`;
}
export function timeOfDay(hour:number){
  const h=wrap(hour,24);
  return h<5||h>=20?"夜晚":h<8?"清晨":h<16?"白昼":"黄昏";
}

export class DayNightClock {
  private totalMinutes=8*60;
  get hour(){return wrap(this.totalMinutes,1440)/60;}
  snapshot():ClockSnapshot{return {day:Math.floor(this.totalMinutes/1440)+1,minutes:wrap(this.totalMinutes,1440)};}
  update(seconds:number,scale=1){
    if(!Number.isFinite(seconds)||!Number.isFinite(scale))return;
    this.totalMinutes+=Math.max(0,seconds)*1440/DAY_SECONDS*Math.max(0,Math.min(16,scale));
  }
  setHour(hour:number){
    if(Number.isFinite(hour))this.totalMinutes=Math.floor(this.totalMinutes/1440)*1440+wrap(hour,24)*60;
  }
}

/** Stylized spring sun: rises in +X/east, crosses the sky, sets in -X/west. */
export function solarAt(hour:number){
  const h=wrap(hour,24),angle=(h-6)/24*Math.PI*2,elevation=Math.sin(angle);
  // Fade at the horizon and cap grazing shadow length to keep the whole farm
  // within a stable shadow map. The midnight sun contributes no direct light.
  const x=Math.cos(angle),y=Math.max(.18,elevation*.9),z=-elevation*.32,length=Math.hypot(x,y,z);
  return {
    hour:h,toSun:{x:x/length,y:y/length,z:z/length},
    daylight:smooth(-.12,.30,elevation),
    sunlight:smooth(-.02,.18,elevation)*(1.05+.15*Math.max(0,elevation)),
    twilight:smooth(-.20,.03,elevation)*(1-smooth(.08,.65,elevation)),
  };
}
export type SolarState=ReturnType<typeof solarAt>;
export const INITIAL_SUN=solarAt(8);
