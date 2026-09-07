export type ScreenPoint={x:number;y:number};
export const PICKUP_LIFT_SECONDS=.18,PICKUP_FLY_SECONDS=.60,PICKUP_REDUCED_SECONDS=.22;
export const PICKUP_POOL_SIZE=24,PICKUP_SLOT_SHINE_SECONDS=.48;
const clamp=(n:number)=>Math.max(0,Math.min(1,Number.isFinite(n)?n:0));
const smooth=(u:number)=>u*u*(3-2*u);

/** Screen-space continuation from the projected ground object to its actual slot. */
export function pickupFlightPose(from:ScreenPoint,to:ScreenPoint,elapsed:number,motion=true){
  const age=Math.max(0,Number.isFinite(elapsed)?elapsed:0);
  if(!motion){
    const u=clamp(age/PICKUP_REDUCED_SECONDS);
    // Reduced motion avoids a long cross-screen sweep but preserves source/arrival feedback.
    return {x:from.x,y:from.y-6*u,scale:1,opacity:1-smooth(u),rotation:0,progress:u,stage:"fade" as const,done:u>=1};
  }
  const lift=34;
  if(age<PICKUP_LIFT_SECONDS){
    const u=clamp(age/PICKUP_LIFT_SECONDS),ease=1-(1-u)**3;
    return {x:from.x,y:from.y-lift*ease,scale:.86+.24*ease,opacity:1,rotation:-12*ease,progress:0,stage:"lift" as const,done:false};
  }
  const u=clamp((age-PICKUP_LIFT_SECONDS)/PICKUP_FLY_SECONDS),ease=u*u*(3-2*u);
  const arc=Math.min(90,Math.max(34,Math.hypot(to.x-from.x,to.y-from.y)*.18));
  return {x:from.x+(to.x-from.x)*ease,y:from.y-lift+(to.y-from.y+lift)*ease-Math.sin(Math.PI*u)*arc,
    scale:1.1-.60*ease,opacity:1-.8*smooth(clamp((u-.86)/.14)),rotation:-12*(1-u)+Math.sin(Math.PI*u)*18,
    progress:u,stage:"fly" as const,done:u>=1};
}
