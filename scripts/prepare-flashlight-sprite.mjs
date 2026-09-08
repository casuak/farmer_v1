// The generated standalone flashlight already has true alpha.
// Usage: node scripts/prepare-flashlight-sprite.mjs [generated.png]
import sharp from 'sharp';
import {resolve} from 'node:path';
const source=process.argv[2]??'docs/art/flashlight-source.png';
if(resolve(source)!==resolve('docs/art/flashlight-source.png'))await sharp(source).png().toFile('docs/art/flashlight-source.png');
const art=await sharp(source).trim().resize(112,112,{fit:'inside',kernel:'nearest'}).png().toBuffer();
const {width,height}=await sharp(art).metadata();
await sharp({create:{width:128,height:128,channels:4,background:{r:0,g:0,b:0,alpha:0}}}).composite([{input:art,left:Math.floor((128-width)/2),top:Math.floor((128-height)/2)}]).png().toFile('public/items/generated/flashlight.png');
console.log('Exported transparent 128px flashlight sprite');
