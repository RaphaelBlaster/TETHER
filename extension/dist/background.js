import{a as e,i as t,t as n}from"./assets/panel-state-model-D-qQZeYP.js";var r=[{id:`chatgpt`,label:`ChatGPT`,origins:[`https://chatgpt.com`,`https://chat.openai.com`],hostPatterns:[/^chatgpt\.com$/i,/^chat\.openai\.com$/i],composerHints:[`#prompt-textarea`,`div#prompt-textarea.ProseMirror`,`[data-testid="prompt-textarea"]`,`[contenteditable='true'][role='textbox']`,`form [contenteditable="true"]`],submitHints:[`button#composer-submit-button`,`#composer-submit-button`,`button[data-testid="send-button"]`,`button[data-testid="fruitjuice-send-button"]`,`button[aria-label='Send prompt']`,`button[aria-label="Send prompt"]`,`button[type="submit"]`],stopHints:[`button[data-testid="stop-button"]`,`button[aria-label="Stop streaming"]`,`button[aria-label*="Stop"]`],assistantHints:[`[data-message-author-role="assistant"]`,`[data-turn="assistant"]`,`article[data-turn="assistant"]`],userHints:[`[data-message-author-role="user"]`,`[data-turn="user"]`]},{id:`gemini`,label:`Gemini`,origins:[`https://gemini.google.com`],hostPatterns:[/^gemini\.google\.com$/i],composerHints:[`div.ql-editor[contenteditable="true"]`,`rich-textarea [contenteditable="true"]`,`[contenteditable="true"][aria-label*="prompt" i]`,`[contenteditable="true"][aria-label*="Enter" i]`,`div[contenteditable="true"]`],submitHints:[`button[aria-label*="Send" i]`,`button.send-button`,`button[mattooltip*="Send" i]`,`button[type="submit"]`],stopHints:[`button[aria-label*="Stop" i]`,`button[aria-label*="Cancel" i]`],assistantHints:[`model-response`,`.model-response-text`,`[data-message-author-role="model"]`,`.response-container`],userHints:[`.user-query`,`[data-message-author-role="user"]`]},{id:`deepseek`,label:`DeepSeek`,origins:[`https://chat.deepseek.com`],hostPatterns:[/^chat\.deepseek\.com$/i],composerHints:[`textarea`,`[contenteditable="true"]`,`textarea#chat-input`,`.chat-input textarea`],submitHints:[`button[type="submit"]`,`div[role="button"][aria-label*="Send" i]`,`button[aria-label*="Send" i]`,`.send-button`],stopHints:[`button[aria-label*="Stop" i]`],assistantHints:[`.ds-markdown`,`.message-assistant`,`[class*="assistant"]`],userHints:[`.message-user`,`[class*="user"]`]},{id:`claude`,label:`Claude`,origins:[`https://claude.ai`],hostPatterns:[/^claude\.ai$/i],composerHints:[`div[contenteditable="true"].ProseMirror`,`div[contenteditable="true"][translate="no"]`,`fieldset [contenteditable="true"]`,`[contenteditable="true"]`],submitHints:[`button[aria-label="Send Message"]`,`button[aria-label*="Send" i]`,`button[type="submit"]`],stopHints:[`button[aria-label*="Stop" i]`,`button[aria-label*="Interrupt" i]`],assistantHints:[`[data-is-streaming]`,`.font-claude-message`,`[data-test-render-count]`],userHints:[`.font-user-message`]}];function i(e){return r.find(t=>t.id===e)||null}function a(e){let t=``,n=``;try{let r=new URL(e);t=r.hostname,n=r.origin}catch{return null}for(let e of r)if(e.origins?.some(e=>e===n)||e.hostPatterns?.some(e=>e.test(t)))return e;return null}function o(){return[`textarea`,`input[type="text"]`,`input:not([type])`,`[contenteditable="true"]`,`[role="textbox"]`]}function s(){return[`button[type="submit"]`,`button#composer-submit-button`,`#composer-submit-button`,`button[aria-label="Send prompt"]`,`button[aria-label*="Send" i]`,`button[aria-label*="Submit" i]`,`button[title*="Send" i]`,`[role="button"][aria-label*="Send" i]`]}var c=new Set([`https://chromewebstore.google.com`,`https://chrome.google.com`,`https://microsoftedge.microsoft.com`]);function l(e){let t;try{t=new URL(e)}catch{return{kind:`restricted`,reason:`invalid_url`}}if(![`http:`,`https:`].includes(t.protocol)||c.has(t.origin))return{kind:`restricted`,reason:`browser_restricted`};let n=a(t.href),r=n?.id===`chatgpt`&&/^\/c\/([^/?#]+)/.exec(t.pathname)?.[1]?decodeURIComponent(/^\/c\/([^/?#]+)/.exec(t.pathname)[1]):null;return{kind:`web`,origin:t.origin,host:t.hostname,permissionPattern:`${t.origin}/*`,calibrationKey:t.origin,providerId:n?.id??`site:${t.origin}`,label:n?.label??t.hostname,conversationId:r,hasAdapter:!!n,providerKind:n?`llm`:`generic`}}function u(e){let t=l(e);return t.kind===`web`?t:null}var d=`browserSessions`,f=`tetherSessionSchemaVersion`,p=`tabAttachments`,m=class extends Error{constructor(e,t){super(t),this.name=`BrowserSessionError`,this.code=e}};function h({storage:e,getTab:t,uuid:n=()=>crypto.randomUUID(),now:r=()=>Date.now()}={}){let i={},a=new Map;function o(){a=new Map;for(let e of Object.values(i))a.set(e.tabId,e.browserSessionId)}async function s(){await e.set({[f]:1,[d]:i})}async function c(){let t=await e.get([f,d,p]);return i=t.tetherSessionSchemaVersion===1?t.browserSessions??{}:{},await e.remove(p),await l(),S()}async function l(){let e={},n=new Set;for(let a of Object.values(i))if(!(!g(a)||n.has(a.tabId)))try{let i=await t(a.tabId),o=u(i?.url);if(!o||o.providerId!==a.providerId||o.origin!==a.origin)continue;n.add(a.tabId),e[a.browserSessionId]={...a,transportMode:a.transportMode===`CROSS`?`CROSS`:`CLI`,role:a.transportMode===`CROSS`&&a.role===`SLAVE`?`SLAVE`:a.transportMode===`CROSS`?`MASTER`:`ENDPOINT`,windowId:i.windowId,conversationId:o.conversationId,lastSeenAt:r()}}catch{}return i=e,o(),await s(),S()}async function h(e,t,o,c={}){if(!Number.isInteger(e?.id)||!Number.isInteger(e?.windowId))throw new m(`invalid_tab`,`No valid browser tab is available`);let l=c.transportMode===`CROSS`?`CROSS`:`CLI`,d=l===`CROSS`&&c.role===`SLAVE`?`SLAVE`:l===`CROSS`?`MASTER`:`ENDPOINT`,f=x(e.id);if(f){let e={...f,transportMode:l,role:d,lastSeenAt:r()};return i={...i,[e.browserSessionId]:e},await s(),e}let p=S();if(l===`CLI`&&p.length>0)throw new m(`cli_endpoint_exists`,`CLI already has an active endpoint`);if(l===`CROSS`&&p.length>=2)throw new m(`cross_pair_complete`,`CROSS already has its MASTER and SLAVE endpoints`);if(l===`CROSS`&&p.some(e=>e.transportMode===`CROSS`&&e.role===d))throw new m(`cross_role_taken`,`CROSS already has a ${d} endpoint`);let h=u(e.url);if(!h)throw new m(`restricted_tab`,`This browser page does not allow TETHER access`);let g=t[h.calibrationKey];if(!h.hasAdapter&&(!g||g.version!==1))throw new m(`calibration_required`,`This site must be calibrated first`);if(!h.hasAdapter&&!o?.valid)throw new m(`calibration_invalid`,`The saved controls must be validated before activation`);let _=r(),v=n(),y={schemaVersion:1,browserSessionId:v,tabId:e.id,windowId:e.windowId,providerId:h.providerId,origin:h.origin,conversationId:h.conversationId,calibrationKey:h.calibrationKey,transportMode:l,role:d,status:`active`,createdAt:_,lastSeenAt:_};return i={...i,[v]:y},a.set(e.id,v),await s(),y}async function _(e,t=()=>`ENDPOINT`){let n=e===`CROSS`?`CROSS`:`CLI`,a=S();if(n===`CLI`&&a.length>1)throw new m(`multiple_cli_endpoints`,`Deactivate all but one endpoint before switching to CLI mode`);if(n===`CROSS`&&a.length>2)throw new m(`too_many_cross_endpoints`,`CROSS supports exactly one MASTER and one SLAVE endpoint`);let c=a.map(e=>n===`CROSS`?t(e):`ENDPOINT`);if(n===`CROSS`&&new Set(c).size!==c.length)throw new m(`duplicate_cross_role`,`CROSS requires one LLM MASTER and one non-LLM SLAVE`);return i=Object.fromEntries(a.map((e,t)=>[e.browserSessionId,{...e,transportMode:n,role:c[t],lastSeenAt:r()}])),o(),await s(),S()}async function v(e,t){let n=x(e);if(!n)throw new m(`inactive_session`,`Activate this tab before changing its CROSS role`);if(n.transportMode!==`CROSS`)throw new m(`invalid_mode`,`Only CROSS endpoints have MASTER or SLAVE roles`);if(![`MASTER`,`SLAVE`].includes(t))throw new m(`invalid_role`,`Choose MASTER or SLAVE`);if(S().some(n=>n.tabId!==e&&n.transportMode===`CROSS`&&n.role===t))throw new m(`cross_role_taken`,`CROSS already has a ${t} endpoint`);let a={...n,role:t,lastSeenAt:r()};return i={...i,[a.browserSessionId]:a},await s(),a}async function y(e){let t=x(e?.id);if(!t)return null;let n=u(e.url);if(!n||n.providerId!==t.providerId||n.origin!==t.origin)return await b(e.id),null;let a={...t,windowId:e.windowId,conversationId:n.conversationId,lastSeenAt:r()};return i={...i,[a.browserSessionId]:a},await s(),a}async function b(e){let t=x(e);if(!t)return!1;let n={...i};return delete n[t.browserSessionId],i=n,a.delete(e),await s(),!0}function ee(e,t){let n=i[e];if(!n)throw new m(`unknown_session`,`Unknown browser session`);if(n.tabId!==t)throw new m(`session_tab_mismatch`,`Browser session does not belong to sender tab`);return n}function x(e){let t=a.get(e);return t?i[t]??null:null}function te(e){return i[e]??null}function S(){return Object.values(i)}return{initialize:c,reconcile:l,activate:h,configureMode:_,setRole:v,updateTab:y,removeByTabId:b,assertSender:ee,getByTabId:x,getById:te,list:S}}function g(e){return!!(e&&e.schemaVersion===1&&typeof e.browserSessionId==`string`&&e.browserSessionId&&Number.isInteger(e.tabId)&&Number.isInteger(e.windowId)&&typeof e.providerId==`string`&&typeof e.origin==`string`&&typeof e.calibrationKey==`string`&&e.status===`active`&&Number.isFinite(e.createdAt)&&Number.isFinite(e.lastSeenAt))}var _=`tether-extension`,v=`tetherExtensionInstanceId`,y=`TETHER_EXTENSION_ADAPTER_OK`;async function b(e,t=()=>crypto.randomUUID()){let n=(await e.get(v))[v];if(D(n))return n;let r=t();if(!D(r))throw Error(`Generated extension instance ID is invalid`);return await e.set({[v]:r}),r}function ee(e,t,n){if(![`hello`,`sessions_changed`].includes(e)||!D(t))throw Error(`Invalid extension registration`);return{protocol:_,version:1,type:e,extensionInstanceId:t,sessions:n.filter(e=>e.status===`active`).map(T)}}function x(e){if(typeof e!=`string`||e.length>16777216)throw Error(`Message must be bounded text`);let t=JSON.parse(e);if(!O(t)||t.protocol!==`tether-extension`||t.version!==1)throw Error(`Unsupported TETHER extension message`);if(t.type===`ping`&&D(t.requestId)||t.type===`test_request`&&D(t.requestId)&&D(t.browserSessionId)&&t.payload?.message===`TETHER_ADAPTER_EXTENSION_CHECK`||t.type===`browser_request`&&D(t.requestId)&&D(t.browserSessionId)&&O(t.payload)&&typeof t.payload.prompt==`string`&&t.payload.prompt.length>0&&t.payload.prompt.length<=16777216&&typeof t.payload.installBootstrap==`boolean`||t.type===`browser_cancel`&&D(t.requestId)&&D(t.browserSessionId))return t;throw Error(`Unsupported TETHER extension message`)}function te(e){return E(`pong`,{requestId:e})}function S(e,t){return E(`test_completed`,{requestId:e,browserSessionId:t,payload:{message:y}})}function C(e,t,n){return E(`test_error`,{requestId:e,browserSessionId:t,error:{code:n?.code??`test_request_failed`,message:(n instanceof Error?n.message:String(n||`Test request failed`)).slice(0,1024)}})}function ne(e,t,n){if(typeof n!=`string`||n.length>16777216)throw Error(`Browser response must be bounded text`);return E(`browser_completed`,{requestId:e,browserSessionId:t,payload:{text:n}})}function w(e,t,n){return E(`browser_error`,{requestId:e,browserSessionId:t,error:{code:n?.code??`browser_request_failed`,message:(n instanceof Error?n.message:String(n||`Browser request failed`)).slice(0,1024)}})}function re(e,t,n){return`${e}\u0000${t}\u0000${n}`}function T(e){return{browserSessionId:e.browserSessionId,tabId:e.tabId,origin:e.origin,providerId:e.providerId,conversationId:e.conversationId??null,transportMode:e.transportMode===`CROSS`?`CROSS`:`CLI`,role:e.transportMode===`CROSS`&&e.role===`SLAVE`?`SLAVE`:e.transportMode===`CROSS`?`MASTER`:`ENDPOINT`}}function E(e,t){return{protocol:_,version:1,type:e,...t}}function D(e){return typeof e==`string`&&e.length>0&&e.length<=128}function O(e){return typeof e==`object`&&!!e&&!Array.isArray(e)}var ie=Object.freeze({CONNECTING:`connecting`,CONNECTED:`connected`,RETRYING:`retrying`}),k=[500,1e3,2e3,4e3,1e4],ae=128;function oe({url:e=`ws://127.0.0.1:8766/tether/extension`,createSocket:t=e=>new WebSocket(e),schedule:n=setTimeout,cancelSchedule:r=clearTimeout,retryDelays:i=k,getRegistration:a=async()=>{throw Error(`Browser sessions are not initialized`)},onTestRequest:o=async()=>{},onBrowserRequest:s=async()=>{throw Error(`Browser request handler is unavailable`)},onStateChange:c=()=>{}}={}){let l=null,u=null,d=0,f=ie.RETRYING,p=null,m=new Map,h=new Map;function g(e){f=e,c(e)}function _(){u!==null&&(r(u),u=null)}function v(){if(u!==null)return;g(ie.RETRYING);let e=i[Math.min(d,i.length-1)];d+=1,u=n(()=>{u=null,D()},e)}async function y(e,t){let n=await a();return l===e?(p=n,e.send(JSON.stringify(ee(t,n.extensionInstanceId,n.sessions))),!0):!1}function b(e,t){for(h.set(e,t);h.size>ae;)h.delete(h.keys().next().value)}function T(e,t){l===e&&e.send(JSON.stringify(t))}function E(e,t){let n=p;if(!n)throw Error(`Extension registration is unavailable`);let r=re(n.extensionInstanceId,t.browserSessionId,t.requestId);if(t.type===`browser_cancel`){let e=m.get(r);e&&(m.delete(r),e.controller.abort());return}let i=h.get(r);if(i){T(e,i);return}if(m.has(r))return;let a=new AbortController,c=Promise.resolve(t.type===`test_request`?o(t,n):s(t,n,{signal:a.signal})).then(e=>t.type===`test_request`?S(t.requestId,t.browserSessionId):ne(t.requestId,t.browserSessionId,e),e=>t.type===`test_request`?C(t.requestId,t.browserSessionId,e):w(t.requestId,t.browserSessionId,e)).then(t=>{m.get(r)?.operation===c&&(m.delete(r),b(r,t),T(e,t))});m.set(r,{operation:c,controller:a})}function D(){_();let n=l;l=null,n?.close(),p=null,A();let r=t(e);l=r,g(ie.CONNECTING),r.addEventListener(`open`,()=>{l===r&&(d=0,y(r,`hello`).then(e=>{e&&g(ie.CONNECTED)},()=>{l===r&&r.close(1011,`Registration failed`)}))}),r.addEventListener(`message`,e=>{if(l===r)try{let t=x(e.data);t.type===`ping`?T(r,te(t.requestId)):E(r,t)}catch{r.close(1002,`Invalid TETHER extension message`)}}),r.addEventListener(`close`,()=>{l===r&&(l=null,p=null,A(),v())}),r.addEventListener(`error`,()=>{l===r&&r.close()})}async function O(){let e=l;return!e||f!==ie.CONNECTED?!1:y(e,`sessions_changed`)}function oe(){_();let e=l;l=null,p=null,A(),e?.close()}return{connect:D,getState:()=>f,sessionsChanged:O,stop:oe};function A(){for(let e of m.values())e.controller.abort();m.clear()}}function A(e,t){return e?e.version!==1||e.origin!==t||!ce(e.composer)||!ce(e.send)||e.responseCalibration!=null&&!se(e.responseCalibration)?le(`schema_invalid`,{loaded:!0,profile:e}):le(`stored`,{loaded:!0,profile:e}):le(`missing`)}function se(e){return!!(e&&e.version===1&&e.sampleCount===3&&ce(e.conversationRoot)&&j(e.assistantTurn)&&j(e.assistantContent))}function j(e){return!!(e&&e.version===1&&typeof e.tagName==`string`&&e.tagName&&e.attributes&&typeof e.attributes==`object`&&typeof e.primarySelector==`string`&&e.primarySelector&&Array.isArray(e.fallbackSelectors)&&Number.isInteger(e.expectedMatchCount)&&e.expectedMatchCount>=1)}function ce(e){return!!(e&&e.version===1&&typeof e.tagName==`string`&&e.tagName&&e.attributes&&typeof e.attributes==`object`&&typeof e.primarySelector==`string`&&Array.isArray(e.fallbackSelectors)&&Array.isArray(e.ancestorChain))}function le(e,t={}){return{code:e,valid:!1,loaded:!1,composerResolved:!1,sendResolved:!1,...t}}var ue=`calibrationProfiles`,de=`activeCalibration`,fe=[`starting`,`selecting_composer`,`selecting_send`,`validating_new_profile`],pe=[`idle`,`complete`,`cancelled`,`failed`];function me({injectContentScript:e,sendTabMessage:t,loadProfiles:n,saveProfiles:r,loadActiveOperation:i=async()=>null,saveActiveOperation:a=async()=>{},clearActiveOperation:o=async()=>{},getPageState:s=async()=>null,publish:c=()=>{}}){let l=he();async function u(e){return l={...l,...e},c(l),fe.includes(l.stage)?await a({requestId:l.requestId,tabId:l.tabId,origin:l.origin,mode:l.mode,startedAt:l.startedAt,stage:l.stage}):await o(),l}async function d(){let e=await i();if(!_e(e))return await o(),l;l={...he(),...e,error:null},c(l);try{let t=await s(e.tabId);return!t?.active||t.requestId!==e.requestId||![`selecting_composer`,`selecting_send`].includes(t.stage)?u({...M(`failed`),error:`Calibration could not be recovered after worker restart`}):u({stage:t.stage,error:null})}catch{return u({...M(`failed`),error:`Calibration page is no longer available`})}}async function f({requestId:n,tab:r,origin:i,mode:a=`replace`}){if(ge({requestId:n,tab:r,origin:i,mode:a}),fe.includes(l.stage)){if(l.tabId===r.id)return l;throw Error(`Another calibration is already active in a different tab`)}if(!pe.includes(l.stage))throw Error(`Calibration cannot start from its current state`);try{await u({stage:`starting`,requestId:n,tabId:r.id,origin:i,mode:a,startedAt:Date.now(),error:null,profile:null}),await e(r.id);let o=await t(r.id,{type:`calibration.start`,requestId:n,origin:i,mode:a});if(!o?.ok)throw Error(o?.error??`The page integration could not be started`);return u({stage:`selecting_composer`,error:null})}catch(e){throw await u({...M(`failed`),error:ve(e)}),e}}async function p(e=l.requestId){let{tabId:n}=l;return Number.isInteger(n)&&await t(n,{type:`calibration.cancel`,requestId:e}).catch(()=>{}),u({...M(`cancelled`),error:null})}async function m(e,t){if(t!==l.tabId||e.requestId!==l.requestId)return l;if(e.stage===`complete`){await u({stage:`validating_new_profile`,error:null});let t=e.profile;if(A(t,l.origin).code!==`stored`)return u({...M(`failed`),error:`The page returned an invalid calibration profile`});try{return await r({...await n(),[l.origin]:t}),u({...M(`complete`),error:null,profile:t})}catch(e){return u({...M(`failed`),error:e instanceof Error?e.message:`The replacement calibration could not be saved`})}}return e.stage===`failed`||e.stage===`cancelled`?u({...M(e.stage),error:e.error??null}):e.stage===`selection_rejected`&&[`selecting_composer`,`selecting_send`].includes(e.calibrationStage)?u({stage:e.calibrationStage,error:e.error??`Choose a different element`}):[`selecting_composer`,`selecting_send`].includes(e.stage)?u({stage:e.stage,error:null}):l}function h(e){return e===l.tabId?u({...M(`failed`),error:`The calibrated tab was closed`}):Promise.resolve(l)}function g(e,t){return e===l.tabId&&(t.status===`loading`||t.url)?u({...M(`failed`),error:`The calibrated tab navigated`}):Promise.resolve(l)}return{restore:d,start:f,cancel:p,handlePageState:m,handleTabRemoved:h,handleTabUpdated:g,getState:()=>l}}function he(){return{stage:`idle`,requestId:null,tabId:null,origin:null,mode:null,startedAt:null,error:null,profile:null}}function M(e){return{stage:e,requestId:null,tabId:null,origin:null,mode:null,startedAt:null}}function ge({requestId:e,tab:t,origin:n,mode:r}){if(typeof e!=`string`||e.length===0||e.length>128)throw Error(`A valid calibration request ID is required`);if(!Number.isInteger(t?.id)||t.url==null)throw Error(`No valid browser tab is available`);if(new URL(t.url).origin!==n)throw Error(`The selected tab changed before calibration started`);if(r!==`replace`)throw Error(`Unsupported calibration mode`)}function _e(e){return!!(e&&typeof e.requestId==`string`&&Number.isInteger(e.tabId)&&typeof e.origin==`string`&&e.mode===`replace`&&fe.includes(e.stage))}function ve(e){let t=e instanceof Error?e.message:String(e);return/Cannot access|chrome:\/\/|edge:\/\/|Cannot use import statement/i.test(t)?`The page integration could not be started. Reload the page and try again.`:/Receiving end does not exist|Could not establish connection/i.test(t)?`The page integration could not be reached. Reload the page and try again.`:t||`Calibration could not start`}function ye({resolvePanelTab:e,inspectSite:t,hasAccess:n,assertAvailable:r=()=>{},start:i}){return async function(a,o){let s=await e(o),c=t(s?.url);if(c.kind!==`web`)throw Error(`TETHER cannot access this browser page`);if(!await n(c.origin))throw Error(`Permission is required for this site`);return r(s),i({requestId:a.requestId,tab:s,origin:c.origin,mode:`replace`})}}function be(){let e=Promise.resolve();return{run(t){let n=e.then(t,t);return e=n.catch(()=>{}),n}}}function xe({sidePanel:e,hasSession:t}){let n=new Map,r=be();async function i(t,r=[]){await e.setOptions({enabled:!1});for(let n of t)await e.setOptions({tabId:n.tabId,path:`index.html`,enabled:!0});for(let e of r)Number.isInteger(e?.windowId)&&Number.isInteger(e?.id)&&n.set(e.windowId,e.id)}function a(t){if(!Number.isInteger(t?.id)||!Number.isInteger(t?.windowId))return Promise.reject(Error(`No active tab is available`));n.set(t.windowId,t.id);let r=e.setOptions({tabId:t.id,path:`index.html`,enabled:!0}),i=e.open({tabId:t.id});return Promise.all([r,i])}function o({tabId:i,windowId:a}){return r.run(async()=>{let r=n.get(a);n.set(a,i),Number.isInteger(r)&&r!==i&&!t(r)&&await e.setOptions({tabId:r,enabled:!1}).catch(()=>{}),await e.setOptions({tabId:i,path:`index.html`,enabled:t(i)})})}function s(t){return r.run(()=>e.setOptions({tabId:t.tabId,path:`index.html`,enabled:!0}))}function c(t){return r.run(()=>[...n.values()].includes(t)?Promise.resolve():e.setOptions({tabId:t,enabled:!1}).catch(()=>{}))}function l(e){for(let[t,r]of n)r===e&&n.delete(t)}return{initialize:i,openManually:a,handleActivated:o,sessionActivated:s,sessionRemoved:c,handleRemoved:l}}var Se=1e6,N=class extends Error{constructor(e,t){super(t),this.name=`InjectionCoordinatorError`,this.code=e}};function Ce({sendTabMessage:e,publish:t=()=>{},timeoutMs:n=12e3,setTimer:r=setTimeout,clearTimer:i=clearTimeout,now:a=()=>Date.now()}){let o=new Map,s=new Map,c=new Map;function l({requestId:l,session:u,profile:d,text:f}){we({requestId:l,session:u,profile:d,text:f});let p=o.get(u.browserSessionId);if(p)return p.requestId===l?p.promise:Promise.reject(new N(`session_busy`,`This browser session is already injecting a test message`));let m=s.get(u.browserSessionId);if(m?.requestId===l)return m.ok?Promise.resolve(m.value):Promise.reject(m.error);let h,g=!1,_=new Promise((t,n)=>{h=(t=`cancelled`)=>{g||(g=!0,e(u.tabId,{type:`injection.cancel`,requestId:l}).catch(()=>{}),n(new N(t,Te(t))))}}),v,y=new Promise((t,i)=>{v=r(()=>{e(u.tabId,{type:`injection.cancel`,requestId:l}).catch(()=>{}),i(new N(`injection_timeout`,`Test-message injection timed out`))},n)}),b={requestId:l,browserSessionId:u.browserSessionId,tabId:u.tabId,origin:u.origin,stage:`injecting`,startedAt:a()};t(b),c.set(u.browserSessionId,b);let ee=e(u.tabId,{type:`injection.execute`,requestId:l,browserSessionId:u.browserSessionId,origin:u.origin,profile:d,text:f}).then(e=>{if(!e?.ok)throw new N(e?.code??`injection_failed`,e?.error??`Test-message injection failed`);return{...b,stage:`complete`,result:e.result}}),x=Promise.race([ee,_,y]).then(e=>(s.set(u.browserSessionId,{requestId:l,ok:!0,value:e}),c.set(u.browserSessionId,e),t(e),e),e=>{let n=e instanceof N?e:new N(`injection_failed`,e instanceof Error?e.message:String(e));s.set(u.browserSessionId,{requestId:l,ok:!1,error:n});let r={...b,stage:n.code===`cancelled`?`cancelled`:`failed`,error:n.message};throw c.set(u.browserSessionId,r),t(r),n}).finally(()=>{i(v),o.get(u.browserSessionId)?.requestId===l&&o.delete(u.browserSessionId)});return o.set(u.browserSessionId,{...b,promise:x,cancel:h}),x}function u(e,t=`cancelled`){let n=o.get(e);return n?(n.cancel(t),!0):!1}function d(e,t=`cancelled`){for(let n of o.values())n.tabId===e&&n.cancel(t)}function f(e){let t=[...o.values()].find(t=>t.tabId===e);return t?{requestId:t.requestId,browserSessionId:t.browserSessionId,tabId:t.tabId,origin:t.origin,stage:t.stage,startedAt:t.startedAt}:null}function p(e){return c.get(e)??null}return{start:l,cancelBySessionId:u,cancelByTabId:d,getByTabId:f,getBySessionId:p}}function we({requestId:e,session:t,profile:n,text:r}){if(typeof e!=`string`||e.length===0||e.length>128)throw new N(`invalid_request_id`,`A valid injection request ID is required`);if(!t?.browserSessionId||!Number.isInteger(t.tabId)||!t.origin)throw new N(`invalid_session`,`A valid activated browser session is required`);if(!n||n.origin!==t.origin||n.version!==1)throw new N(`calibration_mismatch`,`The calibration profile does not belong to this browser session`);if(typeof r!=`string`||r.trim().length===0)throw new N(`empty_text`,`Enter a plain-text test message`);if(r.length>1e6)throw new N(`text_too_large`,`Test message exceeds ${Se} characters`)}function Te(e){return e===`tab_closed`?`The owning browser tab was closed`:e===`tab_navigated`?`The owning browser tab navigated`:e===`session_deactivated`?`TETHER was deactivated for the owning tab`:`Test-message injection was cancelled`}function Ee({sendTabMessage:e,publish:t=()=>{}}){let n=new Map,r=new Map;async function i({requestId:i,session:a,profile:o,text:s}){let c=r.get(a.browserSessionId);if(c){if(c.requestId===i)return c.promise;throw De(`session_busy`,`This browser session is already observing a response`)}let l={requestId:i,browserSessionId:a.browserSessionId,tabId:a.tabId,stage:`observing`,text:null,error:null};n.set(a.browserSessionId,l),t(l);let u,d=e(a.tabId,{type:`extraction.execute.v2`,requestId:i,browserSessionId:a.browserSessionId,origin:a.origin,profile:o,text:s}).then(e=>{if(!e?.ok)throw De(e?.code,e?.error);let r={...l,stage:`complete`,result:e.result};return n.set(a.browserSessionId,r),t(r),r},e=>{throw e}).catch(e=>{let r={...l,stage:e?.code===`cancelled`?`cancelled`:`failed`,error:e.message};throw n.set(a.browserSessionId,r),t(r),e}).finally(()=>{r.get(a.browserSessionId)===u&&r.delete(a.browserSessionId)});return u={...l,promise:d},r.set(a.browserSessionId,u),d}function a(i,a=`cancelled`){let o=r.get(i);if(!o)return!1;r.delete(i),e(o.tabId,{type:`extraction.cancel.v2`,requestId:o.requestId}).catch(()=>{});let s={...o,stage:`cancelled`,error:a};return n.set(i,s),t(s),!0}function o(e,t){for(let n of r.values())n.tabId===e&&a(n.browserSessionId,t)}return{start:i,cancelBySessionId:a,cancelByTabId:o,getBySessionId:e=>n.get(e)??null}}function De(e=`extraction_failed`,t=`Response extraction failed`){return Object.assign(Error(t),{code:e})}var Oe=class extends Error{constructor(e,t,n={}){super(t),this.name=`AutomationError`,this.code=e,this.diagnostics=ke(n)}};function ke(e){if(!e||typeof e!=`object`)return{};let t={};for(let[n,r]of Object.entries(e))if(r!=null)if(typeof r==`string`)t[n]=r.slice(0,500);else if(typeof r==`number`||typeof r==`boolean`)t[n]=r;else if(Array.isArray(r))t[n]=r.slice(0,20).map(e=>typeof e==`string`?e.slice(0,200):e);else try{t[n]=JSON.parse(JSON.stringify(r))}catch{t[n]=String(r).slice(0,200)}return t}var P=Object.freeze({NO_ACTIVE_SESSION:`no_active_session`,MULTIPLE_ACTIVE_SESSIONS:`multiple_active_sessions`,INACTIVE_SESSION:`inactive_session`,TAB_UNAVAILABLE:`tab_unavailable`,DEBUGGER_ATTACH_FAILED:`debugger_attach_failed`,DEBUGGER_DETACHED:`debugger_detached`,COMPOSER_NOT_FOUND:`composer_not_found`,COMPOSER_NOT_EDITABLE:`composer_not_editable`,PROMPT_WRITE_FAILED:`prompt_write_failed`,PROMPT_VERIFICATION_FAILED:`prompt_verification_failed`,SEND_NOT_FOUND:`send_not_found`,SEND_NOT_ACTIONABLE:`send_not_actionable`,SUBMISSION_NOT_OBSERVED:`submission_not_observed`,ASSISTANT_RESPONSE_NOT_FOUND:`assistant_response_not_found`,RESPONSE_TIMEOUT:`response_timeout`,OPERATION_CANCELLED:`operation_cancelled`,ADAPTER_DISCONNECTED:`adapter_disconnected`});function Ae(e){async function t(t,n,r={}){let i=await e.sendCommand(t,`Runtime.evaluate`,{expression:n,returnByValue:!0,awaitPromise:!0,userGesture:!0,...r});if(i?.exceptionDetails){let e=i.exceptionDetails.exception?.description||i.exceptionDetails.text||`Runtime.evaluate failed`,t=Error(e);throw t.code=`cdp_evaluate_failed`,t}return i?.result?.value}async function n(t,n){await e.sendCommand(t,`Input.insertText`,{text:n})}async function r(t,n){await e.sendCommand(t,`Input.dispatchKeyEvent`,n)}async function i(e,t){let i={key:`Control`,code:`ControlLeft`,windowsVirtualKeyCode:17,nativeVirtualKeyCode:17},a={key:`a`,code:`KeyA`,windowsVirtualKeyCode:65,nativeVirtualKeyCode:65},o={key:`Backspace`,code:`Backspace`,windowsVirtualKeyCode:8,nativeVirtualKeyCode:8};await r(e,{type:`rawKeyDown`,...i}),await r(e,{type:`rawKeyDown`,...a,modifiers:2}),await r(e,{type:`keyUp`,...a,modifiers:2}),await r(e,{type:`keyUp`,...i}),await r(e,{type:`rawKeyDown`,...o}),await r(e,{type:`keyUp`,...o}),await n(e,t)}async function a(e){let t={key:`Enter`,code:`Enter`,windowsVirtualKeyCode:13,nativeVirtualKeyCode:13};await r(e,{type:`rawKeyDown`,...t,text:`\r`}),await r(e,{type:`char`,...t,text:`\r`}),await r(e,{type:`keyUp`,...t})}async function o(t,n,r){let i={x:n,y:r,button:`left`,clickCount:1};await e.sendCommand(t,`Input.dispatchMouseEvent`,{type:`mousePressed`,buttons:1,...i}),await e.sendCommand(t,`Input.dispatchMouseEvent`,{type:`mouseReleased`,buttons:0,...i})}return{evaluate:t,insertText:n,replaceFocusedText:i,dispatchKey:r,pressEnter:a,mouseClickAt:o}}function F(e){return new Promise(t=>setTimeout(t,e))}var je=/\b(search|filter|find|query|lookup|go to|jump to|ask anything about your chats)\b/i;function Me({composerHints:e=[],submitHints:t=[],calibratedComposer:n=null,calibratedSend:r=null,calibratedComposerSelectors:i=[],calibratedSendSelectors:a=[]}={}){let c={composerHints:e,submitHints:t,genericComposer:o(),genericSubmit:s(),calibratedComposer:n,calibratedSend:r,calibratedComposerSelectors:i,calibratedSendSelectors:a};return`(() => {
    const cfg = ${JSON.stringify(c)};
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
    const calibratedComposerEls = new Set(queryAll(cfg.calibratedComposerSelectors));
    const calibratedSendEls = new Set(queryAll(cfg.calibratedSendSelectors));
    const composerEls = unique([
      ...calibratedComposerEls,
      ...hintComposerEls,
      ...queryAll(cfg.genericComposer),
    ]);
    const sendEls = unique([
      ...calibratedSendEls,
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
        calibrated: calibratedComposerEls.has(el) || matchesFingerprint(el, cfg.calibratedComposer),
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
        calibrated: calibratedSendEls.has(el) || matchesFingerprint(el, cfg.calibratedSend),
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
  })()`}function Le(){let e=0;return{click(){if(e+=1,e>1){let e=Error(`Send clicked more than once`);throw e.code=`multiple_clicks`,e}return e},get count(){return e}}}function Re({userSelectors:e=[],assistantSelectors:t=[],response:n=null}={}){return`(() => {
    const userSelectors = ${JSON.stringify(e)};
    const assistantSelectors = ${JSON.stringify(t)};
    const response = ${JSON.stringify(n)};

    function root() {
      for (const selector of response?.rootSelectors || []) {
        try {
          const element = document.querySelector(selector);
          if (element) return element;
        } catch (_) {}
      }
      return document;
    }

    function count(sels) {
      for (const s of sels || []) {
        try {
          const n = root().querySelectorAll(s).length;
          if (n) return n;
        } catch (_) {}
      }
      return 0;
    }

    function texts(sels, limit = 50) {
      for (const s of sels || []) {
        try {
          const nodes = [...root().querySelectorAll(s)];
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
    const aSels = response?.turnSelectors?.length
      ? response.turnSelectors
      : assistantSelectors.length ? assistantSelectors : asstDefault;
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
  })()`}function ze({baseline:e,stopHints:t=[],progressHints:n=[],response:r=null}){return`(() => {
    const baseline = ${JSON.stringify(e||{})};
    const stopHints = ${JSON.stringify(t)};
    const progressHints = ${JSON.stringify(n)};
    const response = ${JSON.stringify(r)};

    function root() {
      for (const selector of response?.rootSelectors || []) {
        try {
          const element = document.querySelector(selector);
          if (element) return element;
        } catch (_) {}
      }
      return document;
    }

    function nodesFor(sels) {
      for (const s of sels || []) {
        try {
          const nodes = [...root().querySelectorAll(s)];
          if (nodes.length) return nodes;
        } catch (_) {}
      }
      return [];
    }

    function cleanText(el) {
      if (!el) return '';
      let regions = [el];
      for (const selector of response?.contentSelectors || []) {
        try {
          const matches = [...el.querySelectorAll(selector)];
          if (matches.length) {
            regions = matches;
            break;
          }
        } catch (_) {}
      }
      return regions.map((region) => {
        const clone = region.cloneNode(true);
        const exclusions = [
          'button', 'nav', 'svg', '[data-testid*="copy"]', '[aria-label*="Copy"]',
          '[aria-label*="Good"]', '[aria-label*="Bad"]', '[class*="feedback"]',
          ...(response?.excludeSelectors || []),
        ];
        for (const selector of exclusions) {
          try { clone.querySelectorAll(selector).forEach((n) => n.remove()); } catch (_) {}
        }
        return (clone.innerText || clone.textContent || '').replace(/\\u00a0/g, ' ').trim();
      }).filter(Boolean).join('\\n').trim();
    }

    function any(sels) {
      for (const s of sels || []) {
        try {
          if (document.querySelector(s)) return true;
        } catch (_) {}
      }
      return false;
    }

    const asstSels = response?.turnSelectors?.length ? response.turnSelectors : baseline.assistantSelectors || [
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

    const streaming = any(stopSels.concat(progressHints));

    return {
      found: Boolean(target) && !isOld && text.length > 0,
      text: isOld ? '' : text,
      length: isOld ? 0 : text.length,
      assistantCount: nodes.length,
      prevAssistantCount: prevCount,
      streaming,
      isOld,
    };
  })()`}function Be(e){if(!e||typeof e!=`string`)return!1;let t=e.trim(),n=t.search(/\{\s*"schemaVersion"\s*:/),r=n>=0?t.slice(n):t;if(!(r.startsWith(`{`)||r.startsWith(`[`)))return!1;let i=!1,a=!1,o=0;for(let e=0;e<r.length;e++){let t=r[e];if(i){a?a=!1:t===`\\`?a=!0:t===`"`&&(i=!1);continue}if(t===`"`){i=!0;continue}(t===`{`||t===`[`)&&(o+=1),(t===`}`||t===`]`)&&--o}return!!(i||a||o>0)}function Ve({stableMs:e=900,requireNonEmpty:t=!0}={}){let n=``,r=0;return{update(i,{streaming:a=!1,now:o=Date.now()}={}){let s=i||``;return t&&!s.trim()||a?(n=s,r=0,{stable:!1,text:s}):s===n?(r||=o,{stable:o-r>=e&&!Be(s),text:s,stableForMs:o-r}):(n=s,r=o,{stable:!1,text:s})},reset(){n=``,r=0}}}function He(e,t){if(!e||!t)return!1;let n=e.replace(/\\s+/g,` `).trim(),r=String(t).replace(/\\s+/g,` `).trim();return n===r||n.includes(r)&&n.length<r.length+20}var Ue=`providerAdapterCacheV1`,We=64*1024,Ge=3e3,Ke=300,qe=16,Je=4,Ye=new Set([`schemaVersion`,`origin`,`adapterVersion`,`engineVersion`,`composer`,`send`,`response`,`completion`]),Xe=Object.freeze({schemaVersion:1,origin:`https://tinker.thinkingmachines.ai`,adapterVersion:1,engineVersion:1,composer:{selectors:[`textarea[aria-label="Message"]`]},send:{selectors:[`button[aria-label="Send message"]`]},response:{turnSelectors:[`article:has(button[aria-label="View raw"]):has(button[aria-label="Copy request ID"])`],contentSelectors:[`p`],excludeSelectors:[`[data-slot="collapsible"]`]},completion:{stopSelectors:[`button[aria-label="Stop generating"]`],progressSelectors:[`[role="status"]`]}});function Ze(e=[]){return[...e.flatMap(e=>(e.origins??[]).map(t=>({schemaVersion:1,origin:t,adapterVersion:1,engineVersion:1,composer:{selectors:[...e.composerHints??[]]},send:{selectors:[...e.submitHints??[]]},response:{turnSelectors:[...e.assistantHints??[]],contentSelectors:[],excludeSelectors:[]},completion:{stopSelectors:[...e.stopHints??[]],progressSelectors:[]}}))),Xe]}function Qe(e,t){let n=typeof e==`string`?e:JSON.stringify(e);if(lt(n)>65536)throw L(`manifest_too_large`,`Provider adapter exceeds ${We} bytes`);let r;try{r=JSON.parse(typeof e==`string`?e:n)}catch{throw L(`manifest_json_invalid`,`Provider adapter must be valid JSON`)}if(at(r,Ye,`manifest`),r.schemaVersion!==1)throw L(`manifest_schema_unsupported`,`Unsupported provider adapter schema version`);if(r.engineVersion!==1)throw L(`manifest_engine_unsupported`,`Provider adapter requires an unsupported engine`);if(!Number.isSafeInteger(r.adapterVersion)||r.adapterVersion<1)throw L(`manifest_schema_invalid`,`adapterVersion must be a positive integer`);let i;try{let e=new URL(r.origin);if(![`http:`,`https:`].includes(e.protocol)||e.origin!==r.origin)throw Error();i=e.origin}catch{throw L(`manifest_schema_invalid`,`origin must be an exact HTTP(S) origin`)}if(t&&i!==new URL(t).origin)throw L(`manifest_origin_mismatch`,`Provider adapter origin does not match the target page`);return rt(r.composer,`composer`,!0),rt(r.send,`send`,!0),at(r.response,new Set([`turnSelectors`,`contentSelectors`,`excludeSelectors`]),`response`),it(r.response.turnSelectors,`response.turnSelectors`,!0),it(r.response.contentSelectors,`response.contentSelectors`,!1),it(r.response.excludeSelectors,`response.excludeSelectors`,!1),at(r.completion,new Set([`stopSelectors`,`progressSelectors`]),`completion`),it(r.completion.stopSelectors,`completion.stopSelectors`,!1),it(r.completion.progressSelectors,`completion.progressSelectors`,!1),dt(r)}function $e({packagedManifests:e=[],storage:t=null,fetchManifest:n=null,timeoutMs:r=Ge,now:i=()=>Date.now()}={}){let a=new Map;for(let t of e){let e=Qe(t,t?.origin);a.set(e.origin,e)}let o=null;async function s(){return o||=(async()=>{if(!t)return{origins:{}};let e=(await t.get(Ue))?.[Ue];return e&&ft(e.origins)?e:{origins:{}}})(),o}async function c(e){t&&await t.set({[Ue]:e})}function l(e){return a.get(I(e))??null}async function u(e){let t=I(e),n=(await s()).origins[t],r=n?.versions?.[n.activeVersion]?.manifest;if(r)try{return ut(Qe(r,t),n.activeVersion===n.rollbackVersion?`rollback`:`cache`)}catch{}let i=l(t);return i?ut(i,`packaged`):null}async function d(e,{refresh:t=!1}={}){let a=I(e),o=await u(a);if(!t||typeof n!=`function`)return o;let l=await s(),d=l.origins[a],p;try{if(p=await st(n,{origin:a,etag:d?.etag??null,timeoutMs:r}),p?.notModified)return o;let e=Qe(p?.manifest??p,a);return o&&e.adapterVersion<=o.adapterVersion?(p?.etag&&d?.etag!==p.etag&&(l.origins[a]={...d??{versions:{}},etag:p.etag,checkedAt:i()},await c(l)),o):(await f(a,e,{etag:p?.etag??null}),ut(e,`remote`))}catch{return o}}async function f(e,t,{etag:n=null}={}){let r=I(e),a=Qe(t,r),o=await s(),u=o.origins[r]??{versions:{}},d={...u.versions,[a.adapterVersion]:{manifest:a,etag:n,acceptedAt:i()}};return ct(d,a.adapterVersion),o.origins[r]={...u,previousActiveVersion:u.activeVersion??l(r)?.adapterVersion??null,activeVersion:a.adapterVersion,rollbackVersion:null,etag:n,versions:d},await c(o),ut(a,`cache`)}async function p(e,t){let n=I(e),r=await s(),a=r.origins[n];if(!a||a.activeVersion!==t)return u(n);let o={...a.rejectedVersions??{},[t]:i()},l=a.previousActiveVersion;return l&&a.versions?.[l]?(a.activeVersion=l,a.rollbackVersion=l):delete r.origins[n],r.origins[n]&&(r.origins[n].rejectedVersions=o),await c(r),u(n)}async function m(e,t){let n=I(e),r=await s(),a=r.origins[n]??{versions:{}},o=a.versions?.[t]?.manifest??null,u=l(n);if(!o&&u?.adapterVersion===t&&(o=u),!o)throw L(`adapter_version_missing`,`Requested provider adapter version is unavailable`);let d=Qe(o,n);return a.versions={...a.versions,[t]:a.versions?.[t]??{manifest:d,etag:null,acceptedAt:i()}},a.previousActiveVersion=a.activeVersion??null,a.activeVersion=t,a.rollbackVersion=t,r.origins[n]=a,await c(r),ut(d,`rollback`)}return{resolve:d,accept:f,reject:p,rollback:m,getPackaged:l}}function et({endpointForOrigin:e,fetchImpl:t=fetch,maxBytes:n=We}={}){if(typeof e!=`function`)throw TypeError(`endpointForOrigin is required`);return async function({origin:r,etag:i,signal:a}){let o=e(r),s={Accept:`application/json`};i&&(s[`If-None-Match`]=i);let c=await t(o,{method:`GET`,headers:s,signal:a,credentials:`omit`,cache:`no-store`,redirect:`error`});if(c.status===304)return{notModified:!0};if(!c.ok)throw L(`registry_unavailable`,`Registry returned HTTP ${c.status}`);let l=Number(c.headers.get(`content-length`));if(Number.isFinite(l)&&l>n)throw L(`manifest_too_large`,`Provider adapter exceeds ${n} bytes`);let u=await c.text();if(lt(u)>n)throw L(`manifest_too_large`,`Provider adapter exceeds ${n} bytes`);return{manifest:u,etag:c.headers.get(`etag`)}}}function tt(e){let t;try{t=new URL(e)}catch{throw TypeError(`Provider adapter registry URL is invalid`)}if(t.protocol!==`https:`||t.username||t.password||t.search||t.hash)throw TypeError(`Provider adapter registry must be an HTTPS base URL`);return function(e){let n=new URL(`/v1/adapters`,t);return n.searchParams.set(`origin`,I(e)),n.href}}function nt(e){let t=e?.composer?.selectors??[],n=e?.send?.selectors??[];return`(() => {
    const composerSelectors = ${JSON.stringify(t)};
    const sendSelectors = ${JSON.stringify(n)};
    function matches(selectors) {
      const found = [];
      for (const selector of selectors) {
        try {
          for (const element of document.querySelectorAll(selector)) {
            if (!found.includes(element)) found.push(element);
          }
        } catch (_) { return { invalidSelector: true, count: 0 }; }
      }
      return { invalidSelector: false, count: found.length };
    }
    const composer = matches(composerSelectors);
    const send = matches(sendSelectors);
    return {
      valid: !composer.invalidSelector && !send.invalidSelector &&
        composer.count === 1 && send.count <= 1,
      composerCount: composer.count,
      sendCount: send.count,
      invalidSelector: composer.invalidSelector || send.invalidSelector,
    };
  })()`}function rt(e,t,n){at(e,new Set([`selectors`]),t),it(e.selectors,`${t}.selectors`,n)}function it(e,t,n){if(!Array.isArray(e)||n&&e.length===0||e.length>qe)throw L(`manifest_schema_invalid`,`${t} must be a bounded selector array`);for(let n of e)if(typeof n!=`string`||n.length===0||n.length>Ke||ot(n))throw L(`manifest_selector_unsafe`,`${t} contains an unsafe selector`)}function at(e,t,n){if(!ft(e)||Object.keys(e).some(e=>!t.has(e))||[...t].some(t=>!(t in e)))throw L(`manifest_schema_invalid`,`${n} does not match the strict schema`)}function ot(e){for(let t of e){let e=t.charCodeAt(0);if(e<32||e===127||`{}@`.includes(t))return!0}return!1}async function st(e,{origin:t,etag:n,timeoutMs:r}){let i=new AbortController,a;try{return await Promise.race([e({origin:t,etag:n,signal:i.signal}),new Promise((e,t)=>{a=setTimeout(()=>{i.abort(),t(L(`registry_timeout`,`Provider adapter registry timed out`))},r)})])}finally{clearTimeout(a)}}function ct(e,t){let n=Object.keys(e).map(Number).sort((e,t)=>t-e);for(let r of n.slice(Je))r!==t&&delete e[r]}function I(e){try{let t=new URL(e);if(![`http:`,`https:`].includes(t.protocol))throw Error();return t.origin}catch{throw L(`manifest_origin_invalid`,`A valid HTTP(S) origin is required`)}}function lt(e){return new TextEncoder().encode(e).byteLength}function ut(e,t){return{...e,source:t}}function dt(e){Object.freeze(e);for(let t of Object.values(e))t&&typeof t==`object`&&!Object.isFrozen(t)&&dt(t);return e}function ft(e){return typeof e==`object`&&!!e&&!Array.isArray(e)}function L(e,t){return Object.assign(Error(t),{code:e})}var pt=`direct-cdp`;function R(e,t,n){throw new Oe(e,t,n)}function mt({composerFp:e,composerSelector:t,prompt:n}){return`(() => {
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
  })()`}function ht({transport:e,calibrationStore:t,adapterRegistry:r}={}){let o=Ae(e),s=new Map,c=new Map;function l(e,t,n){return`${e}::${t}::${n}`}function u(e){e?.aborted&&R(P.OPERATION_CANCELLED,`Operation cancelled`)}async function d(t,r){r?.(n.ATTACHING_DEBUGGER);try{await e.attach(t)}catch(e){R(P.DEBUGGER_ATTACH_FAILED,e?.message||`Failed to attach debugger`,{tabId:t})}}async function f(t){await e.sendCommand(t,`Page.enable`).catch(()=>{}),await Promise.all([e.sendCommand(t,`Page.setWebLifecycleState`,{state:`active`}).catch(()=>{}),e.sendCommand(t,`Emulation.setFocusEmulationEnabled`,{enabled:!0}).catch(()=>{})])}function p(e,t){return e&&i(e)||a(t)||null}async function m(e){return t?typeof t.get==`function`?t.get(e):t[e]||null:null}async function h(e){let{requestId:t,browserSessionId:i,tabId:a,origin:h,providerId:g,prompt:_,signal:v,extensionInstanceId:y=`local`,onStage:b,onProgress:ee,timeoutMs:x=12e4,clearFirst:te=!0}=e||{};a??R(P.TAB_UNAVAILABLE,`tabId is required`),typeof _!=`string`&&R(P.PROMPT_WRITE_FAILED,`prompt must be a string`);let S=l(y,i,t),C=s.get(S);if(C){if(C.status===`pending`)return C.promise;if(C.status===`completed`)return C.result;if(C.status===`failed`)throw C.error}let ne=new AbortController;c.set(S,ne);let w={get aborted(){return ne.signal.aborted||!!v?.aborted}},re=(async()=>{let e=(e,t)=>{b?.(e,t),ee?.({stage:e,...t})};try{e(n.VALIDATING_SESSION,{tabId:a,browserSessionId:i}),u(w),await d(a,e),await f(a),u(w);let t=p(g,h),s=await m(h),c=r?await r.resolve(h,{refresh:!0}):null;c&&c.source!==`packaged`&&((await o.evaluate(a,nt(c)))?.valid||(c=await r.reject(h,c.adapterVersion)));let l=gt(s?.composer),v=gt(s?.send),y=_t(s?.responseCalibration,c),b=vt(l,c?.composer?.selectors,t?.composerHints),S=vt(v,c?.send?.selectors,t?.submitHints),C=vt(c?.completion?.stopSelectors,t?.stopHints),ne=vt(c?.completion?.progressSelectors);e(n.CAPTURING_BASELINE);let re=await o.evaluate(a,Re({userSelectors:t?.userHints||[],assistantSelectors:t?.assistantHints||[],response:y}));u(w),e(n.RESOLVING_COMPOSER);let T=await o.evaluate(a,Me({composerHints:b,submitHints:S,calibratedComposer:s?.composer||null,calibratedSend:s?.send||null,calibratedComposerSelectors:l,calibratedSendSelectors:v}));T?.composer||R(P.COMPOSER_NOT_FOUND,`Could not discover chat composer`,{discovery:T?.discovery}),ee?.({stage:n.RESOLVING_COMPOSER,discovery:{composerFound:!0,sendFound:!!T.send,composerMethod:T.composer.method,sendMethod:T.send?.method,calibrationRequired:T.discovery?.calibrationRequired}}),e(n.WRITING_PROMPT,{length:_.length});let E=await o.evaluate(a,Pe({composerFp:T.composer.fingerprint,composerSelector:T.composer.selector,prompt:_,clearFirst:te}));if(!E?.ok)try{await o.evaluate(a,`(() => {
                const el = document.querySelector(${JSON.stringify(T.composer.selector)}) ||
                  document.querySelector('#prompt-textarea') ||
                  document.querySelector('[contenteditable="true"]');
                if (el) { el.focus(); return true; }
                return false;
              })()`),await o.replaceFocusedText(a,_),await F(120),E={ok:!0,fallback:`insertText`}}catch{R(E?.code||P.PROMPT_WRITE_FAILED,E?.message||`Failed to write prompt`)}e(n.VERIFYING_PROMPT),await F(80);let D=await o.evaluate(a,mt({composerFp:T.composer.fingerprint,composerSelector:T.composer.selector,prompt:_}));if(!D?.ok){try{await o.evaluate(a,`(() => {
                const el = document.querySelector('#prompt-textarea') ||
                  document.querySelector('[contenteditable="true"]');
                if (el) el.focus();
                return !!el;
              })()`),await o.replaceFocusedText(a,_),await F(150)}catch{}D=await o.evaluate(a,mt({composerFp:T.composer.fingerprint,composerSelector:T.composer.selector,prompt:_})),D?.ok||R(P.PROMPT_VERIFICATION_FAILED,`Composer did not contain the exact prompt after write`)}await F(200),u(w),e(n.RESOLVING_SEND);let O=T.send,ie=Date.now()+15e3;for(;u(w),O=(await o.evaluate(a,Me({composerHints:b,submitHints:S,calibratedComposer:s?.composer||null,calibratedSend:s?.send||null,calibratedComposerSelectors:l,calibratedSendSelectors:v})))?.send||O,!(await o.evaluate(a,Ne({composerFp:T.composer.fingerprint,sendFp:O?.fingerprint,composerSelector:T.composer.selector,sendSelector:O?.selector})))?.send?.actionable;)Date.now()>ie&&R(O?P.SEND_NOT_ACTIONABLE:P.SEND_NOT_FOUND,O?`Send control never became actionable`:`Send control not found`),await F(120);e(n.SUBMITTING),Le().click();let k=await o.evaluate(a,Fe({sendFp:O.fingerprint,sendSelector:O.selector}));k?.clickable||R(k?.code||P.SEND_NOT_ACTIONABLE,k?.message||`Send click failed`,k?.diagnostics),await o.mouseClickAt(a,k.centerX,k.centerY),e(n.VERIFYING_SUBMISSION);let ae=!1,oe=Date.now()+2e4;for(;Date.now()<oe;){if(u(w),(await o.evaluate(a,Ie({baseline:{...re,composerText:_,composerLength:_.length},promptPreview:_.slice(0,200),stopHints:C})))?.submitted){ae=!0;break}await F(200)}ae||R(P.SUBMISSION_NOT_OBSERVED,`Submission was not observed after clicking Send`),e(n.OBSERVING_RESPONSE);let A=Ve({stableMs:900}),se=Date.now()+x,j=null;for(;Date.now()<se;){u(w);let t=await o.evaluate(a,ze({baseline:re,stopHints:C,progressHints:ne,response:y}));if(j=t,t?.found&&t.text){if(He(t.text,_)){await F(250);continue}let r=A.update(t.text,{streaming:!!t.streaming});if(ee?.({stage:t.streaming?n.OBSERVING_RESPONSE:n.WAITING_FOR_STABILITY,text:t.text,streaming:t.streaming}),r.stable)return e(n.COMPLETE),{text:t.text,engine:pt,diagnostics:{composerMethod:T.composer.method,sendMethod:O?.method,assistantCount:t.assistantCount}}}else ee?.({stage:n.OBSERVING_RESPONSE,text:t?.text||``,streaming:!!t?.streaming});await F(350)}if(j?.text&&!He(j.text,_))return e(n.COMPLETE),{text:j.text,engine:pt,diagnostics:{timedOut:!0}};R(P.RESPONSE_TIMEOUT,`Timed out waiting for a stable assistant response`,{lastLength:j?.length||0})}finally{c.delete(S)}})();s.set(S,{status:`pending`,promise:re});try{let e=await re;return s.set(S,{status:`completed`,result:e,promise:re}),e}catch(e){let t=e instanceof Oe?e:new Oe(e?.code||`failed`,e?.message||String(e));throw s.set(S,{status:`failed`,error:t,promise:re}),t}}function g({requestId:e,browserSessionId:t,extensionInstanceId:n=`local`}){let r=l(n,t,e),i=c.get(r);return i?(i.abort(),!0):!1}async function _(t){try{await e.detach(t)}catch{}}function v(){return pt}function y(){return s}return{request:h,cancel:g,release:_,getEngine:v,_idempotencyMap:y,correlationKey:l}}function gt(e){return e?vt([e.primarySelector,...e.fallbackSelectors||[]]):[]}function _t(e,t){let n=e?{rootSelectors:gt(e.conversationRoot),turnSelectors:gt(e.assistantTurn),contentSelectors:gt(e.assistantContent)}:null,r=t?.response??null;return!n&&!r?null:{rootSelectors:n?.rootSelectors??[],turnSelectors:n?.turnSelectors?.length?n.turnSelectors:r?.turnSelectors??[],contentSelectors:n?.contentSelectors?.length?n.contentSelectors:r?.contentSelectors??[],excludeSelectors:r?.excludeSelectors??[]}}function vt(...e){return[...new Set(e.flat().filter(Boolean))]}var yt=`1.3`;function bt(){let e=new Map;function t(t){return e.get(t)?.state||`not_attached`}async function n(t){let n=e.get(t);if(n?.state===`attached`)return;if(n?.attachPromise){await n.attachPromise;return}e.set(t,{state:`attaching`});let r=(async()=>{try{await chrome.debugger.attach({tabId:t},yt),e.set(t,{state:`attached`})}catch(n){let r=String(n?.message||n);if(/already attached/i.test(r)){try{await chrome.debugger.detach({tabId:t})}catch{}await chrome.debugger.attach({tabId:t},yt),e.set(t,{state:`attached`});return}e.set(t,{state:`failed`});let i=Error(r);throw i.code=`debugger_attach_failed`,i}})();e.set(t,{state:`attaching`,attachPromise:r}),await r}async function r(n){if(t(n)===`not_attached`){try{await chrome.debugger.detach({tabId:n})}catch{}e.delete(n);return}e.set(n,{state:`detaching`});try{await chrome.debugger.detach({tabId:n})}catch{}e.delete(n)}async function i(n,r,i={}){if(t(n)!==`attached`)try{await chrome.debugger.attach({tabId:n},yt),e.set(n,{state:`attached`})}catch(e){let t=Error(String(e?.message||e));throw t.code=`debugger_detached`,t}try{return await chrome.debugger.sendCommand({tabId:n},r,i)}catch(t){let r=String(t?.message||t);if(/not attached|detached|debugger is not attached/i.test(r)){e.delete(n);let t=Error(r);throw t.code=`debugger_detached`,t}throw t}}function a(t){e.delete(t)}function o(e){return t(e)===`attached`}return globalThis.chrome?.debugger?.onDetach&&chrome.debugger.onDetach.addListener(e=>{e?.tabId!=null&&a(e.tabId)}),{attach:n,detach:r,sendCommand:i,getState:t,isAttached:o,markDetached:a,PROTOCOL_VERSION:yt}}function xt(e,t){if(e?.url){let n=l(e.url);return!t||n.kind!==`web`||n.origin!==t.origin||n.providerId!==t.providerId}return e?.status===`loading`}function St(e,t){return e?.url?xt({url:e.url},t):!1}function Ct(){try{globalThis.__tetherContentScriptCleanup?.()}catch{}delete globalThis.__tetherContentScriptCleanup,delete globalThis.__tetherCalibrationVersion}async function wt({tabId:e,executeScript:t,sendTabMessage:n}){try{let t=await n(e,{type:`tether.endpointReady`});if(t?.ok)return t}catch{}await t({target:{tabId:e},func:Ct}),await t({target:{tabId:e},files:[`content-script.js`]});let r=await n(e,{type:`tether.endpointReady`});if(!r?.ok)throw Object.assign(Error(`TETHER endpoint did not acknowledge readiness`),{code:`endpoint_not_ready`});return r}var Tt=`activeResponseCalibrations`,Et=new Set([`starting`,`injecting_marker`,`waiting_for_marker`,`marker_captured`,`inferring_structure`,`manual_selection_required`,`manual_selecting_turn`]);function Dt({injectContentScript:e,sendTabMessage:t,loadProfiles:n,saveProfiles:r,loadActiveOperations:i=async()=>({}),saveActiveOperations:a=async()=>{},getPageState:o=async()=>null,publish:s=()=>{}}){let c=new Map;async function l(){let e={};for(let[t,n]of c)Et.has(n.stage)&&(e[t]=At(n));await a(e)}async function u(e,t){let n={...c.get(e)??kt(e),...t};return c.set(e,n),s(jt(n)),await l(),n}async function d({requestId:n,session:r,profile:i}){Ot({requestId:n,session:r,profile:i});let a=c.get(r.browserSessionId);if(a&&Et.has(a.stage)){if(a.requestId===n)return a;throw B(`session_busy`,`This browser session is already calibrating responses`)}await u(r.browserSessionId,{stage:`starting`,requestId:n,browserSessionId:r.browserSessionId,tabId:r.tabId,origin:r.origin,turn:0,totalTurns:3,startedAt:Date.now(),error:null});try{await e(r.tabId);let a=await t(r.tabId,{type:`responseCalibration.start`,requestId:n,browserSessionId:r.browserSessionId,origin:r.origin,profile:i});if(!a?.ok)throw B(a?.code??`start_failed`,a?.error??`Response calibration could not start`);return c.get(r.browserSessionId)}catch(e){throw await u(r.browserSessionId,z(`failed`,e)),e}}async function f(e,t){let i=c.get(e.browserSessionId);if(!i||i.tabId!==t||i.requestId!==e.requestId)return null;if(e.stage===`complete`){if(!se(e.responseCalibration))return u(i.browserSessionId,z(`failed`,B(`invalid_result`,`The page returned invalid response calibration`)));let t=await n(),a=t[i.origin];if(A(a,i.origin).code!==`stored`)return u(i.browserSessionId,z(`failed`,B(`profile_changed`,`The control calibration changed during response calibration`)));let o={...a,responseCalibration:e.responseCalibration};return await r({...t,[i.origin]:o}),u(i.browserSessionId,{...z(`complete`),responseCalibration:e.responseCalibration})}return e.stage===`failed`||e.stage===`cancelled`?u(i.browserSessionId,z(e.stage,B(e.code,e.error))):Et.has(e.stage)?u(i.browserSessionId,{stage:e.stage,turn:e.turn??i.turn,totalTurns:3,error:null}):i}async function p(e,n=`cancelled`){let r=c.get(e);return!r||!Et.has(r.stage)?!1:(await t(r.tabId,{type:`responseCalibration.cancel`,requestId:r.requestId}).catch(()=>{}),await u(e,z(`cancelled`,B(n,Nt(n)))),!0)}async function m(e){let n=c.get(e);if(!n||n.stage!==`manual_selection_required`)throw B(`manual_selection_unavailable`,`No guided response calibration is waiting in this tab`);let r=await t(n.tabId,{type:`responseCalibration.manualSelect`,requestId:n.requestId});if(!r?.ok)throw B(r?.code??`manual_selection_failed`,r?.error??`Guided response selection could not start`);return u(e,{stage:`manual_selecting_turn`,error:null})}async function h(){let e=await i();for(let t of Object.values(e??{}))if(Mt(t)){c.set(t.browserSessionId,t);try{let e=await o(t.tabId);e?.requestId===t.requestId&&e.browserSessionId===t.browserSessionId?await f(e,t.tabId):await u(t.browserSessionId,z(`failed`,B(`restart_lost`,`Response calibration could not be recovered`)))}catch{await u(t.browserSessionId,z(`failed`,B(`tab_unavailable`,`The response-calibration tab is unavailable`)))}}await l()}function g(e,t){return Promise.all([...c.values()].filter(t=>t.tabId===e).map(e=>p(e.browserSessionId,t)))}return{start:d,startManualSelection:m,cancel:p,restore:h,handlePageState:f,cancelByTabId:g,getBySessionId:e=>c.has(e)?jt(c.get(e)):null}}function Ot({requestId:e,session:t,profile:n}){if(typeof e!=`string`||!e||e.length>128)throw B(`invalid_request_id`,`A valid request ID is required`);if(!t?.browserSessionId||!Number.isInteger(t.tabId))throw B(`invalid_session`,`An activated browser session is required`);if(A(n,t.origin).code!==`stored`)throw B(`invalid_profile`,`Valid control calibration is required`)}function kt(e){return{browserSessionId:e,stage:`idle`,requestId:null,tabId:null,origin:null,turn:0,totalTurns:3,error:null}}function z(e,t=null){return{stage:e,requestId:null,startedAt:null,error:t?.message??null,code:t?.code??null}}function At(e){return{stage:e.stage,requestId:e.requestId,browserSessionId:e.browserSessionId,tabId:e.tabId,origin:e.origin,turn:e.turn,totalTurns:e.totalTurns,startedAt:e.startedAt,error:e.error,code:e.code??null}}function jt(e){return{stage:e.stage,turn:e.turn,totalTurns:e.totalTurns,error:e.error,code:e.code??null}}function Mt(e){return!!(e?.browserSessionId&&Number.isInteger(e.tabId)&&typeof e.requestId==`string`&&Et.has(e.stage))}function B(e=`response_calibration_failed`,t=`Response calibration failed`){return Object.assign(Error(t),{code:e})}function Nt(e){return e===`tab_closed`?`The owning browser tab was closed`:e===`tab_navigated`?`The owning browser tab navigated`:e===`session_deactivated`?`TETHER was deactivated for this tab`:`Response calibration was cancelled`}var Pt=`https://tether-provider-registry.onrender.com`,Ft=`tetherTransportMode`,It=`tetherTheme`,V=`CLI`,Lt=`dark`,Rt=chrome.storage.session.get(Ft).then(e=>{V=e[Ft]===`CROSS`?`CROSS`:`CLI`}),zt=chrome.storage.local.get(It).then(e=>{Lt=e[It]===`light`?`light`:`dark`}),Bt=be();function H(e){chrome.runtime.sendMessage(e).catch(()=>{})}async function U(){return(await chrome.storage.local.get(`calibrationProfiles`)).calibrationProfiles??{}}var Vt=e=>wt({tabId:e,executeScript:e=>chrome.scripting.executeScript(e),sendTabMessage:(e,t)=>chrome.tabs.sendMessage(e,t)}),W=me({injectContentScript(e){return Vt(e)},sendTabMessage:(e,t)=>chrome.tabs.sendMessage(e,t),loadProfiles:U,saveProfiles:e=>chrome.storage.local.set({[ue]:e}),async loadActiveOperation(){return(await chrome.storage.session.get(`activeCalibration`)).activeCalibration??null},saveActiveOperation:e=>chrome.storage.session.set({[de]:e}),clearActiveOperation:()=>chrome.storage.session.remove(de),getPageState:e=>chrome.tabs.sendMessage(e,{type:`calibration.getPageState`}),publish(e){H({type:`calibration.stateChanged`,state:e}),H({type:`panel.stateChanged`})}}),G=h({storage:chrome.storage.session,getTab:e=>chrome.tabs.get(e)}),K=Ce({async sendTabMessage(e,t){return t.type===`injection.execute`&&await Vt(e),chrome.tabs.sendMessage(e,t)},publish(e){H({type:`injection.stateChanged`,state:e}),H({type:`panel.stateChanged`})}}),q=Dt({injectContentScript:e=>Vt(e),sendTabMessage:(e,t)=>chrome.tabs.sendMessage(e,t),loadProfiles:U,saveProfiles:e=>chrome.storage.local.set({[ue]:e}),async loadActiveOperations(){return(await chrome.storage.session.get(`activeResponseCalibrations`)).activeResponseCalibrations??{}},saveActiveOperations:e=>chrome.storage.session.set({[Tt]:e}),getPageState:e=>chrome.tabs.sendMessage(e,{type:`responseCalibration.getPageState`}),publish(e){H({type:`responseCalibration.stateChanged`,state:e}),H({type:`panel.stateChanged`})}}),Ht=Ee({async sendTabMessage(e,t){return t.type===`extraction.execute.v2`&&await Vt(e),chrome.tabs.sendMessage(e,t)},publish(){H({type:`extraction.stateChanged`}),H({type:`panel.stateChanged`})}}),J=xe({sidePanel:chrome.sidePanel,hasSession:e=>!!G.getByTabId(e)});chrome.sidePanel.setPanelBehavior({openPanelOnActionClick:!1}).catch(console.error),chrome.storage.local.setAccessLevel({accessLevel:`TRUSTED_CONTEXTS`}).catch(console.error);var Y=G.initialize(),Ut=b(chrome.storage.local),Wt=W.restore(),Gt=q.restore(),Kt=Y.then(async e=>{let t=await chrome.tabs.query({active:!0});await J.initialize(e,t)}),X=Promise.all([Y,Wt,Gt,Kt]),qt=et({endpointForOrigin:tt(Pt)}),Jt=$e({packagedManifests:Ze(r),storage:chrome.storage.local,fetchManifest:qt}),Yt=ht({transport:bt(),calibrationStore:{get:async e=>(await U())[e]??null},adapterRegistry:Jt});async function Xt(){let[e]=await Promise.all([Ut,Y]);return{extensionInstanceId:e,sessions:G.list()}}async function Zt(e,t){await Y;let n=t.sessions.find(t=>t.browserSessionId===e.browserSessionId),r=G.getById(e.browserSessionId);if(!n||!r||r.status!==`active`)throw Object.assign(Error(`Browser session is not active`),{code:`inactive_session`});let i;try{i=await chrome.tabs.get(r.tabId)}catch{throw Object.assign(Error(`Browser session tab is unavailable`),{code:`tab_unavailable`})}let a=l(i?.url),o={...a,title:i?.title??a.label??null,faviconUrl:i?.favIconUrl??null};if(i?.id!==r.tabId||o.kind!==`web`||o.origin!==r.origin||o.providerId!==r.providerId)throw Object.assign(Error(`Browser session no longer matches its tab`),{code:`session_tab_mismatch`});let s=q.getBySessionId(r.browserSessionId);if(K.getBySessionId(r.browserSessionId)?.stage===`injecting`||Ht.getBySessionId(r.browserSessionId)?.stage===`observing`||s&&![`complete`,`cancelled`,`failed`].includes(s.stage)||W.getState().tabId===r.tabId)throw Object.assign(Error(`Browser session is busy`),{code:`session_busy`})}async function Qt(e,t,{signal:n}){await X,await Zt(e,t);let r=G.getById(e.browserSessionId),i=await Ut;if(n.aborted)throw Object.assign(Error(`Adapter disconnected`),{code:`adapter_disconnected`});let a=()=>Yt.cancel({extensionInstanceId:i,browserSessionId:r.browserSessionId,requestId:e.requestId});n.addEventListener(`abort`,a,{once:!0});try{return await $(r.tabId,`automation`),(await Yt.request({requestId:e.requestId,browserSessionId:r.browserSessionId,extensionInstanceId:i,tabId:r.tabId,origin:r.origin,providerId:r.providerId,prompt:e.payload.prompt,signal:n})).text}finally{n.removeEventListener(`abort`,a),G.getById(r.browserSessionId)&&await $(r.tabId,`active`).catch(()=>{})}}var $t=oe({getRegistration:Xt,onTestRequest:Zt,onBrowserRequest:Qt,onStateChange(e){H({type:`connection.stateChanged`,state:e})}});function en(e){return H({type:`browserSession.stateChanged`,tabId:e}),$t.sessionsChanged()}var tn=new Map;async function Z(e){let t=tn.get(e.documentId);if(Number.isInteger(t))return chrome.tabs.get(t);let[n]=await chrome.tabs.query({active:!0,currentWindow:!0});return n}async function nn(e,t){let n=Date.now();try{return await Vt(e),{...await chrome.tabs.sendMessage(e,{type:`calibration.validateProfile`,profile:t}),validatedAt:n}}catch(e){return{code:`validation_failed`,valid:!1,loaded:!0,composerResolved:!1,sendResolved:!1,validatedAt:n,error:e instanceof Error?e.message:String(e)}}}function rn(e,t,n,r){let i={storageKey:ue,origin:r,loaded:e.loaded,migrated:!1,profileSource:n?n.createdAt?`current_schema`:`checkpoint_4_schema`:`none`,profileVersion:n?.version??null,createdAt:n?.createdAt??null,lastValidatedAt:t?.validatedAt??null,validationResult:t?.code??e.code,composerFingerprintExists:!!n?.composer,sendFingerprintExists:!!n?.send,composerResolved:!!t?.composerResolved,sendResolved:!!t?.sendResolved};return e.code===`missing`?{state:`missing`,validation:e,diagnostics:i}:e.code===`schema_invalid`?{state:`invalid`,validation:e,diagnostics:i}:t?.valid?{state:`valid`,validation:t,diagnostics:i}:t?.code===`validation_failed`?{state:`validation_failed`,validation:t,diagnostics:i}:{state:`needs_update`,validation:t,diagnostics:i}}async function an(t){await X;let n=await Z(t),r=l(n?.url),i={...r,title:n?.title??r.label??null,faviconUrl:n?.favIconUrl??null},a=G.getByTabId(n?.id),o=G.list().filter(e=>e.transportMode===`CROSS`),s={count:V===`CROSS`?o.length:G.list().filter(e=>e.transportMode===`CLI`).length,masterReady:o.some(e=>e.role===`MASTER`),slaveReady:o.some(e=>e.role===`SLAVE`)},c={state:a?`active`:`inactive`,role:a?.role??null,transportMode:a?.transportMode??null};if(i.kind===`restricted`)return{site:i,tabId:n?.id??null,access:`restricted`,calibration:null,activation:c,endpoints:s};let u=(await U())[i.calibrationKey]??null,d=A(u,i.origin);if(!await e(i.origin))return{site:i,tabId:n.id,access:`required`,calibration:{...rn(d,null,u,i.origin),state:`access_required`},activation:c,endpoints:s};let f=rn(d,d.code===`stored`?await nn(n.id,u):null,u,i.origin),p=W.getState(),m=p.tabId===n.id?p:{stage:`idle`,error:null};return{site:i,tabId:n.id,access:`granted`,calibration:f,calibrationOperation:m,injectionOperation:a?K.getBySessionId(a.browserSessionId):null,responseCalibration:{state:u?.responseCalibration?`ready`:`missing`,operation:a?q.getBySessionId(a.browserSessionId):null},extractionOperation:a?Ht.getBySessionId(a.browserSessionId):null,activation:c,endpoints:s}}function Q(e,t){e({ok:!1,error:t.message,code:t.code??`unexpected_error`})}async function $(e,t,n=void 0){await zt;let r=await chrome.tabs.get(e).catch(()=>null),i=l(r?.url);return await Vt(e),chrome.tabs.sendMessage(e,{type:`tether.endpointState`,state:t,mode:V,theme:Lt,message:n,context:{title:r?.title??i.label??`Browser chat`,host:i.host??i.origin??``,faviconUrl:r?.favIconUrl??null}})}var on=ye({resolvePanelTab:Z,inspectSite:l,hasAccess:e,assertAvailable(e){if(K.getByTabId(e.id)?.stage===`injecting`)throw Error(`Cancel the active injection test before starting calibration`);let t=G.getByTabId(e.id),n=t?q.getBySessionId(t.browserSessionId):null;if(n&&![`complete`,`cancelled`,`failed`].includes(n.stage))throw Error(`Cancel response calibration before recalibrating controls`)},start:e=>W.start(e)});chrome.runtime.onMessage.addListener((e,t,n)=>{if(e?.type===`tether.theme.set`)return zt.then(()=>Bt.run(async()=>{if(![`dark`,`light`].includes(e.theme))throw Object.assign(Error(`Unsupported TETHER theme`),{code:`invalid_theme`});return Lt=e.theme,await chrome.storage.local.set({[It]:Lt}),await Promise.all(G.list().map(e=>chrome.tabs.sendMessage(e.tabId,{type:`tether.theme.set`,theme:Lt}).catch(()=>{}))),Lt})).then(e=>n({ok:!0,theme:e}),e=>Q(n,e)),!0;if(e?.type===`mode.get`)return Rt.then(()=>n({ok:!0,mode:V})),!0;if(e?.type===`mode.set`)return Rt.then(()=>Bt.run(async()=>{if(![`CLI`,`CROSS`].includes(e.mode))throw Object.assign(Error(`Unsupported TETHER mode`),{code:`invalid_mode`});let t=e.mode;if(t!==V&&G.list().length>0)throw Object.assign(Error(`Deactivate the current endpoints before switching TETHER modes`),{code:`active_endpoints`});return V=t,await chrome.storage.session.set({[Ft]:t}),await Promise.all(G.list().map(e=>$(e.tabId,`active`).catch(()=>{}))),H({type:`mode.stateChanged`,mode:V}),H({type:`panel.stateChanged`}),V})).then(e=>n({ok:!0,mode:e}),e=>Q(n,e)),!0;if(e?.type===`connection.getState`){n({state:$t.getState()});return}if(e?.type===`panel.getState`)return an(t).then(e=>n({ok:!0,state:e}),e=>Q(n,e)),!0;if(e?.type===`browserSession.activate`)return X.then(()=>Bt.run(async()=>{let n=await Z(t),r=await an(t);if(r.access!==`granted`||!r.site?.hasAdapter&&r.calibration?.state!==`valid`)throw Object.assign(Error(`This site requires a valid calibration before activation`),{code:`calibration_required`});if(V===`CLI`&&!G.getByTabId(n.id)&&G.list().length>0)throw Object.assign(Error(`CLI already has an active endpoint; deactivate it before selecting another tab`),{code:`cli_endpoint_exists`});let i=e.role;if(V===`CROSS`&&![`MASTER`,`SLAVE`].includes(i))throw Object.assign(Error(`Choose MASTER or SLAVE before activating this CROSS endpoint`),{code:`cross_role_required`});if((await Z(t))?.id!==n.id)throw Object.assign(Error(`The side panel changed tabs before activation completed`),{code:`panel_tab_changed`});let a=await chrome.tabs.get(n.id),o=l(a.url);if(o.kind!==`web`||o.origin!==r.site?.origin||o.providerId!==r.site?.providerId)throw Object.assign(Error(`This tab navigated before activation completed; review it and try again`),{code:`tab_navigated`});let s=await G.activate(a,await U(),r.calibration.validation,{transportMode:V,role:V===`CROSS`?i:`ENDPOINT`});return await J.sessionActivated(s),await en(n.id),$(s.tabId,`active`).catch(()=>{}),an(t)})).then(e=>n({ok:!0,state:e}),e=>Q(n,e)),!0;if(e?.type===`browserSession.deactivate`)return X.then(()=>Bt.run(async()=>{let e=await Z(t),n=G.getByTabId(e.id);return n?(await $(n.tabId,`releasing`).catch(()=>{}),await G.removeByTabId(e.id),K.cancelBySessionId(n.browserSessionId,`session_deactivated`),Ht.cancelBySessionId(n.browserSessionId,`session_deactivated`),await q.cancel(n.browserSessionId,`session_deactivated`),await Yt.release(n.tabId).catch(()=>{})):await G.removeByTabId(e.id),await J.sessionRemoved(e.id),await en(e.id),an(t)})).then(e=>n({ok:!0,state:e}),e=>Q(n,e)),!0;if(e?.type===`browserSession.role.set`)return X.then(()=>Bt.run(async()=>{let n=await Z(t),r=await G.setRole(n.id,e.role);return await en(n.id),$(r.tabId,`active`).catch(()=>{}),an(t)})).then(e=>n({ok:!0,state:e}),e=>Q(n,e)),!0;if(e?.type===`browserSession.validate`)return Y.then(()=>G.assertSender(e.browserSessionId,t.tab?.id)).then(e=>n({ok:!0,session:e}),e=>Q(n,e)),!0;if(e?.type===`calibration.start`)return X.then(()=>on(e,t)).then(e=>n({ok:!0,state:e}),e=>{let t=W.getState();n({ok:!1,error:t.error??e.message,state:t})}),!0;if(e?.type===`injection.start`)return X.then(async()=>{let n=await Z(t),r=G.getByTabId(n?.id);if(!r)throw Object.assign(Error(`Activate TETHER for this tab before testing injection`),{code:`inactive_session`});let i=q.getBySessionId(r.browserSessionId);if(i&&![`complete`,`cancelled`,`failed`].includes(i.stage))throw Object.assign(Error(`Response calibration is using this browser session`),{code:`session_busy`});if(r.tabId!==n.id)throw Object.assign(Error(`Browser session does not own the panel-bound tab`),{code:`session_tab_mismatch`});let a=l(n.url);if(a.kind!==`web`||a.origin!==r.origin)throw Object.assign(Error(`The activated browser session no longer matches this page`),{code:`origin_mismatch`});let o=(await U())[r.calibrationKey];if(A(o,r.origin).code!==`stored`)throw Object.assign(Error(`This site requires a valid calibration before testing injection`),{code:`calibration_invalid`});if(W.getState().tabId===n.id)throw Object.assign(Error(`Finish or cancel calibration before testing injection`),{code:`calibration_active`});return K.start({requestId:e.requestId,session:r,profile:o,text:e.text})}).then(e=>n({ok:!0,state:e}),e=>Q(n,e)),!0;if(e?.type===`injection.cancel`)return X.then(async()=>{let e=await Z(t),n=G.getByTabId(e?.id);if(!n)throw Object.assign(Error(`No active browser session exists for this tab`),{code:`inactive_session`});return{cancelled:K.cancelBySessionId(n.browserSessionId)}}).then(e=>n({ok:!0,...e}),e=>Q(n,e)),!0;if(e?.type===`responseCalibration.start`)return X.then(async()=>{let n=await Z(t),r=G.getByTabId(n?.id);if(!r)throw Object.assign(Error(`Activate TETHER in this tab first`),{code:`inactive_session`});if(K.getByTabId(n.id)?.stage===`injecting`)throw Object.assign(Error(`Cancel the injection test first`),{code:`session_busy`});if(W.getState().tabId===n.id)throw Object.assign(Error(`Finish control calibration first`),{code:`page_busy`});let i=(await U())[r.calibrationKey];return q.start({requestId:e.requestId,session:r,profile:i})}).then(e=>n({ok:!0,state:e}),e=>Q(n,e)),!0;if(e?.type===`extraction.start`)return X.then(async()=>{let n=await Z(t),r=G.getByTabId(n?.id);if(!r)throw Object.assign(Error(`Activate TETHER in this tab first`),{code:`inactive_session`});let i=(await U())[r.calibrationKey];if(!i?.responseCalibration)throw Object.assign(Error(`Complete response calibration first`),{code:`response_calibration_missing`});return Ht.start({requestId:e.requestId,session:r,profile:i,text:e.text})}).then(e=>n({ok:!0,state:e}),e=>Q(n,e)),!0;if(e?.type===`extraction.cancel`)return X.then(async()=>{let e=await Z(t),n=G.getByTabId(e?.id);return n?Ht.cancelBySessionId(n.browserSessionId):!1}).then(e=>n({ok:!0,cancelled:e}),e=>Q(n,e)),!0;if(e?.type===`responseCalibration.cancel`)return X.then(async()=>{let e=await Z(t),n=G.getByTabId(e?.id);return n?q.cancel(n.browserSessionId):!1}).then(e=>n({ok:!0,cancelled:e}),e=>Q(n,e)),!0;if(e?.type===`responseCalibration.manualSelect`)return X.then(async()=>{let e=await Z(t),n=G.getByTabId(e?.id);if(!n)throw Object.assign(Error(`Activate TETHER in this tab first`),{code:`inactive_session`});return q.startManualSelection(n.browserSessionId)}).then(e=>n({ok:!0,state:e}),e=>Q(n,e)),!0;if(e?.type===`responseCalibration.pageState`)return X.then(async()=>(await G.assertSender(e.browserSessionId,t.tab?.id),q.handlePageState(e,t.tab.id))).then(()=>n({ok:!0}),e=>Q(n,e)),!0;if(e?.type===`calibration.cancel`)return X.then(async()=>{let n=await Z(t),r=W.getState();if(Number.isInteger(r.tabId)&&r.tabId!==n?.id)throw Error(`Another tab owns the active calibration`);return W.cancel(e.requestId)}).then(e=>n({ok:!0,state:e}),e=>Q(n,e)),!0;if(e?.type===`calibration.pageState`)return W.handlePageState(e,t.tab?.id).then(()=>n({ok:!0}),e=>Q(n,e)),!0}),chrome.action.onClicked.addListener(e=>{J.openManually(e).catch(e=>console.error(`TETHER could not open`,e))}),chrome.tabs.onActivated.addListener(e=>{Kt.then(()=>J.handleActivated(e)).catch(console.error)}),chrome.tabs.onUpdated.addListener((e,t,n)=>{W.handleTabUpdated(e,t);let r=G.getByTabId(e);xt(t,r)&&(K.cancelByTabId(e,`tab_navigated`),Ht.cancelByTabId(e,`tab_navigated`),q.cancelByTabId(e,`tab_navigated`)),St(t,r)&&Yt.release(e).catch(console.error),t.status===`complete`&&r&&!t.url&&$(e,`active`).catch(()=>{}),t.url&&Y.then(async()=>{let r=G.getByTabId(e),i=await G.updateTab(n);r&&!i&&await J.sessionRemoved(e),i&&await J.sessionActivated(i),i&&t.status===`complete`&&await $(e,`active`).catch(()=>{}),(r||i)&&await en(e)}).catch(console.error)}),chrome.tabs.onRemoved.addListener(e=>{W.handleTabRemoved(e),K.cancelByTabId(e,`tab_closed`),Ht.cancelByTabId(e,`tab_closed`),q.cancelByTabId(e,`tab_closed`),Yt.release(e).catch(console.error),Y.then(async()=>{await G.removeByTabId(e),J.handleRemoved(e),await en(e)}).catch(console.error)}),chrome.runtime.onConnect.addListener(e=>{t(e,{getTab:e=>chrome.tabs.get(e),onBind(e,t){t.sender?.documentId&&tn.set(t.sender.documentId,e),t.postMessage({type:`panel.bound`,tabId:e})},onExplicitClose:async e=>{W.getState().tabId===e&&[`starting`,`selecting_composer`,`selecting_send`].includes(W.getState().stage)&&await W.cancel()}}),e.onDisconnect.addListener(()=>{e.sender?.documentId&&tn.delete(e.sender.documentId)})}),$t.connect();