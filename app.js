const STORAGE_KEY = 'endsem-compass-v1';
const OWNER_KEY = 'endsem-compass-owner-v1';
const AI_API_URL = 'https://endsem-compass-ai.onrender.com/api/chat';
const colours = ['#6255e7','#2678eb','#ec9854','#21ab7c','#dd5276','#775d45'];
const initialState = {target:100, theme:'light', subjects:[]};
let state = loadState();
let selectedColour = colours[0];
let activeChatTopicId = null;
const $ = selector => document.querySelector(selector);

function loadState(){try{return JSON.parse(localStorage.getItem(STORAGE_KEY)) || structuredClone(initialState)}catch{return structuredClone(initialState)}}
function save(){localStorage.setItem(STORAGE_KEY,JSON.stringify(state));}
function ownerId(){let id=localStorage.getItem(OWNER_KEY);if(!id){id=crypto.randomUUID();localStorage.setItem(OWNER_KEY,id)}return id}
function topics(){return state.subjects.flatMap(subject=>subject.topics.map(topic=>({...topic,subject})));}
function metrics(){const all=topics(),done=all.filter(topic=>topic.complete),marks=all.reduce((sum,topic)=>sum+Number(topic.marks),0),covered=done.reduce((sum,topic)=>sum+Number(topic.marks),0);return{all,done,marks,covered,notes:all.filter(topic=>topic.notes).length}}
function escapeHtml(value){const element=document.createElement('div');element.textContent=value;return element.innerHTML}

function render(){
  const m=metrics(), progress=m.all.length?Math.round(m.done.length/m.all.length*100):0, targetProgress=Math.min(100,Math.round(m.covered/state.target*100));
  document.body.classList.toggle('dark',state.theme==='dark');
  $('#totalTopics').textContent=m.all.length;
  $('#totalTopicsNote').textContent=m.all.length?`${state.subjects.length} subject${state.subjects.length===1?'':'s'} in your plan`:'Start building your plan';
  $('#completedTopics').textContent=m.done.length; $('#completionNote').textContent=`${progress}% of your syllabus`;
  $('#marksCovered').textContent=m.covered; $('#marksNote').textContent=`out of ${m.marks} topic marks`;
  $('#notesReady').textContent=m.notes; $('#notesNote').textContent=`${m.all.length-m.notes} topics need notes`;
  $('#progressPercent').textContent=`${progress}%`; $('#overallProgressBar').style.width=`${progress}%`;
  $('#legendComplete').textContent=m.done.length; $('#legendRemaining').textContent=m.all.length-m.done.length;
  $('#coveredMarkValue').textContent=m.covered; $('#targetMarkValue').textContent=state.target; $('#targetBar').style.width=`${targetProgress}%`;
  $('#targetCopy').textContent=m.all.length?`${m.covered} completed marks contribute to your ${state.target}-mark goal.`:'Set your target and add topics to see progress.';
  const next=m.all.find(topic=>!topic.complete);
  $('#nextUpText').textContent=next?`${next.subject.name} · ${next.name} (${next.marks} marks)`:m.all.length?'Everything is marked complete. Great work!':'Add your first topic to get started.';
  renderSubjects(); save();
}

function renderSubjects(){
  const list=$('#subjectList'),empty=$('#emptyState');list.innerHTML='';empty.hidden=state.subjects.length>0;
  state.subjects.forEach(subject=>{
    const completed=subject.topics.filter(topic=>topic.complete).length, progress=subject.topics.length?completed/subject.topics.length*100:0;
    const card=document.createElement('article');card.className='subject-card';
    card.innerHTML=`<div class="subject-top"><div class="subject-title"><i class="subject-color" style="background:${subject.color}"></i><h3>${escapeHtml(subject.name)} <span>${subject.topics.length} topic${subject.topics.length===1?'':'s'}</span></h3></div><div class="subject-info"><small>${completed}/${subject.topics.length} DONE</small><div class="mini-bar"><i style="width:${progress}%;background:${subject.color}"></i></div><button class="kebab" data-delete-subject="${subject.id}" title="Delete subject">×</button></div></div><div class="topic-list">${subject.topics.map(topic=>`<div class="topic-row"><button class="status-toggle ${topic.complete?'done':''}" data-toggle="${topic.id}" aria-label="Mark ${escapeHtml(topic.name)} ${topic.complete?'incomplete':'complete'}">${topic.complete?'✓':''}</button><span class="topic-name ${topic.complete?'done':''}">${escapeHtml(topic.name)}</span><button class="ai-topic-button" data-chat="${topic.id}" title="Open AI chat for ${escapeHtml(topic.name)}">✦ Ask AI</button><span class="marks">${topic.marks} MARKS</span><span class="notes-badge ${topic.notes?'notes-yes':'notes-no'}">${topic.notes?'NOTES READY':'NO NOTES'}</span><button class="delete-topic" data-delete-topic="${topic.id}" title="Delete topic">×</button></div>`).join('')}</div><div class="add-topic-row"><button data-add-topic="${subject.id}">+ Add topic</button></div>`;
    list.append(card);
  });
}

