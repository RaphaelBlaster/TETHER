import{i as e,r as t,t as n}from"./assets/panel-state-model-Dg-iAPTJ.js";var r=[{id:`chatgpt`,label:`ChatGPT`,origins:[`https://chatgpt.com`,`https://chat.openai.com`],hostPatterns:[/^chatgpt\.com$/i,/^chat\.openai\.com$/i],composerHints:[`#prompt-textarea`,`div#prompt-textarea.ProseMirror`,`[data-testid="prompt-textarea"]`,`[contenteditable='true'][role='textbox']`,`form [contenteditable="true"]`],submitHints:[`button#composer-submit-button`,`#composer-submit-button`,`button[data-testid="send-button"]`,`button[data-testid="fruitjuice-send-button"]`,`button[aria-label='Send prompt']`,`button[aria-label="Send prompt"]`,`button[type="submit"]`],stopHints:[`button[data-testid="stop-button"]`,`button[aria-label="Stop streaming"]`,`button[aria-label*="Stop"]`],assistantHints:[`[data-message-author-role="assistant"]`,`[data-turn="assistant"]`,`article[data-turn="assistant"]`],userHints:[`[data-message-author-role="user"]`,`[data-turn="user"]`]},{id:`gemini`,label:`Gemini`,origins:[`https://gemini.google.com`],hostPatterns:[/^gemini\.google\.com$/i],composerHints:[`div.ql-editor[contenteditable="true"]`,`rich-textarea [contenteditable="true"]`,`[contenteditable="true"][aria-label*="prompt" i]`,`[contenteditable="true"][aria-label*="Enter" i]`,`div[contenteditable="true"]`],submitHints:[`button[aria-label*="Send" i]`,`button.send-button`,`button[mattooltip*="Send" i]`,`button[type="submit"]`],stopHints:[`button[aria-label*="Stop" i]`,`button[aria-label*="Cancel" i]`],assistantHints:[`model-response`,`.model-response-text`,`[data-message-author-role="model"]`,`.response-container`],userHints:[`.user-query`,`[data-message-author-role="user"]`]},{id:`deepseek`,label:`DeepSeek`,origins:[`https://chat.deepseek.com`],hostPatterns:[/^chat\.deepseek\.com$/i],composerHints:[`textarea`,`[contenteditable="true"]`,`textarea#chat-input`,`.chat-input textarea`],submitHints:[`button[type="submit"]`,`div[role="button"][aria-label*="Send" i]`,`button[aria-label*="Send" i]`,`.send-button`],stopHints:[`button[aria-label*="Stop" i]`],assistantHints:[`.ds-markdown`,`.message-assistant`,`[class*="assistant"]`],userHints:[`.message-user`,`[class*="user"]`]},{id:`claude`,label:`Claude`,origins:[`https://claude.ai`],hostPatterns:[/^claude\.ai$/i],composerHints:[`div[contenteditable="true"].ProseMirror`,`div[contenteditable="true"][translate="no"]`,`fieldset [contenteditable="true"]`,`[contenteditable="true"]`],submitHints:[`button[aria-label="Send Message"]`,`button[aria-label*="Send" i]`,`button[type="submit"]`],stopHints:[`button[aria-label*="Stop" i]`,`button[aria-label*="Interrupt" i]`],assistantHints:[`[data-is-streaming]`,`.font-claude-message`,`[data-test-render-count]`],userHints:[`.font-user-message`]}];function i(e){return r.find(t=>t.id===e)||null}function a(e){let t=``,n=``;try{let r=new URL(e);t=r.hostname,n=r.origin}catch{return null}for(let e of r)if(e.origins?.some(e=>e===n)||e.hostPatterns?.some(e=>e.test(t)))return e;return null}function o(){return[`textarea`,`input[type="text"]`,`input:not([type])`,`[contenteditable="true"]`,`[role="textbox"]`]}function s(){return[`button[type="submit"]`,`button#composer-submit-button`,`#composer-submit-button`,`button[aria-label="Send prompt"]`,`button[aria-label*="Send" i]`,`button[aria-label*="Submit" i]`,`button[title*="Send" i]`,`[role="button"][aria-label*="Send" i]`]}var c=new Set([`https://chromewebstore.google.com`,`https://chrome.google.com`,`https://microsoftedge.microsoft.com`]);function l(e){let t;try{t=new URL(e)}catch{return{kind:`restricted`,reason:`invalid_url`}}if(![`http:`,`https:`].includes(t.protocol)||c.has(t.origin))return{kind:`restricted`,reason:`browser_restricted`};let n=a(t.href),r=n?.id===`chatgpt`&&/^\/c\/([^/?#]+)/.exec(t.pathname)?.[1]?decodeURIComponent(/^\/c\/([^/?#]+)/.exec(t.pathname)[1]):null;return{kind:`web`,origin:t.origin,permissionPattern:`${t.origin}/*`,calibrationKey:t.origin,providerId:n?.id??`site:${t.origin}`,label:n?.label??t.hostname,conversationId:r,hasAdapter:!!n,providerKind:n?`llm`:`generic`}}function u(e){let t=l(e);return t.kind===`web`?t:null}var d=`browserSessions`,f=`tetherSessionSchemaVersion`,p=`tabAttachments`,m=class extends Error{constructor(e,t){super(t),this.name=`BrowserSessionError`,this.code=e}};function h({storage:e,getTab:t,uuid:n=()=>crypto.randomUUID(),now:r=()=>Date.now()}={}){let i={},a=new Map;function o(){a=new Map;for(let e of Object.values(i))a.set(e.tabId,e.browserSessionId)}async function s(){await e.set({[f]:1,[d]:i})}async function c(){let t=await e.get([f,d,p]);return i=t.tetherSessionSchemaVersion===1?t.browserSessions??{}:{},await e.remove(p),await l(),C()}async function l(){let e={},n=new Set;for(let a of Object.values(i))if(!(!g(a)||n.has(a.tabId)))try{let i=await t(a.tabId),o=u(i?.url);if(!o||o.providerId!==a.providerId||o.origin!==a.origin)continue;n.add(a.tabId),e[a.browserSessionId]={...a,transportMode:a.transportMode===`CROSS`?`CROSS`:`CLI`,role:a.transportMode===`CROSS`&&a.role===`SLAVE`?`SLAVE`:a.transportMode===`CROSS`?`MASTER`:`ENDPOINT`,windowId:i.windowId,conversationId:o.conversationId,lastSeenAt:r()}}catch{}return i=e,o(),await s(),C()}async function h(e,t,o,c={}){if(!Number.isInteger(e?.id)||!Number.isInteger(e?.windowId))throw new m(`invalid_tab`,`No valid browser tab is available`);let l=c.transportMode===`CROSS`?`CROSS`:`CLI`,d=l===`CROSS`&&c.role===`SLAVE`?`SLAVE`:l===`CROSS`?`MASTER`:`ENDPOINT`,f=x(e.id);if(f){let e={...f,transportMode:l,role:d,lastSeenAt:r()};return i={...i,[e.browserSessionId]:e},await s(),e}let p=C();if(l===`CROSS`&&p.length>=2)throw new m(`cross_pair_complete`,`CROSS already has its MASTER and SLAVE endpoints`);if(l===`CROSS`&&p.some(e=>e.transportMode===`CROSS`&&e.role===d))throw new m(`cross_role_taken`,`CROSS already has a ${d} endpoint`);let h=u(e.url);if(!h)throw new m(`restricted_tab`,`This browser page does not allow TETHER access`);let g=t[h.calibrationKey];if(!h.hasAdapter&&(!g||g.version!==1))throw new m(`calibration_required`,`This site must be calibrated first`);if(!h.hasAdapter&&!o?.valid)throw new m(`calibration_invalid`,`The saved controls must be validated before activation`);let _=r(),v=n(),y={schemaVersion:1,browserSessionId:v,tabId:e.id,windowId:e.windowId,providerId:h.providerId,origin:h.origin,conversationId:h.conversationId,calibrationKey:h.calibrationKey,transportMode:l,role:d,status:`active`,createdAt:_,lastSeenAt:_};return i={...i,[v]:y},a.set(e.id,v),await s(),y}async function _(e,t=()=>`ENDPOINT`){let n=e===`CROSS`?`CROSS`:`CLI`,a=C();if(n===`CLI`&&a.length>1)throw new m(`multiple_cli_endpoints`,`Deactivate all but one endpoint before switching to CLI mode`);if(n===`CROSS`&&a.length>2)throw new m(`too_many_cross_endpoints`,`CROSS supports exactly one MASTER and one SLAVE endpoint`);let c=a.map(e=>n===`CROSS`?t(e):`ENDPOINT`);if(n===`CROSS`&&new Set(c).size!==c.length)throw new m(`duplicate_cross_role`,`CROSS requires one LLM MASTER and one non-LLM SLAVE`);return i=Object.fromEntries(a.map((e,t)=>[e.browserSessionId,{...e,transportMode:n,role:c[t],lastSeenAt:r()}])),o(),await s(),C()}async function v(e,t){let n=x(e);if(!n)throw new m(`inactive_session`,`Activate this tab before changing its CROSS role`);if(n.transportMode!==`CROSS`)throw new m(`invalid_mode`,`Only CROSS endpoints have MASTER or SLAVE roles`);if(![`MASTER`,`SLAVE`].includes(t))throw new m(`invalid_role`,`Choose MASTER or SLAVE`);if(C().some(n=>n.tabId!==e&&n.transportMode===`CROSS`&&n.role===t))throw new m(`cross_role_taken`,`CROSS already has a ${t} endpoint`);let a={...n,role:t,lastSeenAt:r()};return i={...i,[a.browserSessionId]:a},await s(),a}async function y(e){let t=x(e?.id);if(!t)return null;let n=u(e.url);if(!n||n.providerId!==t.providerId||n.origin!==t.origin)return await b(e.id),null;let a={...t,windowId:e.windowId,conversationId:n.conversationId,lastSeenAt:r()};return i={...i,[a.browserSessionId]:a},await s(),a}async function b(e){let t=x(e);if(!t)return!1;let n={...i};return delete n[t.browserSessionId],i=n,a.delete(e),await s(),!0}function ee(e,t){let n=i[e];if(!n)throw new m(`unknown_session`,`Unknown browser session`);if(n.tabId!==t)throw new m(`session_tab_mismatch`,`Browser session does not belong to sender tab`);return n}function x(e){let t=a.get(e);return t?i[t]??null:null}function S(e){return i[e]??null}function C(){return Object.values(i)}return{initialize:c,reconcile:l,activate:h,configureMode:_,setRole:v,updateTab:y,removeByTabId:b,assertSender:ee,getByTabId:x,getById:S,list:C}}function g(e){return!!(e&&e.schemaVersion===1&&typeof e.browserSessionId==`string`&&e.browserSessionId&&Number.isInteger(e.tabId)&&Number.isInteger(e.windowId)&&typeof e.providerId==`string`&&typeof e.origin==`string`&&typeof e.calibrationKey==`string`&&e.status===`active`&&Number.isFinite(e.createdAt)&&Number.isFinite(e.lastSeenAt))}var _=`tether-extension`,v=`tetherExtensionInstanceId`,y=`TETHER_EXTENSION_ADAPTER_OK`;async function b(e,t=()=>crypto.randomUUID()){let n=(await e.get(v))[v];if(O(n))return n;let r=t();if(!O(r))throw Error(`Generated extension instance ID is invalid`);return await e.set({[v]:r}),r}function ee(e,t,n){if(![`hello`,`sessions_changed`].includes(e)||!O(t))throw Error(`Invalid extension registration`);return{protocol:_,version:1,type:e,extensionInstanceId:t,sessions:n.filter(e=>e.status===`active`).map(ne)}}function x(e){if(typeof e!=`string`||e.length>16777216)throw Error(`Message must be bounded text`);let t=JSON.parse(e);if(!re(t)||t.protocol!==`tether-extension`||t.version!==1)throw Error(`Unsupported TETHER extension message`);if(t.type===`ping`&&O(t.requestId)||t.type===`test_request`&&O(t.requestId)&&O(t.browserSessionId)&&t.payload?.message===`TETHER_ADAPTER_EXTENSION_CHECK`||t.type===`browser_request`&&O(t.requestId)&&O(t.browserSessionId)&&re(t.payload)&&typeof t.payload.prompt==`string`&&t.payload.prompt.length>0&&t.payload.prompt.length<=16777216&&typeof t.payload.installBootstrap==`boolean`||t.type===`browser_cancel`&&O(t.requestId)&&O(t.browserSessionId))return t;throw Error(`Unsupported TETHER extension message`)}function S(e){return D(`pong`,{requestId:e})}function C(e,t){return D(`test_completed`,{requestId:e,browserSessionId:t,payload:{message:y}})}function w(e,t,n){return D(`test_error`,{requestId:e,browserSessionId:t,error:{code:n?.code??`test_request_failed`,message:(n instanceof Error?n.message:String(n||`Test request failed`)).slice(0,1024)}})}function T(e,t,n){if(typeof n!=`string`||n.length>16777216)throw Error(`Browser response must be bounded text`);return D(`browser_completed`,{requestId:e,browserSessionId:t,payload:{text:n}})}function E(e,t,n){return D(`browser_error`,{requestId:e,browserSessionId:t,error:{code:n?.code??`browser_request_failed`,message:(n instanceof Error?n.message:String(n||`Browser request failed`)).slice(0,1024)}})}function te(e,t,n){return`${e}\u0000${t}\u0000${n}`}function ne(e){return{browserSessionId:e.browserSessionId,tabId:e.tabId,origin:e.origin,providerId:e.providerId,conversationId:e.conversationId??null,transportMode:e.transportMode===`CROSS`?`CROSS`:`CLI`,role:e.transportMode===`CROSS`&&e.role===`SLAVE`?`SLAVE`:e.transportMode===`CROSS`?`MASTER`:`ENDPOINT`}}function D(e,t){return{protocol:_,version:1,type:e,...t}}function O(e){return typeof e==`string`&&e.length>0&&e.length<=128}function re(e){return typeof e==`object`&&!!e&&!Array.isArray(e)}var k=Object.freeze({CONNECTING:`connecting`,CONNECTED:`connected`,RETRYING:`retrying`}),ie=[500,1e3,2e3,4e3,1e4],ae=128;function oe({url:e=`ws://127.0.0.1:8766/tether/extension`,createSocket:t=e=>new WebSocket(e),schedule:n=setTimeout,cancelSchedule:r=clearTimeout,retryDelays:i=ie,getRegistration:a=async()=>{throw Error(`Browser sessions are not initialized`)},onTestRequest:o=async()=>{},onBrowserRequest:s=async()=>{throw Error(`Browser request handler is unavailable`)},onStateChange:c=()=>{}}={}){let l=null,u=null,d=0,f=k.RETRYING,p=null,m=new Map,h=new Map;function g(e){f=e,c(e)}function _(){u!==null&&(r(u),u=null)}function v(){if(u!==null)return;g(k.RETRYING);let e=i[Math.min(d,i.length-1)];d+=1,u=n(()=>{u=null,O()},e)}async function y(e,t){let n=await a();return l===e?(p=n,e.send(JSON.stringify(ee(t,n.extensionInstanceId,n.sessions))),!0):!1}function b(e,t){for(h.set(e,t);h.size>ae;)h.delete(h.keys().next().value)}function ne(e,t){l===e&&e.send(JSON.stringify(t))}function D(e,t){let n=p;if(!n)throw Error(`Extension registration is unavailable`);let r=te(n.extensionInstanceId,t.browserSessionId,t.requestId);if(t.type===`browser_cancel`){let e=m.get(r);e&&(m.delete(r),e.controller.abort());return}let i=h.get(r);if(i){ne(e,i);return}if(m.has(r))return;let a=new AbortController,c=Promise.resolve(t.type===`test_request`?o(t,n):s(t,n,{signal:a.signal})).then(e=>t.type===`test_request`?C(t.requestId,t.browserSessionId):T(t.requestId,t.browserSessionId,e),e=>t.type===`test_request`?w(t.requestId,t.browserSessionId,e):E(t.requestId,t.browserSessionId,e)).then(t=>{m.get(r)?.operation===c&&(m.delete(r),b(r,t),ne(e,t))});m.set(r,{operation:c,controller:a})}function O(){_();let n=l;l=null,n?.close(),p=null,A();let r=t(e);l=r,g(k.CONNECTING),r.addEventListener(`open`,()=>{l===r&&(d=0,y(r,`hello`).then(e=>{e&&g(k.CONNECTED)},()=>{l===r&&r.close(1011,`Registration failed`)}))}),r.addEventListener(`message`,e=>{if(l===r)try{let t=x(e.data);t.type===`ping`?ne(r,S(t.requestId)):D(r,t)}catch{r.close(1002,`Invalid TETHER extension message`)}}),r.addEventListener(`close`,()=>{l===r&&(l=null,p=null,A(),v())}),r.addEventListener(`error`,()=>{l===r&&r.close()})}async function re(){let e=l;return!e||f!==k.CONNECTED?!1:y(e,`sessions_changed`)}function oe(){_();let e=l;l=null,p=null,A(),e?.close()}return{connect:O,getState:()=>f,sessionsChanged:re,stop:oe};function A(){for(let e of m.values())e.controller.abort();m.clear()}}function A(e,t){return e?e.version!==1||e.origin!==t||!le(e.composer)||!le(e.send)||e.responseCalibration!=null&&!se(e.responseCalibration)?ue(`schema_invalid`,{loaded:!0,profile:e}):ue(`stored`,{loaded:!0,profile:e}):ue(`missing`)}function se(e){return!!(e&&e.version===1&&e.sampleCount===3&&le(e.conversationRoot)&&ce(e.assistantTurn)&&ce(e.assistantContent))}function ce(e){return!!(e&&e.version===1&&typeof e.tagName==`string`&&e.tagName&&e.attributes&&typeof e.attributes==`object`&&typeof e.primarySelector==`string`&&e.primarySelector&&Array.isArray(e.fallbackSelectors)&&Number.isInteger(e.expectedMatchCount)&&e.expectedMatchCount>=1)}function le(e){return!!(e&&e.version===1&&typeof e.tagName==`string`&&e.tagName&&e.attributes&&typeof e.attributes==`object`&&typeof e.primarySelector==`string`&&Array.isArray(e.fallbackSelectors)&&Array.isArray(e.ancestorChain))}function ue(e,t={}){return{code:e,valid:!1,loaded:!1,composerResolved:!1,sendResolved:!1,...t}}var de=`calibrationProfiles`,fe=`activeCalibration`,pe=[`starting`,`selecting_composer`,`selecting_send`,`validating_new_profile`],me=[`idle`,`complete`,`cancelled`,`failed`];function he({injectContentScript:e,sendTabMessage:t,loadProfiles:n,saveProfiles:r,loadActiveOperation:i=async()=>null,saveActiveOperation:a=async()=>{},clearActiveOperation:o=async()=>{},getPageState:s=async()=>null,publish:c=()=>{}}){let l=ge();async function u(e){return l={...l,...e},c(l),pe.includes(l.stage)?await a({requestId:l.requestId,tabId:l.tabId,origin:l.origin,mode:l.mode,startedAt:l.startedAt,stage:l.stage}):await o(),l}async function d(){let e=await i();if(!ve(e))return await o(),l;l={...ge(),...e,error:null},c(l);try{let t=await s(e.tabId);return!t?.active||t.requestId!==e.requestId||![`selecting_composer`,`selecting_send`].includes(t.stage)?u({...j(`failed`),error:`Calibration could not be recovered after worker restart`}):u({stage:t.stage,error:null})}catch{return u({...j(`failed`),error:`Calibration page is no longer available`})}}async function f({requestId:n,tab:r,origin:i,mode:a=`replace`}){if(_e({requestId:n,tab:r,origin:i,mode:a}),pe.includes(l.stage)){if(l.tabId===r.id)return l;throw Error(`Another calibration is already active in a different tab`)}if(!me.includes(l.stage))throw Error(`Calibration cannot start from its current state`);try{await u({stage:`starting`,requestId:n,tabId:r.id,origin:i,mode:a,startedAt:Date.now(),error:null,profile:null}),await e(r.id);let o=await t(r.id,{type:`calibration.start`,requestId:n,origin:i,mode:a});if(!o?.ok)throw Error(o?.error??`The page integration could not be started`);return u({stage:`selecting_composer`,error:null})}catch(e){throw await u({...j(`failed`),error:ye(e)}),e}}async function p(e=l.requestId){let{tabId:n}=l;return Number.isInteger(n)&&await t(n,{type:`calibration.cancel`,requestId:e}).catch(()=>{}),u({...j(`cancelled`),error:null})}async function m(e,t){if(t!==l.tabId||e.requestId!==l.requestId)return l;if(e.stage===`complete`){await u({stage:`validating_new_profile`,error:null});let t=e.profile;if(A(t,l.origin).code!==`stored`)return u({...j(`failed`),error:`The page returned an invalid calibration profile`});try{return await r({...await n(),[l.origin]:t}),u({...j(`complete`),error:null,profile:t})}catch(e){return u({...j(`failed`),error:e instanceof Error?e.message:`The replacement calibration could not be saved`})}}return e.stage===`failed`||e.stage===`cancelled`?u({...j(e.stage),error:e.error??null}):e.stage===`selection_rejected`&&[`selecting_composer`,`selecting_send`].includes(e.calibrationStage)?u({stage:e.calibrationStage,error:e.error??`Choose a different element`}):[`selecting_composer`,`selecting_send`].includes(e.stage)?u({stage:e.stage,error:null}):l}function h(e){return e===l.tabId?u({...j(`failed`),error:`The calibrated tab was closed`}):Promise.resolve(l)}function g(e,t){return e===l.tabId&&(t.status===`loading`||t.url)?u({...j(`failed`),error:`The calibrated tab navigated`}):Promise.resolve(l)}return{restore:d,start:f,cancel:p,handlePageState:m,handleTabRemoved:h,handleTabUpdated:g,getState:()=>l}}function ge(){return{stage:`idle`,requestId:null,tabId:null,origin:null,mode:null,startedAt:null,error:null,profile:null}}function j(e){return{stage:e,requestId:null,tabId:null,origin:null,mode:null,startedAt:null}}function _e({requestId:e,tab:t,origin:n,mode:r}){if(typeof e!=`string`||e.length===0||e.length>128)throw Error(`A valid calibration request ID is required`);if(!Number.isInteger(t?.id)||t.url==null)throw Error(`No valid browser tab is available`);if(new URL(t.url).origin!==n)throw Error(`The selected tab changed before calibration started`);if(r!==`replace`)throw Error(`Unsupported calibration mode`)}function ve(e){return!!(e&&typeof e.requestId==`string`&&Number.isInteger(e.tabId)&&typeof e.origin==`string`&&e.mode===`replace`&&pe.includes(e.stage))}function ye(e){let t=e instanceof Error?e.message:String(e);return/Cannot access|chrome:\/\/|edge:\/\/|Cannot use import statement/i.test(t)?`The page integration could not be started. Reload the page and try again.`:/Receiving end does not exist|Could not establish connection/i.test(t)?`The page integration could not be reached. Reload the page and try again.`:t||`Calibration could not start`}function be({resolvePanelTab:e,inspectSite:t,hasAccess:n,assertAvailable:r=()=>{},start:i}){return async function(a,o){let s=await e(o),c=t(s?.url);if(c.kind!==`web`)throw Error(`TETHER cannot access this browser page`);if(!await n(c.origin))throw Error(`Permission is required for this site`);return r(s),i({requestId:a.requestId,tab:s,origin:c.origin,mode:`replace`})}}function xe({sidePanel:e,hasSession:t}){let n=new Map;async function r(t,r=[]){await e.setOptions({enabled:!1});for(let n of t)await e.setOptions({tabId:n.tabId,path:`index.html`,enabled:!0});for(let e of r)Number.isInteger(e?.windowId)&&Number.isInteger(e?.id)&&n.set(e.windowId,e.id)}function i(t){if(!Number.isInteger(t?.id)||!Number.isInteger(t?.windowId))return Promise.reject(Error(`No active tab is available`));n.set(t.windowId,t.id);let r=e.setOptions({tabId:t.id,path:`index.html`,enabled:!0}),i=e.open({tabId:t.id});return Promise.all([r,i])}async function a({tabId:r,windowId:i}){let a=n.get(i);n.set(i,r),Number.isInteger(a)&&a!==r&&!t(a)&&await e.setOptions({tabId:a,enabled:!1}).catch(()=>{}),await e.setOptions({tabId:r,path:`index.html`,enabled:t(r)})}function o(t){return e.setOptions({tabId:t.tabId,path:`index.html`,enabled:!0})}function s(t){return[...n.values()].includes(t)?Promise.resolve():e.setOptions({tabId:t,enabled:!1}).catch(()=>{})}function c(e){for(let[t,r]of n)r===e&&n.delete(t)}return{initialize:r,openManually:i,handleActivated:a,sessionActivated:o,sessionRemoved:s,handleRemoved:c}}var Se=1e6,M=class extends Error{constructor(e,t){super(t),this.name=`InjectionCoordinatorError`,this.code=e}};function Ce({sendTabMessage:e,publish:t=()=>{},timeoutMs:n=12e3,setTimer:r=setTimeout,clearTimer:i=clearTimeout,now:a=()=>Date.now()}){let o=new Map,s=new Map,c=new Map;function l({requestId:l,session:u,profile:d,text:f}){we({requestId:l,session:u,profile:d,text:f});let p=o.get(u.browserSessionId);if(p)return p.requestId===l?p.promise:Promise.reject(new M(`session_busy`,`This browser session is already injecting a test message`));let m=s.get(u.browserSessionId);if(m?.requestId===l)return m.ok?Promise.resolve(m.value):Promise.reject(m.error);let h,g=!1,_=new Promise((t,n)=>{h=(t=`cancelled`)=>{g||(g=!0,e(u.tabId,{type:`injection.cancel`,requestId:l}).catch(()=>{}),n(new M(t,Te(t))))}}),v,y=new Promise((t,i)=>{v=r(()=>{e(u.tabId,{type:`injection.cancel`,requestId:l}).catch(()=>{}),i(new M(`injection_timeout`,`Test-message injection timed out`))},n)}),b={requestId:l,browserSessionId:u.browserSessionId,tabId:u.tabId,origin:u.origin,stage:`injecting`,startedAt:a()};t(b),c.set(u.browserSessionId,b);let ee=e(u.tabId,{type:`injection.execute`,requestId:l,browserSessionId:u.browserSessionId,origin:u.origin,profile:d,text:f}).then(e=>{if(!e?.ok)throw new M(e?.code??`injection_failed`,e?.error??`Test-message injection failed`);return{...b,stage:`complete`,result:e.result}}),x=Promise.race([ee,_,y]).then(e=>(s.set(u.browserSessionId,{requestId:l,ok:!0,value:e}),c.set(u.browserSessionId,e),t(e),e),e=>{let n=e instanceof M?e:new M(`injection_failed`,e instanceof Error?e.message:String(e));s.set(u.browserSessionId,{requestId:l,ok:!1,error:n});let r={...b,stage:n.code===`cancelled`?`cancelled`:`failed`,error:n.message};throw c.set(u.browserSessionId,r),t(r),n}).finally(()=>{i(v),o.get(u.browserSessionId)?.requestId===l&&o.delete(u.browserSessionId)});return o.set(u.browserSessionId,{...b,promise:x,cancel:h}),x}function u(e,t=`cancelled`){let n=o.get(e);return n?(n.cancel(t),!0):!1}function d(e,t=`cancelled`){for(let n of o.values())n.tabId===e&&n.cancel(t)}function f(e){let t=[...o.values()].find(t=>t.tabId===e);return t?{requestId:t.requestId,browserSessionId:t.browserSessionId,tabId:t.tabId,origin:t.origin,stage:t.stage,startedAt:t.startedAt}:null}function p(e){return c.get(e)??null}return{start:l,cancelBySessionId:u,cancelByTabId:d,getByTabId:f,getBySessionId:p}}function we({requestId:e,session:t,profile:n,text:r}){if(typeof e!=`string`||e.length===0||e.length>128)throw new M(`invalid_request_id`,`A valid injection request ID is required`);if(!t?.browserSessionId||!Number.isInteger(t.tabId)||!t.origin)throw new M(`invalid_session`,`A valid activated browser session is required`);if(!n||n.origin!==t.origin||n.version!==1)throw new M(`calibration_mismatch`,`The calibration profile does not belong to this browser session`);if(typeof r!=`string`||r.trim().length===0)throw new M(`empty_text`,`Enter a plain-text test message`);if(r.length>1e6)throw new M(`text_too_large`,`Test message exceeds ${Se} characters`)}function Te(e){return e===`tab_closed`?`The owning browser tab was closed`:e===`tab_navigated`?`The owning browser tab navigated`:e===`session_deactivated`?`TETHER was deactivated for the owning tab`:`Test-message injection was cancelled`}function Ee({sendTabMessage:e,publish:t=()=>{}}){let n=new Map,r=new Map;async function i({requestId:i,session:a,profile:o,text:s}){let c=r.get(a.browserSessionId);if(c){if(c.requestId===i)return c.promise;throw De(`session_busy`,`This browser session is already observing a response`)}let l={requestId:i,browserSessionId:a.browserSessionId,tabId:a.tabId,stage:`observing`,text:null,error:null};n.set(a.browserSessionId,l),t(l);let u,d=e(a.tabId,{type:`extraction.execute.v2`,requestId:i,browserSessionId:a.browserSessionId,origin:a.origin,profile:o,text:s}).then(e=>{if(!e?.ok)throw De(e?.code,e?.error);let r={...l,stage:`complete`,result:e.result};return n.set(a.browserSessionId,r),t(r),r},e=>{throw e}).catch(e=>{let r={...l,stage:e?.code===`cancelled`?`cancelled`:`failed`,error:e.message};throw n.set(a.browserSessionId,r),t(r),e}).finally(()=>{r.get(a.browserSessionId)===u&&r.delete(a.browserSessionId)});return u={...l,promise:d},r.set(a.browserSessionId,u),d}function a(i,a=`cancelled`){let o=r.get(i);if(!o)return!1;r.delete(i),e(o.tabId,{type:`extraction.cancel.v2`,requestId:o.requestId}).catch(()=>{});let s={...o,stage:`cancelled`,error:a};return n.set(i,s),t(s),!0}function o(e,t){for(let n of r.values())n.tabId===e&&a(n.browserSessionId,t)}return{start:i,cancelBySessionId:a,cancelByTabId:o,getBySessionId:e=>n.get(e)??null}}function De(e=`extraction_failed`,t=`Response extraction failed`){return Object.assign(Error(t),{code:e})}var Oe=class extends Error{constructor(e,t,n={}){super(t),this.name=`AutomationError`,this.code=e,this.diagnostics=ke(n)}};function ke(e){if(!e||typeof e!=`object`)return{};let t={};for(let[n,r]of Object.entries(e))if(r!=null)if(typeof r==`string`)t[n]=r.slice(0,500);else if(typeof r==`number`||typeof r==`boolean`)t[n]=r;else if(Array.isArray(r))t[n]=r.slice(0,20).map(e=>typeof e==`string`?e.slice(0,200):e);else try{t[n]=JSON.parse(JSON.stringify(r))}catch{t[n]=String(r).slice(0,200)}return t}var N=Object.freeze({NO_ACTIVE_SESSION:`no_active_session`,MULTIPLE_ACTIVE_SESSIONS:`multiple_active_sessions`,INACTIVE_SESSION:`inactive_session`,TAB_UNAVAILABLE:`tab_unavailable`,DEBUGGER_ATTACH_FAILED:`debugger_attach_failed`,DEBUGGER_DETACHED:`debugger_detached`,COMPOSER_NOT_FOUND:`composer_not_found`,COMPOSER_NOT_EDITABLE:`composer_not_editable`,PROMPT_WRITE_FAILED:`prompt_write_failed`,PROMPT_VERIFICATION_FAILED:`prompt_verification_failed`,SEND_NOT_FOUND:`send_not_found`,SEND_NOT_ACTIONABLE:`send_not_actionable`,SUBMISSION_NOT_OBSERVED:`submission_not_observed`,ASSISTANT_RESPONSE_NOT_FOUND:`assistant_response_not_found`,RESPONSE_TIMEOUT:`response_timeout`,OPERATION_CANCELLED:`operation_cancelled`,ADAPTER_DISCONNECTED:`adapter_disconnected`});function Ae(e){async function t(t,n,r={}){let i=await e.sendCommand(t,`Runtime.evaluate`,{expression:n,returnByValue:!0,awaitPromise:!0,userGesture:!0,...r});if(i?.exceptionDetails){let e=i.exceptionDetails.exception?.description||i.exceptionDetails.text||`Runtime.evaluate failed`,t=Error(e);throw t.code=`cdp_evaluate_failed`,t}return i?.result?.value}async function n(t,n){await e.sendCommand(t,`Input.insertText`,{text:n})}async function r(t,n){await e.sendCommand(t,`Input.dispatchKeyEvent`,n)}async function i(e,t){let i={key:`Control`,code:`ControlLeft`,windowsVirtualKeyCode:17,nativeVirtualKeyCode:17},a={key:`a`,code:`KeyA`,windowsVirtualKeyCode:65,nativeVirtualKeyCode:65},o={key:`Backspace`,code:`Backspace`,windowsVirtualKeyCode:8,nativeVirtualKeyCode:8};await r(e,{type:`rawKeyDown`,...i}),await r(e,{type:`rawKeyDown`,...a,modifiers:2}),await r(e,{type:`keyUp`,...a,modifiers:2}),await r(e,{type:`keyUp`,...i}),await r(e,{type:`rawKeyDown`,...o}),await r(e,{type:`keyUp`,...o}),await n(e,t)}async function a(e){let t={key:`Enter`,code:`Enter`,windowsVirtualKeyCode:13,nativeVirtualKeyCode:13};await r(e,{type:`rawKeyDown`,...t,text:`\r`}),await r(e,{type:`char`,...t,text:`\r`}),await r(e,{type:`keyUp`,...t})}async function o(t,n,r){let i={x:n,y:r,button:`left`,clickCount:1};await e.sendCommand(t,`Input.dispatchMouseEvent`,{type:`mousePressed`,buttons:1,...i}),await e.sendCommand(t,`Input.dispatchMouseEvent`,{type:`mouseReleased`,buttons:0,...i})}return{evaluate:t,insertText:n,replaceFocusedText:i,dispatchKey:r,pressEnter:a,mouseClickAt:o}}function P(e){return new Promise(t=>setTimeout(t,e))}var je=/\b(search|filter|find|query|lookup|go to|jump to|ask anything about your chats)\b/i;function Me({composerHints:e=[],submitHints:t=[],calibratedComposer:n=null,calibratedSend:r=null}={}){let i={composerHints:e,submitHints:t,genericComposer:o(),genericSubmit:s(),calibratedComposer:n,calibratedSend:r};return`(() => {
    const cfg = ${JSON.stringify(i)};
    const SEARCH_LIKE = ${je.toString()};

    function isVisible(el) {
      if (!el || !el.isConnected) return false;
      const st = window.getComputedStyle(el);
      if (st.display === 'none' || st.visibility === 'hidden' || st.opacity === '0') return false;
      if (st.pointerEvents === 'none') return false;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return false;
      if (r.bottom < 0 || r.right < 0 || r.top > innerHeight || r.left > innerWidth) return false;
      return true;
    }

    function rectInfo(el) {
      const r = el.getBoundingClientRect();
      return {
        x: r.x, y: r.y, width: r.width, height: r.height,
        area: r.width * r.height,
        bottomProximity: Math.max(0, Math.min(1, 1 - (r.bottom / Math.max(innerHeight, 1)))),
        centerX: r.left + r.width / 2,
        centerY: r.top + r.height / 2,
      };
    }

    function inExtensionUi(el) {
      try {
        if (el.closest && el.closest('[data-tether-root]')) return true;
      } catch (_) {}
      return false;
    }

    function fingerprint(el) {
      if (!el) return null;
      return {
        tag: el.tagName,
        id: el.id || '',
        className: typeof el.className === 'string' ? el.className.slice(0, 120) : '',
        name: el.getAttribute('name') || '',
        role: el.getAttribute('role') || '',
        ariaLabel: el.getAttribute('aria-label') || '',
        placeholder: el.getAttribute('placeholder') || '',
        type: el.getAttribute('type') || '',
        testId: el.getAttribute('data-testid') || '',
        contentEditable: el.isContentEditable || el.getAttribute('contenteditable') === 'true',
      };
    }

    function matchesFingerprint(el, fp) {
      if (!el || !fp) return false;
      if (fp.id && el.id === fp.id) return true;
      if (fp.testId && el.getAttribute('data-testid') === fp.testId) return true;
      if (fp.ariaLabel && el.getAttribute('aria-label') === fp.ariaLabel) return true;
      if (fp.tag && el.tagName === fp.tag && fp.className) {
        const cn = typeof el.className === 'string' ? el.className : '';
        if (cn && cn.includes(String(fp.className).split(' ')[0])) return true;
      }
      return false;
    }

    function unique(list) {
      return [...new Set(list.filter(Boolean))];
    }

    function queryAll(selectors) {
      const out = [];
      for (const s of selectors) {
        try {
          out.push(...document.querySelectorAll(s));
        } catch (_) {}
      }
      return unique(out);
    }

    function scoreComposer(c) {
      let score = 0;
      if (!c) return -Infinity;
      if (c.hidden || c.zeroSize || c.disabled) return -1000;
      if (c.inSidePanel) return -1000;
      if (c.searchLike) score -= 80;
      if (c.visible) score += 40;
      if (c.editable) score += 30;
      if (c.focusable) score += 10;
      if (c.providerHint) score += 100;
      if (c.calibrated) score += 120;
      score += Math.min(30, (c.area || 0) / 4000);
      score += Math.min(25, (c.bottomProximity || 0) * 25);
      if (c.nearSend) score += 35;
      if (c.roleTextbox) score += 15;
      if (c.tag === 'TEXTAREA') score += 12;
      if (c.contentEditable) score += 10;
      const name = (c.ariaLabel || '') + ' ' + (c.placeholder || '') + ' ' + (c.name || '');
      if (/message|prompt|chat|ask|composer|talk/i.test(name)) score += 20;
      if (SEARCH_LIKE.test(name)) score -= 60;
      return score;
    }

    function scoreSend(c) {
      let score = 0;
      if (!c) return -Infinity;
      if (c.hidden || c.zeroSize) return -1000;
      if (c.disabled || c.ariaDisabled) score -= 40;
      if (c.inSidePanel) return -1000;
      if (c.visible) score += 30;
      if (c.providerHint) score += 100;
      if (c.calibrated) score += 120;
      if (c.typeSubmit) score += 40;
      if (c.idSuggestsSend) score += 50;
      if (c.nameSuggestsSend) score += 45;
      if (c.nearComposer) score += 40;
      if (c.enabled) score += 25;
      if (c.id === 'composer-submit-button') score += 80;
      if (/^send prompt$/i.test(c.ariaLabel || '')) score += 70;
      return score;
    }

    const hintComposerEls = new Set(queryAll(cfg.composerHints));
    const hintSendEls = new Set(queryAll(cfg.submitHints));
    const composerEls = unique([
      ...hintComposerEls,
      ...queryAll(cfg.genericComposer),
    ]);
    const sendEls = unique([
      ...hintSendEls,
      ...queryAll(cfg.genericSubmit),
      ...[...document.querySelectorAll('button, [role="button"], input[type="submit"]')],
    ]);

    const composerCandidates = composerEls.map((el, index) => {
      const r = rectInfo(el);
      const ariaLabel = el.getAttribute('aria-label') || '';
      const placeholder = el.getAttribute('placeholder') || '';
      const name = el.getAttribute('name') || '';
      const labelBlob = ariaLabel + ' ' + placeholder + ' ' + name;
      const disabled =
        el.disabled === true ||
        el.getAttribute('aria-disabled') === 'true' ||
        el.getAttribute('contenteditable') === 'false';
      const editable =
        !disabled &&
        (el.tagName === 'TEXTAREA' ||
          el.tagName === 'INPUT' ||
          el.isContentEditable ||
          el.getAttribute('contenteditable') === 'true' ||
          el.getAttribute('role') === 'textbox');
      return {
        index,
        tag: el.tagName,
        id: el.id || '',
        ariaLabel,
        placeholder,
        name,
        roleTextbox: el.getAttribute('role') === 'textbox',
        contentEditable: el.isContentEditable || el.getAttribute('contenteditable') === 'true',
        visible: isVisible(el),
        hidden: !isVisible(el),
        zeroSize: r.area < 4,
        disabled,
        editable,
        focusable: typeof el.focus === 'function',
        providerHint: hintComposerEls.has(el),
        calibrated: matchesFingerprint(el, cfg.calibratedComposer),
        searchLike: SEARCH_LIKE.test(labelBlob),
        inSidePanel: inExtensionUi(el),
        area: r.area,
        bottomProximity: r.bottomProximity,
        nearSend: false,
        centerX: r.centerX,
        centerY: r.centerY,
        fingerprint: fingerprint(el),
      };
    });

    const sendCandidates = sendEls.map((el, index) => {
      const r = rectInfo(el);
      const ariaLabel = el.getAttribute('aria-label') || '';
      const title = el.getAttribute('title') || '';
      const id = el.id || '';
      const text = (el.innerText || el.textContent || '').trim().slice(0, 40);
      const nameBlob = (ariaLabel + ' ' + title + ' ' + id + ' ' + text).toLowerCase();
      const disabled =
        el.disabled === true || el.getAttribute('aria-disabled') === 'true';
      return {
        index,
        tag: el.tagName,
        id,
        ariaLabel,
        title,
        text,
        typeSubmit: (el.getAttribute('type') || '').toLowerCase() === 'submit',
        idSuggestsSend: /send|submit/i.test(id),
        nameSuggestsSend: /\\b(send|submit)\\b/i.test(nameBlob),
        visible: isVisible(el),
        hidden: !isVisible(el),
        zeroSize: r.area < 4,
        disabled,
        ariaDisabled: el.getAttribute('aria-disabled') === 'true',
        enabled: !disabled,
        providerHint: hintSendEls.has(el),
        calibrated: matchesFingerprint(el, cfg.calibratedSend),
        inSidePanel: inExtensionUi(el),
        nearComposer: false,
        centerX: r.centerX,
        centerY: r.centerY,
        fingerprint: fingerprint(el),
      };
    }).filter((c) => c.nameSuggestsSend || c.typeSubmit || c.providerHint || c.calibrated || c.idSuggestsSend);

    // Proximity boosts.
    for (const cc of composerCandidates) {
      for (const sc of sendCandidates) {
        const dist = Math.hypot(cc.centerX - sc.centerX, cc.centerY - sc.centerY);
        if (dist < 280) {
          cc.nearSend = true;
          sc.nearComposer = true;
        }
      }
    }

    function bestOf(list, scorer) {
      let best = null;
      let bestScore = -Infinity;
      for (const c of list) {
        const s = scorer(c);
        c.score = s;
        if (s > bestScore) {
          bestScore = s;
          best = c;
        }
      }
      return best && bestScore >= 0 ? best : null;
    }

    const bestComposer = bestOf(composerCandidates, scoreComposer);
    const bestSend = bestOf(sendCandidates, scoreSend);

    // Build stable CSS path for re-query when possible.
    function cssPath(fp) {
      if (!fp) return null;
      if (fp.id) return '#' + CSS.escape(fp.id);
      if (fp.testId) return '[data-testid="' + fp.testId.replace(/"/g, '\\\\"') + '"]';
      if (fp.ariaLabel) return '[aria-label="' + fp.ariaLabel.replace(/"/g, '\\\\"') + '"]';
      return null;
    }

    return {
      composer: bestComposer
        ? {
            ...bestComposer,
            method: bestComposer.calibrated
              ? 'calibrated'
              : bestComposer.providerHint
                ? 'provider_hint'
                : 'semantic',
            selector: cssPath(bestComposer.fingerprint),
          }
        : null,
      send: bestSend
        ? {
            ...bestSend,
            method: bestSend.calibrated
              ? 'calibrated'
              : bestSend.providerHint
                ? 'provider_hint'
                : 'semantic',
            selector: cssPath(bestSend.fingerprint),
          }
        : null,
      composerCount: composerCandidates.length,
      sendCount: sendCandidates.length,
      discovery: {
        composerFound: Boolean(bestComposer),
        sendFound: Boolean(bestSend),
        calibrationRequired: !bestComposer || !bestSend,
      },
    };
  })()`}function Ne({composerFp:e,sendFp:t,composerSelector:n,sendSelector:r}){return`(() => {
    const composerFp = ${JSON.stringify(e)};
    const sendFp = ${JSON.stringify(t)};
    const composerSelector = ${JSON.stringify(n)};
    const sendSelector = ${JSON.stringify(r)};

    function isVisible(el) {
      if (!el || !el.isConnected) return false;
      const st = window.getComputedStyle(el);
      if (st.display === 'none' || st.visibility === 'hidden' || Number(st.opacity) === 0) return false;
      if (st.pointerEvents === 'none') return false;
      const r = el.getBoundingClientRect();
      return r.width > 1 && r.height > 1;
    }

    function matchFp(el, fp) {
      if (!el || !fp) return false;
      if (fp.id && el.id === fp.id) return true;
      if (fp.testId && el.getAttribute('data-testid') === fp.testId) return true;
      if (fp.ariaLabel && el.getAttribute('aria-label') === fp.ariaLabel) return true;
      return false;
    }

    function find(sel, fp, fallbacks) {
      if (sel) {
        try {
          const el = document.querySelector(sel);
          if (el) return el;
        } catch (_) {}
      }
      if (fp?.id) {
        const el = document.getElementById(fp.id);
        if (el) return el;
      }
      for (const s of fallbacks || []) {
        try {
          for (const el of document.querySelectorAll(s)) {
            if (matchFp(el, fp) || !fp) return el;
          }
        } catch (_) {}
      }
      // last: scan
      if (fp) {
        for (const el of document.querySelectorAll('textarea, input, [contenteditable="true"], [role="textbox"], button, [role="button"]')) {
          if (matchFp(el, fp)) return el;
        }
      }
      return null;
    }

    const composer = find(composerSelector, composerFp, ['#prompt-textarea', '[contenteditable="true"]', 'textarea', '[role="textbox"]']);
    const send = find(sendSelector, sendFp, ['#composer-submit-button', 'button[type="submit"]', 'button[aria-label="Send prompt"]']);

    function info(el) {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const disabled = el.disabled === true || el.getAttribute('aria-disabled') === 'true';
      return {
        connected: el.isConnected,
        visible: isVisible(el),
        disabled,
        ariaDisabled: el.getAttribute('aria-disabled') === 'true',
        pointerEvents: getComputedStyle(el).pointerEvents,
        width: r.width,
        height: r.height,
        centerX: r.left + r.width / 2,
        centerY: r.top + r.height / 2,
        actionable: el.isConnected && isVisible(el) && !disabled && getComputedStyle(el).pointerEvents !== 'none' && r.width > 1 && r.height > 1,
      };
    }

    return { composer: info(composer), send: info(send), hasComposer: !!composer, hasSend: !!send };
  })()`}function Pe({composerFp:e,composerSelector:t,prompt:n,clearFirst:r=!0}){return`(() => {
    const prompt = ${JSON.stringify(n)};
    const clearFirst = ${JSON.stringify(!!r)};
    const composerFp = ${JSON.stringify(e)};
    const composerSelector = ${JSON.stringify(t)};

    function matchFp(el, fp) {
      if (!el || !fp) return false;
      if (fp.id && el.id === fp.id) return true;
      if (fp.testId && el.getAttribute('data-testid') === fp.testId) return true;
      if (fp.ariaLabel && el.getAttribute('aria-label') === fp.ariaLabel) return true;
      return false;
    }

    function findComposer() {
      if (composerSelector) {
        try {
          const el = document.querySelector(composerSelector);
          if (el) return el;
        } catch (_) {}
      }
      if (composerFp?.id) {
        const el = document.getElementById(composerFp.id);
        if (el) return el;
      }
      const sels = ['#prompt-textarea', '[data-testid="prompt-textarea"]', '[contenteditable="true"]', 'textarea', '[role="textbox"]', 'input[type="text"]'];
      for (const s of sels) {
        try {
          for (const el of document.querySelectorAll(s)) {
            if (!composerFp || matchFp(el, composerFp)) return el;
          }
        } catch (_) {}
      }
      return null;
    }

    function setNativeValue(el, value) {
      const proto =
        el.tagName === 'TEXTAREA'
          ? window.HTMLTextAreaElement.prototype
          : window.HTMLInputElement.prototype;
      const desc = Object.getOwnPropertyDescriptor(proto, 'value');
      if (desc && desc.set) {
        desc.set.call(el, value);
      } else {
        el.value = value;
      }
    }

    function dispatchInput(el, data, inputType) {
      try {
        el.dispatchEvent(new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          inputType: inputType || 'insertText',
          data: data ?? null,
        }));
      } catch (_) {
        el.dispatchEvent(new Event('beforeinput', { bubbles: true, cancelable: true }));
      }
      try {
        el.dispatchEvent(new InputEvent('input', {
          bubbles: true,
          cancelable: true,
          inputType: inputType || 'insertText',
          data: data ?? null,
        }));
      } catch (_) {
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }

    function readValue(el) {
      if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
        return String(el.value || '');
      }
      return String(el.innerText || el.textContent || '');
    }

    const el = findComposer();
    if (!el) {
      return { ok: false, code: 'composer_not_found', message: 'Composer element missing' };
    }

    const editable =
      el.tagName === 'TEXTAREA' ||
      el.tagName === 'INPUT' ||
      el.isContentEditable ||
      el.getAttribute('contenteditable') === 'true';
    if (!editable || el.disabled || el.getAttribute('aria-disabled') === 'true') {
      return { ok: false, code: 'composer_not_editable', message: 'Composer is not editable' };
    }

    try {
      el.scrollIntoView({ block: 'center', inline: 'nearest' });
    } catch (_) {}
    try { el.focus(); } catch (_) {}
    try { el.click(); } catch (_) {}

    const isTextField = el.tagName === 'TEXTAREA' || el.tagName === 'INPUT';

    if (isTextField) {
      if (clearFirst) {
        setNativeValue(el, '');
        dispatchInput(el, '', 'deleteContentBackward');
      }
      setNativeValue(el, prompt);
      dispatchInput(el, prompt, 'insertText');
      try {
        el.dispatchEvent(new Event('change', { bubbles: true }));
      } catch (_) {}
    } else {
      // contenteditable / ProseMirror
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(el);
      sel.removeAllRanges();
      sel.addRange(range);

      if (clearFirst) {
        try {
          document.execCommand('selectAll', false, null);
          document.execCommand('delete', false, null);
        } catch (_) {}
        dispatchInput(el, null, 'deleteContentBackward');
      }

      let inserted = false;
      try {
        inserted = document.execCommand('insertText', false, prompt);
      } catch (_) {
        inserted = false;
      }

      if (!inserted) {
        // Fallback: replace children with a text node + input events
        while (el.firstChild) el.removeChild(el.firstChild);
        el.appendChild(document.createTextNode(prompt));
        dispatchInput(el, prompt, 'insertText');
      } else {
        dispatchInput(el, prompt, 'insertText');
      }
    }

    const value = readValue(el);
    const normalized = value.replace(/\\u00a0/g, ' ').trimEnd();
    const expected = String(prompt).replace(/\\u00a0/g, ' ').trimEnd();
    // A previous implementation accepted a substring match. That let a
    // failed clear append a new request to an older request and falsely report
    // success. A browser turn must own the entire composer value.
    const ok = normalized === expected || normalized === expected + '\\n';

    return {
      ok,
      code: ok ? 'ok' : 'prompt_verification_failed',
      message: ok ? 'written' : 'Composer value did not match prompt',
      length: value.length,
      preview: value.slice(0, 120),
      tag: el.tagName,
      contentEditable: !!el.isContentEditable,
    };
  })()`}function Fe({sendFp:e,sendSelector:t}){return`(() => {
    const sendFp = ${JSON.stringify(e)};
    const sendSelector = ${JSON.stringify(t)};

    function isVisible(el) {
      if (!el || !el.isConnected) return false;
      const st = window.getComputedStyle(el);
      if (st.display === 'none' || st.visibility === 'hidden' || Number(st.opacity) === 0) return false;
      if (st.pointerEvents === 'none') return false;
      const r = el.getBoundingClientRect();
      return r.width > 1 && r.height > 1;
    }

    function matchFp(el, fp) {
      if (!el || !fp) return false;
      if (fp.id && el.id === fp.id) return true;
      if (fp.testId && el.getAttribute('data-testid') === fp.testId) return true;
      if (fp.ariaLabel && el.getAttribute('aria-label') === fp.ariaLabel) return true;
      return false;
    }

    function findSend() {
      if (sendSelector) {
        try {
          const el = document.querySelector(sendSelector);
          if (el) return el;
        } catch (_) {}
      }
      if (sendFp?.id) {
        const el = document.getElementById(sendFp.id);
        if (el) return el;
      }
      const sels = [
        'button#composer-submit-button',
        '#composer-submit-button',
        'button[aria-label="Send prompt"]',
        'button[data-testid="send-button"]',
        'button[type="submit"]',
        'button[aria-label*="Send" i]',
      ];
      for (const s of sels) {
        try {
          const el = document.querySelector(s);
          if (el && (!sendFp || matchFp(el, sendFp))) return el;
        } catch (_) {}
      }
      return null;
    }

    const el = findSend();
    if (!el) {
      return { ok: false, code: 'send_not_found', message: 'Send control not found', clickable: false };
    }

    const r = el.getBoundingClientRect();
    const disabled = el.disabled === true || el.getAttribute('aria-disabled') === 'true';
    const st = window.getComputedStyle(el);

    if (!el.isConnected || !isVisible(el) || disabled || st.pointerEvents === 'none' || r.width < 1 || r.height < 1) {
      return {
        ok: false,
        code: 'send_not_actionable',
        message: 'Send control is not actionable',
        clickable: false,
        diagnostics: {
          connected: el.isConnected,
          visible: isVisible(el),
          disabled,
          pointerEvents: st.pointerEvents,
          width: r.width,
          height: r.height,
        },
      };
    }

    // The caller dispatches one real CDP pointer sequence at these bounds.
    // Calling a synthetic DOM click here is not reliable for controlled composers.
    return {
      ok: true,
      clickable: true,
      clickCount: 1,
      centerX: r.left + r.width / 2,
      centerY: r.top + r.height / 2,
    };
  })()`}function Ie({baseline:e,promptPreview:t,stopHints:n=[]}){return`(() => {
    const baseline = ${JSON.stringify(e||{})};
    const promptPreview = ${JSON.stringify(t||``)};
    const stopHints = ${JSON.stringify(n)};

    function count(sels) {
      for (const s of sels || []) {
        try {
          const n = document.querySelectorAll(s).length;
          if (n) return n;
        } catch (_) {}
      }
      return 0;
    }

    function textOf(selList) {
      for (const s of selList || []) {
        try {
          const nodes = document.querySelectorAll(s);
          if (nodes.length) {
            const last = nodes[nodes.length - 1];
            return (last.innerText || last.textContent || '').trim().slice(0, 200);
          }
        } catch (_) {}
      }
      return '';
    }

    function any(sels) {
      for (const s of sels || []) {
        try {
          if (document.querySelector(s)) return true;
        } catch (_) {}
      }
      return false;
    }

    function composerValue() {
      const el =
        document.querySelector('#prompt-textarea') ||
        document.querySelector('[data-testid="prompt-textarea"]') ||
        document.querySelector('[contenteditable="true"]') ||
        document.querySelector('textarea');
      if (!el) return '';
      if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') return String(el.value || '');
      return String(el.innerText || el.textContent || '');
    }

    const userSels = baseline.userSelectors || ['[data-message-author-role="user"]', '[data-turn="user"]'];
    const asstSels = baseline.assistantSelectors || ['[data-message-author-role="assistant"]', '[data-turn="assistant"]'];
    const stopSels = stopHints.concat([
      'button[data-testid="stop-button"]',
      'button[aria-label*="Stop" i]',
      '.result-streaming',
      '[data-is-streaming="true"]',
    ]);

    const userCount = count(userSels);
    const asstCount = count(asstSels);
    const composer = composerValue();
    const stopVisible = any(stopSels);
    const lastUser = textOf(userSels);

    const evidence = {
      userCount,
      asstCount,
      prevUserCount: baseline.userCount || 0,
      prevAsstCount: baseline.assistantCount || 0,
      composerLength: composer.length,
      prevComposerLength: baseline.composerLength || 0,
      stopVisible,
      lastUserPreview: lastUser.slice(0, 80),
      promptSeenInUser:
        Boolean(promptPreview) &&
        lastUser.replace(/\\s+/g, ' ').includes(String(promptPreview).replace(/\\s+/g, ' ').slice(0, 80)),
      composerCleared:
        (baseline.composerLength || 0) > 0 && composer.trim().length === 0,
      composerChanged: composer !== (baseline.composerText || ''),
      userIncreased: userCount > (baseline.userCount || 0),
      asstIncreased: asstCount > (baseline.assistantCount || 0),
      url: location.href,
      prevUrl: baseline.url || '',
    };

    const score =
      (evidence.userIncreased ? 3 : 0) +
      (evidence.promptSeenInUser ? 3 : 0) +
      (evidence.composerCleared ? 2 : 0) +
      (evidence.composerChanged ? 1 : 0) +
      (evidence.stopVisible ? 2 : 0) +
      (evidence.asstIncreased ? 2 : 0) +
      (evidence.url !== evidence.prevUrl ? 1 : 0);

    return {
      submitted: score >= 3,
      score,
      evidence,
    };
  })()`}function Le(){let e=0;return{click(){if(e+=1,e>1){let e=Error(`Send clicked more than once`);throw e.code=`multiple_clicks`,e}return e},get count(){return e}}}function Re({userSelectors:e=[],assistantSelectors:t=[]}={}){return`(() => {
    const userSelectors = ${JSON.stringify(e)};
    const assistantSelectors = ${JSON.stringify(t)};

    function count(sels) {
      for (const s of sels || []) {
        try {
          const n = document.querySelectorAll(s).length;
          if (n) return n;
        } catch (_) {}
      }
      return 0;
    }

    function texts(sels, limit = 50) {
      for (const s of sels || []) {
        try {
          const nodes = [...document.querySelectorAll(s)];
          if (nodes.length) {
            return nodes.slice(-limit).map((n, i) => ({
              i,
              text: (n.innerText || n.textContent || '').trim().slice(0, 500),
              len: (n.innerText || n.textContent || '').trim().length,
            }));
          }
        } catch (_) {}
      }
      return [];
    }

    function composerText() {
      const el =
        document.querySelector('#prompt-textarea') ||
        document.querySelector('[data-testid="prompt-textarea"]') ||
        document.querySelector('form [contenteditable="true"]') ||
        document.querySelector('[contenteditable="true"]') ||
        document.querySelector('textarea');
      if (!el) return '';
      if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') return String(el.value || '');
      return String(el.innerText || el.textContent || '');
    }

    const userDefault = ['[data-message-author-role="user"]', '[data-turn="user"]'];
    const asstDefault = ['[data-message-author-role="assistant"]', '[data-turn="assistant"]', 'model-response'];
    const uSels = userSelectors.length ? userSelectors : userDefault;
    const aSels = assistantSelectors.length ? assistantSelectors : asstDefault;
    const cText = composerText();

    return {
      url: location.href,
      userSelectors: uSels,
      assistantSelectors: aSels,
      userCount: count(uSels),
      assistantCount: count(aSels),
      userTexts: texts(uSels),
      assistantTexts: texts(aSels),
      composerText: cText,
      composerLength: cText.length,
      capturedAt: Date.now(),
    };
  })()`}function ze({baseline:e,stopHints:t=[]}){return`(() => {
    const baseline = ${JSON.stringify(e||{})};
    const stopHints = ${JSON.stringify(t)};

    function nodesFor(sels) {
      for (const s of sels || []) {
        try {
          const nodes = [...document.querySelectorAll(s)];
          if (nodes.length) return nodes;
        } catch (_) {}
      }
      return [];
    }

    function cleanText(el) {
      if (!el) return '';
      const clone = el.cloneNode(true);
      clone.querySelectorAll(
        'button, nav, svg, [data-testid*="copy"], [aria-label*="Copy"], [aria-label*="Good"], [aria-label*="Bad"], [class*="feedback"]'
      ).forEach((n) => n.remove());
      return (clone.innerText || clone.textContent || '').replace(/\\u00a0/g, ' ').trim();
    }

    function any(sels) {
      for (const s of sels || []) {
        try {
          if (document.querySelector(s)) return true;
        } catch (_) {}
      }
      return false;
    }

    const asstSels = baseline.assistantSelectors || [
      '[data-message-author-role="assistant"]',
      '[data-turn="assistant"]',
      'model-response',
      '.ds-markdown',
    ];
    const stopSels = stopHints.concat([
      'button[data-testid="stop-button"]',
      'button[aria-label*="Stop" i]',
      '.result-streaming',
      '[class*="result-streaming"]',
      '[data-is-streaming="true"]',
    ]);

    const nodes = nodesFor(asstSels);
    const prevCount = baseline.assistantCount || 0;
    // Prefer turns after baseline; if DOM recycled, use last node.
    let target = null;
    if (nodes.length > prevCount) {
      target = nodes[nodes.length - 1];
    } else if (nodes.length) {
      // Compare against baseline last text — if last changed, treat as new/streaming.
      const last = nodes[nodes.length - 1];
      const text = cleanText(last);
      const prevLast = (baseline.assistantTexts || []).slice(-1)[0]?.text || '';
      if (text && text !== prevLast) target = last;
      else if (nodes.length > prevCount) target = last;
    }

    const text = target ? cleanText(target) : '';
    // Ignore if it equals a baseline assistant message exactly and count didn't grow.
    const baselineSet = new Set((baseline.assistantTexts || []).map((t) => t.text));
    const isOld = baselineSet.has(text) && nodes.length <= prevCount;

    const streaming = any(stopSels);

    return {
      found: Boolean(target) && !isOld && text.length > 0,
      text: isOld ? '' : text,
      length: isOld ? 0 : text.length,
      assistantCount: nodes.length,
      prevAssistantCount: prevCount,
      streaming,
      isOld,
    };
  })()`}function Be(e){if(!e||typeof e!=`string`)return!1;let t=e.trim(),n=t.search(/\{\s*"schemaVersion"\s*:/),r=n>=0?t.slice(n):t;if(!(r.startsWith(`{`)||r.startsWith(`[`)))return!1;let i=!1,a=!1,o=0;for(let e=0;e<r.length;e++){let t=r[e];if(i){a?a=!1:t===`\\`?a=!0:t===`"`&&(i=!1);continue}if(t===`"`){i=!0;continue}(t===`{`||t===`[`)&&(o+=1),(t===`}`||t===`]`)&&--o}return!!(i||a||o>0)}function Ve({stableMs:e=900,requireNonEmpty:t=!0}={}){let n=``,r=0;return{update(i,{streaming:a=!1,now:o=Date.now()}={}){let s=i||``;return t&&!s.trim()||a?(n=s,r=0,{stable:!1,text:s}):s===n?(r||=o,{stable:o-r>=e&&!Be(s),text:s,stableForMs:o-r}):(n=s,r=o,{stable:!1,text:s})},reset(){n=``,r=0}}}function He(e,t){if(!e||!t)return!1;let n=e.replace(/\\s+/g,` `).trim(),r=String(t).replace(/\\s+/g,` `).trim();return n===r||n.includes(r)&&n.length<r.length+20}var Ue=`direct-cdp`;function F(e,t,n){throw new Oe(e,t,n)}function We({composerFp:e,composerSelector:t,prompt:n}){return`(() => {
    const expected = ${JSON.stringify(n)};
    const composerFp = ${JSON.stringify(e)};
    const composerSelector = ${JSON.stringify(t)};

    function matchFp(el, fp) {
      if (!el || !fp) return false;
      if (fp.id && el.id === fp.id) return true;
      if (fp.testId && el.getAttribute('data-testid') === fp.testId) return true;
      if (fp.ariaLabel && el.getAttribute('aria-label') === fp.ariaLabel) return true;
      return false;
    }

    let el = null;
    try { if (composerSelector) el = document.querySelector(composerSelector); } catch (_) {}
    if (!el && composerFp?.id) el = document.getElementById(composerFp.id);
    if (!el) {
      el = document.querySelector('#prompt-textarea') ||
        document.querySelector('[data-testid="prompt-textarea"]') ||
        document.querySelector('[contenteditable="true"]') ||
        document.querySelector('textarea');
    }
    if (!el) return { ok: false, code: 'composer_not_found' };

    const value = (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT')
      ? String(el.value || '')
      : String(el.innerText || el.textContent || '');
    const norm = (s) => String(s).replace(/\\u00a0/g, ' ').replace(/\\s+/g, ' ').trim();
    // Exact ownership is important: containment accepts a stale composer with
    // multiple concatenated TETHER requests, which the provider will not obey.
    const ok = norm(value) === norm(expected);
    return { ok, length: value.length, preview: value.slice(0, 120) };
  })()`}function Ge({transport:e,calibrationStore:t}={}){let r=Ae(e),o=new Map,s=new Map;function c(e,t,n){return`${e}::${t}::${n}`}function l(e){e?.aborted&&F(N.OPERATION_CANCELLED,`Operation cancelled`)}async function u(t,r){r?.(n.ATTACHING_DEBUGGER);try{await e.attach(t)}catch(e){F(N.DEBUGGER_ATTACH_FAILED,e?.message||`Failed to attach debugger`,{tabId:t})}}async function d(t){await e.sendCommand(t,`Page.enable`).catch(()=>{}),await Promise.all([e.sendCommand(t,`Page.setWebLifecycleState`,{state:`active`}).catch(()=>{}),e.sendCommand(t,`Emulation.setFocusEmulationEnabled`,{enabled:!0}).catch(()=>{})])}function f(e,t){return e&&i(e)||a(t)||null}async function p(e){return t?typeof t.get==`function`?t.get(e):t[e]||null:null}async function m(e){let{requestId:t,browserSessionId:i,tabId:a,origin:m,providerId:h,prompt:g,signal:_,extensionInstanceId:v=`local`,onStage:y,onProgress:b,timeoutMs:ee=12e4,clearFirst:x=!0}=e||{};a??F(N.TAB_UNAVAILABLE,`tabId is required`),typeof g!=`string`&&F(N.PROMPT_WRITE_FAILED,`prompt must be a string`);let S=c(v,i,t),C=o.get(S);if(C){if(C.status===`pending`)return C.promise;if(C.status===`completed`)return C.result;if(C.status===`failed`)throw C.error}let w=new AbortController;s.set(S,w);let T={get aborted(){return w.signal.aborted||!!_?.aborted}},E=(async()=>{let e=(e,t)=>{y?.(e,t),b?.({stage:e,...t})};try{e(n.VALIDATING_SESSION,{tabId:a,browserSessionId:i}),l(T),await u(a,e),await d(a),l(T);let t=f(h,m),o=await p(m);e(n.CAPTURING_BASELINE);let s=await r.evaluate(a,Re({userSelectors:t?.userHints||[],assistantSelectors:t?.assistantHints||[]}));l(T),e(n.RESOLVING_COMPOSER);let c=await r.evaluate(a,Me({composerHints:t?.composerHints||[],submitHints:t?.submitHints||[],calibratedComposer:o?.composer||null,calibratedSend:o?.send||null}));c?.composer||F(N.COMPOSER_NOT_FOUND,`Could not discover chat composer`,{discovery:c?.discovery}),b?.({stage:n.RESOLVING_COMPOSER,discovery:{composerFound:!0,sendFound:!!c.send,composerMethod:c.composer.method,sendMethod:c.send?.method,calibrationRequired:c.discovery?.calibrationRequired}}),e(n.WRITING_PROMPT,{length:g.length});let _=await r.evaluate(a,Pe({composerFp:c.composer.fingerprint,composerSelector:c.composer.selector,prompt:g,clearFirst:x}));if(!_?.ok)try{await r.evaluate(a,`(() => {
                const el = document.querySelector(${JSON.stringify(c.composer.selector)}) ||
                  document.querySelector('#prompt-textarea') ||
                  document.querySelector('[contenteditable="true"]');
                if (el) { el.focus(); return true; }
                return false;
              })()`),await r.replaceFocusedText(a,g),await P(120),_={ok:!0,fallback:`insertText`}}catch{F(_?.code||N.PROMPT_WRITE_FAILED,_?.message||`Failed to write prompt`)}e(n.VERIFYING_PROMPT),await P(80);let v=await r.evaluate(a,We({composerFp:c.composer.fingerprint,composerSelector:c.composer.selector,prompt:g}));if(!v?.ok){try{await r.evaluate(a,`(() => {
                const el = document.querySelector('#prompt-textarea') ||
                  document.querySelector('[contenteditable="true"]');
                if (el) el.focus();
                return !!el;
              })()`),await r.replaceFocusedText(a,g),await P(150)}catch{}v=await r.evaluate(a,We({composerFp:c.composer.fingerprint,composerSelector:c.composer.selector,prompt:g})),v?.ok||F(N.PROMPT_VERIFICATION_FAILED,`Composer did not contain the exact prompt after write`)}await P(200),l(T),e(n.RESOLVING_SEND);let y=c.send,S=Date.now()+15e3;for(;l(T),y=(await r.evaluate(a,Me({composerHints:t?.composerHints||[],submitHints:t?.submitHints||[],calibratedComposer:o?.composer||null,calibratedSend:o?.send||null})))?.send||y,!(await r.evaluate(a,Ne({composerFp:c.composer.fingerprint,sendFp:y?.fingerprint,composerSelector:c.composer.selector,sendSelector:y?.selector})))?.send?.actionable;)Date.now()>S&&F(y?N.SEND_NOT_ACTIONABLE:N.SEND_NOT_FOUND,y?`Send control never became actionable`:`Send control not found`),await P(120);e(n.SUBMITTING),Le().click();let C=await r.evaluate(a,Fe({sendFp:y.fingerprint,sendSelector:y.selector}));C?.clickable||F(C?.code||N.SEND_NOT_ACTIONABLE,C?.message||`Send click failed`,C?.diagnostics),await r.mouseClickAt(a,C.centerX,C.centerY),e(n.VERIFYING_SUBMISSION);let w=!1,E=Date.now()+2e4;for(;Date.now()<E;){if(l(T),(await r.evaluate(a,Ie({baseline:s,promptPreview:g.slice(0,200),stopHints:t?.stopHints||[]})))?.submitted){w=!0;break}await P(200)}w||F(N.SUBMISSION_NOT_OBSERVED,`Submission was not observed after clicking Send`),e(n.OBSERVING_RESPONSE);let te=Ve({stableMs:900}),ne=Date.now()+ee,D=null;for(;Date.now()<ne;){l(T);let i=await r.evaluate(a,ze({baseline:s,stopHints:t?.stopHints||[]}));if(D=i,i?.found&&i.text){if(He(i.text,g)){await P(250);continue}let t=te.update(i.text,{streaming:!!i.streaming});if(b?.({stage:i.streaming?n.OBSERVING_RESPONSE:n.WAITING_FOR_STABILITY,text:i.text,streaming:i.streaming}),t.stable)return e(n.COMPLETE),{text:i.text,engine:Ue,diagnostics:{composerMethod:c.composer.method,sendMethod:y?.method,assistantCount:i.assistantCount}}}else b?.({stage:n.OBSERVING_RESPONSE,text:i?.text||``,streaming:!!i?.streaming});await P(350)}if(D?.text&&!He(D.text,g))return e(n.COMPLETE),{text:D.text,engine:Ue,diagnostics:{timedOut:!0}};F(N.RESPONSE_TIMEOUT,`Timed out waiting for a stable assistant response`,{lastLength:D?.length||0})}finally{s.delete(S)}})();o.set(S,{status:`pending`,promise:E});try{let e=await E;return o.set(S,{status:`completed`,result:e,promise:E}),e}catch(e){let t=e instanceof Oe?e:new Oe(e?.code||`failed`,e?.message||String(e));throw o.set(S,{status:`failed`,error:t,promise:E}),t}}function h({requestId:e,browserSessionId:t,extensionInstanceId:n=`local`}){let r=c(n,t,e),i=s.get(r);return i?(i.abort(),!0):!1}async function g(t){try{await e.detach(t)}catch{}}function _(){return Ue}function v(){return o}return{request:m,cancel:h,release:g,getEngine:_,_idempotencyMap:v,correlationKey:c}}var Ke=`1.3`;function qe(){let e=new Map;function t(t){return e.get(t)?.state||`not_attached`}async function n(t){let n=e.get(t);if(n?.state===`attached`)return;if(n?.attachPromise){await n.attachPromise;return}e.set(t,{state:`attaching`});let r=(async()=>{try{await chrome.debugger.attach({tabId:t},Ke),e.set(t,{state:`attached`})}catch(n){let r=String(n?.message||n);if(/already attached/i.test(r)){try{await chrome.debugger.detach({tabId:t})}catch{}await chrome.debugger.attach({tabId:t},Ke),e.set(t,{state:`attached`});return}e.set(t,{state:`failed`});let i=Error(r);throw i.code=`debugger_attach_failed`,i}})();e.set(t,{state:`attaching`,attachPromise:r}),await r}async function r(n){if(t(n)===`not_attached`){try{await chrome.debugger.detach({tabId:n})}catch{}e.delete(n);return}e.set(n,{state:`detaching`});try{await chrome.debugger.detach({tabId:n})}catch{}e.delete(n)}async function i(n,r,i={}){if(t(n)!==`attached`)try{await chrome.debugger.attach({tabId:n},Ke),e.set(n,{state:`attached`})}catch(e){let t=Error(String(e?.message||e));throw t.code=`debugger_detached`,t}try{return await chrome.debugger.sendCommand({tabId:n},r,i)}catch(t){let r=String(t?.message||t);if(/not attached|detached|debugger is not attached/i.test(r)){e.delete(n);let t=Error(r);throw t.code=`debugger_detached`,t}throw t}}function a(t){e.delete(t)}function o(e){return t(e)===`attached`}return globalThis.chrome?.debugger?.onDetach&&chrome.debugger.onDetach.addListener(e=>{e?.tabId!=null&&a(e.tabId)}),{attach:n,detach:r,sendCommand:i,getState:t,isAttached:o,markDetached:a,PROTOCOL_VERSION:Ke}}function Je(e,t){if(e?.url){let n=l(e.url);return!t||n.kind!==`web`||n.origin!==t.origin||n.providerId!==t.providerId}return e?.status===`loading`}function Ye(e,t){return e?.url?Je({url:e.url},t):!1}function Xe(){try{globalThis.__tetherContentScriptCleanup?.()}catch{}delete globalThis.__tetherContentScriptCleanup,delete globalThis.__tetherCalibrationVersion}async function Ze({tabId:e,executeScript:t,sendTabMessage:n}){try{let t=await n(e,{type:`tether.endpointReady`});if(t?.ok)return t}catch{}await t({target:{tabId:e},func:Xe}),await t({target:{tabId:e},files:[`content-script.js`]});let r=await n(e,{type:`tether.endpointReady`});if(!r?.ok)throw Object.assign(Error(`TETHER endpoint did not acknowledge readiness`),{code:`endpoint_not_ready`});return r}var Qe=`activeResponseCalibrations`,I=new Set([`starting`,`injecting_marker`,`waiting_for_marker`,`marker_captured`,`inferring_structure`,`manual_selection_required`,`manual_selecting_turn`]);function $e({injectContentScript:e,sendTabMessage:t,loadProfiles:n,saveProfiles:r,loadActiveOperations:i=async()=>({}),saveActiveOperations:a=async()=>{},getPageState:o=async()=>null,publish:s=()=>{}}){let c=new Map;async function l(){let e={};for(let[t,n]of c)I.has(n.stage)&&(e[t]=nt(n));await a(e)}async function u(e,t){let n={...c.get(e)??tt(e),...t};return c.set(e,n),s(rt(n)),await l(),n}async function d({requestId:n,session:r,profile:i}){et({requestId:n,session:r,profile:i});let a=c.get(r.browserSessionId);if(a&&I.has(a.stage)){if(a.requestId===n)return a;throw R(`session_busy`,`This browser session is already calibrating responses`)}await u(r.browserSessionId,{stage:`starting`,requestId:n,browserSessionId:r.browserSessionId,tabId:r.tabId,origin:r.origin,turn:0,totalTurns:3,startedAt:Date.now(),error:null});try{await e(r.tabId);let a=await t(r.tabId,{type:`responseCalibration.start`,requestId:n,browserSessionId:r.browserSessionId,origin:r.origin,profile:i});if(!a?.ok)throw R(a?.code??`start_failed`,a?.error??`Response calibration could not start`);return c.get(r.browserSessionId)}catch(e){throw await u(r.browserSessionId,L(`failed`,e)),e}}async function f(e,t){let i=c.get(e.browserSessionId);if(!i||i.tabId!==t||i.requestId!==e.requestId)return null;if(e.stage===`complete`){if(!se(e.responseCalibration))return u(i.browserSessionId,L(`failed`,R(`invalid_result`,`The page returned invalid response calibration`)));let t=await n(),a=t[i.origin];if(A(a,i.origin).code!==`stored`)return u(i.browserSessionId,L(`failed`,R(`profile_changed`,`The control calibration changed during response calibration`)));let o={...a,responseCalibration:e.responseCalibration};return await r({...t,[i.origin]:o}),u(i.browserSessionId,{...L(`complete`),responseCalibration:e.responseCalibration})}return e.stage===`failed`||e.stage===`cancelled`?u(i.browserSessionId,L(e.stage,R(e.code,e.error))):I.has(e.stage)?u(i.browserSessionId,{stage:e.stage,turn:e.turn??i.turn,totalTurns:3,error:null}):i}async function p(e,n=`cancelled`){let r=c.get(e);return!r||!I.has(r.stage)?!1:(await t(r.tabId,{type:`responseCalibration.cancel`,requestId:r.requestId}).catch(()=>{}),await u(e,L(`cancelled`,R(n,at(n)))),!0)}async function m(e){let n=c.get(e);if(!n||n.stage!==`manual_selection_required`)throw R(`manual_selection_unavailable`,`No guided response calibration is waiting in this tab`);let r=await t(n.tabId,{type:`responseCalibration.manualSelect`,requestId:n.requestId});if(!r?.ok)throw R(r?.code??`manual_selection_failed`,r?.error??`Guided response selection could not start`);return u(e,{stage:`manual_selecting_turn`,error:null})}async function h(){let e=await i();for(let t of Object.values(e??{}))if(it(t)){c.set(t.browserSessionId,t);try{let e=await o(t.tabId);e?.requestId===t.requestId&&e.browserSessionId===t.browserSessionId?await f(e,t.tabId):await u(t.browserSessionId,L(`failed`,R(`restart_lost`,`Response calibration could not be recovered`)))}catch{await u(t.browserSessionId,L(`failed`,R(`tab_unavailable`,`The response-calibration tab is unavailable`)))}}await l()}function g(e,t){return Promise.all([...c.values()].filter(t=>t.tabId===e).map(e=>p(e.browserSessionId,t)))}return{start:d,startManualSelection:m,cancel:p,restore:h,handlePageState:f,cancelByTabId:g,getBySessionId:e=>c.has(e)?rt(c.get(e)):null}}function et({requestId:e,session:t,profile:n}){if(typeof e!=`string`||!e||e.length>128)throw R(`invalid_request_id`,`A valid request ID is required`);if(!t?.browserSessionId||!Number.isInteger(t.tabId))throw R(`invalid_session`,`An activated browser session is required`);if(A(n,t.origin).code!==`stored`)throw R(`invalid_profile`,`Valid control calibration is required`)}function tt(e){return{browserSessionId:e,stage:`idle`,requestId:null,tabId:null,origin:null,turn:0,totalTurns:3,error:null}}function L(e,t=null){return{stage:e,requestId:null,startedAt:null,error:t?.message??null,code:t?.code??null}}function nt(e){return{stage:e.stage,requestId:e.requestId,browserSessionId:e.browserSessionId,tabId:e.tabId,origin:e.origin,turn:e.turn,totalTurns:e.totalTurns,startedAt:e.startedAt,error:e.error,code:e.code??null}}function rt(e){return{stage:e.stage,turn:e.turn,totalTurns:e.totalTurns,error:e.error,code:e.code??null}}function it(e){return!!(e?.browserSessionId&&Number.isInteger(e.tabId)&&typeof e.requestId==`string`&&I.has(e.stage))}function R(e=`response_calibration_failed`,t=`Response calibration failed`){return Object.assign(Error(t),{code:e})}function at(e){return e===`tab_closed`?`The owning browser tab was closed`:e===`tab_navigated`?`The owning browser tab navigated`:e===`session_deactivated`?`TETHER was deactivated for this tab`:`Response calibration was cancelled`}var ot=`tetherTransportMode`,z=`CLI`,st=chrome.storage.session.get(ot).then(e=>{z=e[ot]===`CROSS`?`CROSS`:`CLI`});function B(e){chrome.runtime.sendMessage(e).catch(()=>{})}async function V(){return(await chrome.storage.local.get(`calibrationProfiles`)).calibrationProfiles??{}}var H=e=>Ze({tabId:e,executeScript:e=>chrome.scripting.executeScript(e),sendTabMessage:(e,t)=>chrome.tabs.sendMessage(e,t)}),U=he({injectContentScript(e){return H(e)},sendTabMessage:(e,t)=>chrome.tabs.sendMessage(e,t),loadProfiles:V,saveProfiles:e=>chrome.storage.local.set({[de]:e}),async loadActiveOperation(){return(await chrome.storage.session.get(`activeCalibration`)).activeCalibration??null},saveActiveOperation:e=>chrome.storage.session.set({[fe]:e}),clearActiveOperation:()=>chrome.storage.session.remove(fe),getPageState:e=>chrome.tabs.sendMessage(e,{type:`calibration.getPageState`}),publish(e){B({type:`calibration.stateChanged`,state:e}),B({type:`panel.stateChanged`})}}),W=h({storage:chrome.storage.session,getTab:e=>chrome.tabs.get(e)}),G=Ce({async sendTabMessage(e,t){return t.type===`injection.execute`&&await H(e),chrome.tabs.sendMessage(e,t)},publish(e){B({type:`injection.stateChanged`,state:e}),B({type:`panel.stateChanged`})}}),K=$e({injectContentScript:e=>H(e),sendTabMessage:(e,t)=>chrome.tabs.sendMessage(e,t),loadProfiles:V,saveProfiles:e=>chrome.storage.local.set({[de]:e}),async loadActiveOperations(){return(await chrome.storage.session.get(`activeResponseCalibrations`)).activeResponseCalibrations??{}},saveActiveOperations:e=>chrome.storage.session.set({[Qe]:e}),getPageState:e=>chrome.tabs.sendMessage(e,{type:`responseCalibration.getPageState`}),publish(e){B({type:`responseCalibration.stateChanged`,state:e}),B({type:`panel.stateChanged`})}}),q=Ee({async sendTabMessage(e,t){return t.type===`extraction.execute.v2`&&await H(e),chrome.tabs.sendMessage(e,t)},publish(){B({type:`extraction.stateChanged`}),B({type:`panel.stateChanged`})}}),J=xe({sidePanel:chrome.sidePanel,hasSession:e=>!!W.getByTabId(e)});chrome.sidePanel.setPanelBehavior({openPanelOnActionClick:!1}).catch(console.error),chrome.storage.local.setAccessLevel({accessLevel:`TRUSTED_CONTEXTS`}).catch(console.error);var Y=W.initialize(),ct=b(chrome.storage.local),lt=U.restore(),ut=K.restore(),dt=Y.then(async e=>{let t=await chrome.tabs.query({active:!0});await J.initialize(e,t)}),X=Promise.all([Y,lt,ut,dt]),ft=Ge({transport:qe()});async function pt(){let[e]=await Promise.all([ct,Y]);return{extensionInstanceId:e,sessions:W.list()}}async function mt(e,t){await Y;let n=t.sessions.find(t=>t.browserSessionId===e.browserSessionId),r=W.getById(e.browserSessionId);if(!n||!r||r.status!==`active`)throw Object.assign(Error(`Browser session is not active`),{code:`inactive_session`});let i;try{i=await chrome.tabs.get(r.tabId)}catch{throw Object.assign(Error(`Browser session tab is unavailable`),{code:`tab_unavailable`})}let a=l(i?.url);if(i?.id!==r.tabId||a.kind!==`web`||a.origin!==r.origin||a.providerId!==r.providerId)throw Object.assign(Error(`Browser session no longer matches its tab`),{code:`session_tab_mismatch`});let o=K.getBySessionId(r.browserSessionId);if(G.getBySessionId(r.browserSessionId)?.stage===`injecting`||q.getBySessionId(r.browserSessionId)?.stage===`observing`||o&&![`complete`,`cancelled`,`failed`].includes(o.stage)||U.getState().tabId===r.tabId)throw Object.assign(Error(`Browser session is busy`),{code:`session_busy`})}async function ht(e,t,{signal:n}){await X,await mt(e,t);let r=W.getById(e.browserSessionId),i=await ct;if(n.aborted)throw Object.assign(Error(`Adapter disconnected`),{code:`adapter_disconnected`});let a=()=>ft.cancel({extensionInstanceId:i,browserSessionId:r.browserSessionId,requestId:e.requestId});n.addEventListener(`abort`,a,{once:!0});try{return(await ft.request({requestId:e.requestId,browserSessionId:r.browserSessionId,extensionInstanceId:i,tabId:r.tabId,origin:r.origin,providerId:r.providerId,prompt:e.payload.prompt,signal:n})).text}finally{n.removeEventListener(`abort`,a)}}var gt=oe({getRegistration:pt,onTestRequest:mt,onBrowserRequest:ht,onStateChange(e){B({type:`connection.stateChanged`,state:e})}});function _t(e){return B({type:`browserSession.stateChanged`,tabId:e}),gt.sessionsChanged()}var vt=new Map;async function Z(e){let t=vt.get(e.documentId);if(Number.isInteger(t))return chrome.tabs.get(t);let[n]=await chrome.tabs.query({active:!0,currentWindow:!0});return n}async function yt(e,t){let n=Date.now();try{return await H(e),{...await chrome.tabs.sendMessage(e,{type:`calibration.validateProfile`,profile:t}),validatedAt:n}}catch(e){return{code:`validation_failed`,valid:!1,loaded:!0,composerResolved:!1,sendResolved:!1,validatedAt:n,error:e instanceof Error?e.message:String(e)}}}function bt(e,t,n,r){let i={storageKey:de,origin:r,loaded:e.loaded,migrated:!1,profileSource:n?n.createdAt?`current_schema`:`checkpoint_4_schema`:`none`,profileVersion:n?.version??null,createdAt:n?.createdAt??null,lastValidatedAt:t?.validatedAt??null,validationResult:t?.code??e.code,composerFingerprintExists:!!n?.composer,sendFingerprintExists:!!n?.send,composerResolved:!!t?.composerResolved,sendResolved:!!t?.sendResolved};return e.code===`missing`?{state:`missing`,validation:e,diagnostics:i}:e.code===`schema_invalid`?{state:`invalid`,validation:e,diagnostics:i}:t?.valid?{state:`valid`,validation:t,diagnostics:i}:t?.code===`validation_failed`?{state:`validation_failed`,validation:t,diagnostics:i}:{state:`needs_update`,validation:t,diagnostics:i}}async function xt(t){await X;let n=await Z(t),r=l(n?.url),i=W.getByTabId(n?.id),a=W.list().filter(e=>e.transportMode===`CROSS`),o={count:z===`CROSS`?a.length:W.list().filter(e=>e.transportMode===`CLI`).length,masterReady:a.some(e=>e.role===`MASTER`),slaveReady:a.some(e=>e.role===`SLAVE`)},s={state:i?`active`:`inactive`,role:i?.role??null,transportMode:i?.transportMode??null};if(r.kind===`restricted`)return{site:r,tabId:n?.id??null,access:`restricted`,calibration:null,activation:s,endpoints:o};let c=(await V())[r.calibrationKey]??null,u=A(c,r.origin);if(!await e(r.origin))return{site:r,tabId:n.id,access:`required`,calibration:{...bt(u,null,c,r.origin),state:`access_required`},activation:s,endpoints:o};let d=bt(u,u.code===`stored`?await yt(n.id,c):null,c,r.origin),f=U.getState(),p=f.tabId===n.id?f:{stage:`idle`,error:null};return{site:r,tabId:n.id,access:`granted`,calibration:d,calibrationOperation:p,injectionOperation:i?G.getBySessionId(i.browserSessionId):null,responseCalibration:{state:c?.responseCalibration?`ready`:`missing`,operation:i?K.getBySessionId(i.browserSessionId):null},extractionOperation:i?q.getBySessionId(i.browserSessionId):null,activation:s,endpoints:o}}function Q(e,t){e({ok:!1,error:t.message,code:t.code??`unexpected_error`})}async function $(e,t,n=void 0){return await H(e),chrome.tabs.sendMessage(e,{type:`tether.endpointState`,state:t,mode:z,message:n})}var St=be({resolvePanelTab:Z,inspectSite:l,hasAccess:e,assertAvailable(e){if(G.getByTabId(e.id)?.stage===`injecting`)throw Error(`Cancel the active injection test before starting calibration`);let t=W.getByTabId(e.id),n=t?K.getBySessionId(t.browserSessionId):null;if(n&&![`complete`,`cancelled`,`failed`].includes(n.stage))throw Error(`Cancel response calibration before recalibrating controls`)},start:e=>U.start(e)});chrome.runtime.onMessage.addListener((e,t,n)=>{if(e?.type===`mode.get`)return st.then(()=>n({ok:!0,mode:z})),!0;if(e?.type===`mode.set`)return st.then(async()=>{if(![`CLI`,`CROSS`].includes(e.mode))throw Object.assign(Error(`Unsupported TETHER mode`),{code:`invalid_mode`});let t=e.mode;if(t!==z&&W.list().length>0)throw Object.assign(Error(`Deactivate the current endpoints before switching TETHER modes`),{code:`active_endpoints`});return z=t,await chrome.storage.session.set({[ot]:t}),await Promise.all(W.list().map(e=>$(e.tabId,`active`).catch(()=>{}))),B({type:`mode.stateChanged`,mode:z}),B({type:`panel.stateChanged`}),z}).then(e=>n({ok:!0,mode:e}),e=>Q(n,e)),!0;if(e?.type===`connection.getState`){n({state:gt.getState()});return}if(e?.type===`panel.getState`)return xt(t).then(e=>n({ok:!0,state:e}),e=>Q(n,e)),!0;if(e?.type===`browserSession.activate`)return X.then(async()=>{let n=await Z(t),r=await xt(t);if(r.access!==`granted`||!r.site?.hasAdapter&&r.calibration?.state!==`valid`)throw Object.assign(Error(`This site requires a valid calibration before activation`),{code:`calibration_required`});if(z===`CLI`&&!W.getByTabId(n.id)&&W.list().length>0)throw Object.assign(Error(`CLI already has an active endpoint; deactivate it before selecting another tab`),{code:`cli_endpoint_exists`});let i=e.role;if(z===`CROSS`&&![`MASTER`,`SLAVE`].includes(i))throw Object.assign(Error(`Choose MASTER or SLAVE before activating this CROSS endpoint`),{code:`cross_role_required`});let a=await W.activate(n,await V(),r.calibration.validation,{transportMode:z,role:z===`CROSS`?i:`ENDPOINT`});return await J.sessionActivated(a),await _t(n.id),$(a.tabId,`active`).catch(()=>{}),xt(t)}).then(e=>n({ok:!0,state:e}),e=>Q(n,e)),!0;if(e?.type===`browserSession.deactivate`)return X.then(async()=>{let e=await Z(t),n=W.getByTabId(e.id);return n&&(await $(n.tabId,`hidden`).catch(()=>{}),G.cancelBySessionId(n.browserSessionId,`session_deactivated`),q.cancelBySessionId(n.browserSessionId,`session_deactivated`),await K.cancel(n.browserSessionId,`session_deactivated`),await ft.release(n.tabId)),await W.removeByTabId(e.id),await J.sessionRemoved(e.id),await _t(e.id),xt(t)}).then(e=>n({ok:!0,state:e}),e=>Q(n,e)),!0;if(e?.type===`browserSession.role.set`)return X.then(async()=>{let n=await Z(t),r=await W.setRole(n.id,e.role);return await _t(n.id),$(r.tabId,`active`).catch(()=>{}),xt(t)}).then(e=>n({ok:!0,state:e}),e=>Q(n,e)),!0;if(e?.type===`browserSession.validate`)return Y.then(()=>W.assertSender(e.browserSessionId,t.tab?.id)).then(e=>n({ok:!0,session:e}),e=>Q(n,e)),!0;if(e?.type===`calibration.start`)return X.then(()=>St(e,t)).then(e=>n({ok:!0,state:e}),e=>{let t=U.getState();n({ok:!1,error:t.error??e.message,state:t})}),!0;if(e?.type===`injection.start`)return X.then(async()=>{let n=await Z(t),r=W.getByTabId(n?.id);if(!r)throw Object.assign(Error(`Activate TETHER for this tab before testing injection`),{code:`inactive_session`});let i=K.getBySessionId(r.browserSessionId);if(i&&![`complete`,`cancelled`,`failed`].includes(i.stage))throw Object.assign(Error(`Response calibration is using this browser session`),{code:`session_busy`});if(r.tabId!==n.id)throw Object.assign(Error(`Browser session does not own the panel-bound tab`),{code:`session_tab_mismatch`});let a=l(n.url);if(a.kind!==`web`||a.origin!==r.origin)throw Object.assign(Error(`The activated browser session no longer matches this page`),{code:`origin_mismatch`});let o=(await V())[r.calibrationKey];if(A(o,r.origin).code!==`stored`)throw Object.assign(Error(`This site requires a valid calibration before testing injection`),{code:`calibration_invalid`});if(U.getState().tabId===n.id)throw Object.assign(Error(`Finish or cancel calibration before testing injection`),{code:`calibration_active`});return G.start({requestId:e.requestId,session:r,profile:o,text:e.text})}).then(e=>n({ok:!0,state:e}),e=>Q(n,e)),!0;if(e?.type===`injection.cancel`)return X.then(async()=>{let e=await Z(t),n=W.getByTabId(e?.id);if(!n)throw Object.assign(Error(`No active browser session exists for this tab`),{code:`inactive_session`});return{cancelled:G.cancelBySessionId(n.browserSessionId)}}).then(e=>n({ok:!0,...e}),e=>Q(n,e)),!0;if(e?.type===`responseCalibration.start`)return X.then(async()=>{let n=await Z(t),r=W.getByTabId(n?.id);if(!r)throw Object.assign(Error(`Activate TETHER in this tab first`),{code:`inactive_session`});if(G.getByTabId(n.id)?.stage===`injecting`)throw Object.assign(Error(`Cancel the injection test first`),{code:`session_busy`});if(U.getState().tabId===n.id)throw Object.assign(Error(`Finish control calibration first`),{code:`page_busy`});let i=(await V())[r.calibrationKey];return K.start({requestId:e.requestId,session:r,profile:i})}).then(e=>n({ok:!0,state:e}),e=>Q(n,e)),!0;if(e?.type===`extraction.start`)return X.then(async()=>{let n=await Z(t),r=W.getByTabId(n?.id);if(!r)throw Object.assign(Error(`Activate TETHER in this tab first`),{code:`inactive_session`});let i=(await V())[r.calibrationKey];if(!i?.responseCalibration)throw Object.assign(Error(`Complete response calibration first`),{code:`response_calibration_missing`});return q.start({requestId:e.requestId,session:r,profile:i,text:e.text})}).then(e=>n({ok:!0,state:e}),e=>Q(n,e)),!0;if(e?.type===`extraction.cancel`)return X.then(async()=>{let e=await Z(t),n=W.getByTabId(e?.id);return n?q.cancelBySessionId(n.browserSessionId):!1}).then(e=>n({ok:!0,cancelled:e}),e=>Q(n,e)),!0;if(e?.type===`responseCalibration.cancel`)return X.then(async()=>{let e=await Z(t),n=W.getByTabId(e?.id);return n?K.cancel(n.browserSessionId):!1}).then(e=>n({ok:!0,cancelled:e}),e=>Q(n,e)),!0;if(e?.type===`responseCalibration.manualSelect`)return X.then(async()=>{let e=await Z(t),n=W.getByTabId(e?.id);if(!n)throw Object.assign(Error(`Activate TETHER in this tab first`),{code:`inactive_session`});return K.startManualSelection(n.browserSessionId)}).then(e=>n({ok:!0,state:e}),e=>Q(n,e)),!0;if(e?.type===`responseCalibration.pageState`)return X.then(async()=>(await W.assertSender(e.browserSessionId,t.tab?.id),K.handlePageState(e,t.tab.id))).then(()=>n({ok:!0}),e=>Q(n,e)),!0;if(e?.type===`calibration.cancel`)return X.then(async()=>{let n=await Z(t),r=U.getState();if(Number.isInteger(r.tabId)&&r.tabId!==n?.id)throw Error(`Another tab owns the active calibration`);return U.cancel(e.requestId)}).then(e=>n({ok:!0,state:e}),e=>Q(n,e)),!0;if(e?.type===`calibration.pageState`)return U.handlePageState(e,t.tab?.id).then(()=>n({ok:!0}),e=>Q(n,e)),!0}),chrome.action.onClicked.addListener(e=>{J.openManually(e).catch(e=>console.error(`TETHER could not open`,e))}),chrome.tabs.onActivated.addListener(e=>{dt.then(()=>J.handleActivated(e)).catch(console.error)}),chrome.tabs.onUpdated.addListener((e,t,n)=>{U.handleTabUpdated(e,t);let r=W.getByTabId(e);Je(t,r)&&(G.cancelByTabId(e,`tab_navigated`),q.cancelByTabId(e,`tab_navigated`),K.cancelByTabId(e,`tab_navigated`)),Ye(t,r)&&ft.release(e).catch(console.error),t.status===`complete`&&r&&!t.url&&$(e,`active`).catch(()=>{}),t.url&&Y.then(async()=>{let r=W.getByTabId(e),i=await W.updateTab(n);r&&!i&&await J.sessionRemoved(e),i&&await J.sessionActivated(i),i&&t.status===`complete`&&await $(e,`active`).catch(()=>{}),(r||i)&&await _t(e)}).catch(console.error)}),chrome.tabs.onRemoved.addListener(e=>{U.handleTabRemoved(e),G.cancelByTabId(e,`tab_closed`),q.cancelByTabId(e,`tab_closed`),K.cancelByTabId(e,`tab_closed`),ft.release(e).catch(console.error),Y.then(async()=>{await W.removeByTabId(e),J.handleRemoved(e),await _t(e)}).catch(console.error)}),chrome.runtime.onConnect.addListener(e=>{t(e,{getTab:e=>chrome.tabs.get(e),onBind(e,t){t.sender?.documentId&&vt.set(t.sender.documentId,e),t.postMessage({type:`panel.bound`,tabId:e})},onExplicitClose:async e=>{U.getState().tabId===e&&[`starting`,`selecting_composer`,`selecting_send`].includes(U.getState().stage)&&await U.cancel()}}),e.onDisconnect.addListener(()=>{e.sender?.documentId&&vt.delete(e.sender.documentId)})}),gt.connect();