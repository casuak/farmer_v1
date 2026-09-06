import { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Color3,Color4 } from "@babylonjs/core/Maths/math.color";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import { DefaultRenderingPipeline } from "@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline";
import { ExtractHighlightsPostProcess } from "@babylonjs/core/PostProcesses/extractHighlightsPostProcess";
import { ImageProcessingConfiguration } from "@babylonjs/core/Materials/imageProcessingConfiguration";
import type { Camera } from "@babylonjs/core/Cameras/camera";
import { solarAt } from "./dayNight";
import { createShadowAnchor,SHADOW_MAP_SIZE,SHADOW_HALF_EXTENT } from "./stableShadows";

export const BLOOM_LUMA_THRESHOLD=.82;

const palette={
  nightSky:Color3.FromHexString("#829dce"),daySky:Color3.FromHexString("#daeaf6"),
  nightGround:Color3.FromHexString("#435b80"),dayGround:Color3.FromHexString("#789265"),
  nightFog:Color3.FromHexString("#283b5b"),dayFog:Color3.FromHexString("#bfd1bc"),duskFog:Color3.FromHexString("#b89791"),
  sun:Color3.FromHexString("#fff0cf"),sunset:Color3.FromHexString("#ffb472"),
};

export function createSpringLighting(scene:Scene,camera:Camera) {
  scene.clearColor=Color4.FromHexString("#bfd1bcff");
  scene.ambientColor=Color3.FromHexString("#d3dfcf").scale(.13);
  scene.fogMode=Scene.FOGMODE_LINEAR;scene.fogStart=85;scene.fogEnd=145;
  scene.fogColor=Color3.FromHexString("#bfd1bc");
  const image=scene.imageProcessingConfiguration;
  image.toneMappingEnabled=true;image.toneMappingType=ImageProcessingConfiguration.TONEMAPPING_ACES;
  image.exposure=1.18;image.contrast=1.06;

  // The spring sun follows the day while a cool fill preserves voxel faces.
  const sky=new HemisphericLight("cool-spring-sky",Vector3.Up(),scene);
  sky.intensity=.62;sky.diffuse=Color3.FromHexString("#daeaf6");sky.groundColor=Color3.FromHexString("#789265");
  const sun=new DirectionalLight("morning-sun",new Vector3(-1,-1,.3),scene);
  sun.intensity=1.20;sun.diffuse=Color3.FromHexString("#fff0cf");
  sun.specular=Color3.FromHexString("#fff4db");
  sun.shadowMinZ=1;sun.shadowMaxZ=160;sun.autoUpdateExtends=false;
  // Fixed frustum avoids Babylon's auto-extent padding changing the actual
  // texel size underneath the light-space snapping calculation.
  sun.shadowFrustumSize=SHADOW_HALF_EXTENT*2;
  sun.orthoLeft=-SHADOW_HALF_EXTENT;sun.orthoRight=SHADOW_HALF_EXTENT;sun.orthoTop=SHADOW_HALF_EXTENT;sun.orthoBottom=-SHADOW_HALF_EXTENT;
  const fill=new DirectionalLight("blue-sky-bounce",new Vector3(-.7,-.35,-.55),scene);
  fill.intensity=.17;fill.diffuse=Color3.FromHexString("#bfdbe8");fill.specular=Color3.Black();
  const caps=scene.getEngine().getCaps();
  const shadowSize=Math.min(SHADOW_MAP_SIZE,caps.maxTextureSize,caps.maxRenderTextureSize);
  const shadow=new ShadowGenerator(shadowSize,sun);
  // PCSS rotates a random kernel using moving light-space coordinates. Fixed
  // 5x5 PCF weights avoid that noisy shimmer as the sun or follow camera moves.
  shadow.usePercentageCloserFiltering=true;
  shadow.filteringQuality=ShadowGenerator.QUALITY_HIGH;
  shadow.bias=.00035;shadow.normalBias=.018;shadow.setDarkness(.14);shadow.transparencyShadow=true;
  shadow.enableSoftTransparentShadow=false;

  // Float render-target support does not guarantee a working HDR post-process
  // chain on every GPU. RGBA8 keeps bloom/FXAA and applies ACES in the materials.
  const pipeline=new DefaultRenderingPipeline("spring-light-and-color",false,scene,[camera],false);
  pipeline.samples=1;pipeline.fxaaEnabled=true;
  pipeline.bloomScale=.5;pipeline.bloomKernel=72;pipeline.bloomWeight=.42;
  // LDR input is already tone-mapped and gamma-encoded. Babylon gamma-converts
  // its threshold, so encode the desired display-luma cutoff in its input space.
  pipeline.bloomThreshold=Math.pow(BLOOM_LUMA_THRESHOLD,2.2);pipeline.bloomEnabled=true;
  // The built-in observer copies exposure from image processing, but LDR pixels
  // have already received that exposure. Reset it just before the effect binds.
  const correctedHighlights=new WeakSet<ExtractHighlightsPostProcess>();
  pipeline.onBuildObservable.add(()=>{
    for(const pass of camera._postProcesses){
      if(pass instanceof ExtractHighlightsPostProcess&&!correctedHighlights.has(pass)){
        pass.onApplyObservable.add(()=>{pass._exposure=1;});
        correctedHighlights.add(pass);
      }
    }
  });
  pipeline.prepare();pipeline.automaticBuild=true;
  let compatible=false;
  const anchorShadow=createShadowAnchor(shadowSize);
  function follow(target:{x:number;z:number}){
    anchorShadow(target,sun.direction,sun.position);
  }
  function update(hour:number,target:{x:number;z:number}){
    const solar=solarAt(hour),{daylight,twilight,toSun}=solar;
    sun.direction.set(-toSun.x,-toSun.y,-toSun.z);sun.intensity=solar.sunlight;
    Color3.LerpToRef(palette.sun,palette.sunset,twilight,sun.diffuse);
    sky.intensity=.38+daylight*.24;
    Color3.LerpToRef(palette.nightSky,palette.daySky,daylight,sky.diffuse);
    Color3.LerpToRef(palette.nightGround,palette.dayGround,daylight,sky.groundColor);
    fill.intensity=.14+daylight*.03;
    Color3.LerpToRef(palette.nightFog,palette.dayFog,daylight,scene.fogColor);
    Color3.LerpToRef(scene.fogColor,palette.duskFog,twilight*.4,scene.fogColor);
    scene.clearColor.set(scene.fogColor.r,scene.fogColor.g,scene.fogColor.b,1);
    for(const light of scene.lights)if(light.name.endsWith("-warm-interior"))light.intensity=.38+(1-daylight)*.42;
    follow(target);return solar;
  }
  update(8,{x:0,z:0});
  return {
    shadow,pipeline,sun,update,follow,
    get compatible(){return compatible;},
    setBloom(enabled:boolean){if(!compatible&&pipeline.bloomEnabled!==enabled)pipeline.bloomEnabled=enabled;},
    recover(){
      if(compatible)return false;
      compatible=true;
      // Dispose also detaches the chain from the camera. Restore both clearing
      // and material-side color conversion, otherwise direct output stays dark.
      pipeline.dispose();scene.postProcessesEnabled=false;scene.autoClear=true;
      image.applyByPostProcess=false;
      shadow.usePoissonSampling=true;
      return true;
    },
  };
}
