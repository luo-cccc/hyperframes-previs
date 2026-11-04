import {sampleCamera} from './scene-data.js';

export const rigRecipes=[
  {id:'hold',label:'固定观察'},
  {id:'push',label:'缓慢推进'},
  {id:'truck',label:'横向平移'},
  {id:'arc',label:'小幅环绕'}
];
const add=(a,b)=>a.map((value,i)=>value+b[i]);
const subtract=(a,b)=>a.map((value,i)=>value-b[i]);
const scale=(a,b)=>a.map(value=>value*b);
const length=a=>Math.hypot(...a);

export function planCameraRig(shot,kind,amount=.8){
  if(!rigRecipes.some(recipe=>recipe.id===kind))throw new Error('Unknown camera rig recipe.');
  if(!Number.isFinite(amount)||Math.abs(amount)>5)throw new Error('Rig amount must be finite and between -5 and 5 metres (arc uses amount × 10 degrees).');
  const start=sampleCamera(shot,shot.start),end=structuredClone(start);
  const direction=subtract(start.target,start.position),distance=length(direction);
  if(distance<.05)throw new Error('Camera needs a distinct target before creating a rig.');
  if(kind==='push'){
    if(amount>distance-.3)throw new Error('Push would pass too close to the camera target.');
    end.position=add(start.position,scale(direction,amount/distance));
  }
  if(kind==='truck'){
    const horizontal=Math.hypot(direction[0],direction[2]);
    if(horizontal<.001)throw new Error('Choose a camera with a horizontal view direction for a truck move.');
    const delta=[-direction[2]/horizontal*amount,0,direction[0]/horizontal*amount];
    end.position=add(start.position,delta);end.target=add(start.target,delta);
  }
  if(kind==='arc'){
    const angle=amount*Math.PI/18,relative=subtract(start.position,start.target),c=Math.cos(angle),s=Math.sin(angle);
    end.position=add(start.target,[relative[0]*c+relative[2]*s,relative[1],-relative[0]*s+relative[2]*c]);
  }
  return {from:start,to:end,offset:{position:[0,0,0],target:[0,0,0],fov:0}};
}
