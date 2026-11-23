/* Existing AfterKey account design, restored multi-section application. */
(() => {
  'use strict';
  const $ = (s,root=document) => root.querySelector(s);
  const esc = v => String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const stamp = t => t ? new Date(t*1000).toLocaleString() : 'Not yet';
  const size = b => b < 1048576 ? `${(b/1024).toFixed(1)} KB` : `${(b/1048576).toFixed(1)} MB`;
  const kinds = {note:'Private memory',message:'Message or letter',document:'Document',media:'Photo, video or audio',account:'Account information',place:'Place or instruction'};
  let account, entries=[], familyId=null, familySteward=false;
  const route = location.pathname.split('/')[2] || 'dashboard';
  const section = $('#content');
  function notice(message,error=false) { const n=$('#notice'); n.textContent=message; n.hidden=false; n.dataset.error=error; n.scrollIntoView({block:'nearest'}); }
  async function api(path,method='GET',data) {
    const r=await fetch(path,{method,credentials:'same-origin',headers:method==='GET'?{}:{'Content-Type':'application/json'},body:method==='GET'?undefined:JSON.stringify(data??{})});
    let d; try { d=await r.json(); } catch { throw Error('The server could not complete the request. Please try again.'); }
    if (!r.ok) { if(r.status===401 && !path.startsWith('/api/claim')) location.href='/login'; throw Error(d.detail||d.message||String(d.error||'Request failed').replaceAll('_',' ')); }
    return d;
  }
  const button=(text,action,id='')=>`<button class="btn btn--ghost compact" type="button" data-action="${action}" data-id="${esc(id)}">${text}</button>`;
  const link=(text,url)=>`<a class="btn btn--ghost compact" href="${url}">${text}</a>`;
  let fieldId=0;
  const input=(name,label,value='',type='text',extra='')=>`<div class="field"><label for="${name}-${++fieldId}">${label}</label><input id="${name}-${fieldId}" name="${name}" type="${type}" value="${esc(value)}" ${extra}></div>`;
  const area=(name,label,value='',extra='')=>`<div class="field"><label for="${name}-${++fieldId}">${label}</label><textarea id="${name}-${fieldId}" name="${name}" ${extra}>${esc(value)}</textarea></div>`;
  const checkbox=(name,label,on=false)=>`<label class="check"><input name="${name}" type="checkbox" ${on?'checked':''}>${label}</label>`;
  function form(id,body,label='Save changes') { return `<form data-form="${id}">${body}<div class="actions"><button class="btn compact" type="submit">${label}</button></div></form>`; }
  function box(title,body) { return `<section class="panel section"><h2>${title}</h2>${body}</section>`; }
  function header(title,subtitle,action='') { $('#page-title').textContent=title; $('#page-subtitle').textContent=subtitle; $('#page-actions').innerHTML=action; document.title=`${title} | AfterKey`; }
  function dataOf(f) { const p=Object.fromEntries(new FormData(f)); f.querySelectorAll('[type=checkbox]').forEach(x=>p[x.name]=x.checked); return p; }
  function dialog(title,body) { $('#dialog-content').innerHTML=`<h2>${title}</h2>${body}<div class="dialog__actions">${button('Close','close')}</div>`; $('#dialog').showModal(); }
  async function submit(f,fn) { const b=f.querySelector('[type=submit]'); b.disabled=true; try { await fn(dataOf(f)); } finally { b.disabled=false; } }
  function fileURL(e,download=false) { return `${familyId?`/api/family/${familyId}/file/`:'/api/entries/'}${e.id}${familyId?'':'/file'}${download?'?download=1':''}`; }
  function memory(e,full=false) {
    return `<article class="memory"><span class="tag">${esc(kinds[e.kind]||'Memory')}</span><h3>${esc(e.title)}</h3><div class="meta">Updated ${stamp(e.updated_at)}${e.file_name?` · ${esc(e.file_name)} · ${size(e.file_size)}`:''}</div>${full?`<p>${esc(e.body)}</p>`:`<p>${esc((e.body||'').slice(0,150))}${e.body?.length>150?'…':''}</p>`}<div class="actions">${button('Open','preview',e.id)}${!familyId||familySteward?button('Edit','edit',e.id):''}${!familyId?button('Delete','delete-entry',e.id):''}${e.file_name?`<a class="btn btn--ghost compact" href="${fileURL(e,true)}" download>Download</a>`:''}</div></article>`;
  }
  async function dashboard() {
    header('Your dashboard','A living record of what matters, safely in your keeping.',link('Add a memory','/app/vault?new=1'));
    const d=await api('/api/overview'); entries=d.recent;
    const days=Math.ceil((d.plan.due_at-Date.now()/1000)/86400);
    section.innerHTML=`<div class="stats">${[['Vault items',d.items],['Stored privately',size(d.bytes)],['Next Life Check',days>=0?`${days} days`:'Check in due'],['Legacy status',d.plan.activation?.status||'Sealed']].map(([k,v])=>`<div class="panel stat"><span>${k}</span><strong>${esc(v)}</strong></div>`).join('')}</div><div class="grid">${box('Keep your story close',`<p>Save the photographs, words, and records you want to carry forward.</p><div class="actions">${link('My Vault','/app/vault')}${link('Choose loved ones','/app/legacy')}${link('Secure my account','/app/settings')}</div>`)}${box('Life Check',`<p>Your next check-in is ${stamp(d.plan.due_at)}. Status: ${esc(d.plan.checkin_status)}.</p><p>A missed check-in only calls for follow-up. It never proves death or releases your vault.</p>${button('I’m here — check in','checkin')}`)}</div>${box('Recent memories',d.recent.length?d.recent.map(e=>memory(e)).join(''):'<p>Your vault is ready for its first memory. Add a letter, a photograph, or an important document.</p>')}`;
  }
  async function vault() {
    familyId=null; header('My Vault','Letters, photographs, documents, and memories — held privately.',button('Add a memory','new'));
    entries=(await api('/api/entries')).entries;
    section.innerHTML=`<div class="toolbar"><input aria-label="Search vault" id="search" placeholder="Search your memories"><select aria-label="Filter category" id="category"><option value="">All memories</option>${Object.entries(kinds).map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}</select></div><div class="panel" id="memories"></div><p class="muted">Attachments: images, PDF, text, MP4/WebM video, MP3/M4A audio. Up to 8 MB per item. Private files are served only after account authorization.</p>`;
    filter(); $('#search').addEventListener('input',filter); $('#category').addEventListener('change',filter);
    if(new URLSearchParams(location.search).has('new')) { history.replaceState(null,'','/app/vault'); editor(); }
  }
  function filter() { const term=$('#search').value.toLowerCase(),kind=$('#category').value; const list=entries.filter(e=>(!kind||e.kind===kind)&&`${e.title} ${e.body}`.toLowerCase().includes(term)); $('#memories').innerHTML=list.length?list.map(e=>memory(e)).join(''):'<div class="empty"><h2>No memories here yet</h2><p>Add a memory or try a different search.</p></div>'; }
  function editor(e={}) {
    dialog(e.id?'Edit memory':'Add a memory',form('entry',`${input('title','Title',e.title,'text','required maxlength="120"')}<div class="field"><label for="kind">Category</label><select id="kind" name="kind">${Object.entries(kinds).map(([k,v])=>`<option value="${k}" ${e.kind===k?'selected':''}>${v}</option>`).join('')}</select></div>${area('body','Your words or instructions',e.body,'maxlength="20000"')}${input('recipient','For someone special (optional)',e.recipient)}${input('recipient_email','Recipient email (optional — does not grant access)',e.recipient_email,'email')}${area('secret','Private account details (optional)',e.secret,'maxlength="4000"')}${input('link','Related link (optional)',e.link,'url')}${!familyId?input('attachment',e.file_name?'Replace attachment (optional)':'Attachment (optional)','','file','accept="image/png,image/jpeg,image/webp,image/gif,application/pdf,text/plain,video/mp4,video/webm,audio/mpeg,audio/mp4"'):''}<input type="hidden" name="id" value="${e.id||''}">`,'Save memory'));
  }
  function preview(e) {
    let media=''; const url=fileURL(e);
    if(e.file_name) {
      if(e.file_type.startsWith('image/')) media=`<img class="memory-preview" src="${url}" alt="${esc(e.title)}">`;
      else if(e.file_type.startsWith('video/')) media=`<video class="memory-preview" controls preload="metadata" src="${url}"></video>`;
      else if(e.file_type.startsWith('audio/')) media=`<audio controls preload="metadata" src="${url}"></audio>`;
      else media=`<a class="text-link" target="_blank" rel="noopener" href="${url}">Preview ${esc(e.file_name)} in a new tab</a>`;
      media+=`<div class="actions">${link('Download attachment',fileURL(e,true))}</div>`;
    }
    dialog(esc(e.title),`<p>${esc(kinds[e.kind])}</p><div class="body-text">${esc(e.body)}</div>${e.secret?`<details><summary>Private account details</summary><pre class="body-text">${esc(e.secret)}</pre></details>`:''}${e.link&&/^https?:\/\//.test(e.link)?`<p><a class="text-link" href="${esc(e.link)}" rel="noopener noreferrer" target="_blank">Open related link</a></p>`:''}${media}`);
  }
  async function legacy() {
    header('Legacy Management','Choose who comes next. Keep control of every step.');
    const [{plan:p,history:h},{heirs}]=await Promise.all([api('/api/plan'),api('/api/heirs')]);
    section.innerHTML=`<div class="notice">Private content stays sealed until activation and identity checks are approved. An invitation is never an access key. A missed Life Check never authorizes release.</div><div class="grid">${box('Life Check',form('plan',`${input('frequency','Check-in frequency (days)',p.frequency,'number','required min="1" max="365"')}${input('grace','Grace period (days)',p.grace,'number','required min="1" max="90"')}${checkbox('generation_enabled','Allow designated stewards to nominate the next generation',p.generation_enabled)}`)+`<p>Next check-in: ${stamp(p.due_at)}<br>Grace period ends: ${stamp(p.grace_ends_at)}<br>Status: ${esc(p.checkin_status)}</p>${button('I’m here — check in','checkin')}`)}${box('Your chosen loved ones',`${heirs.length?heirs.map(h=>`<article class="memory"><h3>${esc(h.name)}</h3><p>${esc(h.email)}</p><span class="tag">${esc(h.role)}${h.steward?' · steward':''}</span><p>Status: ${esc(h.status)}</p><div class="actions">${button('Edit nomination','edit-heir',h.id)}${button('Withdraw','remove-heir',h.id)}${p.activation?.status==='approved'?button('Send invitation','invite',h.id):''}</div></article>`).join(''):'<p>Choose up to five people to carry your story forward.</p>'}${button('Choose a loved one','new-heir')}`)}</div>${box('Activation review',`<p>Current status: <strong>${esc(p.activation?.status||'Not activated')}</strong>. Approval requires independent checks of supporting records and inheritance authority.</p>${p.activation?`<p>Requested ${stamp(p.activation.created_at)}</p>${button('Withdraw activation — I’m here','checkin')}`:form('activation',`${area('reason','Circumstances requiring review','','required minlength="20" maxlength="1000"')}${area('evidence','Verifiable supporting record or reference, and inheritance authority','','required minlength="20" maxlength="4000"')}<p>Do not paste account passwords or identity document numbers. Use a record reference and a safe way for the reviewer to verify it independently.</p>`,'Request independent review')}`)}${box('Check-in history',h.length?`<ul>${h.map(r=>`<li>${stamp(r.created_at)}</li>`).join('')}</ul>`:'<p>Your first check-in will appear here.</p>')}`;
    section._heirs=heirs;
  }
  function heirEditor(h={},successor=false) {
    dialog(successor?'Nominate the next generation':h.id?'Edit nomination':'Choose a loved one',form(successor?'successor':'heir',`${input('name','Full name',h.name,'text','required maxlength="80"')}${!h.id?input('email','Their own email address',h.email,'email','required'):''}<label for="role">Nomination</label><select name="role" id="role"><option value="primary" ${h.role==='primary'?'selected':''}>Primary beneficiary</option><option value="backup" ${h.role==='backup'?'selected':''}>Backup beneficiary</option></select>${checkbox('steward','Designate as a steward who can manage the family space',h.steward)}<p>A backup can be invited after the primary nomination is withdrawn. Every person completes their own verification.</p><input type="hidden" name="id" value="${h.id||''}">`,'Save nomination'));
  }
  async function settings() {
    header('Settings','Your account, privacy, and security.');
    const {sessions}=await api('/api/account/sessions'),p=account.preferences;
    section.innerHTML=`<div class="grid">${box('Personal information',form('profile',`${input('name','Your name',account.name,'text','maxlength="100"')}${input('email_readonly','Account email',account.email,'email','readonly')}<p>Sign-in and recovery are tied to this email. Contact support if you lose access.</p>${checkbox('life_check_email','Email me Life Check reminders',p.life_check_email!==false)}${checkbox('activity_email','Email me about security and legacy activity',p.activity_email!==false)}${checkbox('profile_visible','Show my name to approved family members',!!p.profile_visible)}`))}${box('Email verification',`<p>${account.verified?'Your email is verified.':'Verify your email to enable recovery codes and legacy requests.'}</p>${button('Send verification code','send-email')}${form('verify-email',input('code','Six-digit code','','text','required pattern="[0-9]{6}" inputmode="numeric" autocomplete="one-time-code"'),'Verify email')}`)}${box('Change password',form('password',`${input('password','Current password','','password','required autocomplete="current-password"')}${input('new_password','New password','','password','required minlength="10" maxlength="200" autocomplete="new-password"')}`,'Update password'))}${box('Account recovery',`<p>Verified email: ${account.verified?'Ready':'Verification needed'}<br>Recovery codes: ${account.recovery_ready?'Created':'Not yet created'}</p><div class="actions">${link('Manage recovery','/app/recovery')}</div>`)}</div>${box('Active sessions',sessions.map(s=>`<article class="memory"><h3>${s.current?'This device':'Signed-in device'}</h3><p>${esc(s.user_agent||'Unknown browser')}<br>Started ${stamp(s.created_at)} · expires ${stamp(s.expires_at)}</p>${button(s.current?'Sign out this device':'Revoke session','revoke-session',s.id)}</article>`).join(''))}${box('Delete account',`<p>Closing your account immediately disables sign-in and legacy access. Your records and files are retained privately for recovery and backup retention; this action does not permanently erase the stored records.</p>${form('delete-account',`${input('password','Confirm your password','','password','required autocomplete="current-password"')}${input('confirmation','Type DELETE to close your account','','text','required pattern="DELETE"')}`,'Close my account')}`)}`;
  }
  async function recovery() {
    header('Account Recovery','Keep a safe way back to your own account.');
    section.innerHTML=`<div class="grid">${box('Verified email recovery',`<p>Send a one-use password reset link to ${esc(account.email)}. The link expires in one hour. A successful reset signs out all existing sessions.</p><p>Email: ${account.verified?'verified':'verify your email in Settings'}</p>${button('Send password reset email','reset-email')}`)}${box('Recovery codes',`<p>Store these offline, away from your password. Each code works once. Generating a new set invalidates the previous set.</p>${form('codes',input('password','Confirm your password','','password','required autocomplete="current-password"'),'Generate recovery codes')}`)}</div><section id="generated-codes" hidden class="panel section"></section><div class="notice">Recovery is always for your own account. A loved one will never need the original owner’s password or recovery codes.</div>`;
  }
  async function family() {
    header('Family spaces','A legacy continues through the people who care for it.');
    const {spaces}=await api('/api/family');
    const selected=Number(new URLSearchParams(location.search).get('space'));
    familyId=spaces.some(s=>s.id===selected)?selected:null;
    if(!familyId) { section.innerHTML=box('Legacies in your keeping',spaces.length?spaces.map(s=>`<article class="memory"><h3>Family legacy</h3><p>Claimed ${stamp(s.claimed_at)}${s.steward?' · Designated steward':''}</p>${link('Open family space',`/app/family?space=${s.id}`)}</article>`).join(''):'<p>After you complete a verified invitation and claim a legacy, the family space will appear here.</p>')+box('Request a review for a loved one',form('activation',input('owner_email','Their AfterKey email address','','email','required')+area('reason','Circumstances requiring review','','required minlength="20" maxlength="1000"')+area('evidence','Verifiable supporting record and inheritance reference','','required minlength="20" maxlength="4000"'),'Request independent review')+'<p>You must be nominated by this person and have verified your own account email. A reviewer independently checks every request.</p>'); return; }
    const d=await api(`/api/family/${familyId}`); entries=d.entries; familySteward=d.steward;
    section.innerHTML=`${box(d.owner_name?`Remembering ${esc(d.owner_name)}`:'Continue the legacy',`<p>${d.steward?'You are a designated steward. You may maintain the memories entrusted to this space.':'You have approved access to these memories.'}</p>${d.steward&&d.generation_enabled?button('Nominate next generation','successor'):''}`)}<div class="panel">${entries.length?entries.map(e=>memory(e)).join(''):'<div class="empty">There are no active vault items in this space.</div>'}</div>`;
  }
  async function reviews() {
    header('Legacy reviews','Independent verification, with every decision recorded.');
    const d=await api('/api/reviews');
    section.innerHTML=`<div class="notice">Confirm evidence independently. An email, invitation, claim statement, or missed Life Check is never proof of death or inheritance authority. Do not approve a request you are personally involved in.</div>${box('Activation requests',d.activations.length?d.activations.map(r=>reviewCard('activation',r)).join(''):'<p>No activation requests are waiting.</p>')}${box('Identity and inheritance verification',d.claims.length?d.claims.map(r=>reviewCard('identity',r)).join(''):'<p>No identity reviews are waiting.</p>')}${box('Approved activation · invitations',d.invitations.length?d.invitations.map(h=>`<article class="memory"><h3>${esc(h.name)}</h3><p>${esc(h.role)} beneficiary · family ${h.user_id}</p>${button('Send invitation','invite',h.id)}</article>`).join(''):'<p>No nominations are awaiting an invitation.</p>')}${box('Review history',d.audit.length?`<ul>${d.audit.map(r=>`<li>${stamp(r.created_at)} · ${esc(r.action.replaceAll('_',' '))} · record ${esc(r.target)}</li>`).join('')}</ul>`:'<p>Recorded actions will appear here.</p>')}`;
  }
  function reviewCard(kind,r) {
    return `<article class="memory"><h3>Request ${r.id}${r.identity_name?` · ${esc(r.identity_name)}`:''}</h3><p>${esc(r.reason||r.relationship)}</p><p>${esc(r.evidence)}</p>${form('review',`<input type="hidden" name="kind" value="${kind}"><input type="hidden" name="id" value="${r.id}">${checkbox(kind==='activation'?'death_evidence_checked':'identity_checked',kind==='activation'?'I independently verified the death record':'I independently verified the recipient’s identity')}${checkbox('authority_checked','I independently verified inheritance authority')}${area('decision','Decision notes and verification references','','required minlength="20" maxlength="2000"')}<label for="status-${kind}-${r.id}">Decision</label><select id="status-${kind}-${r.id}" name="status"><option value="rejected">Reject / request corrections</option><option value="approved">Approve</option></select>${input('password','Your administrator password','','password','required')}`,'Record decision')}</article>`;
  }
  const render=()=>({dashboard,vault,legacy,settings,recovery,family,reviews}[route]||dashboard)();
  document.addEventListener('click',async ev=>{
    const b=ev.target.closest('[data-action]'); if(!b)return;
    const action=b.dataset.action,id=Number(b.dataset.id);
    b.disabled=true;
    try {
      if(action==='menu') { const menu=$('#mobile-menu'); menu.hidden=!menu.hidden; b.setAttribute('aria-expanded',String(!menu.hidden)); }
      else if(action==='close') $('#dialog').close();
      else if(action==='logout') { await api('/api/auth/logout','POST'); location.href='/login'; }
      else if(action==='new') editor();
      else if(action==='edit') editor(entries.find(e=>e.id===id));
      else if(action==='preview') preview(entries.find(e=>e.id===id));
      else if(action==='delete-entry') { if(confirm('Remove this item from your vault?')) { await api(`/api/entries/${id}`,'DELETE'); await render(); notice('Memory removed from your vault.'); } }
      else if(action==='checkin') { await api('/api/plan/checkin','POST'); await render(); notice('Your check-in is recorded. Any pending or active legacy activation has been cancelled.'); }
      else if(action==='new-heir') heirEditor();
      else if(action==='edit-heir') heirEditor(section._heirs.find(h=>h.id===id));
      else if(action==='remove-heir') { if(confirm('Withdraw this nomination and revoke their legacy access?')) { await api(`/api/heirs/${id}`,'DELETE'); await render(); notice('Nomination withdrawn.'); } }
      else if(action==='invite') { await api(`/api/heirs/${id}/invite`,'POST'); await render(); notice('Invitation sent. Private content remains sealed until all claim checks pass.'); }
      else if(action==='send-email') { await api('/api/account/email/send','POST'); notice('A six-digit code has been sent to your account email.'); }
      else if(action==='reset-email') { await api('/api/auth/reset/request','POST',{email:account.email}); notice('If delivery is available, your reset link will arrive shortly.'); }
      else if(action==='revoke-session') { await api(`/api/account/sessions/${b.dataset.id}`,'DELETE'); await render(); notice('Session revoked.'); }
      else if(action==='successor') heirEditor({},true);
      else if(action==='download-codes') { const blob=new Blob([$('#codes').textContent],{type:'text/plain'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='afterkey-recovery-codes.txt';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000); }
    } catch(e) { notice(e.message,true); } finally { b.disabled=false; }
  });
  document.addEventListener('submit',async ev=>{
    const f=ev.target;if(!f.dataset.form)return;ev.preventDefault();
    try { await submit(f,async p=>{
      switch(f.dataset.form) {
        case 'entry': {
          const attachment=f.elements.attachment?.files[0];
          if(attachment?.size>8*1024*1024)throw Error('Choose an attachment no larger than 8 MB.');
          const editing=!!p.id;
          const result=await api(editing?(familyId?`/api/family/${familyId}/entries/${p.id}`:`/api/entries/${p.id}`):'/api/entries',editing?'PATCH':'POST',p);
          const eid=p.id||result.id;
          // Keep the saved ID if an upload fails, so retry never duplicates the memory.
          f.elements.id.value=eid;
          if(attachment) {
            const r=await fetch(`/api/entries/${eid}/file`,{method:'POST',headers:{'Content-Type':attachment.type||'application/octet-stream','X-File-Name':attachment.name.replace(/[^\x20-\x7E]/g,'_')},body:attachment});
            const d=await r.json();if(!r.ok)throw Error(d.detail||d.message||d.error||'Upload failed. Your text is saved; retry the attachment.');
          }
          $('#dialog').close();await render();notice('Memory saved.'); break;
        }
        case 'plan': await api('/api/plan','PATCH',p);await render();notice('Life Check and succession settings saved.');break;
        case 'heir': await api(p.id?`/api/heirs/${p.id}`:'/api/heirs',p.id?'PATCH':'POST',p);$('#dialog').close();await render();notice('Loved one saved.');break;
        case 'activation': await api('/api/activations','POST',p);await render();notice('Submitted for independent review. No private content has been released.');break;
        case 'profile': await api('/api/account','PATCH',{name:p.name,preferences:p});account=await api('/api/account');notice('Profile, privacy and notification preferences saved.');break;
        case 'verify-email': await api('/api/account/email/verify','POST',p);account=await api('/api/account');await render();notice('Email verified.');break;
        case 'password': await api('/api/account/password','POST',p);f.reset();notice('Password updated. Other devices have been signed out.');break;
        case 'codes': {const d=await api('/api/account/recovery-codes','POST',p);f.reset();$('#generated-codes').hidden=false;$('#generated-codes').innerHTML=`<h2>Save these recovery codes now</h2><p>They are shown once. Keep them somewhere private and offline.</p><pre class="codes" id="codes">${d.codes.join('\n')}</pre>${button('Download codes','download-codes')}`;notice('New recovery codes created. Any older codes are now invalid.');break;}
        case 'delete-account': if(confirm('Close your account and revoke access now?')) {await api('/api/account','DELETE',p);location.href='/login';}break;
        case 'successor': await api(`/api/family/${familyId}/successors`,'POST',p);$('#dialog').close();notice('Successor nominated. An administrator can review and issue their verification invitation.');break;
        case 'review': await api(`/api/reviews/${p.kind}/${p.id}`,'POST',p);await render();notice('Review decision recorded.');break;
      }
    }); } catch(e) { notice(e.message,true); let err=$('.form-error',f);if(!err){err=document.createElement('p');err.className='form-error';err.setAttribute('role','alert');f.prepend(err);}err.textContent=e.message; }
  });
  (async()=>{try { account=await api('/api/account');document.querySelectorAll('[data-who]').forEach(e=>e.textContent=account.name||account.email);document.querySelectorAll('[data-admin]').forEach(e=>e.hidden=!account.admin);document.querySelectorAll('nav a').forEach(a=>{if(a.pathname===location.pathname)a.setAttribute('aria-current','page');});await render();}catch(e){notice(e.message,true);}})();
})();
