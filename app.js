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
  const dateText = v => { try { return new Date(v).toLocaleDateString("ar-EG",{year:"numeric",month:"short",day:"numeric"}); } catch { return ""; } };
  function toast(s){ const t=$("toast");t.textContent=s;t.classList.add("show");setTimeout(()=>t.classList.remove("show"),2600); }
  function setStatus(s,good=false){$("syncStatus").textContent=s;$("syncStatus").style.color=good?"#c9f5df":"#f9d7c7";}
  const sortKey = m => typeof m.order === "number" ? m.order : -(m.updatedAt || m.createdAt || 0);
  const sortMsgs = arr => arr.sort((a, b) => sortKey(a) - sortKey(b));
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
  const makePreview = t => String(t || "").replace(/\s+/g, " ").trim().slice(0, 90);
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
    const filtered=source.filter(m=>(viewMode==="trash" || inGroup(m))&&`${m.title||""}\n${previewOf(m)}`.toLocaleLowerCase().includes(q));
    if(!filtered.length){listEl.innerHTML=`<div class="empty-list">${q?"لا توجد نتائج مطابقة.":"لا توجد عناصر في هذا القسم."}</div>`}
    else listEl.innerHTML=filtered.map(m=>`<div class="conversation ${m.id===selectedId?"active":""}" data-id="${escapeHtml(m.id)}" draggable="${reorderMode&&!q&&viewMode==="active"?"true":"false"}"><div class="avatar">✉</div><div class="conversation-info"><h3>${escapeHtml(m.title)}</h3><p>${escapeHtml(previewOf(m) || (hasImgs(m) ? "📷 صورة مرفقة" : "بدون نص"))}</p></div><time>${escapeHtml(dateText(m.updatedAt||m.createdAt))}</time>${reorderMode&&!q?`<div class="move-btns"><button type="button" data-move="-1" aria-label="تحريك لأعلى">▲</button><button type="button" data-move="1" aria-label="تحريك لأسفل">▼</button></div>`:""}</div>`).join("");
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
    $("messageBubble").innerHTML=`<div class="message-text">${escapeHtml(video.text).replace(/\n/g,"<br>")}</div>${videoId?`<button type="button" class="drive-video-card" id="openDriveVideo"><span class="drive-video-thumb"><img src="https://drive.google.com/thumbnail?id=${encodeURIComponent(videoId)}&sz=w640" alt="معاينة الفيديو" loading="lazy"><span class="drive-video-play">▶</span></span><span class="drive-video-caption"><strong>مشاهدة الفيديو</strong><small>يفتح داخل التطبيق من Google Drive</small></span></button>`:video.url?`<div class="message-text">رابط الفيديو غير صالح. استخدم رابط مشاركة من Google Drive.</div>`:""}${imgs.length?`<div class="message-images">${imgs.map((src,i)=>`<div class="message-image-item"><img src="${src}" alt="صورة داخل الرسالة" loading="lazy" data-zoom-image="${i}"><a href="${src}" download="important-image-${i+1}.jpg" class="image-download">تنزيل</a></div>`).join("")}</div>`:""}${renderDriveFiles(b.filesJson)}${b.stale?'<div class="message-text" style="opacity:.6;font-size:12px">نسخة محفوظة قد لا تكون الأحدث</div>':""}`;
    const videoBtn=$("openDriveVideo");if(videoBtn)videoBtn.addEventListener("click",()=>openDriveVideo(videoId));
  }
  document.addEventListener("click",e=>{
    const im=e.target.closest("[data-zoom-image]");if(!im)return;
    let box=document.getElementById("imageZoomOverlay");
    if(!box){box=document.createElement("div");box.id="imageZoomOverlay";box.className="image-zoom-overlay";box.innerHTML='<button type="button" aria-label="إغلاق">×</button><img alt="عرض الصورة بالحجم الكامل">';document.body.appendChild(box);box.addEventListener("click",()=>box.classList.remove("show"));}
    box.querySelector("img").src=im.src;box.classList.add("show");
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
  function openNew(){editingId=null;pendingImages=[];$("dialogHeading").textContent="إضافة رسالة جديدة";$("messageTitle").value="";$("messageContent").value="";$("messageVideoUrl").value="";$("messageFileUrl").value="";$("notifyOnEdit").checked=false;$("messageImages").value="";$("formError").textContent="";renderImagePreview();dialog.showModal()}
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
  $("searchInput").addEventListener("input",render);
  $("messageForm").addEventListener("submit",async e=>{
    e.preventDefault();const title=$("messageTitle").value.trim(),textContent=$("messageContent").value.trim(),videoUrl=$("messageVideoUrl").value.trim(),fileUrl=$("messageFileUrl").value.trim();
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
  ["copyBtn", "shareBtn", "editBtn", "trashBtn", "archiveBtn", "copyToGroupBtn"].forEach(id => $(id).addEventListener("click", () => {
    messageActionsMenu.classList.add("hidden");
    messageMenuBtn.setAttribute("aria-expanded", "false");
  }));
  $("copyBtn").addEventListener("click",async()=>{const m=messages.find(x=>x.id===selectedId);if(!m)return;const b=await getBody(m);if(!b){toast("المحتوى غير متاح");return}try{await navigator.clipboard.writeText(extractVideo(b.content||"").text);toast("تم نسخ النص")}catch{toast("تعذر النسخ؛ حدد النص وانسخه يدويًا")}});
  $("shareBtn").addEventListener("click",async()=>{const m=messages.find(x=>x.id===selectedId);if(!m)return;const b=await getBody(m);if(!b){toast("المحتوى غير متاح");return}try{if(navigator.share)await navigator.share({title:m.title,text:extractVideo(b.content||"").text+(extractVideo(b.content||"").url?"\n"+extractVideo(b.content||"").url:"")});else{await navigator.clipboard.writeText(m.title+"\n\n"+extractVideo(b.content||"").text+(extractVideo(b.content||"").url?"\n"+extractVideo(b.content||"").url:""));toast("تم نسخ الرسالة للمشاركة")}}catch{}});
  $("editBtn").addEventListener("click",async()=>{const m=messages.find(x=>x.id===selectedId);if(!m)return;const b=await getBody(m);if(!b){toast("المحتوى غير متاح بدون إنترنت");return}editingId=m.id;pendingImages=readImages(b).slice();const video=extractVideo(b.content||"");$("dialogHeading").textContent="تعديل الرسالة";$("messageTitle").value=m.title||"";$("messageContent").value=video.text;$("messageVideoUrl").value=video.url;const f=JSON.parse(b.filesJson||"[]");$("messageFileUrl").value=f[0]?.url||"";$("notifyOnEdit").checked=false;$("messageImages").value="";$("formError").textContent="";renderImagePreview();dialog.showModal()});
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
  if(sharedText){setTimeout(()=>{openNew();$("messageContent").value=sharedText;history.replaceState({}, "", location.pathname)},350)}
  window.addEventListener("beforeinstallprompt",e=>{e.preventDefault();installPrompt=e;$("installBtn").classList.remove("hidden")});
  $("installBtn").addEventListener("click",async()=>{if(!installPrompt)return;installPrompt.prompt();await installPrompt.userChoice;installPrompt=null;$("installBtn").classList.add("hidden")});
  (function textTools(){
    const ta=$("messageContent"),title=$("messageTitle"),bar=$("textTools");
    const refresh=()=>{const has=ta.selectionStart!==ta.selectionEnd;bar.querySelectorAll('[data-t="cut"],[data-t="copy"],[data-t="del"]').forEach(b=>{b.disabled=!has})};
    ["focus","input","select","keyup","touchend"].forEach(ev=>ta.addEventListener(ev,refresh));
    document.addEventListener("selectionchange",()=>{if(document.activeElement===ta)refresh()});
    setInterval(()=>{if(dialog.open)refresh()},250);
    bar.querySelectorAll("button").forEach(b=>{
      b.addEventListener("pointerdown",e=>e.preventDefault());
      b.addEventListener("mousedown",e=>e.preventDefault());
      b.addEventListener("click",async()=>{
        const t=b.dataset.t;
        if(t==="all"){ta.focus();ta.setSelectionRange(0,ta.value.length);refresh();return}
        const s=ta.selectionStart,e=ta.selectionEnd;if(s===e)return;
        const text=ta.value.slice(s,e);
        if(t==="copy"||t==="cut"){try{await navigator.clipboard.writeText(text)}catch{ta.focus();ta.setSelectionRange(s,e);try{document.execCommand("copy")}catch{}}}
        if(t==="cut"||t==="del"){ta.setRangeText("",s,e,"end");ta.focus()}
        refresh();
      });
    });
    const curH=()=>(window.visualViewport&&window.visualViewport.height)||window.innerHeight;
    let fullH=Math.max(window.innerHeight,curH());
    window.addEventListener("resize",()=>{fullH=Math.max(fullH,curH())});
    window.addEventListener("orientationchange",()=>setTimeout(()=>{fullH=curH()},400));
    [ta,title].forEach(el=>el.addEventListener("click",()=>{
      if(document.activeElement===el&&curH()>=fullH-80){
        const s=el.selectionStart,e=el.selectionEnd;el.blur();
        setTimeout(()=>{el.focus();try{el.setSelectionRange(s,e)}catch{}},0);
      }
    }));
  })();
  if("serviceWorker" in navigator && location.protocol.startsWith("http")){
    const hadController=!!navigator.serviceWorker.controller;let reloaded=false;
    navigator.serviceWorker.addEventListener("controllerchange",()=>{if(hadController&&!reloaded){reloaded=true;location.reload()}});
    navigator.serviceWorker.register("sw.js").catch(console.warn);
  }
  initFirebase();
})();
