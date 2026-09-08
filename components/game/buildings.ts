import { PointLight } from "@babylonjs/core/Lights/pointLight";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import type { Scene } from "@babylonjs/core/scene";
import type { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import type { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { Obstacle,Occluder } from "./world";
import type { Point } from "./farming";
import { Voxels } from "./voxel";

export type Room={id:string;name:string;x:number;z:number;w:number;d:number;shop:boolean;inside:(p:Point)=>boolean};
import { BUILDINGS } from "./geography";


export function buildRooms(scene:Scene,shadow:ShadowGenerator,mat:StandardMaterial,roofMat:StandardMaterial,obstacles:Obstacle[],occluders:Occluder[]):Room[] {
  return BUILDINGS.map(b=>{
    const {x,z,w,d}=b,front=z-d/2,back=z+d/2,left=x-w/2,right=x+w/2;
    const floor=new Voxels(),solid=new Voxels(),facade=new Voxels(),roof=new Voxels(),inside=new Voxels();
    const collision=(cx:number,cz:number,cw:number,cd:number)=>obstacles.push({x:cx,z:cz,w:cw,d:cd,kind:"building"});
    floor.box(x,-.015,z,w+.2,.14,d+.2,"#a99470");
    for(let i=0;i<Math.ceil(d/.28);i++)floor.box(x,.064,front+.13+i*.28,w-.22,.038,.26,i%3?"#c49b69":"#d3b181");
    solid.box(x,1.42,back,w,2.72,.20,b.wall);solid.box(left,1.42,z,.20,2.72,d,b.wall);
    facade.box(right,1.42,z,.20,2.72,d,b.wall);
    // A real 1.5 m doorway, with a lintel above head height. No hidden full-house collider.
    const wing=(w-1.5)/2;
    for(const s of [-1,1]){facade.box(x+s*(.75+wing/2),1.42,front,wing,2.72,.20,b.wall);collision(x+s*(.75+wing/2),front,wing,.20);}
    facade.box(x,2.55,front,1.5,.44,.22,"#94724c");
    // Door is visibly open against the left interior wall of the opening.
    facade.box(x-.73,1.08,front+.48,.07,1.94,.90,"#6d8974");
    for(const cx of [left,right])for(const cz of [front,back])facade.box(cx,1.44,cz,.22,2.85,.22,"#a5875d");
    facade.box(x,2.85,front,w+.18,.16,.26,"#b99b67");
    for(const cx of [x-w*.31,x+w*.31]){
      facade.box(cx,1.73,front-.14,.99,1.15,.15,"#a28659");
      facade.box(cx,1.76,front-.23,.78,.91,.04,"#a3c4b0");
      facade.box(cx,1.76,front-.26,.065,.96,.045,"#fff0ca");facade.box(cx,1.76,front-.26,.84,.065,.045,"#fff0ca");
      facade.box(cx,1.08,front-.27,1.16,.24,.40,"#af7f54");
      for(let i=0;i<5;i++){facade.box(cx-.43+i*.21,1.25,front-.30,.20,.23,.27,"#7b9c56");facade.box(cx-.43+i*.21,1.41,front-.30,.13,.13,.15,i%2?"#edc780":"#edb6b2");}
    }
    collision(x,back,w,.20);collision(left,z,.20,d);collision(right,z,.20,d);
    const layers=8;
    for(let j=0;j<layers;j++){
      const offset=(d/2+.42)*(1-j/layers),y=2.98+j*.22;
      for(const s of [-1,1])for(let k=0;k<Math.ceil((w+.9)/.43);k++)roof.box(left-.34+k*.43,y,z+s*offset,.45,.25,d/layers+.20,j%3===0?b.roof:b.id==="home"?"#d38d61":b.id==="shop"?"#7da497":b.id==="cafe"?"#c89585":"#8bb2bc");
      roof.box(x,y,z,w,.23,Math.max(.1,offset*2-.2),b.wall);
    }
    roof.box(x,4.70,z,w+1.0,.22,.37,b.id==="home"?"#e2a06e":"#b4c2a0");
    if(b.id==="home"){roof.box(x+1.83,4.52,z+.55,.7,1.45,.7,"#a7907b");roof.box(x+1.83,5.24,z+.55,.9,.2,.9,"#c9b69b");}
    if(b.shop){
      // Striped canvas awning and a pine-cone emblem above the open door.
      for(let i=0;i<10;i++)facade.box(left+.37+i*w/10,2.48,front-.60,w/10+.01,.13,1.08,i%2?"#f6e8bd":"#799c80");
      facade.box(x,2.10,front-.45,1.18,.43,.12,"#8b6948");facade.box(x,2.11,front-.53,.23,.29,.04,"#efd393");
      inside.box(x,.77,back-1.20,w-1.3,1.34,.70,"#aa8053");inside.box(x,1.46,back-1.20,w-1.1,.13,.86,"#d9b984");collision(x,back-1.20,w-1.3,.75);
      for(let row=0;row<3;row++){
        inside.box(x,.60+row*.63,back-.35,w-.55,.10,.47,"#9b7853");
        for(let i=0;i<9;i++)inside.box(left+.58+i*.70,.81+row*.63,back-.34,.36,.34,.30,["#cfb478","#8baf83","#cb9177","#d8c9a0"][(i+row)%4]);
      }
      inside.box(x+2.2,1.65,back-1.16,.54,.30,.40,"#668d7f");inside.box(x+2.2,1.87,back-1.16,.37,.15,.25,"#d6c08c");
      // Shopkeeper stands behind the counter.
      inside.box(x,1.25,back-.55,.48,.64,.3,"#6b8771");inside.box(x,1.87,back-.55,.43,.47,.36,"#e0b183");inside.box(x,2.13,back-.53,.46,.17,.37,"#79604c");
      for(const cx of [x-.1,x+.1])inside.box(cx,1.88,back-.744,.048,.058,.02,"#46493c");
      inside.box(x,.097,front+1.1,2.2,.015,1.3,"#81998a");
    }else{
      // Bed, quilt and pillow; kitchen, books and a small dining corner.
      const bedX=left+1.03,bedZ=back-1.35;
      inside.box(bedX,.38,bedZ,1.36,.60,2.10,"#93704c");inside.box(bedX,.73,bedZ,1.31,.20,2.03,"#e8daba");inside.box(bedX,.86,bedZ-.35,1.30,.08,1.36,b.id==="cottage"?"#83a9ad":"#d39c8c");inside.box(bedX,.86,bedZ+.65,1.08,.17,.45,"#fff0d4");
      inside.box(bedX,.85,back-.28,1.47,.9,.12,"#ac865b");collision(bedX,bedZ,1.4,2.15);
      inside.box(right-.62,.57,back-1,.89,1.02,1.46,"#b89a6b");inside.box(right-.62,1.12,back-1,1.04,.10,1.57,"#e4d5b4");collision(right-.62,back-1,1.02,1.57);
      inside.box(right-.58,1.19,back-1.1,.52,.03,.65,"#8fa6a0");inside.box(right-.58,1.29,back-.94,.06,.26,.06,"#738e8e");
      inside.box(x+.26,.63,z+.24,1.17,.12,.84,"#cfa571");for(const s of [-1,1])inside.box(x+.26+s*.42,.34,z+.24,.10,.55,.56,"#94714b");collision(x+.26,z+.24,1.17,.84);
      inside.box(x+.27,.82,z+.22,.31,.26,.26,"#b68465");inside.box(x+.27,1.04,z+.22,.35,.30,.31,"#85a468");
      inside.box(x,.096,front+1.08,2.17,.018,1.23,b.id==="cafe"?"#c1a36e":"#88a495");
      for(let i=0;i<5;i++)inside.box(right-.21,1.55,back-2.1+i*.20,.20,.30,.16,["#c29475","#8da69a","#d3bc8c"][i%3]);
      inside.box(right-.24,1.34,back-1.68,.36,.09,1.23,"#a68154");
      solid.box(x+.3,1.95,back-.13,.95,.66,.07,"#a18356");solid.box(x+.3,1.95,back-.18,.76,.48,.045,"#91b3a0");
    }
    const room:Room={...b,inside:p=>p.x>left+.08&&p.x<right-.08&&p.z>front-.12&&p.z<back-.08};
    const floorMesh=floor.build(b.id+"-floor",scene,mat);floorMesh.isPickable=true;floorMesh.metadata={tileKind:"floor"};
    const backMesh=solid.build(b.id+"-back-walls",scene,mat);const facadeMesh=facade.build(b.id+"-front-walls",scene,mat);
    const interior=inside.build(b.id+"-interior",scene,mat),roofMesh=roof.build(b.id+"-roof",scene,roofMat);
    for(const m of [backMesh,facadeMesh,interior,roofMesh]){shadow.addShadowCaster(m);m.isPickable=true;m.metadata={tileKind:"building"};}
    // Keep the far L-shaped wall solid indoors: its combined AABB includes empty
    // room space and would otherwise falsely trigger camera occlusion fading.
    occluders.push({mesh:backMesh,x,z,radius:w/2+.2,bottom:.15,top:2.85,phase:0,room:room.id,insideOpacity:1});
    // Thick, overlapping voxel boxes cannot form a clean translucent cutaway.
    // Hide the near wall/roof exactly, retaining geometry for physical light blocking.
    occluders.push({mesh:roofMesh,x,z,radius:w/2+.6,bottom:2.8,top:5.4,phase:0,room:room.id,insideOpacity:0});
    occluders.push({mesh:facadeMesh,x,z,radius:w/2+.2,bottom:.15,top:2.95,phase:0,room:room.id,insideOpacity:0});
    const lamp=new PointLight(b.id+"-warm-interior",new Vector3(x,2.3,z),scene);lamp.diffuse=Color3.FromHexString("#ffe2a8");lamp.intensity=.38;lamp.range=9;lamp.includedOnlyMeshes=[floorMesh,interior,backMesh,facadeMesh];
    return room;
  });
}