function showToast(message){const toast=$('#toast');toast.textContent=message;toast.classList.add('visible');setTimeout(()=>toast.classList.remove('visible'),2400)}
function openSubject(){selectedColour=colours[state.subjects.length%colours.length];renderColours();$('#subjectName').value='';$('#subjectModal').showModal();$('#subjectName').focus()}
function renderColours(){$('#colourOptions').innerHTML=colours.map(colour=>`<button type="button" class="colour-choice ${colour===selectedColour?'selected':''}" data-colour="${colour}" style="background:${colour}" aria-label="Choose colour"></button>`).join('')}
function refreshSubjectOptions(selected){$('#topicSubject').innerHTML=state.subjects.map(subject=>`<option value="${subject.id}" ${subject.id===selected?'selected':''}>${escapeHtml(subject.name)}</option>`).join('')}
function openTopic(subjectId){
  if(!state.subjects.length){openSubject();showToast('Create a subject before adding a topic.');return}
  $('#topicModalKicker').textContent='NEW TOPIC';$('#topicModalTitle').textContent='Add a study topic';$('#saveTopicButton').textContent='Add topic';
  refreshSubjectOptions(subjectId||state.subjects[0].id);$('#topicName').value='';$('#topicMarks').value='5';$('#topicStatus').value='incomplete';$('#topicNotes').checked=false;
  $('#topicModal').showModal();$('#topicName').focus();
}
function findTopic(id){for(const subject of state.subjects){const topic=subject.topics.find(item=>item.id===id);if(topic)return{subject,topic}}}

function renderChatMessages(messages, topicName){
  const container=$('#chatMessages');
  if(!messages.length){container.innerHTML=`<div class="chat-welcome"><span>✦</span><p>I’m ready to help with <b>${escapeHtml(topicName)}</b>. Ask for a simple explanation, practice questions, examples, or a revision plan.</p></div>`;return}
  container.innerHTML=messages.map(message=>`<article class="chat-bubble ${message.role==='user'?'user-message':'assistant-message'}"><span>${message.role==='user'?'YOU':'AI TUTOR'}</span><p>${escapeHtml(message.content).replace(/\n/g,'<br>')}</p></article>`).join('');
  container.scrollTop=container.scrollHeight;
}
async function apiRequest(path, options={}){
  const response=await fetch(`${AI_API_URL}${path}`,{...options,headers:{'Content-Type':'application/json','X-Study-Owner':ownerId(),...(options.headers||{})}});
  const payload=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(payload.error||'The AI tutor is unavailable right now.');
  return payload;
}
async function openChat(topicId){
  const match=findTopic(topicId);if(!match)return;activeChatTopicId=topicId;
  $('#chatTopicTitle').textContent=match.topic.name;
  $('#chatContext').textContent=`${match.subject.name} · ${match.topic.marks} marks · ${match.topic.notes?'notes ready':'no notes added'}`;
  $('#chatMessages').innerHTML='<div class="chat-welcome"><span>✦</span><p>Loading this topic’s saved conversation…</p></div>';
  $('#chatStatus').textContent='';$('#chatInput').value='';$('#aiModal').showModal();
  try{const payload=await apiRequest(`/${encodeURIComponent(topicId)}`);renderChatMessages(payload.messages||[],match.topic.name)}catch(error){$('#chatStatus').textContent=error.message==='Failed to fetch'?'The AI tutor is being set up. Please try again shortly.':error.message;renderChatMessages([],match.topic.name)}
  $('#chatInput').focus();
}
async function sendChatMessage(event){
  event.preventDefault();const match=findTopic(activeChatTopicId),input=$('#chatInput'),message=input.value.trim();if(!match||!message)return;
  input.value='';$('#sendChat').disabled=true;$('#chatStatus').textContent='AI tutor is thinking…';
  try{
    const payload=await apiRequest(`/${encodeURIComponent(activeChatTopicId)}`,{method:'POST',body:JSON.stringify({subject:match.subject.name,topic:{name:match.topic.name,marks:match.topic.marks,notesAvailable:match.topic.notes,completed:match.topic.complete},message})});
    $('#chatStatus').textContent='';renderChatMessages(payload.messages||[],match.topic.name);
  }catch(error){$('#chatStatus').textContent=error.message==='Failed to fetch'?'The AI tutor is being set up. Please try again shortly.':error.message;input.value=message;input.focus()}
  finally{$('#sendChat').disabled=false;}
}

