import { Color3,Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { SolidParticleSystem } from "@babylonjs/core/Particles/solidParticleSystem";
import type { Scene } from "@babylonjs/core/scene";
import { seededRandom,voxelMaterial } from "./voxel";

/** A camera-sized volume of airborne petals, independent of individual trees. */
export function createCherryBlossoms(scene:Scene) {
  const random=seededRandom(53127);
  const shape=MeshBuilder.CreateBox("petal-template",{width:.13,height:.025,depth:.20},scene);
  const petals=new SolidParticleSystem("falling-cherry-blossoms",scene,{updatable:true,isPickable:false,computeBoundingBox:true});
  petals.addShape(shape,224);const mesh=petals.buildMesh();shape.dispose();
  const material=voxelMaterial(scene,"cherry-petal");
  material.emissiveColor=Color3.FromHexString("#e9b7b6").scale(.25);material.alpha=.92;
  mesh.material=material;mesh.hasVertexAlpha=true;mesh.isPickable=false;
  petals.computeParticleTexture=false;
  const drifting=petals.particles.map((p,i)=>{
    const depth=18+random()*18;
    p.scaling.setAll((.65+random()*.65)*(1.12-(depth-18)*.009));
    p.color=new Color4(1,.76+random()*.15,.79+random()*.13,1);
    return {
      // Jittered coverage prevents empty quadrants or dense emitter-shaped trails.
      u:(i%16+.12+random()*.76)/16,v:(Math.floor(i/16)+.12+random()*.76)/14,
      x:0,y:0,depth,phase:random()*Math.PI*2,
      fall:.35+random()*.40,wind:.24+random()*.24,spin:.65+random()*1.1,
    };
  });
  const right=Vector3.Zero(),up=Vector3.Zero(),forward=Vector3.Zero();
  const previousCamera=Vector3.Zero(),cameraDelta=Vector3.Zero();
  const rightAxis=Vector3.Right(),upAxis=Vector3.Up(),forwardAxis=Vector3.Forward();
  let initialized=false,lastTime=0,elapsed=0,lastWidth=1,lastHeight=1;
  const wrap=(value:number,half:number)=>((value+half)%(half*2)+half*2)%(half*2)-half;

  function update(time:number,motion:boolean) {
    const camera=scene.activeCamera;if(!camera)return;
    camera.getViewMatrix();
    camera.getDirectionToRef(rightAxis,right);camera.getDirectionToRef(upAxis,up);camera.getDirectionToRef(forwardAxis,forward);
    const halfHeight=Math.abs((camera.orthoTop??15.8)-(camera.orthoBottom??-15.8))/2;
    const aspect=scene.getEngine().getRenderWidth()/scene.getEngine().getRenderHeight();
    const halfWidth=Math.abs((camera.orthoRight??halfHeight*aspect)-(camera.orthoLeft??-halfHeight*aspect))/2;
    // Recycle beyond the visible border, where alpha is already zero.
    const width=halfWidth*1.18,height=halfHeight*1.18;
    const dt=initialized&&motion?Math.max(0,Math.min(time-lastTime,.25)):0;
    elapsed+=dt;lastTime=time;
    camera.globalPosition.subtractToRef(previousCamera,cameraDelta);
    const panX=initialized?Vector3.Dot(cameraDelta,right):0,panY=initialized?Vector3.Dot(cameraDelta,up):0;
    const gust=Math.sin(elapsed*.29)*.14+Math.sin(elapsed*.61)*.07;
    for(let i=0;i<petals.particles.length;i++) {
      const p=petals.particles[i],f=drifting[i];
      if(!initialized){f.x=(f.u*2-1)*width;f.y=(f.v*2-1)*height;}
      else {
        // Compensating for camera pan leaves the petals floating in the world.
        // Scaling the field on zoom/resize keeps every part of the new view covered.
        f.x=f.x*width/lastWidth-panX+(f.wind+gust)*dt;
        f.y=f.y*height/lastHeight-panY-f.fall*dt;
      }
      f.x=wrap(f.x,width);f.y=wrap(f.y,height);
      const x=f.x+Math.sin(elapsed*.9+f.phase)*.24,y=f.y+Math.sin(elapsed*1.3+f.phase)*.07;
      p.position.copyFrom(camera.globalPosition);
      p.position.addInPlaceFromFloats(right.x*x+up.x*y+forward.x*f.depth,right.y*x+up.y*y+forward.y*f.depth,right.z*x+up.z*y+forward.z*f.depth);
      p.rotation.set(elapsed*f.spin+f.phase,elapsed*f.spin*.47+f.phase,Math.sin(elapsed*.8+f.phase)*1.15);
      const fade=Math.max(0,Math.min(1,(width-Math.abs(x))/(width-halfWidth),(height-Math.abs(y))/(height-halfHeight)));
      p.color!.a=fade*fade*(3-2*fade);
    }
    petals.setParticles();previousCamera.copyFrom(camera.globalPosition);
    initialized=true;lastWidth=width;lastHeight=height;
  }
  return {update};
}
