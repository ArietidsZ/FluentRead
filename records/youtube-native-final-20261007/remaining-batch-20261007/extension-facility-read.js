
const page = await browser.open('chrome://extensions/');
try {
 return await page.evaluate(async () => {
  const manager=document.querySelector('extensions-manager');
  const developerMode=manager?.inDevMode ?? null;
  if (!chrome.developerPrivate?.getExtensionsInfo) return {status:'BLOCKED_EXTENSION_INFO_API_UNAVAILABLE',developerMode};
  const extensions=await new Promise(resolve=>chrome.developerPrivate.getExtensionsInfo({includeDisabled:true,includeTerminated:true},resolve));
  const own=extensions.filter(x=>/fluent.?read|流畅阅读/i.test(x.name)).map(x=>({id:x.id,name:x.name,version:x.version,state:x.state,type:x.type,location:x.location,unpackedPath:x.path||null}));
  return {status:'READ_ONLY',developerMode,fluentReadExtensions:own,settingsChanged:false};
 });
} finally { await page.close(); }
