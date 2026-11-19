const $ = (id) => document.getElementById(id);
const STORAGE_KEY = "ptxyz_transfer_receipts_v1";
let filesQueue = [];
let results = [];
let history = loadHistory();
let worker = null;

function loadHistory(){ try{return JSON.parse(localStorage.getItem(STORAGE_KEY)||"[]")}catch{return []} }
function saveHistory(){ localStorage.setItem(STORAGE_KEY, JSON.stringify(history)); renderHistory(); }
function money(n){ if(!n) return ""; const digits=String(n).replace(/\D/g,""); return digits ? "Rp " + Number(digits).toLocaleString("id-ID") : ""; }
function norm(s){return String(s||"").toUpperCase().replace(/[^A-Z0-9]/g,"")}
function esc(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
function showNotice(msg){$("notice").textContent=msg;$("notice").classList.remove("hidden")}
function hideNotice(){$("notice").classList.add("hidden")}

$("files").addEventListener("change",e=>addFiles([...e.target.files]));
function addFiles(files){
  const valid=files.filter(f=>f.type.startsWith("image/"));
  filesQueue.push(...valid);
  $("runOcr").disabled=!filesQueue.length;
  $("clearQueue").disabled=!filesQueue.length;
  $("queueInfo").textContent=`${filesQueue.length} gambar dalam antrean.`;
  hideNotice();
}
const drop=$("files").parentElement;
drop.addEventListener("dragover",e=>{e.preventDefault();drop.style.borderColor="#526f91"});
drop.addEventListener("dragleave",()=>drop.style.borderColor="");
drop.addEventListener("drop",e=>{e.preventDefault();drop.style.borderColor="";addFiles([...e.dataTransfer.files])});
$("clearQueue").onclick=()=>{filesQueue=[];$("files").value="";$("queueInfo").textContent="Belum ada gambar dipilih.";$("runOcr").disabled=true;$("clearQueue").disabled=true};

function parseOcr(raw){
  const lines=raw.split(/\r?\n/).map(x=>x.replace(/\s+/g," ").trim()).filter(Boolean);
  const all=lines.join("\n");
  // Time: prefer a time near a transaction date/time label, otherwise first valid clock time.
  let time="";
  const timeLabel=/(waktu|jam|time|tanggal\s*\/?\s*waktu|date\s*\/?\s*time|transaksi)/i;
  for(let i=0;i<lines.length;i++){
    if(timeLabel.test(lines[i])){
      const m=lines[i].match(/\b([01]?\d|2[0-3])[:.]([0-5]\d)(?:[:.]([0-5]\d))?\b/);
      if(m){time=m[0].replace(/\./g,":");break}
      if(lines[i+1]){const n=lines[i+1].match(/\b([01]?\d|2[0-3])[:.]([0-5]\d)(?:[:.]([0-5]\d))?\b/);if(n){time=n[0].replace(/\./g,":");break}}
    }
  }
  if(!time){const m=all.match(/\b([01]?\d|2[0-3])[:.]([0-5]\d)(?:[:.]([0-5]\d))?\b/);if(m)time=m[0].replace(/\./g,":")}
  // Receiving bank: only capture around destination/recipient labels to avoid sender bank.
  let bank="";
  const bankLabel=/(bank\s*(penerima|tujuan)|penerima|rekening\s*tujuan|ke\s*bank|beneficiary\s*bank|destination\s*bank)/i;
  for(let i=0;i<lines.length;i++){
    if(bankLabel.test(lines[i])){
      let value=lines[i].replace(/.*?(bank\s*(penerima|tujuan)|penerima|rekening\s*tujuan|ke\s*bank|beneficiary\s*bank|destination\s*bank)\s*[:\-]?\s*/i,"").trim();
      if(!value && lines[i+1]) value=lines[i+1];
      value=value.replace(/^(nama|bank)\s*[:\-]?\s*/i,"").trim();
      if(value && value.length<55 && !/^\d+$/.test(value)){bank=value;break}
    }
  }
  // Amount: prioritize lines containing amount/nominal/total, then Rp-formatted values.
  let amount="";
  const amountLabel=/(nominal|jumlah|total|amount|transfer|sebesar)/i;
  for(const line of lines){
    if(amountLabel.test(line)){
      const m=line.match(/(?:rp\.?\s*)?([\d][\d.,\s]{2,})/i);
      if(m){const d=m[1].replace(/\D/g,"");if(d.length>=3){amount=d;break}}
    }
  }
  if(!amount){
    const matches=[...all.matchAll(/(?:rp\.?\s*)((?:\d{1,3}(?:[.,]\d{3})+)|\d{4,})/gi)];
    if(matches.length)amount=matches.sort((a,b)=>b[1].replace(/\D/g,"").length-a[1].replace(/\D/g,"").length)[0][1];
  }
  // Reference number: prioritize explicit labels; stop at line boundary.
  let reference="";
  const refLabel=/(no\.?\s*referensi|nomor\s*referensi|reference\s*(number|no)?|ref(?:erensi)?\.?\s*(no|number)?|id\s*transaksi|no\.?\s*transaksi|transaction\s*id)/i;
  for(let i=0;i<lines.length;i++){
    if(refLabel.test(lines[i])){
      let val=lines[i].replace(/.*?(no\.?\s*referensi|nomor\s*referensi|reference\s*(number|no)?|ref(?:erensi)?\.?\s*(no|number)?|id\s*transaksi|no\.?\s*transaksi|transaction\s*id)\s*[:#\-]?\s*/i,"").trim();
      if(!val && lines[i+1])val=lines[i+1];
      val=val.replace(/\s+(tanggal|waktu|jam|nominal|jumlah|total|bank).*$/i,"").trim();
      const m=val.match(/[A-Z0-9][A-Z0-9\-\/]{4,}/i);
      if(m){reference=m[0];break}
    }
  }
  return {time,bank,amount,reference,raw};
}

async function sha256(file){
  const buf=await file.arrayBuffer();
  const digest=await crypto.subtle.digest("SHA-256",buf);
  return [...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,"0")).join("");
}
function compareDuplicate(item, priorItems){
  const ref=norm(item.reference);
  if(item.hash && priorItems.some(x=>x.hash===item.hash))return {label:"Gambar identik",kind:"dup"};
  if(ref.length>=5 && priorItems.some(x=>norm(x.reference)===ref))return {label:"Nomor referensi sudah digunakan",kind:"dup"};
  const amt=String(item.amount||"").replace(/\D/g,"");
  const bank=norm(item.bank), time=norm(item.time);
  if(amt.length>=4 && bank && time && priorItems.some(x=>String(x.amount||"").replace(/\D/g,"")===amt && norm(x.bank)===bank && norm(x.time)===time)){
    return {label:"Perlu diperiksa: data mirip",kind:"warn"};
  }
  return {label:"Belum ditemukan duplikasi",kind:"ok"};
}
function allKnown(excludeId){return [...history,...results.filter(x=>x.id!==excludeId && x.saved)]}

$("runOcr").onclick=async()=>{
  if(!filesQueue.length)return;
  $("runOcr").disabled=true;$("progressWrap").classList.remove("hidden");hideNotice();
  results=[];renderResults();
  try{
    worker=await Tesseract.createWorker("eng",1,{logger:m=>{
      if(m.status){$("progressText").textContent=m.status==="recognizing text"?"Membaca teks pada gambar…":m.status}
      if(m.status==="recognizing text" && m.progress!=null){$("progressBar").style.width=Math.round(m.progress*100)+"%";$("progressPct").textContent=Math.round(m.progress*100)+"%"}
    }});
    for(let i=0;i<filesQueue.length;i++){
      const file=filesQueue[i];
      $("progressText").textContent=`Memproses ${i+1} dari ${filesQueue.length}: ${file.name}`;
      $("progressBar").style.width=Math.round(i/filesQueue.length*100)+"%";
      const {data}=await worker.recognize(file);
      const parsed=parseOcr(data.text);
      const hash=await sha256(file);
      const item={id:crypto.randomUUID?crypto.randomUUID():String(Date.now()+i),name:file.name,preview:URL.createObjectURL(file),hash,...parsed,confidence:Math.round(data.confidence||0),saved:false};
      results.push(item);
      const prior=[...history,...results.slice(0,-1)];
      item.status=compareDuplicate(item,prior);
      renderResults();
    }
    await worker.terminate();worker=null;
    $("progressBar").style.width="100%";$("progressPct").textContent="100%";
    $("progressText").textContent="Selesai.";
    showNotice("OCR selesai. Periksa kolom yang kosong atau keliru, lalu simpan hasil yang sudah dikoreksi.");
  }catch(err){
    console.error(err);
    if(worker){try{await worker.terminate()}catch{} worker=null}
    showNotice("Proses OCR gagal. Periksa koneksi internet, lalu muat ulang halaman dan coba kembali. Detail: "+err.message);
  }finally{
    $("runOcr").disabled=!filesQueue.length;
    $("export").disabled=!results.length;
    $("saveResults").disabled=!results.length;
  }
};

function renderResults(){
  const body=$("results");
  if(!results.length){body.innerHTML='<tr><td colspan="6" class="empty">Belum ada hasil OCR.</td></tr>';return}
  body.innerHTML=results.map((x,i)=>`
    <tr>
      <td><div class="filecell"><img class="thumb" src="${x.preview}" alt=""><span class="filename">${esc(x.name)}<br>OCR ${x.confidence}%</span></div></td>
      <td><input aria-label="Waktu transaksi" data-i="${i}" data-field="time" value="${esc(x.time)}" placeholder="HH:MM:SS"></td>
      <td><input class="wide" aria-label="Bank penerima" data-i="${i}" data-field="bank" value="${esc(x.bank)}" placeholder="Bank penerima"></td>
      <td><input aria-label="Nominal" data-i="${i}" data-field="amount" value="${esc(x.amount)}" placeholder="Nominal angka"></td>
      <td><input class="wide" aria-label="Nomor referensi" data-i="${i}" data-field="reference" value="${esc(x.reference)}" placeholder="Nomor referensi"></td>
      <td><span class="status ${x.status?.kind||"missing"}">${esc(x.status?.label||"Belum diperiksa")}</span></td>
    </tr>`).join("");
  body.querySelectorAll("input").forEach(input=>input.addEventListener("change",e=>{
    const x=results[Number(e.target.dataset.i)];x[e.target.dataset.field]=e.target.value.trim();
    x.status=compareDuplicate(x,[...history,...results.filter(y=>y.id!==x.id)]);
    renderResults();
  }));
  $("export").disabled=false;$("saveResults").disabled=false;
}
function renderHistory(){
  $("historySummary").textContent=`${history.length} bukti tersimpan pada browser ini`;
  $("history").innerHTML=history.length?history.slice().reverse().map(x=>`<tr><td>${esc(x.savedAt||"")}</td><td>${esc(x.time)}</td><td>${esc(x.bank)}</td><td>${esc(money(x.amount)||x.amount)}</td><td>${esc(x.reference)}</td></tr>`).join(""):'<tr><td colspan="5" class="empty">Riwayat masih kosong.</td></tr>';
}
$("saveResults").onclick=()=>{
  let count=0;
  for(const x of results){
    if(x.saved)continue;
    if(!x.time||!x.bank||!x.amount||!x.reference){showNotice("Ada data yang belum lengkap. Lengkapi waktu, bank penerima, nominal, dan nomor referensi sebelum menyimpan.");return}
    const status=compareDuplicate(x,history);
    if(status.kind==="dup"){x.status=status;continue}
    history.push({time:x.time,bank:x.bank,amount:x.amount,reference:x.reference,hash:x.hash,savedAt:new Date().toLocaleString("id-ID")});
    x.saved=true;x.status=status;count++;
  }
  saveHistory();renderResults();
  showNotice(`${count} data disimpan. Data yang terindikasi duplikat kuat tidak disimpan otomatis; periksa terlebih dahulu.`);
};
$("export").onclick=()=>{
  if(!results.length)return;
  const rows=results.map(x=>({"Nama file":x.name,"Waktu transaksi":x.time,"Bank penerima":x.bank,"Nominal":x.amount,"Nomor referensi":x.reference,"Status":x.status?.label||"","Confidence OCR (%)":x.confidence}));
  const ws=XLSX.utils.json_to_sheet(rows);const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,"Hasil OCR");XLSX.writeFile(wb,"hasil-verifikasi-bukti-transfer.xlsx");
};
$("clearHistory").onclick=()=>{
  if(!confirm("Hapus seluruh riwayat yang tersimpan di browser ini? Tindakan ini tidak dapat dibatalkan."))return;
  history=[];saveHistory();showNotice("Riwayat lokal berhasil dikosongkan.");
};
renderHistory();
