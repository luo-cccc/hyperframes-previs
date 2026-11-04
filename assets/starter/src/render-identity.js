// Only renderer inputs belong to frame identity. UI locks/history do not draw pixels.
export function renderSceneContent(scene){
  const value=structuredClone(scene);
  delete value.editorHistory;delete value.editLocks;
  return value;
}
function normalized(value){return Array.isArray(value)?value.map(normalized):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,normalized(value[key])])):value}
export const renderSceneText=scene=>JSON.stringify(normalized(renderSceneContent(scene)));
