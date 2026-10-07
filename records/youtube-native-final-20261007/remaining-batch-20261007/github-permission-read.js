
const page = await browser.open('https://github.com/settings/installations/100252756');
try {
 const data = await page.evaluate(() => {
  const text = document.body?.innerText || '';
  const login = document.querySelector('meta[name=user-login]')?.content || '';
  const signedOut = /\/login(?:[/?]|$)/.test(location.pathname) || (!!document.querySelector('input[name=login]') && /sign in/i.test(text));
  if (signedOut) return {status:'BLOCKED_SIGN_IN_REQUIRED',urlOrigin:location.origin,path:location.pathname,loginPerformed:false,pullRequestsPermission:null,pendingPermissionUpdate:null};
  if (login !== 'ArietidsZ') return {status:login?'BLOCKED_NON_TARGET_ACCOUNT':'BLOCKED_ACCOUNT_NOT_VERIFIABLE',targetAccountVerified:false,pullRequestsPermission:null,pendingPermissionUpdate:null};
  const lines=text.split('\n').map(x=>x.trim()).filter(Boolean);
  const excerpts=[];
  for (let i=0;i<lines.length;i++) if (/pull requests|pending permission|permission update|review request|new permissions/i.test(lines[i])) excerpts.push(lines.slice(Math.max(0,i-1),i+3).join(' | '));
  const installationVisible=location.pathname==='/settings/installations/100252756' && !/page not found|404/.test(text);
  return {status:installationVisible?'READABLE':'BLOCKED_INSTALLATION_NOT_VISIBLE',targetAccountVerified:true,pullRequestsAndPendingExcerpts:excerpts.slice(0,10),settingsChanged:false};
 });
 return data;
} finally { await page.close(); }