document.addEventListener('click',event=>{
  const colour=event.target.closest('[data-colour]');if(colour){selectedColour=colour.dataset.colour;renderColours();return}
  const add=event.target.closest('[data-add-topic]');if(add){openTopic(add.dataset.addTopic);return}
  const chat=event.target.closest('[data-chat]');if(chat){openChat(chat.dataset.chat);return}
  const toggle=event.target.closest('[data-toggle]');if(toggle){const match=findTopic(toggle.dataset.toggle);match.topic.complete=!match.topic.complete;render();showToast(match.topic.complete?'Topic marked complete!':'Moved back to study list.');return}
  const deleteTopic=event.target.closest('[data-delete-topic]');if(deleteTopic){const match=findTopic(deleteTopic.dataset.deleteTopic);match.subject.topics=match.subject.topics.filter(topic=>topic.id!==match.topic.id);render();showToast('Topic removed.');return}
  const deleteSubject=event.target.closest('[data-delete-subject]');if(deleteSubject){const subject=state.subjects.find(item=>item.id===deleteSubject.dataset.deleteSubject);if(confirm(`Delete ${subject.name} and all its topics?`)){state.subjects=state.subjects.filter(item=>item.id!==subject.id);render();showToast('Subject removed.')}}
});

$('#openSubjectModal').onclick=openSubject;$('#emptyAddSubject').onclick=openSubject;$('#openTopicModal').onclick=()=>openTopic();
$('#editTarget').onclick=()=>{$('#targetInput').value=state.target;$('#targetModal').showModal()};
$('#themeButton').onclick=()=>{state.theme=state.theme==='dark'?'light':'dark';render()};
$('#closeAiModal').onclick=()=>$('#aiModal').close();$('#chatForm').addEventListener('submit',sendChatMessage);
$('#subjectForm').addEventListener('submit',event=>{if(event.submitter?.value==='cancel')return;event.preventDefault();const name=$('#subjectName').value.trim();if(!name)return;state.subjects.push({id:crypto.randomUUID(),name,color:selectedColour,topics:[]});$('#subjectModal').close();render();showToast(`${name} added to your syllabus.`)});
$('#topicForm').addEventListener('submit',event=>{if(event.submitter?.value==='cancel')return;event.preventDefault();const name=$('#topicName').value.trim(),subject=state.subjects.find(item=>item.id===$('#topicSubject').value);if(!name||!subject)return;subject.topics.push({id:crypto.randomUUID(),name,marks:Number($('#topicMarks').value),complete:$('#topicStatus').value==='complete',notes:$('#topicNotes').checked});$('#topicModal').close();render();showToast('Topic added. Keep going!')});
$('#targetForm').addEventListener('submit',event=>{if(event.submitter?.value==='cancel')return;event.preventDefault();state.target=Number($('#targetInput').value);$('#targetModal').close();render();showToast('Marks target updated.')});
$('#exportButton').onclick=()=>{const file=new Blob([JSON.stringify(state,null,2)],{type:'application/json'}),url=URL.createObjectURL(file),link=document.createElement('a');link.href=url;link.download='endsem-compass-data.json';link.click();URL.revokeObjectURL(url);showToast('Study data exported.')};
$('#importInput').onchange=event=>{const file=event.target.files[0];if(!file)return;const reader=new FileReader();reader.onload=()=>{try{const imported=JSON.parse(reader.result);if(!Array.isArray(imported.subjects))throw Error();state=imported;render();showToast('Study data imported.')}catch{showToast('That file does not look like Compass data.')}};reader.readAsText(file);event.target.value=''};
render();
