import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Scene } from "@babylonjs/core/scene";
import { riverCenter } from "./geography";
import { Voxels,seededRandom } from "./voxel";

export const RIVER_FISH_COUNT=12;
const stretches=[[-38,-22.2],[-17.8,-2.2],[2.2,15.8],[20.2,38]] as const;
const smooth=(v:number)=>{const x=Math.max(0,Math.min(1,v));return x*x*(3-2*x);};
export type RiverFish={x:number;z:number;yaw:number;scale:number;opacity:number;active:boolean;age:number;life:number;wait:number;origin:number;speed:number;lane:number;phase:number;generation:number};

/** A fixed pool with independently randomized swims and quiet intervals. */
export class RiverFishSchool {
  readonly fish:RiverFish[];
  private readonly random:()=>number;
  constructor(seed=Math.floor(Math.random()*0x7fffffff)){
    this.random=seededRandom(seed);
    this.fish=Array.from({length:RIVER_FISH_COUNT},(_,i)=>({x:0,z:0,yaw:0,scale:1,opacity:0,active:false,age:0,life:0,wait:i*.12+this.random()*2.5,origin:0,speed:0,lane:0,phase:0,generation:0}));
  }
  private spawn(fish:RiverFish,index:number){
    const random=this.random,[low,high]=stretches[index%stretches.length];
    fish.life=5+random()*5;fish.speed=(.32+random()*.30)*(random()<.5?-1:1);
    const distance=Math.abs(fish.speed)*fish.life;
    fish.origin=low+random()*(high-low-distance)+(fish.speed<0?distance:0);
    fish.scale=.75+random()*.35;fish.lane=(random()-.5)*.45;fish.phase=random()*Math.PI*2;
    fish.age=0;fish.opacity=0;fish.active=true;fish.generation++;
  }
  update(dt:number){
    if(!Number.isFinite(dt)||dt<=0)return;
    dt=Math.min(dt,.25);
    this.fish.forEach((fish,index)=>{
      if(!fish.active){fish.wait-=dt;if(fish.wait>0)return;this.spawn(fish,index);}
      fish.age+=dt;
      if(fish.age>=fish.life){fish.active=false;fish.opacity=0;fish.wait=2+this.random()*6;return;}
      const phase=fish.phase+fish.age*1.7;
      fish.z=fish.origin+fish.age*fish.speed;
      fish.x=riverCenter(fish.z)+fish.lane+Math.sin(phase)*.10;
      const vx=Math.cos(fish.z*.29)*1.55*.29*fish.speed+Math.cos(phase)*.17;
      fish.yaw=Math.atan2(-vx,-fish.speed);
      fish.opacity=smooth(fish.age/1.2)*smooth((fish.life-fish.age)/1.4)*.82;
    });
  }
}

export function createRiverFish(scene:Scene,seed?:number){
  const school=new RiverFishSchool(seed),material=new StandardMaterial("river-fish-ink",scene);
  material.disableLighting=true;material.emissiveColor=Color3.FromHexString("#235a58");material.alpha=.40;
  material.disableDepthWrite=true;material.specularColor=Color3.Black();
  const views=school.fish.map((fish,i)=>{
    const root=new TransformNode("river-fish-"+i,scene);
    const body=new Voxels().box(0,0,0,.15,.006,.43,"#ffffff").box(0,0,-.15,.20,.006,.20,"#ffffff").box(0,0,.20,.09,.006,.12,"#ffffff").build("river-fish-shadow",scene,material);
    body.parent=root;body.receiveShadows=false;
    const tail=new Voxels().box(0,0,.075,.25,.006,.13,"#ffffff").build("river-fish-tail",scene,material);
    tail.parent=root;tail.position.z=.25;tail.receiveShadows=false;root.setEnabled(false);
    return {root,body,tail,fish};
  });
  let previousTime:number|null=null;
  function update(time:number,motion:boolean,daylight:number){
    const dt=previousTime===null?0:Math.max(0,time-previousTime);previousTime=time;
    if(motion)school.update(dt);
    for(const {root,body,tail,fish} of views){
      root.setEnabled(fish.active&&fish.opacity>.001);if(!fish.active)continue;
      root.position.set(fish.x,-.198,fish.z);root.rotation.y=fish.yaw;root.scaling.setAll(fish.scale);
      tail.rotation.y=Math.sin(fish.age*9+fish.phase)*.24;
      body.visibility=tail.visibility=fish.opacity*(.5+daylight*.5);
    }
  }
  return {school,views,update};
}
