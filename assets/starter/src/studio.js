const $=id=>document.getElementById(id),frame=$('film'),status=$('status');
let api,scene,time=0,playing=false,stamp=0,lastShot='';
let annotationPacket=null,pendingCapture=null;
let initialRuntimeToken=null;
const fields=['px','py','pz','tx','ty','tz','fov'];
function message(text,error=false){status.textContent=text;status.style.color=error?'#ffab9d':'#8fe2c9'}
async function action(fn){try{await fn()}catch(error){if(api){scene=api.data;refreshCamera();refreshLocks()}message(error.message,true)}}
async function projectApi(url,body){
  const response=await fetch(url,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),text=await response.text();
  let result;try{result=JSON.parse(text)}catch{throw new Error(text||'项目服务不可用。')}
  if(!response.ok)throw new Error(result.message||'项目操作失败。');return result;
}
function refreshLocks(){
  if(!api)return;const locks=api.savedData.editLocks||{},cameraLock=locks.shots?.[lastShot],actorId=$('actor').value,actorLock=locks.actors?.[actorId];
  $('lock-camera').textContent=cameraLock?.locked?'解锁当前镜头':'锁定当前镜头';$('camera-lock-state').textContent=cameraLock?.locked?`已锁定：${cameraLock.reason||'用户确认'}`:'当前镜头可编辑';
  $('lock-actor').textContent=actorLock?.locked?'解锁角色走位':'锁定角色走位';$('actor-lock-state').textContent=actorLock?.locked?`已锁定：${actorLock.reason||'用户确认'}`:'当前角色走位可编辑';
  [...fields.map(id=>$(id)),$('save'),$('reset'),$('undo-camera'),$('preview-rig')].forEach(element=>element.disabled=Boolean(cameraLock?.locked));
  [$('ax'),$('ay'),$('az'),$('save-path'),$('undo-actor')].forEach(element=>element.disabled=Boolean(actorLock?.locked));
}
function dirtyState(){
  if(!api)return;const dirty=api.dirtyShots;
  $('dirty-state').textContent=dirty.length?`未保存机位：${dirty.join('、')}。导出只使用已保存数据。`:'机位预览均已保存。';
  document.querySelectorAll('[data-shot]').forEach(b=>{b.textContent=b.dataset.label+(dirty.includes(b.dataset.shot)?' · 未保存':'')});
}
function resize(){if(!scene)return;const scale=$('framebox').clientWidth/scene.width;frame.style.width=scene.width+'px';frame.style.height=scene.height+'px';frame.style.transform=`scale(${scale})`;$('framebox').style.aspectRatio=`${scene.width}/${scene.height}`}
new ResizeObserver(resize).observe($('framebox'));
function offset(){return {position:fields.slice(0,3).map(id=>Number($(id).value)),target:fields.slice(3,6).map(id=>Number($(id).value)),fov:Number($('fov').value)}}
function refreshCamera(){
  const state=api.inspect(),s=scene.shots.find(s=>s.id===state.shotId),o=s.camera.offset;
  [o.position,o.target,[o.fov]].flat().forEach((v,i)=>$(fields[i]).value=v);$('shot-id').textContent=s.id;
  $('beat').textContent=s.beat;document.querySelectorAll('[data-shot]').forEach(b=>b.classList.toggle('active',b.dataset.shot===s.id));lastShot=s.id;dirtyState();refreshLocks();
}
function seek(t){time=Math.max(0,Math.min(scene.duration,Number(t)));api.seek(time);$('timeline').value=time;$('clock').textContent=`${time.toFixed(2)} / ${scene.duration.toFixed(2)} s`;if(api.inspect().shotId!==lastShot){scene=api.data;refreshCamera()}}
function setPlaying(value){playing=value;stamp=performance.now();$('play').textContent=value?'暂停':'播放';if(value)requestAnimationFrame(tick)}
function tick(now){if(!playing)return;const next=time+(now-stamp)/1000;stamp=now;seek(next);if(time>=scene.duration)setPlaying(false);else requestAnimationFrame(tick)}
function pathFields(){const a=scene.actors.find(a=>a.id===$('actor').value);const index=Number($('path-key').value);a.path[index].position.forEach((v,i)=>$( ['ax','ay','az'][i]).value=v)}
function pathKeys(){const a=scene.actors.find(a=>a.id===$('actor').value);if(!a)return;$('path-key').replaceChildren(...a.path.map((p,i)=>{const o=document.createElement('option');o.value=i;o.textContent=`${p.t.toFixed(2)} 秒`;return o}));pathFields();refreshLocks()}
let initializedFrameDocument=null;
async function initializeStudio(){
  const frameDocument=frame.contentDocument,readiness=frame.contentWindow?.__hf?.buildReady?.previs;
  if(!frameDocument||!readiness||frameDocument===initializedFrameDocument)return;
  initializedFrameDocument=frameDocument;
  try{
    await readiness;if(frame.contentDocument!==frameDocument)return;
    api=frame.contentWindow.PREVIS;scene=api.data;
    setPlaying(false);lastShot='';pendingCapture=null;annotationPacket=null;
    $('shots').replaceChildren();$('actor').replaceChildren();$('legend').replaceChildren();
    $('capture-preview').hidden=true;$('capture-info').textContent='';
    $('check-fight').hidden=!scene.combat;$('capture-states').hidden=!scene.combat;
    $('title').textContent=scene.title;$('spec').textContent=`${scene.width} × ${scene.height} · ${scene.fps} fps · ${scene.duration} s`;
    $('timeline').max=scene.duration;$('timeline').step=1/scene.fps;
    for(const s of scene.shots){const b=document.createElement('button');b.dataset.shot=s.id;b.dataset.label=`${s.id}　${s.start}–${s.end} 秒`;b.textContent=b.dataset.label;b.onclick=()=>{setPlaying(false);seek(s.start)};$('shots').appendChild(b)}
    for(const a of scene.actors){const o=document.createElement('option');o.value=a.id;o.textContent=a.role||a.name||a.id;$('actor').appendChild(o);const label=document.createElement('span'),dot=document.createElement('i');dot.className='dot';dot.style.background=a.color;label.append(dot,document.createTextNode(`${a.role||a.name||a.id} / ${a.id}`));$('legend').appendChild(label)}
    if(scene.actors.length)pathKeys();else $('actor').closest('.panel').hidden=true;
    frame.contentWindow.addEventListener('previs-select',event=>{
      const selected=event.detail;setPlaying(false);$('selection').textContent=`对象：${selected.objectId||'画面位置'} · ${selected.shotId} · ${selected.time.toFixed(3)} 秒 · (${selected.point.x.toFixed(3)}, ${selected.point.y.toFixed(3)})`;
      if(selected.objectId&&scene.actors.some(actor=>actor.id===selected.objectId)){$('actor').value=selected.objectId;pathKeys()}
    });
    resize();seek(0);message('可调整机位或人物关键点。');
    initialRuntimeToken=(await projectApi('./__previs/source')).runtime_sha256;
    await refreshAnnotations();await refreshDelivery();
  }catch(error){message(error.message,true)}
}
frame.addEventListener('load',initializeStudio);
if(frame.contentDocument?.readyState==='complete')initializeStudio();
$('play').onclick=()=>{if(api){if(time>=scene.duration)seek(0);setPlaying(!playing)}};
$('restart').onclick=()=>{if(api){setPlaying(false);seek(0)}};
$('timeline').oninput=()=>{if(api){setPlaying(false);seek($('timeline').value)}};
document.querySelectorAll('[data-view]').forEach(button=>button.onclick=()=>{if(!api)return;api.setView(button.dataset.view);document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('active',b===button))});
fields.forEach(id=>$(id).oninput=()=>action(async()=>{if(!api)return;setPlaying(false);api.setCameraOffset(lastShot,offset());scene=api.data;dirtyState();message('当前机位已预览，点击保存以用于导出；其他镜头预览不会一并保存。')}));
$('save').onclick=()=>action(async()=>{setPlaying(false);const id=lastShot,camera=api.data.shots.find(shot=>shot.id===id).camera;await api.saveCameraTrack(id,camera);scene=api.data;refreshCamera();message(`${id} 已保存；其他镜头的未保存预览仍保留。`);await refreshAnnotations()});
$('discard').onclick=()=>{if(!api)return;setPlaying(false);api.discardCameraPreview(lastShot);scene=api.data;refreshCamera();message('当前镜头已撤回到最近保存的机位，项目文件未改变。')};
$('reset').onclick=()=>action(async()=>{setPlaying(false);const id=lastShot;await api.resetCameraOffset(id);scene=api.data;refreshCamera();message(`${id} 偏移已清零并保存，基础运镜轨迹保持。`);await refreshAnnotations()});
$('actor').onchange=pathKeys;$('path-key').onchange=()=>{pathFields();setPlaying(false);seek(scene.actors.find(a=>a.id===$('actor').value).path[Number($('path-key').value)].t)};
$('save-path').onclick=()=>action(async()=>{setPlaying(false);await api.savePathPoint($('actor').value,Number($('path-key').value),['ax','ay','az'].map(id=>Number($(id).value)));scene=api.data;pathFields();dirtyState();message('当前人物关键点与辅助路径线已更新；未保存的机位不会一并提交。');await refreshAnnotations()});
$('lock-camera').onclick=()=>action(async()=>{const id=lastShot,locked=Boolean(api.savedData.editLocks?.shots?.[id]?.locked);await api.setEditLock('camera',id,!locked);scene=api.data;refreshLocks();dirtyState();message(`${id} ${locked?'已明确解锁':'已锁定'}`)});
$('lock-actor').onclick=()=>action(async()=>{const id=$('actor').value,locked=Boolean(api.savedData.editLocks?.actors?.[id]?.locked);await api.setEditLock('actor',id,!locked);scene=api.data;refreshLocks();message(`${id} ${locked?'已明确解锁':'已锁定'}`)});
async function undo(kind,id){
  setPlaying(false);if(kind==='camera'&&api.dirtyShots.includes(id))throw new Error('请先撤销或保存当前未保存预览，再撤销最近的已保存修改。');
  await api.undoTarget(kind,id);scene=api.data;refreshCamera();if(scene.actors.length)pathFields();await refreshAnnotations();message(`已撤销 ${id} 最近一次保存的修改，其他目标保持。`);
}
$('undo-camera').onclick=()=>action(()=>undo('camera',lastShot));$('undo-actor').onclick=()=>action(()=>undo('actor',$('actor').value));
$('preview-rig').onclick=()=>action(async()=>{setPlaying(false);api.previewRig(lastShot,$('rig-kind').value,Number($('rig-amount').value));scene=api.data;refreshCamera();message('运镜模板仅在当前镜头预览。请检查符合母稿后再保存。')});
$('capture').onclick=()=>action(async()=>{
  setPlaying(false);const source=await projectApi('./__previs/source');
  if(source.runtime_sha256!==initialRuntimeToken)throw new Error('页面加载后场景代码或素材已改变，请刷新重建画面后再捕获。');
  if(source.scene_revision!==api.revision)throw new Error('项目已在其他页面改变，请读取最新场景后再捕获。');
  pendingCapture={...api.captureFrame(),expectedRenderInputsSha256:source.render_inputs_sha256,expectedIntakeSha256:source.intake_sha256};
  seek(pendingCapture.frame.time);$('capture-preview').src='data:image/png;base64,'+pendingCapture.frame.pngBase64;$('capture-preview').hidden=false;$('capture-info').textContent=`${pendingCapture.frame.shotId} · ${pendingCapture.frame.time.toFixed(3)} 秒 · ${pendingCapture.frame.objectId||'画面位置'}。PNG会与本次来源关联。`;message('已捕获干净画面，可填写批注。');
});
$('save-annotation').onclick=()=>action(async()=>{
  if(!pendingCapture)throw new Error('请先捕获需要批注的正式机位画面。');
  if(!annotationPacket)await refreshAnnotations();
  await projectApi('./__previs/annotations',{...pendingCapture,expectedAnnotationsRevision:annotationPacket.revision,text:$('annotation-text').value});
  pendingCapture=null;$('capture-preview').hidden=true;$('capture-info').textContent='批注已保存。';$('annotation-text').value='';await refreshAnnotations();message('画面批注已保存；它是修改意见，尚未标为验收通过。');
});
$('refresh-annotations').onclick=()=>action(refreshAnnotations);
$('export-feedback').onclick=()=>action(async()=>{const result=await projectApi('./__previs/feedback/export',{});message(`反馈包已导出：${result.packageDirectory||result.markdown}。交付整个目录以包含截图；母稿原文保持。`)});
async function refreshAnnotations(){
  annotationPacket=await projectApi('./__previs/annotations');const host=$('annotation-list');host.replaceChildren();
  for(const item of [...annotationPacket.annotations].reverse()){
    const card=document.createElement('div');card.className='annotation';
    const heading=document.createElement('p');heading.className=item.stale?'locked':'badge';heading.textContent=`${item.stale?'过期 · ':''}${({OPEN:'待处理',RESOLVED:'已处理',VERIFIED:'已验收'})[item.status]} · ${item.shotId} · ${item.time.toFixed(3)}s · ${item.objectId||'画面位置'}`;
    const image=document.createElement('img');image.src='./'+item.png_ref;image.alt='批注对应的原始画面';
    const text=document.createElement('p');text.textContent=item.text;
    const note=document.createElement('input');note.type='text';note.placeholder='处理说明或单独验收证据';note.setAttribute('aria-label','批注处理或验收依据');
    const buttons=document.createElement('div');buttons.className='row';
    const update=(status)=>action(async()=>{
      await projectApi('./__previs/annotations/update',{id:item.id,expectedRevision:api.revision,expectedAnnotationsRevision:annotationPacket.revision,status,...(status==='VERIFIED'?{verificationEvidence:note.value}:note.value?{note:note.value}:{})});
      await refreshAnnotations();message(status==='VERIFIED'?'已登记该画面的单独验收证据。':'反馈状态已更新；已处理不等于已验收。');
    });
    for(const [state,label] of [['OPEN','重新打开'],['RESOLVED','标为已处理'],['VERIFIED','附证据验收']]){const button=document.createElement('button');button.textContent=label;button.disabled=item.stale&&state!=='OPEN';button.onclick=()=>update(state);buttons.append(button)}
    const jump=document.createElement('button');jump.textContent='定位时刻';jump.onclick=()=>{setPlaying(false);seek(item.time)};buttons.append(jump);
    const historyNote=document.createElement('button');historyNote.textContent='追加历史说明';historyNote.onclick=()=>action(async()=>{await projectApi('./__previs/annotations/update',{id:item.id,expectedRevision:api.revision,expectedAnnotationsRevision:annotationPacket.revision,note:note.value});await refreshAnnotations();message('说明已追加，原始批注和证据未覆盖。')});buttons.append(historyNote);
    card.append(heading,image,text,note,buttons);host.append(card);
  }
}
$('check-spatial').onclick=()=>action(async()=>{
  const report=await projectApi('./__previs/spatial');$('spatial-summary').textContent=`${report.status==='NO_ISSUES_OBSERVED'?'抽查未发现问题':'发现需查看的警告'} · ${report.sampling.sampleCount} 个采样帧 · ${report.counts.issueGroups} 组。范围：代理几何，不代表完整审片通过。`;
  const host=$('spatial-issues');host.replaceChildren();
  for(const issue of report.issues){const button=document.createElement('button');button.className='issue';button.textContent=`${issue.shotId} ${issue.start_s.toFixed(3)}–${issue.end_s.toFixed(3)}s · ${issue.code==='ARM_TARGET_UNREACHABLE'?'手部目标超出臂展（'+(issue.evidence.hand==='left'?'左手':'右手')+'，差 '+issue.evidence.reach_error_m.toFixed(3)+' 米）':issue.code} · ${issue.actorIds.join(', ')||issue.obstacleId||'相机'}`;button.onclick=()=>{setPlaying(false);seek(issue.start_s)};host.append(button)}
  message('已检查磁盘中的已保存场景。详细代理检查范围需结合画面审阅。');
});
window.addEventListener('beforeunload',event=>{if(api?.dirtyShots.length){event.preventDefault();event.returnValue=''}});

