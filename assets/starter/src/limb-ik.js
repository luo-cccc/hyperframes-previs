// Absolute-time, fixed-length two-bone solving. Targets are observations, not reach guarantees.
const finite=v=>typeof v==='number'&&Number.isFinite(v);
const vector=v=>Array.isArray(v)&&v.length===3&&v.every(finite);
const add=(a,b)=>a.map((v,i)=>v+b[i]);
const sub=(a,b)=>a.map((v,i)=>v-b[i]);
const mul=(a,n)=>a.map(v=>v*n);
const dot=(a,b)=>a.reduce((n,v,i)=>n+v*b[i],0);
const norm=a=>Math.hypot(...a);
const rotate=(p,y)=>[p[0]*Math.cos(y)+p[2]*Math.sin(y),p[1],-p[0]*Math.sin(y)+p[2]*Math.cos(y)];
export const ARM_LENGTHS=Object.freeze({upper:.32,lower:.28});
export function solveTwoBone({root,target,upperLength,lowerLength,pole=[1,0,0]}={}){
 if(!vector(root)||!vector(target)||!vector(pole)||!finite(upperLength)||upperLength<=0||!finite(lowerLength)||lowerLength<=0)throw new Error('IK requires finite XYZ vectors and positive finite bone lengths.');
 const delta=sub(target,root),distance=norm(delta),max=upperLength+lowerLength,min=Math.abs(upperLength-lowerLength);
 if(!finite(distance)||!finite(max))throw new Error('IK distances exceed the finite numeric range.');
 const tolerance=Math.max(max,1)*1e-10,axis=distance>1e-12?mul(delta,1/distance):[0,-1,0],d=Math.max(min,Math.min(max,distance));
 let bend=sub(pole,mul(axis,dot(pole,axis)));
 if(norm(bend)<1e-10){const fallback=[[1,0,0],[0,1,0],[0,0,1]].sort((a,b)=>Math.abs(dot(a,axis))-Math.abs(dot(b,axis)))[0];bend=sub(fallback,mul(axis,dot(fallback,axis)));}
 bend=mul(bend,1/norm(bend));
 let joint,end;
 if(d<=1e-12){joint=add(root,mul(bend,upperLength));end=[...root];}
 else {const along=(upperLength*upperLength-lowerLength*lowerLength+d*d)/(2*d),height=Math.sqrt(Math.max(0,upperLength*upperLength-along*along));joint=add(add(root,mul(axis,along)),mul(bend,height));end=add(root,mul(axis,d));}
 if(distance>=min&&distance<=max)end=[...target];
 const error=norm(sub(end,target)),reachable=distance<=max+tolerance&&distance>=min-tolerance;
 return {root:[...root],joint,end,target:[...target],reachable,reason:reachable?'REACHABLE':distance>max?'TARGET_TOO_FAR':'TARGET_TOO_CLOSE',reach_error_m:error,upper_length:upperLength,lower_length:lowerLength,min_reach:min,max_reach:max};
}
export function solveArmTarget(actor,state,side,handTarget){
 if(!['left','right'].includes(side)||!finite(actor?.height)||actor.height<=0||!vector(state?.modelPosition)||!finite(state?.yaw))throw new Error('Arm IK requires a valid actor transform and hand side.');
 const supplied=actor.scale??1,scale=(Array.isArray(supplied)?supplied:[supplied,supplied,supplied]).map(v=>v*actor.height/1.8);
 if(!vector(scale)||scale.some(v=>v<=0))throw new Error('Arm IK requires positive finite actor scale.');
 const sign=side==='left'?-1:1,shoulder=add(state.modelPosition,rotate([sign*.285*scale[0],1.41*scale[1],0],state.yaw));
 const target=handTarget.target_position??handTarget.position;
 const solved=solveTwoBone({root:shoulder,target,upperLength:ARM_LENGTHS.upper*scale[1],lowerLength:ARM_LENGTHS.lower*scale[1],pole:rotate([sign,-.25,.35],state.yaw)});
 return {...structuredClone(handTarget),position:[...solved.end],target_position:[...target],ik:{space:'WORLD',shoulder:solved.root,elbow:solved.joint,wrist:solved.end,target_position:solved.target,upper_length_m:solved.upper_length,lower_length_m:solved.lower_length,min_reach_m:solved.min_reach,max_reach_m:solved.max_reach,reachable:solved.reachable,reason:solved.reason,reach_error_m:solved.reach_error_m}};
}
