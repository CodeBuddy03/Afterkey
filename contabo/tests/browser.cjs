const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const base='https://127.0.0.1:18443';
const output=process.env.AFTERKEY_TEST_OUTPUT||path.join(__dirname,'../test-results');
fs.mkdirSync(output,{recursive:true});
const password='Independent-password-123';
(async()=>{
 const browser=await chromium.launch({headless:true});
 const contexts=[];const errors=[];let checks=0;
 const context=async(viewport={width:1440,height:1000})=>{const c=await browser.newContext({ignoreHTTPSErrors:true,viewport});contexts.push(c);c.on('page',p=>p.on('pageerror',e=>errors.push(e.message)));return c;};
 const owner=await context(),reviewer=await context(),recipient=await context();
 const page=await owner.newPage(),rp=await reviewer.newPage(),cp=await recipient.newPage();
 async function login(p,email){await p.goto(base+'/login');await p.locator('#email').fill(email);await p.locator('#password').fill(password);await p.locator('[data-submit]').click();await p.waitForURL(base+'/app');await p.getByRole('heading',{name:'Your dashboard',exact:true}).waitFor();checks++;}
 async function visible(p,text){await p.getByText(text,{exact:false}).first().waitFor();checks++;}
 async function notice(p,text){await p.locator('#notice').filter({hasText:text}).waitFor();checks++;}
 async function submit(p,name){await p.getByRole('button',{name,exact:true}).click();}
 try {
  await login(page,'owner@example.test');
  await page.goto(base+'/app/vault');await submit(page,'Add a memory');
  await page.getByLabel('Title',{exact:true}).fill('A letter for tomorrow');
  await page.getByLabel('Category',{exact:true}).selectOption('message');
  await page.getByLabel('Your words or instructions').fill('PRIVATE FAMILY MEMORY — carried forward with care.');
  await page.getByLabel('Attachment (optional)').setInputFiles({name:'memory.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aCusAAAAASUVORK5CYII=','base64')});
  await submit(page,'Save memory');await notice(page,'Memory saved.');
  await page.reload();await visible(page,'A letter for tomorrow');
  await submit(page,'Open');await page.locator('dialog img').waitFor();
  assert(await page.locator('dialog img').evaluate(i=>i.complete&&i.naturalWidth>0));checks++;
  await submit(page,'Close');
  const download=page.waitForEvent('download');await page.getByRole('link',{name:'Download',exact:true}).click();assert.equal((await download).suggestedFilename(),'memory.png');checks++;
  await submit(page,'Edit');await page.getByLabel('Title',{exact:true}).fill('A letter for the next generation');await submit(page,'Save memory');await notice(page,'Memory saved.');
  await page.screenshot({path:path.join(output,'vault-desktop.png'),fullPage:true});
  await page.goto(base+'/app/legacy');await submit(page,'Choose a loved one');
  await page.getByLabel('Full name',{exact:true}).fill('Loved One');await page.getByLabel('Their own email address').fill('claimant@example.test');await page.getByLabel('Designate as a steward').check();await submit(page,'Save nomination');await notice(page,'Loved one saved.');
  const plan=page.locator('[data-form=plan]');await plan.locator('[name=frequency]').fill('14');await plan.locator('[name=grace]').fill('7');await plan.locator('[name=generation_enabled]').check();await plan.getByRole('button',{name:'Save changes'}).click();await notice(page,'Life Check and succession settings saved.');
  await submit(page,'I’m here — check in');await notice(page,'Your check-in is recorded.');
  await page.getByLabel('Circumstances requiring review').fill('Presentation fixture: independently supported activation request.');await page.getByLabel('Verifiable supporting record').fill('Presentation fixture: independent record and inheritance authority reference.');await submit(page,'Request independent review');await notice(page,'Submitted for independent review.');
  await login(rp,'reviewer@example.test');await rp.goto(base+'/app/reviews');
  let review=rp.locator('[data-form=review]').first();await review.locator('[name=death_evidence_checked]').check();await review.locator('[name=authority_checked]').check();await review.locator('[name=decision]').fill('Presentation fixture only: death record and legal authority independently checked.');await review.locator('[name=status]').selectOption('approved');await review.locator('[name=password]').fill(password);await review.getByRole('button',{name:'Record decision'}).click();await notice(rp,'Review decision recorded.');
  await submit(rp,'Send invitation');await notice(rp,'Invitation sent.');
  const mailbox=async()=> (await recipient.request.get(base+'/__test/mail')).json();
  let mail=(await mailbox()).find(m=>m.to==='claimant@example.test'&&m.text.includes('#token='));assert(mail);checks++;
  const token=mail.text.split('#token=')[1].split(/\s/)[0];
  await cp.goto(base+'/legacy#token='+token);await visible(cp,'First, verify your own email.');
  assert(!(await cp.textContent('body')).includes('PRIVATE FAMILY MEMORY'));checks++;
  await submit(cp,'Send my code');await notice(cp,'Your six-digit code has been sent.');
  mail=(await mailbox()).filter(m=>m.to==='claimant@example.test'&&m.text.includes('Your code is ')).at(-1);
  await cp.getByLabel('Six-digit code').fill(mail.text.split('Your code is ')[1].slice(0,6));await submit(cp,'Verify email');await visible(cp,'Help us protect this legacy.');
  await cp.getByLabel('Your full legal name').fill('Loved One');await cp.getByLabel('Your relationship to the owner').fill('Nominated family steward');await cp.getByLabel('Verifiable identity and inheritance reference').fill('Presentation fixture: independently verifiable identity and inheritance records.');await submit(cp,'Submit for identity review');await visible(cp,'Your review is in careful hands.');
  assert(!(await cp.textContent('body')).includes('PRIVATE FAMILY MEMORY'));checks++;
  await rp.reload();review=rp.locator('[data-form=review]').first();await review.locator('[name=identity_checked]').check();await review.locator('[name=authority_checked]').check();await review.locator('[name=decision]').fill('Presentation fixture only: identity and inheritance authority independently verified.');await review.locator('[name=status]').selectOption('approved');await review.locator('[name=password]').fill(password);await review.getByRole('button',{name:'Record decision'}).click();await notice(rp,'Review decision recorded.');
  await submit(cp,'Check review status');await visible(cp,'Your own account. Your own security.');
  await cp.getByLabel('New password (only needed for a new account)').fill(password);await submit(cp,'Create or connect my own account');await visible(cp,'Keep a safe way back.');
  await cp.getByLabel('Your own account password').fill(password);await submit(cp,'Create recovery codes');await visible(cp,'Save your recovery codes.');assert.equal((await cp.locator('#codes').textContent()).trim().split('\n').length,8);checks++;
  await cp.getByLabel('I have stored my recovery codes safely.').check();await cp.getByLabel('I accept responsibility').check();await submit(cp,'Claim this legacy');await visible(cp,'The story continues with you.');
  await cp.getByRole('link',{name:'Continue the legacy',exact:true}).click();await cp.getByRole('link',{name:'Open family space',exact:true}).click();await visible(cp,'PRIVATE FAMILY MEMORY');
  await submit(cp,'Nominate next generation');await cp.getByLabel('Full name',{exact:true}).fill('Next Generation');await cp.getByLabel('Their own email address').fill('next@example.test');await submit(cp,'Save nomination');await notice(cp,'Successor nominated.');
  await page.goto(base+'/app/settings');await page.getByLabel('Your name',{exact:true}).fill('A family storyteller');await page.locator('[data-form=profile]').getByRole('button',{name:'Save changes'}).click();await notice(page,'Profile, privacy and notification preferences saved.');
  await page.goto(base+'/app/recovery');await page.getByLabel('Confirm your password',{exact:true}).fill(password);await submit(page,'Generate recovery codes');await visible(page,'Save these recovery codes now');
  await page.goto(base+'/app');await page.getByRole('heading',{name:'Your dashboard'}).waitFor();await page.locator('.stats').waitFor();await page.screenshot({path:path.join(output,'dashboard-desktop.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});await page.reload();await submit(page,'Menu');await page.locator('#mobile-menu').getByRole('link',{name:'Legacy Management',exact:true}).click();await page.getByRole('heading',{name:'Legacy Management',exact:true}).waitFor();
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));checks++;
  await page.locator('[data-form=plan]').waitFor();await page.screenshot({path:path.join(output,'legacy-mobile.png'),fullPage:true});
  for(const url of ['/app/vault','/app/settings','/app/recovery','/app/family']){await page.goto(base+url);await page.locator('#content section, #content .panel').first().waitFor();assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),url+' mobile overflow');checks++;}
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({passed:true,checks,browserErrors:errors,screenshots:output}));
 } catch(e) {await page.screenshot({path:path.join(output,'failure-owner.png'),fullPage:true});await cp.screenshot({path:path.join(output,'failure-claim.png'),fullPage:true});console.error(e);process.exitCode=1;}
 finally{await browser.close();}
})();