const checkLabels={source_structure:'来源与结构',text_alignment:'母稿对齐',render_specs:'视频规格',spatial_proxy:'代理空间',boundary_source:'接点来源',boundary_extraction:'接点提取',boundary_frame:'接点画面',boundary_motion:'接点运动',audio:'声音',capability:'平台能力',inputs:'实际输入',platform_submission:'平台提交',final_model:'最终媒体',fight_proxy:'战斗代理抽查',state_keyframes:'原时刻状态图',attack_response:'攻防因果',contact_phase:'接触相位',prop_ownership:'器物归属',persistent_effect:'持续术法',attrition_cost:'代价与地形',knowledge_reveal:'真假与揭示'};
const resultLabels={PASS:'通过',CHECKED:'已检查',FAIL:'未通过',BLOCKED:'受阻',PENDING:'待补充',UNKNOWN:'未知',NOT_RUN:'未检查',NOT_IMPLEMENTED:'未实现',NOT_APPLICABLE:'不适用',STALE:'需重新核对'};
async function refreshDelivery(){
  const data=await projectApi('./__previs/delivery'),host=$('delivery-checks');host.replaceChildren();
  if(!data.available){$('delivery-summary').textContent='尚未生成交付回执。';return}
  const goal=data.goal||{};
  $('delivery-summary').textContent=(data.current?'':'回执需更新。')+({COMPLETED:'本目标已完成',IN_PROGRESS:'本目标仍有待检查项',BLOCKED:'本目标受阻'})[goal.status]+' · '+(goal.target||'PREVIS')+'。已交付的文件与目标完成情况分别记录。';
  for(const [name,item] of Object.entries(data.checks)){const row=document.createElement('div');row.className='delivery-check';row.textContent=(checkLabels[name]||name)+'：'+(resultLabels[item.status]||item.status)+'。'+item.scope;host.append(row)}
}
$('refresh-delivery').onclick=()=>action(refreshDelivery);
$('build-handoff').onclick=()=>action(async()=>{const result=await projectApi('./__previs/handoff',{});await refreshDelivery();message('已按保存数据更新回执。目标状态：'+result.goal.status+'；详细范围见分项检查。')});
$('build-boundary').onclick=()=>action(async()=>{
  setPlaying(false);if(api?.dirtyShots.length)throw new Error('请先保存或撤销机位草稿，再提取与正式视频一致的接点证据。');
  $('build-boundary').disabled=true;
  try{await projectApi('./__previs/boundary',{});await projectApi('./__previs/handoff',{});await refreshDelivery();message('接点证据已提取；画面、运动与声音仍需按实际范围分别检查。')}finally{$('build-boundary').disabled=false}
});

$('check-fight').onclick=()=>action(async()=>{setPlaying(false);if(!api?.savedData.combat)throw new Error('当前工程未声明战斗代理；不能把普通布局视为已实现打斗。');const result=await projectApi('./__previs/fight-check',{});message('战斗代理已抽查：'+result.status+'。范围仅为身份、归属与声明接点，不等于攻防、受力或媒体通过。');await refreshDelivery()});
$('capture-states').onclick=()=>action(async()=>{
  setPlaying(false);if(api?.dirtyShots.length)throw new Error('请先保存或撤销草稿，再捕获与原时刻、原镜头一致的状态。');$('capture-states').disabled=true;
  try{const result=await projectApi('./__previs/state-capture',{});message('原时刻状态图已保存：'+result.status+'。独立状态PNG不是MP4抽帧；完整覆盖：'+(result.source_coverage?.status||'未绑定源帧'));await refreshDelivery()}finally{$('capture-states').disabled=false}
});
