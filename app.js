(() => {
  const $ = id => document.getElementById(id);
  const listEl = $("conversationList"), dialog = $("messageDialog");
  let messages = [], selectedId = null, editingId = null, db = null, installPrompt = null;
  const localKey = "rasayeli_local_messages_v1";
  const escapeHtml = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const dateText = v => { try { return new Date(v).toLocaleDateString("ar-EG",{year:"numeric",month:"short",day:"numeric"}); } catch { return ""; } };
  function toast(s){ const t=$("toast");t.textContent=s;t.classList.add("show");setTimeout(()=>t.classList.remove("show"),2600); }
  function setStatus(s,good=false){$("syncStatus").textContent=s;$("syncStatus").style.color=good?"#c9f5df":"#f9d7c7";}
  function loadLocal(){try{return JSON.parse(localStorage.getItem(localKey)||"[]")}catch{return []}}
  function saveLocal(){localStorage.setItem(localKey,JSON.stringify(messages))}
  function initFirebase(){
    const c=window.FIREBASE_CONFIG;
    if(!c || !c.apiKey || !c.databaseURL || !window.firebase){messages=loadLocal();setStatus("حفظ محلي فقط");render();return}
    try{
      if(!firebase.apps.length) firebase.initializeApp(c);
      db=firebase.database();
      db.ref("savedMessages").on("value", snap=>{
        const data=snap.val()||{};
        messages=Object.entries(data).map(([id,v])=>({...v,id})).sort((a,b)=>(b.updatedAt||b.createdAt||0)-(a.updatedAt||a.createdAt||0));
        setStatus("متصل — الرسائل مشتركة",true);render();
      },err=>{setStatus("تعذر الاتصال بقاعدة البيانات");console.error(err);});
    }catch(e){console.error(e);messages=loadLocal();setStatus("إعداد قاعدة البيانات غير صحيح");render()}
  }
  function render(){
    const q=$("searchInput").value.trim().toLocaleLowerCase();
    const filtered=messages.filter(m=>`${m.title||""}\n${m.content||""}`.toLocaleLowerCase().includes(q));
    if(!filtered.length){listEl.innerHTML=`<div class="empty-list">${q?"لا توجد نتائج مطابقة.":"لا توجد رسائل بعد.<br>اضغط ＋ لإضافة أول رسالة."}</div>`}
    else listEl.innerHTML=filtered.map(m=>`<div class="conversation ${m.id===selectedId?"active":""}" data-id="${escapeHtml(m.id)}"><div class="avatar">✉</div><div class="conversation-info"><h3>${escapeHtml(m.title)}</h3><p>${escapeHtml((m.content||"").replace(/\s+/g," ").slice(0,90))}</p></div><time>${escapeHtml(dateText(m.updatedAt||m.createdAt))}</time></div>`).join("");
    listEl.querySelectorAll(".conversation").forEach(el=>el.addEventListener("click",()=>selectMessage(el.dataset.id)));
    if(selectedId && !messages.some(m=>m.id===selectedId)){selectedId=null;showWelcome()}
    else if(selectedId) showMessage();
  }
  function selectMessage(id){selectedId=id;render()}
  function showWelcome(){$("welcome").classList.remove("hidden");$("chatView").classList.add("hidden")}
  function showMessage(){
    const m=messages.find(x=>x.id===selectedId);if(!m){showWelcome();return}
    $("welcome").classList.add("hidden");$("chatView").classList.remove("hidden");
    $("viewTitle").textContent=m.title;$("viewDate").textContent="تاريخ الحفظ: "+dateText(m.createdAt);
    $("messageBubble").textContent=m.content;
  }
  function openNew(){editingId=null;$("dialogHeading").textContent="إضافة رسالة جديدة";$("messageTitle").value="";$("messageContent").value="";$("formError").textContent="";dialog.showModal()}
  function closeDialog(){dialog.close()}
  async function persistMessage(m){
    if(db){await db.ref("savedMessages/"+m.id).set(m)}
    else {const idx=messages.findIndex(x=>x.id===m.id);if(idx>=0)messages[idx]=m;else messages.unshift(m);saveLocal();render()}
  }
  $("newBtn").addEventListener("click",openNew);$("welcomeNewBtn").addEventListener("click",openNew);
  $("closeDialog").addEventListener("click",closeDialog);$("cancelBtn").addEventListener("click",closeDialog);
  $("searchInput").addEventListener("input",render);
  $("messageForm").addEventListener("submit",async e=>{
    e.preventDefault();const title=$("messageTitle").value.trim(),content=$("messageContent").value.trim();
    if(!title||!content){$("formError").textContent="اكتب عنوان الرسالة ومحتواها أولًا.";return}
    const now=Date.now(), old=messages.find(m=>m.id===editingId);
    const id=editingId||(db?db.ref("savedMessages").push().key:"local_"+now+"_"+Math.random().toString(36).slice(2,8));
    const m={id,title,content,createdAt:old?.createdAt||now,updatedAt:now};
    try{await persistMessage(m);selectedId=id;closeDialog();render();toast(db?"تم حفظ الرسالة ومشاركتها مع الجميع":"تم حفظ الرسالة على هذا الجهاز فقط")}
    catch(err){console.error(err);$("formError").textContent="لم يتم الحفظ. تحقق من إعدادات قاعدة البيانات وقواعد الوصول."}
  });
  $("copyBtn").addEventListener("click",async()=>{const m=messages.find(x=>x.id===selectedId);if(!m)return;try{await navigator.clipboard.writeText(m.content);toast("تم نسخ المحتوى")}catch{toast("تعذر النسخ؛ حدد النص وانسخه يدويًا")}});
  $("shareBtn").addEventListener("click",async()=>{const m=messages.find(x=>x.id===selectedId);if(!m)return;try{if(navigator.share)await navigator.share({title:m.title,text:m.content});else{await navigator.clipboard.writeText(m.title+"\n\n"+m.content);toast("تم نسخ الرسالة للمشاركة")}}catch{}});
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