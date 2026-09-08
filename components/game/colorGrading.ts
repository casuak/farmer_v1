import { solarAt } from "./dayNight";

/**
 * A display-space spring grade, applied only to the scene canvas after rendering.
 * This treats voxel materials, custom water shaders and bloom alike, and survives
 * direct-render recovery without adding another tone-map pass or tinting the HUD.
 */
export function springSceneFilter(hour:number,enabled=true):string {
  if(!enabled)return "none";
  const {daylight}=solarAt(Number.isFinite(hour)?hour:8);
  // Richer foliage/water and firmer midtones, without a yellow cast or blur.
  // Ease contrast and brightness back at dusk so moonlit paths stay readable.
  const saturation=1.08+.14*daylight;
  const contrast=1.02+.08*daylight;
  const brightness=1-.02*daylight;
  return `saturate(${saturation.toFixed(3)}) contrast(${contrast.toFixed(3)}) brightness(${brightness.toFixed(3)})`;
}
