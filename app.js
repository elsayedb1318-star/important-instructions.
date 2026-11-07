(() => {
  const $ = id => document.getElementById(id);
  const listEl = $("conversationList"), dialog = $("messageDialog");
  let messages = [], groups = [], trashItems = [], currentGroup = "instructions", reorderMode = false, selectedId = null, editingId = null, db = null, installPrompt = null, pendingImages = [], viewMode = "active";
  const localKey = "rasayeli_local_messages_v1", localGroupsKey = "rasayeli_local_groups_v1", groupKey = "rasayeli_current_group_v1", DEFAULT_GROUP = "instructions";
  try { currentGroup = localStorage.getItem(groupKey) || DEFAULT_GROUP; } catch {}
  const startupParams = new URLSearchParams(location.search);
  const requestedGroupId = startupParams.get("groupId");
  const requestedMessageId = startupParams.get("messageId");
  if (requestedGroupId) currentGroup = requestedGroupId;
  const allGroups = () => [{id:DEFAULT_GROUP,name:DEFAULT_GROUP}, ...groups];
  const groupName = id => (allGroups().find(g => g.id === id) || {name:"…"}).name;
  const activeMessages = () => viewMode === "trash" ? trashItems : messages.filter(m => viewMode === "archive" ? !!m.archived : !m.archived);
  const inGroup = m => (m.groupId || DEFAULT_GROUP) === currentGroup;
  function loadLocalGroups(){try{return JSON.parse(localStorage.getItem(localGroupsKey)||"[]")}catch{return []}}
  function renderGroupMenu(){
    $("groupCurrent").textContent = groupName(currentGroup);
    const box = $("groupList");
    box.innerHTML = allGroups().map(g => `<button type="button" class="group-item ${g.id===currentGroup?"active":""}" data-gid="${escapeHtml(g.id)}" style="padding-right:${g.parentId?30:12}px">${g.parentId?"↳ ":""}${escapeHtml(g.name)}</button>`).join("");
    box.querySelectorAll("[data-gid]").forEach(b => b.addEventListener("click", () => setGroup(b.dataset.gid)));
    const welcomeBox = $("welcomeGroups");
    if (welcomeBox) {
      welcomeBox.innerHTML = allGroups().map(g => `<button type="button" class="welcome-group ${g.id===currentGroup?"active":""}" data-welcome-gid="${escapeHtml(g.id)}"><span class="welcome-group-icon">▤</span><span>${escapeHtml(g.name)}</span><span class="welcome-group-arrow">←</span></button>`).join("");
      welcomeBox.querySelectorAll("[data-welcome-gid]").forEach(b => b.addEventListener("click", () => setGroup(b.dataset.welcomeGid)));
    }
  }
  function setGroup(id){
    currentGroup = id; try { localStorage.setItem(groupKey, id); } catch {}
    $("groupMenu").classList.add("hidden"); $("groupBtn").setAttribute("aria-expanded","false");
    const first = sortMsgs(messages.filter(m => (m.groupId || DEFAULT_GROUP) === currentGroup))[0];
    selectedId = first ? first.id : null;
    if (!selectedId) showWelcome();
    render();
  }
  async function addGroup(){
    if(blocked()){toast(OFFLINE_MSG);return}
    const raw = prompt("اسم الجروب الجديد"); if(raw === null) return;
    const name = raw.trim().slice(0, 60); if(!name) return;
    if(allGroups().some(g => g.name.toLowerCase() === name.toLowerCase())){ toast("اسم الجروب موجود بالفعل"); return; }
    const g = {name, createdAt: Date.now()};
    try{
      if(db){ const ref = db.ref("savedGroups").push(); await ref.set(g); setGroup(ref.key); }
      else { g.id = "local_" + Date.now() + "_" + Math.random().toString(36).slice(2,8); groups.push(g); localStorage.setItem(localGroupsKey, JSON.stringify(groups)); setGroup(g.id); }
      toast("تمت إضافة الجروب");
    }catch(e){ console.error(e); toast("تعذر إضافة الجروب" + (e && e.code ? " (" + e.code + ")" : "") + ". تحقق من صلاحيات قاعدة البيانات"); }
  }
  async function addSubGroup(){
    if(blocked()){toast(OFFLINE_MSG);return}
    const raw=prompt("اسم المجلد الفرعي داخل: "+groupName(currentGroup));if(raw===null)return;
    const name=raw.trim().slice(0,60);if(!name)return;
    const g={name,parentId:currentGroup,createdAt:Date.now()};
    try{if(db){const ref=db.ref("savedGroups").push();await ref.set(g);setGroup(ref.key)}
      else{g.id="local_"+Date.now();groups.push(g);localStorage.setItem(localGroupsKey,JSON.stringify(groups));setGroup(g.id)}
      toast("تم إنشاء المجلد الفرعي");
    }catch(e){toast("تعذر إنشاء المجلد الفرعي؛ حدّث قواعد Firebase")}
  }
  const escapeHtml = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  // يدعم ألوان النص المحفوظة بصيغة آمنة داخل محتوى الرسالة.
  function renderColoredText(raw){
    const value=String(raw??"");
    const token=/\[color=(#[0-9a-fA-F]{6})\]([\s\S]*?)\[\/color\]/g;
    let out="",last=0,match;
    while((match=token.exec(value))){
      out+=escapeHtml(value.slice(last,match.index)).replace(/\n/g,"<br>");
      out+=`<span style="color:${match[1]}">${escapeHtml(match[2]).replace(/\n/g,"<br>")}</span>`;
      last=token.lastIndex;
    }
    out+=escapeHtml(value.slice(last)).replace(/\n/g,"<br>");
    return out;
  }
  // محرر غني: يحفظ الألوان بصيغة متوافقة مع الرسائل القديمة دون إظهار أكوادها للمستخدم.
  function setEditorContent(value){$("messageContent").innerHTML=renderColoredText(value||"");}
  function editorStoredText(){
    const root=$("messageContent");
    function colorHex(value){
      if(!value)return "";
      const h=value.match(/^#([0-9a-f]{6})$/i);if(h)return "#"+h[1].toLowerCase();
      const rgb=value.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
      return rgb?"#"+[rgb[1],rgb[2],rgb[3]].map(n=>Math.max(0,Math.min(255,+n)).toString(16).padStart(2,"0")).join(""):"";
    }
    function walk(node){
      if(node.nodeType===Node.TEXT_NODE)return node.nodeValue||"";
      if(node.nodeType!==Node.ELEMENT_NODE)return "";
      const tag=node.tagName.toLowerCase();
      if(tag==="br")return "\n";
      let inner=Array.from(node.childNodes).map(walk).join("");
      if(tag==="div"||tag==="p")inner+="\n";
      const color=colorHex(node.getAttribute("data-text-color")||node.style.color||node.getAttribute("color"));
      return color&&inner?`[color=${color}]${inner}[/color]`:inner;
    }
    let result=Array.from(root.childNodes).map(walk).join("");
    return result.replace(/\n+$/,"").replace(/^\n+/,"");
  }
  function editorPlainText(){return editorStoredText().replace(/\[color=#[0-9a-f]{6}\]|\[\/color\]/gi,"");}
  const dateText = v => { try { return new Date(v).toLocaleDateString("ar-EG",{year:"numeric",month:"short",day:"numeric"}); } catch { return ""; } };
  function toast(s){ const t=$("toast");t.textContent=s;t.classList.add("show");setTimeout(()=>t.classList.remove("show"),2600); }
  function setStatus(s,good=false){$("syncStatus").textContent=s;$("syncStatus").style.color=good?"#c9f5df":"#f9d7c7";}
  const sortKey = m => typeof m.order === "number" ? m.order : -(m.updatedAt || m.createdAt || 0);
  const sortMsgs = arr => arr.sort((a, b) => Number(!!b.pinned)-Number(!!a.pinned) || sortKey(a) - sortKey(b));
  function newOrder(){ const o = messages.filter(m => typeof m.order === "number").map(m => m.order); return o.length ? Math.min(...o) - 1 : -Date.now(); }
  function loadLocal(){try{return sortMsgs(JSON.parse(localStorage.getItem(localKey)||"[]"))}catch{return []}}
  function saveLocal(){localStorage.setItem(localKey,JSON.stringify(messages))}
  let online = false, cacheOnly = false, serverMsgs = false, serverGroups = false;
  const blocked = () => (db && !online) || cacheOnly;
  const OFFLINE_MSG = "لا يوجد اتصال بالإنترنت — التعديل غير متاح";
  function idbOpen(){return new Promise((res,rej)=>{const r=indexedDB.open("rasayeli_cache",1);r.onupgradeneeded=()=>r.result.createObjectStore("kv");r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})}
  async function idbGet(k){const d=await idbOpen();return new Promise((res,rej)=>{const q=d.transaction("kv").objectStore("kv").get(k);q.onsuccess=()=>res(q.result);q.onerror=()=>rej(q.error)})}
  async function idbSet(k,v){const d=await idbOpen();return new Promise((res,rej)=>{const t=d.transaction("kv","readwrite");t.objectStore("kv").put(v,k);t.oncomplete=()=>res();t.onerror=()=>rej(t.error)})}
  const lsGet=k=>{try{const r=localStorage.getItem("rasayeli_cache_"+k);return r?JSON.parse(r):undefined}catch{return undefined}};
  const cacheGet=k=>idbGet(k).then(v=>v!==undefined?v:lsGet(k)).catch(()=>lsGet(k));
  const cacheSet=(k,v)=>idbSet(k,v).catch(e=>{console.warn("idb save failed",e);try{localStorage.setItem("rasayeli_cache_"+k,JSON.stringify(v))}catch{}});
  const makePreview = t => String(t || "").replace(/\[color=#[0-9a-fA-F]{6}\]|\[\/color\]/g, "").replace(/\s+/g, " ").trim().slice(0, 90);
  const previewOf = m => typeof m.preview === "string" ? m.preview : makePreview(m.content);
  const hasImgs = m => typeof m.hasImages === "boolean" ? m.hasImages : readImages(m).length > 0;
  const bodyCache = new Map(), inflight = new Map();
  function peekBody(m){
    if(typeof m.content === "string" || typeof m.imagesJson === "string") return {content: m.content || "", imagesJson: m.imagesJson || "[]", filesJson:m.filesJson||"[]"};
    const mem = bodyCache.get(m.id); return mem && mem.updatedAt === m.updatedAt ? mem : null;
  }
  async function loadBody(m){
    const hit = peekBody(m); if(hit) return hit;
    const c = await cacheGet("body:" + m.id);
    if(c && c.updatedAt === m.updatedAt){ bodyCache.set(m.id, c); return c; }
    if(db && online){
      try{
        const v = (await db.ref("savedBodies/" + m.id).once("value")).val() || {};
        const b = {updatedAt: m.updatedAt, content: v.content || "", imagesJson: v.imagesJson || "[]", filesJson:v.filesJson||"[]"};
        bodyCache.set(m.id, b); cacheSet("body:" + m.id, b); return b;
      }catch(e){ console.warn("body load failed", e); }
    }
    return c ? {...c, stale: true} : null;
  }
  function getBody(m){
    const k = m.id + "|" + m.updatedAt; if(inflight.has(k)) return inflight.get(k);
    const p = loadBody(m).finally(() => inflight.delete(k)); inflight.set(k, p); return p;
  }
  let migrating = false, migrationWarned = false;
  async function migrateLegacy(items){
    if(migrating || !db) return; migrating = true;
    try{
      for(let i = 0; i < items.length; i += 3){
        const u = {};
        items.slice(i, i + 3).forEach(v => {
          u["savedBodies/" + v.id] = {content: v.content, imagesJson: v.imagesJson};
          u["savedMessages/" + v.id + "/preview"] = makePreview(v.content);
          u["savedMessages/" + v.id + "/hasImages"] = readImages({imagesJson: v.imagesJson}).length > 0;
          u["savedMessages/" + v.id + "/content"] = null;
          u["savedMessages/" + v.id + "/imagesJson"] = null;
        });
        await db.ref().update(u);
      }
    }catch(e){
      console.warn("migration failed", e);
      if(!migrationWarned){ migrationWarned = true; toast("تعذر تحديث بنية البيانات" + (e && e.code ? " (" + e.code + ")" : "") + " — حدّث قواعد Firebase"); }
    }finally{ migrating = false; }
  }
  function setConnStatus(){
    if(online)setStatus("متصل — التعديل متاح للجميع",true);
    else setStatus(messages.length?"غير متصل — عرض النسخة المحفوظة ("+messages.length+")":"غير متصل — لا توجد نسخة محفوظة، افتح التطبيق مرة بالإنترنت");
  }
  function loadCache(){
    return Promise.all([cacheGet("messages"),cacheGet("groups")]).then(([cm,cg])=>{
      if(!serverMsgs&&Array.isArray(cm))messages=sortMsgs(cm);
      if(!serverGroups&&Array.isArray(cg))groups=cg;
      if(requestedMessageId && messages.some(m => m.id === requestedMessageId)) selectedId = requestedMessageId;
      render();
      if(!online&&!serverMsgs)setConnStatus();
    }).catch(e=>console.warn("cache load failed",e));
  }
  function initFirebase(){
    const c=window.FIREBASE_CONFIG;
    if(c && c.apiKey && c.databaseURL && !window.firebase){cacheOnly=true;setStatus("غير متصل — عرض النسخة المحفوظة");loadCache();return}
    if(!c || !c.apiKey || !c.databaseURL || !window.firebase){messages=loadLocal();groups=loadLocalGroups();setStatus("حفظ محلي فقط");render();return}
    try{
      if(!firebase.apps.length) firebase.initializeApp(c);
      db=firebase.database();
      setStatus("جارٍ الاتصال…");
      loadCache();
      db.ref(".info/connected").on("value",s=>{online=s.val()===true;setConnStatus()});
      db.ref("savedGroups").on("value",snap=>{
        const d=snap.val()||{};
        groups=Object.entries(d).map(([id,v])=>({id,name:String((v&&v.name)||""),parentId:(v&&v.parentId)||"",createdAt:(v&&v.createdAt)||0})).filter(g=>g.name).sort((a,b)=>a.createdAt-b.createdAt);
        if(currentGroup!==DEFAULT_GROUP&&!groups.some(g=>g.id===currentGroup)){currentGroup=DEFAULT_GROUP;try{localStorage.setItem(groupKey,currentGroup)}catch{}}
        serverGroups=true;cacheSet("groups",groups);
        render();
      },err=>{console.error("Groups read error:",err);toast("تعذر تحميل الجروبات"+(err&&err.code?" ("+err.code+")":""))});
      db.ref("savedMessages").on("value", snap=>{
        const data=snap.val()||{};
        const legacy=[];
        messages=sortMsgs(Object.entries(data).map(([id,v])=>{
          const {content,imagesJson,...meta}=v||{};
          if(typeof content==="string"||typeof imagesJson==="string"){
            legacy.push({id,content:content||"",imagesJson:imagesJson||"[]",updatedAt:meta.updatedAt});
            if(typeof meta.preview!=="string")meta.preview=makePreview(content);
            if(typeof meta.hasImages!=="boolean")meta.hasImages=readImages({imagesJson}).length>0;
          }
          return {...meta,id};
        }));
        legacy.forEach(l=>{const b={updatedAt:l.updatedAt,content:l.content,imagesJson:l.imagesJson};bodyCache.set(l.id,b);cacheSet("body:"+l.id,b)});
        if(legacy.length)migrateLegacy(legacy);
        serverMsgs=true;cacheSet("messages",messages);
        if(requestedMessageId && messages.some(m => m.id === requestedMessageId)) {
          selectedId = requestedMessageId;
          const target = messages.find(m => m.id === requestedMessageId);
          if (!requestedGroupId && target && target.groupId) { currentGroup = target.groupId; try { localStorage.setItem(groupKey, currentGroup); } catch {} }
        }
        setConnStatus();
        render();
      },err=>{setStatus("تعذر الاتصال بقاعدة البيانات");console.error("Firebase read error:",err);toast("خطأ اتصال: "+(err&&err.code?err.code:"راجع إعدادات Firebase"));});
      db.ref("deletedMessages").on("value",snap=>{
        const d=snap.val()||{};
        trashItems=Object.entries(d).map(([id,v])=>({...((v&&v.meta)||{}),id,deletedAt:v?.deletedAt||0,trashBody:v?.body||{}}));
        if(viewMode==="trash")render();
      });
      db.ref("deletedMessages").on("value",snap=>{
        const d=snap.val()||{};
        trashItems=Object.entries(d).map(([id,v])=>({...((v&&v.meta)||{}),id,deletedAt:v?.deletedAt||0,trashBody:v?.body||{}}));
        if(viewMode==="trash")render();
      });
    }catch(e){console.error(e);messages=loadLocal();groups=loadLocalGroups();setStatus("إعداد قاعدة البيانات غير صحيح");render()}
  }
  function render(){
    renderGroupMenu();
    const q=$("searchInput").value.trim().toLocaleLowerCase();
    const source=activeMessages();
    const filtered=source.filter(m=>(q || viewMode!=="active" || inGroup(m))&&(!q||`${m.title||""}\n${previewOf(m)}\n${groupName(m.groupId||DEFAULT_GROUP)}`.toLocaleLowerCase().includes(q)||(window._fullSearchIds&&window._fullSearchIds.has(m.id))));
    if(!filtered.length){listEl.innerHTML=`<div class="empty-list">${q?"لا توجد نتائج مطابقة.":"لا توجد عناصر في هذا القسم."}</div>`}
    else listEl.innerHTML=filtered.map(m=>`<div class="conversation ${m.id===selectedId?"active":""}" data-id="${escapeHtml(m.id)}" draggable="${reorderMode&&!q&&viewMode==="active"?"true":"false"}"><div class="avatar">✉</div><div class="conversation-info"><h3>${m.pinned?"📌 ":""}${escapeHtml(m.title)}</h3><p>${q?escapeHtml(groupName(m.groupId||DEFAULT_GROUP))+" · ":""}${escapeHtml(previewOf(m) || (hasImgs(m) ? "📷 صورة مرفقة" : "بدون نص"))}</p></div><time>${escapeHtml(dateText(m.updatedAt||m.createdAt))}</time>${reorderMode&&!q?`<div class="move-btns"><button type="button" data-move="-1" aria-label="تحريك لأعلى">▲</button><button type="button" data-move="1" aria-label="تحريك لأسفل">▼</button></div>`:""}</div>`).join("");
    if(q && !window._fullSearchRunning){
      window._fullSearchRunning=true;
      Promise.all(source.filter(m=>q||viewMode!=="active"||inGroup(m)).map(async m=>{const b=await getBody(m);return {m,text:(b?.content||"").toLocaleLowerCase()};})).then(rows=>{
        const ids=new Set(rows.filter(x=>`${x.m.title||""}\n${x.text}\n${groupName(x.m.groupId||DEFAULT_GROUP)}`.toLocaleLowerCase().includes(q)).map(x=>x.m.id));
        window._fullSearchIds=ids; render();
      }).finally(()=>{window._fullSearchRunning=false;});
    }
    if(q && window._fullSearchIds) { /* body matches are merged below */ }
    listEl.querySelectorAll(".conversation").forEach(el=>el.addEventListener("click",()=>{
      if(viewMode==="trash"){restoreTrash(el.dataset.id);return}
      if(viewMode==="archive"){const m=messages.find(x=>x.id===el.dataset.id);if(m){selectedId=m.id;showMessage()}return}
      selectMessage(el.dataset.id);
    }));
    if(reorderMode&&!q&&viewMode==="active"){
      let dragged=null;
      listEl.querySelectorAll(".conversation[draggable=true]").forEach(el=>{
        el.addEventListener("dragstart",e=>{dragged=el.dataset.id;e.dataTransfer.effectAllowed="move"});
        el.addEventListener("dragover",e=>{e.preventDefault();e.dataTransfer.dropEffect="move"});
        el.addEventListener("drop",async e=>{e.preventDefault();const target=el.dataset.id;if(!dragged||dragged===target)return;await reorderDrop(dragged,target);dragged=null});
      });
    }
    listEl.querySelectorAll("[data-move]").forEach(b=>b.addEventListener("click",e=>{e.stopPropagation();moveMessage(b.closest(".conversation").dataset.id,Number(b.dataset.move))}));
    if(selectedId && !messages.some(m=>m.id===selectedId)){selectedId=null;showWelcome()}
    else if(selectedId) { const activeMessage=messages.find(m=>m.id===selectedId); if(activeMessage&&activeMessage.groupId&&activeMessage.groupId!==currentGroup){currentGroup=activeMessage.groupId;try{localStorage.setItem(groupKey,currentGroup)}catch{} renderGroupMenu();} showMessage(); }
  }
  async function reorderDrop(sourceId,targetId){
    const arr=messages.filter(inGroup),from=arr.findIndex(x=>x.id===sourceId),to=arr.findIndex(x=>x.id===targetId);if(from<0||to<0)return;
    const [item]=arr.splice(from,1);arr.splice(to,0,item);arr.forEach((m,i)=>m.order=i);
    const updates={};arr.forEach(m=>updates[m.id+"/order"]=m.order);
    try{if(db)await db.ref("savedMessages").update(updates);else saveLocal();render()}catch(e){toast("تعذر حفظ الترتيب")}
  }
  async function moveMessage(id,dir){
    if(blocked()){toast(OFFLINE_MSG);return}
    const vis=messages.filter(inGroup);
    const i=vis.findIndex(m=>m.id===id),j=i+dir;
    if(i<0||j<0||j>=vis.length)return;
    const sw=vis.slice();[sw[i],sw[j]]=[sw[j],sw[i]];
    const slots=[];messages.forEach((m,k)=>{if(inGroup(m))slots.push(k)});
    const arr=messages.slice();slots.forEach((k,n)=>{arr[k]=sw[n]});
    const changed=[];arr.forEach((m,k)=>{if(m.order!==k){m.order=k;changed.push(m)}});
    messages=arr;render();
    try{
      if(db){const u={};changed.forEach(m=>{u[m.id+"/order"]=m.order});await db.ref("savedMessages").update(u)}
      else saveLocal();
    }catch(e){console.error(e);toast("تعذر حفظ الترتيب"+(e&&e.code?" ("+e.code+")":"")+". تحقق من صلاحيات قاعدة البيانات")}
  }
  $("groupBtn").addEventListener("click",e=>{e.stopPropagation();const menu=$("groupMenu");menu.classList.toggle("hidden");$("groupBtn").setAttribute("aria-expanded",String(!menu.classList.contains("hidden")))});
  $("groupAddBtn").addEventListener("click",addGroup);
  document.addEventListener("click",e=>{if(!e.target.closest("#groupMenu")&&!e.target.closest("#groupBtn")){$("groupMenu").classList.add("hidden");$("groupBtn").setAttribute("aria-expanded","false")}});
  $("reorderBtn").addEventListener("click",()=>{reorderMode=!reorderMode;$("reorderBtn").classList.toggle("on",reorderMode);if(reorderMode&&$("searchInput").value.trim())toast("امسح البحث لتحريك الرسائل");render()});
  async function restoreTrash(id){
    const item=trashItems.find(x=>x.id===id);if(!item)return;
    if(!confirm("استعادة هذه الرسالة إلى الجروب الأصلي؟"))return;
    try{if(db){const {trashBody,deletedAt,...meta}=item;await db.ref().update({["savedMessages/"+id]:meta,["savedBodies/"+id]:trashBody,["deletedMessages/"+id]:null})}
      else{const {trashBody,deletedAt,...meta}=item;messages.push(meta);bodyCache.set(id,{updatedAt:meta.updatedAt,...trashBody});trashItems=trashItems.filter(x=>x.id!==id);saveLocal()}
      viewMode="active";currentGroup=item.groupId||DEFAULT_GROUP;selectedId=id;render();toast("تمت استعادة الرسالة");
    }catch(e){console.error(e);toast("تعذرت الاستعادة؛ حدّث قواعد Firebase")}
  }
  function selectMessage(id){const m=messages.find(x=>x.id===id);if(m&&m.groupId&&m.groupId!==currentGroup){currentGroup=m.groupId;try{localStorage.setItem(groupKey,currentGroup)}catch{}}selectedId=id;render()}
  function showWelcome(){$("welcome").classList.remove("hidden");$("chatView").classList.add("hidden")}
  function readImages(m){
    try { const v=m?.imagesJson; const arr=typeof v==="string"?JSON.parse(v||"[]"):[]; return Array.isArray(arr)?arr.filter(x=>typeof x==="string"&&x.startsWith("data:image/")):[]; } catch { return []; }
  }
  function renderImagePreview(){
    const box=$("imagePreview");
    box.innerHTML=pendingImages.map((src,i)=>`<div class="preview-item"><img src="${src}" alt="صورة مرفقة"><button type="button" data-remove-image="${i}" aria-label="حذف الصورة">×</button></div>`).join("");
    box.querySelectorAll("[data-remove-image]").forEach(b=>b.addEventListener("click",()=>{pendingImages.splice(Number(b.dataset.removeImage),1);renderImagePreview()}));
  }
  const VIDEO_MARKER_RE = /\n?\[DRIVE_VIDEO_URL\]([\s\S]*?)\[\/DRIVE_VIDEO_URL\]/;
  function extractVideo(content){
    const match = String(content || "").match(VIDEO_MARKER_RE);
    return {text: String(content || "").replace(VIDEO_MARKER_RE, "").trim(), url: match ? match[1].trim() : ""};
  }
  function driveFileId(url){
    try{
      const u = new URL(url);
      if(!/(^|\.)drive\.google\.com$/.test(u.hostname) && u.hostname !== "drive.google.com") return "";
      const m = u.pathname.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
      return (m && m[1]) || u.searchParams.get("id") || "";
    }catch{return ""}
  }
  function openDriveVideo(id){
    if(!id)return;
    let dlg = $("videoPreviewDialog");
    if(!dlg){
      dlg=document.createElement("dialog");dlg.id="videoPreviewDialog";dlg.className="video-preview-dialog";
      dlg.innerHTML='<div class="video-preview-head"><strong>مشاهدة الفيديو</strong><button type="button" id="closeVideoPreview" aria-label="إغلاق">×</button></div><div class="video-frame-wrap"><iframe id="driveVideoFrame" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen referrerpolicy="strict-origin-when-cross-origin" title="فيديو Google Drive"></iframe></div>';
      document.body.appendChild(dlg);
      dlg.querySelector("#closeVideoPreview").addEventListener("click",()=>{dlg.querySelector("iframe").src="";dlg.close()});
      dlg.addEventListener("click",e=>{if(e.target===dlg){dlg.querySelector("iframe").src="";dlg.close()}});
    }
    dlg.querySelector("iframe").src="https://drive.google.com/file/d/"+encodeURIComponent(id)+"/preview";
    dlg.showModal();
  }
  function renderDriveFiles(raw){
    let files=[];try{files=JSON.parse(raw||"[]")}catch{}
    return files.map((f,i)=>{const id=f.id||driveFileId(f.url);if(!id)return "";
      const preview="https://drive.google.com/file/d/"+encodeURIComponent(id)+"/preview";
      const download="https://drive.google.com/uc?export=download&id="+encodeURIComponent(id);
      return `<section class="drive-file-card"><strong>📄 ${escapeHtml(f.name||"ملف Google Drive")}</strong><iframe src="${preview}" loading="lazy" title="معاينة الملف"></iframe><a href="${download}" target="_blank" rel="noopener">تنزيل الملف</a></section>`;
    }).join("");
  }
  function paintBody(b){
    const imgs=readImages(b), video=extractVideo(b.content||""), videoId=video.url?driveFileId(video.url):"";
    $("messageBubble").innerHTML=`<div class="message-text">${renderColoredText(video.text)}</div>${videoId?`<button type="button" class="drive-video-card" id="openDriveVideo"><span class="drive-video-thumb"><img src="https://drive.google.com/thumbnail?id=${encodeURIComponent(videoId)}&sz=w640" alt="معاينة الفيديو" loading="lazy"><span class="drive-video-play">▶</span></span><span class="drive-video-caption"><strong>مشاهدة الفيديو</strong><small>يفتح داخل التطبيق من Google Drive</small></span></button>`:video.url?`<div class="message-text">رابط الفيديو غير صالح. استخدم رابط مشاركة من Google Drive.</div>`:""}${imgs.length?`<div class="message-images">${imgs.map((src,i)=>`<div class="message-image-item"><img src="${src}" alt="صورة داخل الرسالة" loading="lazy" data-zoom-image="${i}"><a href="${src}" download="important-image-${i+1}.jpg" class="image-download">تنزيل</a></div>`).join("")}</div>`:""}${renderDriveFiles(b.filesJson)}${b.stale?'<div class="message-text" style="opacity:.6;font-size:12px">نسخة محفوظة قد لا تكون الأحدث</div>':""}`;
    const videoBtn=$("openDriveVideo");if(videoBtn)videoBtn.addEventListener("click",()=>openDriveVideo(videoId));
  }
  let imageZoomHistoryOpen = false;
  function closeImageZoom(fromHistory=false){
    const box=document.getElementById("imageZoomOverlay");
    if(!box || !box.classList.contains("show"))return;
    box.classList.remove("show");
    if(!fromHistory && imageZoomHistoryOpen){
      imageZoomHistoryOpen=false;
      history.back();
    }else if(fromHistory){imageZoomHistoryOpen=false;}
  }
  window.addEventListener("popstate",()=>{
    const box=document.getElementById("imageZoomOverlay");
    if(box?.classList.contains("show"))closeImageZoom(true);
  });
  document.addEventListener("click",e=>{
    const im=e.target.closest("[data-zoom-image]");
    if(im){
      let box=document.getElementById("imageZoomOverlay");
      if(!box){
        box=document.createElement("div");box.id="imageZoomOverlay";box.className="image-zoom-overlay";
        box.innerHTML='<button type="button" aria-label="إغلاق">×</button><img alt="عرض الصورة بالحجم الكامل">';
        document.body.appendChild(box);
        box.addEventListener("click",ev=>{if(ev.target===box || ev.target.closest("button"))closeImageZoom();});
      }
      box.querySelector("img").src=im.src;box.classList.add("show");
      if(!imageZoomHistoryOpen){history.pushState({imageZoom:true},"");imageZoomHistoryOpen=true;}
      return;
    }
  });
  function showMessage(){
    const m=messages.find(x=>x.id===selectedId);if(!m){showWelcome();return}
    $("welcome").classList.add("hidden");$("chatView").classList.remove("hidden");
    $("viewTitle").textContent=m.title;$("viewDate").textContent="تاريخ الحفظ: "+dateText(m.createdAt);
    $("copyBtn").textContent="نسخ النص";
    const hit=peekBody(m);if(hit){paintBody(hit);return}
    $("messageBubble").innerHTML='<div class="message-text">جارٍ تحميل المحتوى…</div>';
    const id=m.id;
    getBody(m).then(b=>{
      if(selectedId!==id)return;
      if(b)paintBody(b);
      else $("messageBubble").innerHTML='<div class="message-text">المحتوى غير متاح بدون إنترنت. افتح هذه الرسالة مرة واحدة أثناء الاتصال ليتم تخزينها.</div>';
    });
  }
  function openNew(){editingId=null;pendingImages=[];$("dialogHeading").textContent="إضافة رسالة جديدة";$("messageTitle").value="";setEditorContent("");$("messageVideoUrl").value="";$("messageFileUrl").value="";$("notifyOnEdit").checked=false;$("messageImages").value="";$("formError").textContent="";renderImagePreview();dialog.showModal()}
  function closeDialog(){dialog.close()}
  async function persistMessage(m){
    if(blocked())throw new Error(OFFLINE_MSG);
    if(db){
      const { id, content, imagesJson, filesJson, ...meta } = m;
      meta.preview = makePreview(extractVideo(content).text); meta.hasImages = readImages({imagesJson}).length > 0;
      const isEdit = messages.some(x => x.id === id);
      const noticeTs = Date.now();
      const shouldNotify = !isEdit || !!m.notifyOnEdit;
      const noticeRef = shouldNotify ? db.ref("jigNotifications").push() : null;
      const updates = {
        ["savedMessages/"+id]: meta,
        ["savedBodies/"+id]: {content, imagesJson, filesJson:filesJson||"[]"},
        ...(shouldNotify ? {
          notice: {id, title: m.title, content: String(content || "").slice(0, 2000), action: isEdit ? "edit" : "add", ts: noticeTs},
          ["jigNotifications/"+noticeRef.key]: {id, title: m.title, groupId: m.groupId || DEFAULT_GROUP, action: isEdit ? "edit" : "add", ts: noticeTs}
        } : {})
      };
      await db.ref().update(updates);
      const b = {updatedAt: m.updatedAt, content, imagesJson, filesJson:m.filesJson||"[]"}; bodyCache.set(id, b); cacheSet("body:"+id, b);
    }
    else {const idx=messages.findIndex(x=>x.id===m.id);if(idx>=0)messages[idx]=m;else messages.unshift(m);sortMsgs(messages);saveLocal();render()}
  }

  function resizeImage(file){return new Promise((resolve,reject)=>{
    const reader=new FileReader(); reader.onerror=reject; reader.onload=()=>{const img=new Image();img.onerror=reject;img.onload=()=>{
      const max=1000,scale=Math.min(1,max/Math.max(img.width,img.height));const canvas=document.createElement("canvas");canvas.width=Math.max(1,Math.round(img.width*scale));canvas.height=Math.max(1,Math.round(img.height*scale));
      const ctx=canvas.getContext("2d");ctx.drawImage(img,0,0,canvas.width,canvas.height);resolve(canvas.toDataURL("image/jpeg",0.72));};img.src=reader.result;};reader.readAsDataURL(file);
  })}
  $("messageImages").addEventListener("change",async e=>{
    const files=Array.from(e.target.files||[]);e.target.value="";
    if(pendingImages.length+files.length>4){toast("الحد الأقصى 4 صور لكل رسالة");return;}
    try{for(const file of files){if(!file.type.startsWith("image/"))continue;pendingImages.push(await resizeImage(file));}renderImagePreview();}
    catch(err){console.error(err);toast("تعذر قراءة إحدى الصور");}
  });
  $("newBtn").addEventListener("click",openNew);$("welcomeNewBtn").addEventListener("click",openNew);
  $("closeDialog").addEventListener("click",closeDialog);$("cancelBtn").addEventListener("click",closeDialog);
  $("searchInput").addEventListener("input",()=>{window._fullSearchIds=null;window._fullSearchRunning=false;render()});
  $("messageForm").addEventListener("submit",async e=>{
    e.preventDefault();const title=$("messageTitle").value.trim(),textContent=editorStoredText().trim(),videoUrl=$("messageVideoUrl").value.trim(),fileUrl=$("messageFileUrl").value.trim();
    const videoId=videoUrl?driveFileId(videoUrl):"",fileId=fileUrl?driveFileId(fileUrl):"";
    if(fileUrl&&!fileId){$("formError").textContent="رابط الملف غير صالح. استخدم رابط مشاركة Google Drive.";return}
    if(videoUrl&&!videoId){$("formError").textContent="رابط غير صالح. الصق رابط فيديو من Google Drive مثل drive.google.com/file/d/...";return}
    if(!title||(!textContent&&!pendingImages.length&&!videoUrl&&!fileUrl)){$("formError").textContent="اكتب عنوان الرسالة وأضف نصًا أو صورة أو فيديو واحدًا على الأقل.";return}
    const content=textContent+(videoUrl?"\n[DRIVE_VIDEO_URL]"+videoUrl+"[/DRIVE_VIDEO_URL]":"");
    const now=Date.now(), old=messages.find(m=>m.id===editingId);
    const id=editingId||(db?db.ref("savedMessages").push().key:"local_"+now+"_"+Math.random().toString(36).slice(2,8));
    const m={id,title,content,imagesJson:JSON.stringify(pendingImages),filesJson:JSON.stringify(fileUrl?[{url:fileUrl,id:fileId,name:"ملف Google Drive"}]:[]),notifyOnEdit:$("notifyOnEdit").checked,createdAt:old?.createdAt||now,updatedAt:now};
    const ord=old?old.order:newOrder();if(typeof ord==="number")m.order=ord;
    const gid=old?old.groupId:currentGroup;if(gid)m.groupId=gid;
    if(m.imagesJson.length>1400000){$("formError").textContent="حجم الصور كبير. جرّب صورًا أقل أو أصغر حجمًا.";return}
    try{await persistMessage(m);selectedId=id;closeDialog();render();toast(db?"تم حفظ الرسالة ومشاركتها مع الجميع":"تم حفظ الرسالة على هذا الجهاز فقط")}
    catch(err){console.error("Rasayeli save error:",err);const code=err&&err.code?" ("+err.code+")":"";const detail=err&&err.message?" — "+err.message:"";$("formError").textContent="لم يتم الحفظ"+code+detail;}
  });
  // قائمة خيارات الرسالة: لا تظهر إلا بعد اجتياز طلب الرقم السري في index.html.
  const messageMenuBtn = $("messageMenuBtn"), messageActionsMenu = $("messageActionsMenu");
  messageMenuBtn.addEventListener("click", e => {
    e.stopPropagation();
    const opening = messageActionsMenu.classList.contains("hidden");
    messageActionsMenu.classList.toggle("hidden", !opening);
    messageMenuBtn.setAttribute("aria-expanded", String(opening));
  });
  document.addEventListener("click", e => {
    if (!e.target.closest(".message-actions-wrap")) {
      messageActionsMenu.classList.add("hidden");
      messageMenuBtn.setAttribute("aria-expanded", "false");
    }
  });
  ["pinBtn", "copyBtn", "shareBtn", "editBtn", "trashBtn", "archiveBtn", "copyToGroupBtn"].forEach(id => $(id).addEventListener("click", () => {
    messageActionsMenu.classList.add("hidden");
    messageMenuBtn.setAttribute("aria-expanded", "false");
  }));
  $("pinBtn").addEventListener("click",async()=>{
    const m=messages.find(x=>x.id===selectedId);if(!m)return;if(blocked()){toast(OFFLINE_MSG);return;}
    const next=!m.pinned;
    if(next && messages.filter(x=>(x.groupId||DEFAULT_GROUP)===(m.groupId||DEFAULT_GROUP)&&x.pinned).length>=5){toast("يمكن تثبيت 5 رسائل كحد أقصى في الجروب");return;}
    try{if(db)await db.ref("savedMessages/"+m.id+"/pinned").set(next);m.pinned=next;render();toast(next?"تم تثبيت الرسالة":"تم إلغاء تثبيت الرسالة");}
    catch(e){toast("تعذر تحديث التثبيت")}
  });
  $("copyBtn").addEventListener("click",async()=>{const m=messages.find(x=>x.id===selectedId);if(!m)return;const b=await getBody(m);if(!b){toast("المحتوى غير متاح");return}try{await navigator.clipboard.writeText(extractVideo(b.content||"").text);toast("تم نسخ النص")}catch{toast("تعذر النسخ؛ حدد النص وانسخه يدويًا")}});
  $("shareBtn").addEventListener("click",async()=>{const m=messages.find(x=>x.id===selectedId);if(!m)return;const b=await getBody(m);if(!b){toast("المحتوى غير متاح");return}try{if(navigator.share)await navigator.share({title:m.title,text:extractVideo(b.content||"").text+(extractVideo(b.content||"").url?"\n"+extractVideo(b.content||"").url:"")});else{await navigator.clipboard.writeText(m.title+"\n\n"+extractVideo(b.content||"").text+(extractVideo(b.content||"").url?"\n"+extractVideo(b.content||"").url:""));toast("تم نسخ الرسالة للمشاركة")}}catch{}});
  $("editBtn").addEventListener("click",async()=>{const m=messages.find(x=>x.id===selectedId);if(!m)return;const b=await getBody(m);if(!b){toast("المحتوى غير متاح بدون إنترنت");return}editingId=m.id;pendingImages=readImages(b).slice();const video=extractVideo(b.content||"");$("dialogHeading").textContent="تعديل الرسالة";$("messageTitle").value=m.title||"";setEditorContent(video.text);$("messageVideoUrl").value=video.url;const f=JSON.parse(b.filesJson||"[]");$("messageFileUrl").value=f[0]?.url||"";$("notifyOnEdit").checked=false;$("messageImages").value="";$("formError").textContent="";renderImagePreview();dialog.showModal()});
  $("trashBtn").addEventListener("click",async()=>{
    const m=messages.find(x=>x.id===selectedId);if(!m)return;if(blocked()){toast(OFFLINE_MSG);return}
    if(!confirm("نقل الرسالة إلى سلة المحذوفات؟ يمكن استعادتها لاحقًا."))return;
    try{const b=await getBody(m)||{content:"",imagesJson:"[]",filesJson:"[]"};
      if(db)await db.ref().update({["deletedMessages/"+m.id]:{meta:m,body:{content:b.content||"",imagesJson:b.imagesJson||"[]",filesJson:b.filesJson||"[]"},deletedAt:Date.now()},["savedMessages/"+m.id]:null,["savedBodies/"+m.id]:null});
      else{trashItems.push({...m,trashBody:b,deletedAt:Date.now()});messages=messages.filter(x=>x.id!==m.id);saveLocal()}
      selectedId=null;render();showWelcome();toast("تم النقل إلى سلة المحذوفات");
    }catch(e){console.error(e);toast("تعذر النقل إلى سلة المحذوفات؛ حدّث قواعد Firebase")}
  });
  $("archiveBtn").addEventListener("click",async()=>{
    const m=messages.find(x=>x.id===selectedId);if(!m)return;if(blocked())return;
    const archived=!m.archived;
    try{if(db)await db.ref("savedMessages/"+m.id+"/archived").set(archived);else{m.archived=archived;saveLocal();render()}
      toast(archived?"تمت أرشفة الرسالة":"تم إلغاء الأرشفة");if(archived){selectedId=null;showWelcome();render()}
    }catch(e){toast("تعذر تحديث الأرشيف؛ حدّث قواعد Firebase")}
  });
  $("copyToGroupBtn").addEventListener("click",async()=>{
    const m=messages.find(x=>x.id===selectedId);if(!m)return;
    const choices=allGroups().map((g,i)=>`${i+1}- ${g.name}`).join("\\n");
    const n=Number(prompt("اكتب رقم الجروب الذي تريد نسخ الرسالة إليه:\\n"+choices));const dest=allGroups()[n-1];if(!dest)return;
    try{const b=await getBody(m);if(!b)throw new Error("body");
      const id=db?db.ref("savedMessages").push().key:"local_"+Date.now();
      const copy={...m,id,groupId:dest.id,createdAt:Date.now(),updatedAt:Date.now(),order:newOrder()};delete copy.archived;
      await persistMessage({...copy,content:b.content||"",imagesJson:b.imagesJson||"[]",filesJson:b.filesJson||"[]",notifyOnEdit:false});
      toast("تم نسخ الرسالة إلى "+dest.name);
    }catch(e){console.error(e);toast("تعذر نسخ الرسالة")}
  });
  $("groupAddBtn").addEventListener("click",addGroup);
  $("subGroupAddBtn").addEventListener("click",addSubGroup);
  $("archiveViewBtn").addEventListener("click",()=>{viewMode="archive";selectedId=null;$("groupMenu").classList.add("hidden");render();showWelcome();toast("عرض الأرشيف")});
  $("trashViewBtn").addEventListener("click",()=>{viewMode="trash";selectedId=null;$("groupMenu").classList.add("hidden");render();showWelcome();toast("سلة المحذوفات: اضغط على العنصر لاستعادته")});

  // استقبال نصوص من قائمة مشاركة Android/Chrome عند تثبيت التطبيق.
  const params=new URLSearchParams(location.search);
  const sharedText=params.get("text")||params.get("title")||"";
  if(sharedText){setTimeout(()=>{openNew();setEditorContent(sharedText);history.replaceState({}, "", location.pathname)},350)}
  window.addEventListener("beforeinstallprompt",e=>{e.preventDefault();installPrompt=e;$("installBtn").classList.remove("hidden")});
  $("installBtn").addEventListener("click",async()=>{if(!installPrompt)return;installPrompt.prompt();await installPrompt.userChoice;installPrompt=null;$("installBtn").classList.add("hidden")});
  (function textTools(){
    const editor=$("messageContent"),title=$("messageTitle"),bar=$("textTools"),colorInput=$("messageTextColor");
    let savedRange=null;
    function saveRange(){const sel=window.getSelection();if(sel&&sel.rangeCount&&editor.contains(sel.anchorNode))savedRange=sel.getRangeAt(0).cloneRange();}
    function restoreRange(){editor.focus();const sel=window.getSelection();if(savedRange&&sel){sel.removeAllRanges();sel.addRange(savedRange);} }
    function refresh(){const sel=window.getSelection();const has=!!(sel&&sel.rangeCount&&!sel.getRangeAt(0).collapsed&&editor.contains(sel.anchorNode));bar.querySelectorAll('[data-t="cut"],[data-t="copy"],[data-t="del"]').forEach(b=>b.disabled=!has);}
    ["keyup","mouseup","touchend","input","focus"].forEach(ev=>editor.addEventListener(ev,()=>{saveRange();refresh()}));
    document.addEventListener("selectionchange",()=>{if(document.activeElement===editor){saveRange();refresh()}});
    editor.addEventListener("keydown",e=>{if(e.key==="Enter"){setTimeout(()=>{saveRange();refresh()},0)}});
    editor.addEventListener("paste",e=>{e.preventDefault();const text=(e.clipboardData||window.clipboardData).getData("text/plain");document.execCommand("insertText",false,text);saveRange();refresh()});
    colorInput.addEventListener("pointerdown",saveRange);colorInput.addEventListener("mousedown",saveRange);colorInput.addEventListener("focus",saveRange);
    colorInput.addEventListener("change",applyColor);
    function applyColor(){const color=colorInput.value.toLowerCase();restoreRange();document.execCommand("styleWithCSS",false,true);document.execCommand("foreColor",false,color);saveRange();refresh();}
    bar.querySelectorAll("button").forEach(b=>{
      b.addEventListener("pointerdown",e=>e.preventDefault());b.addEventListener("mousedown",e=>e.preventDefault());
      b.addEventListener("click",async()=>{
        const t=b.dataset.t;restoreRange();const sel=window.getSelection();
        if(t==="all"){const r=document.createRange();r.selectNodeContents(editor);sel.removeAllRanges();sel.addRange(r);savedRange=r.cloneRange();refresh();return;}
        if(!sel||!sel.rangeCount||sel.getRangeAt(0).collapsed)return;
        const range=sel.getRangeAt(0);const text=range.toString();
        if(t==="copy"||t==="cut"){try{await navigator.clipboard.writeText(text)}catch{document.execCommand("copy")}}
        if(t==="cut"||t==="del"){range.deleteContents();sel.removeAllRanges();savedRange=null;}
        refresh();
      });
    });
    const curH=()=>(window.visualViewport&&window.visualViewport.height)||window.innerHeight;let fullH=Math.max(window.innerHeight,curH());
    window.addEventListener("resize",()=>{fullH=Math.max(fullH,curH())});window.addEventListener("orientationchange",()=>setTimeout(()=>{fullH=curH()},400));
    [editor,title].forEach(el=>el.addEventListener("click",()=>{if(document.activeElement===el&&curH()>=fullH-80){const sel=window.getSelection();const r=sel&&sel.rangeCount?sel.getRangeAt(0).cloneRange():null;el.blur();setTimeout(()=>{el.focus();if(r){const s=window.getSelection();s.removeAllRanges();s.addRange(r)}},0)}}));
    refresh();
  })();
  // إعدادات العرض محفوظة على الجهاز
  const prefKey="ii_preferences_v1";let prefs={theme:"light",font:"medium"};try{prefs={...prefs,...JSON.parse(localStorage.getItem(prefKey)||"{}")}}catch{}
  function applyPrefs(){document.body.classList.toggle("dark-mode",prefs.theme==="dark");document.documentElement.style.setProperty("--app-font-size",prefs.font==="small"?"14px":prefs.font==="large"?"19px":"16px");$("themeBtn").textContent=prefs.theme==="dark"?"☀️":"🌙";}
  function savePrefs(){localStorage.setItem(prefKey,JSON.stringify(prefs));applyPrefs()}
  applyPrefs();
  $("themeBtn").addEventListener("click",()=>{prefs.theme=prefs.theme==="dark"?"light":"dark";savePrefs()});
  $("fontBtn").addEventListener("click",()=>{prefs.font=prefs.font==="small"?"medium":prefs.font==="medium"?"large":"small";savePrefs();toast("حجم الخط: "+(prefs.font==="small"?"صغير":prefs.font==="large"?"كبير":"متوسط"))});
  // النسخ الاحتياطي مشفر بكلمة المرور التي طلبها المستخدم.
  const encoder = new TextEncoder(), decoder = new TextDecoder();
  function bytesToB64(bytes){let bin="";bytes.forEach(b=>bin+=String.fromCharCode(b));return btoa(bin)}
  function b64ToBytes(value){const bin=atob(value);return Uint8Array.from(bin,c=>c.charCodeAt(0))}
  async function backupKey(salt,password){
    const material=await crypto.subtle.importKey("raw",encoder.encode(password),"PBKDF2",false,["deriveKey"]);
    return crypto.subtle.deriveKey({name:"PBKDF2",salt,iterations:250000,hash:"SHA-256"},material,{name:"AES-GCM",length:256},false,["encrypt","decrypt"]);
  }
  async function encryptBackup(bundle,password){
    if(!crypto.subtle)throw new Error("التشفير غير مدعوم في هذا المتصفح؛ افتح التطبيق عبر HTTPS");
    const salt=crypto.getRandomValues(new Uint8Array(16)),iv=crypto.getRandomValues(new Uint8Array(12)),key=await backupKey(salt,password);
    const encrypted=await crypto.subtle.encrypt({name:"AES-GCM",iv},key,encoder.encode(JSON.stringify(bundle)));
    return {app:"Important Instructions",backupFormat:"encrypted-v1",kdf:"PBKDF2-SHA256",iterations:250000,cipher:"AES-GCM",salt:bytesToB64(salt),iv:bytesToB64(iv),data:bytesToB64(new Uint8Array(encrypted))};
  }
  async function decryptBackup(envelope,password){
    if(!envelope||envelope.app!=="Important Instructions"||envelope.backupFormat!=="encrypted-v1")throw new Error("هذا الملف ليس نسخة احتياطية مشفرة صالحة من التطبيق");
    const key=await backupKey(b64ToBytes(envelope.salt),password);
    const plain=await crypto.subtle.decrypt({name:"AES-GCM",iv:b64ToBytes(envelope.iv)},key,b64ToBytes(envelope.data));
    const bundle=JSON.parse(decoder.decode(plain));
    if(!Array.isArray(bundle.messages)||!Array.isArray(bundle.groups))throw new Error("محتويات النسخة الاحتياطية غير مكتملة");
    return bundle;
  }
  // إدخال رقم النسخة الاحتياطية في حقل مخفي، دون وضع الرقم مسبقًا أو إظهاره على الشاشة.
  function askBackupPassword(title){
    return new Promise(resolve=>{
      const overlay=document.createElement("div");
      overlay.style.cssText="position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,.65);display:flex;align-items:center;justify-content:center;padding:18px";
      const box=document.createElement("div");
      box.style.cssText="width:min(420px,100%);background:var(--panel,#fff);color:var(--text,#222);border-radius:20px;padding:22px;box-shadow:0 12px 40px rgba(0,0,0,.3)";
      const heading=document.createElement("h3");heading.textContent=title;heading.style.margin="0 0 16px";
      const hint=document.createElement("p");hint.textContent="أدخل الرقم السري للنسخة الاحتياطية";hint.style.margin="0 0 12px";
      const input=document.createElement("input");input.type="password";input.inputMode="numeric";input.autocomplete="new-password";input.placeholder="الرقم السري";input.style.cssText="box-sizing:border-box;width:100%;padding:13px;border:1px solid #999;border-radius:10px;background:var(--input-bg,#fff);color:var(--text,#222);font-size:20px;letter-spacing:5px;text-align:center";
      const error=document.createElement("p");error.style.cssText="min-height:20px;color:#d33;margin:8px 0";
      const actions=document.createElement("div");actions.style.cssText="display:flex;gap:10px;margin-top:12px";
      const ok=document.createElement("button");ok.type="button";ok.textContent="حسنًا";ok.style.cssText="flex:1;padding:12px;border:0;border-radius:10px;background:#087b6d;color:white;font-size:16px";
      const cancel=document.createElement("button");cancel.type="button";cancel.textContent="إلغاء";cancel.style.cssText="flex:1;padding:12px;border:0;border-radius:10px;background:#888;color:white;font-size:16px";
      actions.append(ok,cancel);box.append(heading,hint,input,error,actions);overlay.append(box);document.body.append(overlay);
      let finished=false;function done(value){if(finished)return;finished=true;overlay.remove();resolve(value)}
      function submit(){if(input.value!=="186186"){error.textContent="الرقم السري غير صحيح";input.value="";input.focus();return}done("186186")}
      ok.addEventListener("click",submit);cancel.addEventListener("click",()=>done(null));
      input.addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();submit()}if(e.key==="Escape")done(null)});
      overlay.addEventListener("click",e=>{if(e.target===overlay)done(null)});input.focus();
    });
  }
  $("exportBtn").addEventListener("click",async()=>{
    const btn=$("exportBtn");btn.disabled=true;toast("جارٍ تجهيز النسخة الاحتياطية المشفرة...");
    try{
      const password=await askBackupPassword("إنشاء نسخة احتياطية");if(password===null)return;
      const bundle={app:"Important Instructions",version:2,exportedAt:new Date().toISOString(),groups:allGroups(),messages:[],trash:trashItems};
      for(const m of messages){const b=await getBody(m);bundle.messages.push({meta:m,body:b||{content:"",imagesJson:"[]",filesJson:"[]"}})}
      const encrypted=await encryptBackup(bundle,password);
      const blob=new Blob([JSON.stringify(encrypted)],{type:"application/json"}),url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download="important-instructions-backup-encrypted-"+new Date().toISOString().slice(0,10)+".json";document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);toast("تم إنشاء نسخة احتياطية مشفرة بنجاح")
    }catch(e){console.error(e);toast(e.message||"تعذر إنشاء النسخة الاحتياطية. تحقق من الاتصال")}
    finally{btn.disabled=false}
  });
  let pendingRestorePassword=null;
  $("importBtn").addEventListener("click",async()=>{
    if(blocked()){toast(OFFLINE_MSG);return}
    if(!confirm("استعادة نسخة احتياطية ستستبدل البيانات الحالية في Firebase. يفضّل إنشاء نسخة احتياطية من الوضع الحالي أولاً. هل تريد المتابعة؟"))return;
    // اطلب كلمة المرور قبل فتح نافذة اختيار الملف حتى تظهر بوضوح على الهاتف.
    pendingRestorePassword=await askBackupPassword("أدخل الرقم السري لاستعادة النسخة الاحتياطية");
    if(pendingRestorePassword===null)return;
    $("backupFileInput").click();
  });
  $("backupFileInput").addEventListener("change",async e=>{
    const file=e.target.files&&e.target.files[0];e.target.value="";if(!file){pendingRestorePassword=null;return;}
    const password=pendingRestorePassword;pendingRestorePassword=null;
    try{
      if(!db||!online)throw new Error("لاستعادة النسخة، افتح التطبيق مع الاتصال بقاعدة Firebase");
      if(!password)throw new Error("يجب إدخال الرقم السري لاستعادة النسخة الاحتياطية");
      const envelope=JSON.parse(await file.text());
      const bundle=await decryptBackup(envelope,password);
      if(!confirm("تم فك تشفير النسخة بنجاح. سيتم استبدال الرسائل والجروبات وسلة المحذوفات الحالية بالبيانات الموجودة في النسخة بتاريخ "+(bundle.exportedAt||"غير معروف")+". هل تؤكد الاستعادة؟"))return;
      const updates={savedMessages:null,savedBodies:null,savedGroups:null,deletedMessages:null};
      for(const g of bundle.groups){if(g.id&&g.id!==DEFAULT_GROUP){const {id,...value}=g;updates["savedGroups/"+id]=value}}
      for(const item of bundle.messages){if(!item.meta||!item.meta.id)continue;const id=item.meta.id;const {id:ignore,...meta}=item.meta;updates["savedMessages/"+id]=meta;updates["savedBodies/"+id]={content:item.body?.content||"",imagesJson:item.body?.imagesJson||"[]",filesJson:item.body?.filesJson||"[]"}}
      for(const item of (bundle.trash||[])){if(!item.id)continue;const {id,deletedAt,trashBody,...meta}=item;updates["deletedMessages/"+id]={meta,deletedAt:deletedAt||Date.now(),body:trashBody||{content:"",imagesJson:"[]",filesJson:"[]"}}}
      await db.ref().update(updates);
      toast("تمت استعادة النسخة الاحتياطية بنجاح. انتظر لحظات حتى يتم تحديث البيانات.");
    }catch(err){console.error(err);toast(err.name==="OperationError"?"كلمة السر غير صحيحة أو ملف النسخة تالف":(err.message||"تعذرت استعادة النسخة الاحتياطية"))}
  });

  if("serviceWorker" in navigator && location.protocol.startsWith("http")){
    const hadController=!!navigator.serviceWorker.controller;let reloaded=false;
    navigator.serviceWorker.addEventListener("controllerchange",()=>{if(hadController&&!reloaded){reloaded=true;location.reload()}});
    navigator.serviceWorker.register("sw.js").catch(console.warn);
  }
  initFirebase();
})();
