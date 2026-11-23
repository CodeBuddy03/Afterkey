(() => {
  'use strict';
  const $=s=>document.querySelector(s), box=$('#claim-content');
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const field=(name,label,type='text',extra='')=>`<div class="field"><label for="${name}">${label}</label><input id="${name}" name="${name}" type="${type}" ${extra}></div>`;
  const form=(id,html,label)=>`<form data-form="${id}">${html}<button class="btn compact" type="submit">${label}</button></form>`;
  let state;
  function notice(message,error=false) { const n=$('#notice');n.hidden=false;n.textContent=message;n.dataset.error=error; }
  async function api(path,method='GET',p) {
    const r=await fetch(path,{method,headers:method==='GET'?{}:{'Content-Type':'application/json'},body:method==='GET'?undefined:JSON.stringify(p??{})});
    let d;try{d=await r.json();}catch{throw Error('The server could not complete this step. Please try again.');}
    if(!r.ok)throw Error(d.detail||d.message||d.error||'Please try again.');return d;
  }
  function step(n) { document.querySelectorAll('.step-list li').forEach((li,i)=>{li.classList.toggle('current',i===n-1);if(i===n-1)li.setAttribute('aria-current','step');else li.removeAttribute('aria-current');}); }
  async function render() {
    state=await api('/api/claim/status');
    if(state.claimed) {step(6);box.innerHTML='<h2>The story continues with you.</h2><p>Your approved family space is ready. Keep these memories close, and return whenever you need.</p><a class="btn compact" href="/app/family">Continue the legacy</a>';return;}
    if(!state.verified) {
      step(2);box.innerHTML=`<h2>First, verify your own email.</h2><p>We will send a six-digit code to ${esc(state.email_hint)}. This confirms that the invitation reached the nominated person.</p><button class="btn btn--ghost compact" data-action="send">Send my code</button>${form('verify',field('code','Six-digit code','text','required pattern="[0-9]{6}" inputmode="numeric" autocomplete="one-time-code"'),'Verify email')}`;return;
    }
    if(state.identity_status==='unsubmitted'||state.identity_status==='rejected') {
      step(3);box.innerHTML=`<h2>Help us protect this legacy.</h2><p>A reviewer will independently confirm your identity and inheritance authority before you can continue.</p>${state.decision?`<div class="notice">Reviewer’s note: ${esc(state.decision)}</div>`:''}${form('identity',`${field('name','Your full legal name','text','required maxlength="120"')}${field('relationship','Your relationship to the owner','text','required maxlength="200"')}<div class="field"><label for="evidence">Verifiable identity and inheritance reference</label><textarea id="evidence" name="evidence" required minlength="20" maxlength="4000"></textarea></div><p>Provide a case or record reference and a way to verify it with the responsible professional or authority. Do not paste passwords, OTPs, or full identity document numbers.</p>`,'Submit for identity review')}`;return;
    }
    if(state.identity_status==='pending') {
      step(3);box.innerHTML='<h2>Your review is in careful hands.</h2><p>Your email is verified. Identity and inheritance verification are pending. No private content is available until approval.</p><p>You can return through your invitation later. You may be asked to verify your email again.</p><button class="btn compact" data-action="refresh">Check review status</button>';return;
    }
    step(4);box.innerHTML=`<h2>Your own account. Your own security.</h2><p>Your identity review is approved. Create an account with a new password of your own. If you already have an AfterKey account at the nominated email, <a class="text-link" href="/login" target="_blank" rel="noopener">sign in in a new tab</a>, then continue here.</p>${form('account',field('password','New password (only needed for a new account)','password','minlength="10" maxlength="200" autocomplete="new-password"'),'Create or connect my own account')}`;
  }
  function recovery() {
    step(4);box.innerHTML=`<h2>Keep a safe way back.</h2><p>Create recovery codes for your independent account. Keep them offline, away from your password. This replaces any previous recovery codes for your account.</p>${form('codes',field('password','Your own account password','password','required autocomplete="current-password"'),'Create recovery codes')}`;
  }
  document.addEventListener('click',async ev=>{
    const b=ev.target.closest('[data-action]');if(!b)return;b.disabled=true;
    try {
      if(b.dataset.action==='send'){await api('/api/claim/send','POST');notice('Your six-digit code has been sent. It expires in 10 minutes.');}
      if(b.dataset.action==='refresh')await render();
      if(b.dataset.action==='download') {const url=URL.createObjectURL(new Blob([$('#codes').textContent],{type:'text/plain'}));const a=document.createElement('a');a.href=url;a.download='afterkey-recovery-codes.txt';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
    }catch(e){notice(e.message,true);}finally{b.disabled=false;}
  });
  document.addEventListener('submit',async ev=>{
    const f=ev.target;if(!f.dataset.form)return;ev.preventDefault();const b=f.querySelector('[type=submit]');b.disabled=true;
    const p=Object.fromEntries(new FormData(f));
    try {
      if(f.dataset.form==='verify'){await api('/api/claim/verify','POST',p);await render();notice('Your email is verified.');}
      if(f.dataset.form==='identity'){await api('/api/claim/identity','POST',p);await render();notice('Your identity review has been submitted.');}
      if(f.dataset.form==='account'){await api('/api/claim/account','POST',p);recovery();notice('Your independent account is connected.');}
      if(f.dataset.form==='codes'){
        const d=await api('/api/account/recovery-codes','POST',p);step(5);
        box.innerHTML=`<h2>Save your recovery codes.</h2><p>These are shown once. Each code can be used once.</p><pre id="codes" class="codes">${d.codes.join('\n')}</pre><button class="btn btn--ghost compact" data-action="download">Download codes</button>${form('complete','<label class="check"><input type="checkbox" name="saved" required>I have stored my recovery codes safely.</label><label class="check"><input type="checkbox" name="confirm" required>I accept responsibility for the legacy entrusted to me.</label>','Claim this legacy')}`;
      }
      if(f.dataset.form==='complete'){await api('/api/claim/complete','POST',{confirm:!!p.confirm,recovery_confirm:!!p.saved});await render();notice('Your claim is complete.');}
    }catch(e){notice(e.message,true);}finally{b.disabled=false;}
  });
  (async()=>{
    try {
      const token=new URLSearchParams(location.hash.slice(1)).get('token')||new URLSearchParams(location.search).get('token');
      if(token){history.replaceState(null,'','/legacy');await api('/api/claim/open','POST',{token});}
      await render();
    }catch(e){step(1);box.innerHTML='<h2>Your invitation stays private.</h2><p>Open a current invitation from your email to begin. If you already claimed your legacy, sign in to your family spaces.</p>';notice(e.message,true);}
  })();
})();
