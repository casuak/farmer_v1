import type { FishId } from "./inventory";
import { ITEM_SPRITES } from "./itemSprites";

/** Fishing overlays and world catches use the same generated inventory art.
 * The legacy grid helpers below remain for procedural ambient fish/tests only. */
export const FISH_SPRITES:Record<FishId,string>={
  carp:ITEM_SPRITES.carp,perch:ITEM_SPRITES.perch,
  sardine:ITEM_SPRITES.sardine,redSnapper:ITEM_SPRITES.redSnapper,
};

export function isFishId(id:string):id is FishId{
  return id==="carp"||id==="perch"||id==="sardine"||id==="redSnapper";
}

type Palette=Record<string,string>;
const FISH_WIDTH=24,FISH_HEIGHT=16;

// 24 x 16 pixel grid, fish facing left: the head tapers to a rounded snout at the
// front (eye on the head), the belly curves, and the tail forks into two clear
// triangles. Palette keys: O outline, B body, L belly/highlight, F fin, G gill,
// E eye-white, P pupil, `.` transparent.
const GRID:string[]=[
  "........................",
  "...........OO...........",
  "..........OFFO..........",
  ".........OFFFFO.........",
  "....OBBBBBBBBBBO...OFO..",
  "...OBBBBBBBBBBBBBOOFFO..",
  "..OEPBBBBBBBBBBBBBOFFFO.",
  "OOBBBGGBBBBBBBBBBBOO....",
  "OOBBBBBBBBBBBBBBBBOFFFO.",
  "..OLLLLLLLLBBBBBBOOFFO..",
  "...OLLLLLLLLBBBBBOOFO...",
  ".....OBBBBBBBBO...OFO...",
  "..........OFFO..........",
  "........................",
  "........................",
  "........................",
];

const PALETTES:Record<FishId,Palette>={
  carp:{O:"#5a3a1a",B:"#cf9346",L:"#f0d18a",F:"#b8743a",G:"#e0a24a",E:"#ffffff",P:"#2a1a12"},
  perch:{O:"#2f3d1f",B:"#8faa4f",L:"#d6e2b0",F:"#5f7d33",G:"#3f532a",E:"#ffffff",P:"#1f1f14"},
  sardine:{O:"#33424f",B:"#a8c8da",L:"#eef6fb",F:"#9cbecf",G:"#7ba3bd",E:"#ffffff",P:"#22303a"},
  redSnapper:{O:"#4f1710",B:"#e06a4a",L:"#f5c9ac",F:"#c24e36",G:"#e88553",E:"#ffffff",P:"#2a120c"},
};

function hexToRgb(hex:string):[number,number,number]{
  return [parseInt(hex.slice(1,3),16),parseInt(hex.slice(3,5),16),parseInt(hex.slice(5,7),16)];
}

/** Turns the shared fish grid into an RGBA byte array for a Babylon RawTexture. */
export function createFishPixels(id:FishId):{data:Uint8Array;width:number;height:number}{
  const palette=PALETTES[id];
  const data=new Uint8Array(FISH_WIDTH*FISH_HEIGHT*4);
  let o=0;
  for(let y=0;y<FISH_HEIGHT;y++){
    const row=GRID[y];
    for(let x=0;x<FISH_WIDTH;x++){
      const ch=row[x];
      if(ch!=="."){
        const [r,g,b]=hexToRgb(palette[ch]);
        data[o]=r;data[o+1]=g;data[o+2]=b;data[o+3]=255;
      }
      o+=4;
    }
  }
  return {data,width:FISH_WIDTH,height:FISH_HEIGHT};
}

/** Renders the same shared grid as crispRect SVG markup (matches /items/fish-*.svg). */
export function fishSpriteSVG(id:FishId):string{
  const palette=PALETTES[id];
  let rects="";
  for(let y=0;y<FISH_HEIGHT;y++){
    const row=GRID[y];
    for(let x=0;x<FISH_WIDTH;x++){
      const ch=row[x];
      if(ch!==".")rects+=`<rect x="${x}" y="${y}" width="1" height="1" fill="${palette[ch]}"/>`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${FISH_WIDTH} ${FISH_HEIGHT}" shape-rendering="crispEdges" width="${FISH_WIDTH}" height="${FISH_HEIGHT}">${rects}</svg>`;
}
