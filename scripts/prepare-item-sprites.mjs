// Export the AI-generated 6 x 4 atlas as keyed, normalized transparent game sprites.
// Usage: node scripts/prepare-item-sprites.mjs <generated-atlas.png>
import sharp from 'sharp';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const source=process.argv[2];
if(!source)throw new Error('Pass the generated atlas PNG path');
const ids=['hoe','seeds','water','scythe','turnip','wood','shell','hat','shirt','backpack','pistol','sword','fishingRod','pickaxe','stone','copperOre','ironOre','crystal','carp','perch','sardine','redSnapper'];
const {data,info}=await sharp(source).ensureAlpha().raw().toBuffer({resolveWithObject:true});
await mkdir('public/items/generated',{recursive:true});
await mkdir('docs/art',{recursive:true});
if(resolve(source)!==resolve('docs/art/item-atlas-source.png'))await sharp(source).png().toFile('docs/art/item-atlas-source.png');
const manifest={source:'docs/art/item-atlas-source.png',generator:'openai/gpt-image-2',grid:[6,4],size:128,additionalSources:{flashlight:'docs/art/flashlight-source.png'},items:{flashlight:'/items/generated/flashlight.png'}};
for(const [index,id] of ids.entries()){
  const x0=Math.round(index%6*info.width/6),x1=Math.round((index%6+1)*info.width/6),y0=Math.round(Math.floor(index/6)*info.height/4),y1=Math.round((Math.floor(index/6)+1)*info.height/4);
  const width=x1-x0,height=y1-y0,rgba=Buffer.alloc(width*height*4);let left=width,top=height,right=-1,bottom=-1;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const src=((y+y0)*info.width+x+x0)*4,dst=(y*width+x)*4,r=data[src],g=data[src+1],b=data[src+2];
    // The generated key is near (238,0,240), not necessarily exactly FF00FF.
    const key=r>155&&b>145&&g<115&&Math.min(r,b)-g>85;
    if(key)continue;
    rgba[dst]=r;rgba[dst+1]=g;rgba[dst+2]=b;rgba[dst+3]=255;
    left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);
  }
  if(right<left)throw new Error('Empty sprite '+id);
  const art=await sharp(rgba,{raw:{width,height,channels:4}}).extract({left,top,width:right-left+1,height:bottom-top+1}).resize(112,112,{fit:'inside',kernel:'nearest'}).png().toBuffer();
  const meta=await sharp(art).metadata();
  await sharp({create:{width:128,height:128,channels:4,background:{r:0,g:0,b:0,alpha:0}}}).composite([{input:art,left:Math.floor((128-meta.width)/2),top:Math.floor((128-meta.height)/2)}]).png().toFile(`public/items/generated/${id}.png`);
  manifest.items[id]=`/items/generated/${id}.png`;
}
await writeFile('public/items/generated/manifest.json',JSON.stringify(manifest,null,2)+'\n');
console.log(`Exported ${ids.length} transparent 128px sprites.`);
