import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { Scene } from "@babylonjs/core/scene";

// Bake vertex-colored, flat-faced boxes into a few meshes per object.
export class Voxels {
  private positions:number[]=[]; private indices:number[]=[];
  private normals:number[]=[]; private colors:number[]=[];
  get vertexCount(){return this.positions.length/3;}
  box(x:number,y:number,z:number,w:number,h:number,d:number,hex:string) {
    const c=Color3.FromHexString(hex);
    const faces=[
      {n:[0,1,0],p:[[-1,1,-1],[-1,1,1],[1,1,1],[1,1,-1]],s:1},
      {n:[0,-1,0],p:[[-1,-1,1],[-1,-1,-1],[1,-1,-1],[1,-1,1]],s:.64},
      {n:[0,0,-1],p:[[-1,-1,-1],[-1,1,-1],[1,1,-1],[1,-1,-1]],s:.88},
      {n:[0,0,1],p:[[1,-1,1],[1,1,1],[-1,1,1],[-1,-1,1]],s:.86},
      {n:[1,0,0],p:[[1,-1,-1],[1,1,-1],[1,1,1],[1,-1,1]],s:.84},
      {n:[-1,0,0],p:[[-1,-1,1],[-1,1,1],[-1,1,-1],[-1,-1,-1]],s:.9},
    ];
    for(const f of faces) {
      const i=this.positions.length/3;
      for(const p of f.p) {
        this.positions.push(x+p[0]*w/2,y+p[1]*h/2,z+p[2]*d/2);
        this.normals.push(...f.n);
        const shade=f.s*(f.n[1]===0&&p[1]<0?.91:1);
        this.colors.push(c.r*shade,c.g*shade,c.b*shade,1);
      }
      // Babylon's default left-handed mesh winding is clockwise from outside.
      this.indices.push(i,i+2,i+1,i,i+3,i+2);
    }
    return this;
  }
  build(name:string,scene:Scene,material:StandardMaterial,updatable=false):Mesh {
    const mesh=new Mesh(name,scene),v=new VertexData();
    v.positions=this.positions;v.indices=this.indices;v.normals=this.normals;v.colors=this.colors;
    v.applyToMesh(mesh,updatable);mesh.material=material;mesh.receiveShadows=true;mesh.isPickable=false;return mesh;
  }
}
export function voxelMaterial(scene:Scene,name="voxel"){
  const mat=new StandardMaterial(name,scene);
  // Sun, sky, fill, four nearby street lights, and one room light.
  mat.maxSimultaneousLights=8;
  mat.diffuseColor=Color3.White();mat.specularColor=Color3.Black();
  mat.ambientColor=Color3.FromHexString("#b8c6a0").scale(.10);mat.backFaceCulling=true;return mat;
}
export function seededRandom(seed:number){
  return ()=>{seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return ((t^t>>>14)>>>0)/4294967296;};
}
