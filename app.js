(() => {
  const $ = id => document.getElementById(id);
  const listEl = $("conversationList"), dialog = $("messageDialog");
  let messages = [], groups = [], currentGroup = "instructions", reorderMode = false, selectedId = null, editingId = null, db = null, installPrompt = null, pendingImages = [];
  const localKey = "rasayeli_local_messages_v1", localGroupsKey = "rasayeli_local_groups_v1", groupKey = "rasayeli_current_group_v1", DEFAULT_GROUP = "instructions";
  try { currentGroup = localStorage.getItem(groupKey) || DEFAULT_GROUP; } catch {}
  const allGroups = () => [{id:DEFAULT_GROUP,name:DEFAULT_GROUP}, ...groups];
  const groupName = id => (allGroups().find(g => g.id === id) || {name:"…"}).name;
  const inGroup = m => (m.groupId || DEFAULT_GROUP) === currentGroup;
  function loadLocalGroups(){try{return JSON.parse(localStorage.getItem(localGroupsKey)||"[]")}catch{return []}}
  function renderGroupMenu(){
    $("groupCurrent").textContent = groupName(currentGroup);
    const box = $("groupList");
    box.innerHTML = allGroups().map(g => `<button type="button" class="group-item ${g.id===currentGroup?"active":""}" data-gid="${escapeHtml(g.id)}">${escapeHtml(g.name)}</button>`).join("");
    box.querySelectorAll("[data-gid]").forEach(b => b.addEventListener("click", () => setGroup(b.dataset.gid)));
  }
  function setGroup(id){
    currentGroup = id; try { localStorage.setItem(groupKey, id); } catch {}
    $("groupMenu").classList.add("hidden"); selectedId = null; showWelcome(); render();
  }
  async function addGroup(){
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
  const escapeHtml = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const dateText = v => { try { return new Date(v).toLocaleDateString("ar-EG",{year:"numeric",month:"short",day:"numeric"}); } catch { return ""; } };
  function toast(s){ const t=$("toast");t.textContent=s;t.classList.add("show");setTimeout(()=>t.classList.remove("show"),2600); }
  function setStatus(s,good=false){$("syncStatus").textContent=s;$("syncStatus").style.color=good?"#c9f5df":"#f9d7c7";}
  const sortKey = m => typeof m.order === "number" ? m.order : -(m.updatedAt || m.createdAt || 0);
  const sortMsgs = arr => arr.sort((a, b) => sortKey(a) - sortKey(b));
  function newOrder(){ const o = messages.filter(m => typeof m.order === "number").map(m => m.order); return o.length ? Math.min(...o) - 1 : -Date.now(); }
  function loadLocal(){try{return sortMsgs(JSON.parse(localStorage.getItem(localKey)||"[]"))}catch{return []}}
  function saveLocal(){localStorage.setItem(localKey,JSON.stringify(messages))}
  function initFirebase(){
    const c=window.FIREBASE_CONFIG;
    if(!c || !c.apiKey || !c.databaseURL || !window.firebase){messages=loadLocal();groups=loadLocalGroups();setStatus("حفظ محلي فقط");render();return}
    try{
      if(!firebase.apps.length) firebase.initializeApp(c);
      db=firebase.database();
      db.ref("savedGroups").on("value",snap=>{
        const d=snap.val()||{};
        groups=Object.entries(d).map(([id,v])=>({id,name:String((v&&v.name)||""),createdAt:(v&&v.createdAt)||0})).filter(g=>g.name).sort((a,b)=>a.createdAt-b.createdAt);
        if(currentGroup!==DEFAULT_GROUP&&!groups.some(g=>g.id===currentGroup)){currentGroup=DEFAULT_GROUP;try{localStorage.setItem(groupKey,currentGroup)}catch{}}
        render();
      },err=>{console.error("Groups read error:",err);toast("تعذر تحميل الجروبات"+(err&&err.code?" ("+err.code+")":""))});
      setStatus("متصل — التعديل متاح للجميع",true);
      db.ref("savedMessages").on("value", snap=>{
        const data=snap.val()||{};
        messages=sortMsgs(Object.entries(data).map(([id,v])=>({...v,id})));
        setStatus("متصل — التعديل متاح للجميع",true);
        render();
      },err=>{setStatus("تعذر الاتصال بقاعدة البيانات");console.error("Firebase read error:",err);toast("خطأ اتصال: "+(err&&err.code?err.code:"راجع إعدادات Firebase"));});
    }catch(e){console.error(e);messages=loadLocal();groups=loadLocalGroups();setStatus("إعداد قاعدة البيانات غير صحيح");render()}
  }
  function render(){
    renderGroupMenu();
    const q=$("searchInput").value.trim().toLocaleLowerCase();
    const filtered=messages.filter(m=>inGroup(m)&&`${m.title||""}\n${m.content||""}`.toLocaleLowerCase().includes(q));
    if(!filtered.length){listEl.innerHTML=`<div class="empty-list">${q?"لا توجد نتائج مطابقة.":"لا توجد رسائل بعد.<br>اضغط ＋ لإضافة أول رسالة."}</div>`}
    else listEl.innerHTML=filtered.map(m=>`<div class="conversation ${m.id===selectedId?"active":""}" data-id="${escapeHtml(m.id)}"><div class="avatar">✉</div><div class="conversation-info"><h3>${escapeHtml(m.title)}</h3><p>${escapeHtml((m.content||"").replace(/\s+/g," ").slice(0,90) || (readImages(m).length ? "📷 صورة مرفقة" : "بدون نص"))}</p></div><time>${escapeHtml(dateText(m.updatedAt||m.createdAt))}</time>${reorderMode&&!q?`<div class="move-btns"><button type="button" data-move="-1" aria-label="تحريك لأعلى">▲</button><button type="button" data-move="1" aria-label="تحريك لأسفل">▼</button></div>`:""}</div>`).join("");
    listEl.querySelectorAll(".conversation").forEach(el=>el.addEventListener("click",()=>selectMessage(el.dataset.id)));
    listEl.querySelectorAll("[data-move]").forEach(b=>b.addEventListener("click",e=>{e.stopPropagation();moveMessage(b.closest(".conversation").dataset.id,Number(b.dataset.move))}));
    if(selectedId && !messages.some(m=>m.id===selectedId)){selectedId=null;showWelcome()}
    else if(selectedId) showMessage();
  }
  async function moveMessage(id,dir){
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
  $("groupBtn").addEventListener("click",e=>{e.stopPropagation();$("groupMenu").classList.toggle("hidden")});
  $("groupAddBtn").addEventListener("click",addGroup);
  document.addEventListener("click",e=>{if(!e.target.closest("#groupMenu"))$("groupMenu").classList.add("hidden")});
  $("reorderBtn").addEventListener("click",()=>{reorderMode=!reorderMode;$("reorderBtn").classList.toggle("on",reorderMode);if(reorderMode&&$("searchInput").value.trim())toast("امسح البحث لتحريك الرسائل");render()});
  function selectMessage(id){selectedId=id;render()}
  function showWelcome(){$("welcome").classList.remove("hidden");$("chatView").classList.add("hidden")}
  function readImages(m){
    try { const v=m?.imagesJson; const arr=typeof v==="string"?JSON.parse(v||"[]"):[]; return Array.isArray(arr)?arr.filter(x=>typeof x==="string"&&x.startsWith("data:image/")):[]; } catch { return []; }
  }
  function renderImagePreview(){
    const box=$("imagePreview");
    box.innerHTML=pendingImages.map((src,i)=>`<div class="preview-item"><img src="${src}" alt="صورة مرفقة"><button type="button" data-remove-image="${i}" aria-label="حذف الصورة">×</button></div>`).join("");
    box.querySelectorAll("[data-remove-image]").forEach(b=>b.addEventListener("click",()=>{pendingImages.splice(Number(b.dataset.removeImage),1);renderImagePreview()}));
  }
  function showMessage(){
    const m=messages.find(x=>x.id===selectedId);if(!m){showWelcome();return}
    $("welcome").classList.add("hidden");$("chatView").classList.remove("hidden");
    $("viewTitle").textContent=m.title;$("viewDate").textContent="تاريخ الحفظ: "+dateText(m.createdAt);
    const imgs=readImages(m);
    $("messageBubble").innerHTML=`<div class="message-text">${escapeHtml(m.content||"").replace(/\n/g,"<br>")}</div>${imgs.length?`<div class="message-images">${imgs.map(src=>`<img src="${src}" alt="صورة داخل الرسالة" loading="lazy">`).join("")}</div>`:""}`;
    $("copyBtn").textContent="نسخ النص";
  }
  function openNew(){editingId=null;pendingImages=[];$("dialogHeading").textContent="إضافة رسالة جديدة";$("messageTitle").value="";$("messageContent").value="";$("messageImages").value="";$("formError").textContent="";renderImagePreview();dialog.showModal()}
  function closeDialog(){dialog.close()}
  async function persistMessage(m){
    if(db){
      const { id: _localId, ...record } = m;
      await db.ref("savedMessages/"+m.id).set(record)
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
    e.preventDefault();const title=$("messageTitle").value.trim(),content=$("messageContent").value.trim();
    if(!title||(!content&&!pendingImages.length)){$("formError").textContent="اكتب عنوان الرسالة وأضف نصًا أو صورة واحدة على الأقل.";return}
    const now=Date.now(), old=messages.find(m=>m.id===editingId);
    const id=editingId||(db?db.ref("savedMessages").push().key:"local_"+now+"_"+Math.random().toString(36).slice(2,8));
    const m={id,title,content,imagesJson:JSON.stringify(pendingImages),createdAt:old?.createdAt||now,updatedAt:now};
    const ord=old?old.order:newOrder();if(typeof ord==="number")m.order=ord;
    const gid=old?old.groupId:currentGroup;if(gid)m.groupId=gid;
    if(m.imagesJson.length>1400000){$("formError").textContent="حجم الصور كبير. جرّب صورًا أقل أو أصغر حجمًا.";return}
    try{await persistMessage(m);selectedId=id;closeDialog();render();toast(db?"تم حفظ الرسالة ومشاركتها مع الجميع":"تم حفظ الرسالة على هذا الجهاز فقط")}
    catch(err){console.error("Rasayeli save error:",err);const code=err&&err.code?" ("+err.code+")":"";const detail=err&&err.message?" — "+err.message:"";$("formError").textContent="لم يتم الحفظ"+code+detail;}
  });
  $("copyBtn").addEventListener("click",async()=>{const m=messages.find(x=>x.id===selectedId);if(!m)return;try{await navigator.clipboard.writeText(m.content||"");toast("تم نسخ النص")}catch{toast("تعذر النسخ؛ حدد النص وانسخه يدويًا")}});
  $("shareBtn").addEventListener("click",async()=>{const m=messages.find(x=>x.id===selectedId);if(!m)return;try{if(navigator.share)await navigator.share({title:m.title,text:m.content});else{await navigator.clipboard.writeText(m.title+"\n\n"+m.content);toast("تم نسخ الرسالة للمشاركة")}}catch{}});
  $("editBtn").addEventListener("click",()=>{const m=messages.find(x=>x.id===selectedId);if(!m)return;editingId=m.id;pendingImages=readImages(m).slice();$("dialogHeading").textContent="تعديل الرسالة";$("messageTitle").value=m.title||"";$("messageContent").value=m.content||"";$("messageImages").value="";$("formError").textContent="";renderImagePreview();dialog.showModal()});
  $("deleteBtn").addEventListener("click",async()=>{const m=messages.find(x=>x.id===selectedId);if(!m)return;if(!confirm("هل تريد حذف هذه الرسالة من القائمة المشتركة؟"))return;try{if(db)await db.ref("savedMessages/"+m.id).remove();else{messages=messages.filter(x=>x.id!==m.id);saveLocal()}selectedId=null;render();showWelcome();toast("تم حذف الرسالة")}catch(e){toast("تعذر الحذف. تحقق من صلاحيات قاعدة البيانات")}});
  // استقبال نصوص من قائمة مشاركة Android/Chrome عند تثبيت التطبيق.
  const params=new URLSearchParams(location.search);
  const sharedText=params.get("text")||params.get("title")||"";
  if(sharedText){setTimeout(()=>{openNew();$("messageContent").value=sharedText;history.replaceState({}, "", location.pathname)},350)}
  window.addEventListener("beforeinstallprompt",e=>{e.preventDefault();installPrompt=e;$("installBtn").classList.remove("hidden")});
  $("installBtn").addEventListener("click",async()=>{if(!installPrompt)return;installPrompt.prompt();await installPrompt.userChoice;installPrompt=null;$("installBtn").classList.add("hidden")});
  if("serviceWorker" in navigator && location.protocol.startsWith("http"))navigator.serviceWorker.register("sw.js").catch(console.warn);
  initFirebase();
})();