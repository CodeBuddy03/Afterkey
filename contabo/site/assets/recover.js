(() => {
  document.querySelector('#recover-form').addEventListener('submit',async e=>{
    e.preventDefault();const f=e.target,b=f.querySelector('button'),n=document.querySelector('#notice');b.disabled=true;
    try {
      const r=await fetch('/api/auth/recover',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.fromEntries(new FormData(f)))});
      const d=await r.json();if(!r.ok)throw Error(d.detail||'Recovery failed. Please check your details.');
      f.reset();n.textContent='Your password has been updated. You can now sign in. All previous sessions have been closed.';n.dataset.error=false;
    }catch(err){n.textContent=err.message;n.dataset.error=true;}finally{n.hidden=false;b.disabled=false;}
  });
})();
