/* LOOKSATSU frontend. Keamanan otoritatif harus tetap di Supabase RLS. */
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const cfg = window.LOOKSATSU_CONFIG || {};
  const configured = cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY &&
    !cfg.SUPABASE_URL.includes("PASTE_") && !cfg.SUPABASE_ANON_KEY.includes("PASTE_");
  const sb = configured && window.supabase
    ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
      }) : null;
  let currentUser = null, admin = false, allMovies = [], favorites = new Set(), signupMode = false;

  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  function toast(msg) { const el=$("toast"); el.textContent=msg; el.classList.add("show"); setTimeout(()=>el.classList.remove("show"),2800); }
  function safeUrl(raw) { try { const u=new URL(raw); return ["https:","http:"].includes(u.protocol) ? u.href : ""; } catch { return ""; } }
  
function videoMarkup(raw) {
  const url = safeUrl(raw);
  if (!url) return '<p class="muted">Tautan video tidak valid.</p>';

  const u = new URL(url);
  const host = u.hostname.toLowerCase();

  // Pemutar YouTube
  if (
    ["youtube.com", "www.youtube.com", "m.youtube.com",
     "youtu.be", "www.youtube-nocookie.com"].includes(host) ||
    host.endsWith(".youtube.com")
  ) {
    let id = "";

    if (host === "youtu.be") {
      id = u.pathname.split("/")[1] || "";
    } else if (u.pathname.startsWith("/embed/")) {
      id = u.pathname.split("/")[2] || "";
    } else {
      id = u.searchParams.get("v") || "";
    }

    if (/^[\w-]{11}$/.test(id)) {
      return `<iframe
        src="https://www.youtube-nocookie.com/embed/${id}"
        title="Video LOOKSATSU"
        allow="accelerometer; autoplay; encrypted-media; picture-in-picture"
        allowfullscreen></iframe>`;
    }
  }

  // Pemutar video langsung
  if (/\.(mp4|webm|ogg)(\?.*)?$/i.test(u.pathname + u.search)) {
    return `<video controls playsinline preload="metadata" style="width:100%;height:100%;background:#000">
      <source src="${esc(url)}">
      Browser tidak mendukung format video ini.
    </video>`;
  }

  return '<p class="muted">Link ini tidak mendukung pemutar langsung. Gunakan URL MP4 atau link embed resmi.</p>';
}

    // Non-YouTube links are opened in a new tab rather than embedded blindly.
    return `<div class="empty-state"><p>Video ini menggunakan penyedia eksternal.</p><a class="button button-primary" target="_blank" rel="noopener noreferrer" href="${esc(url)}">Buka video di tab baru</a></div>`;
  }
  async function loadMovies() {
    if(!sb) { $("connectionStatus").textContent="Belum terhubung ke Supabase — ikuti README."; $("movieGrid").innerHTML='<div class="empty-state">Tambahkan URL dan publishable key Supabase di config.js untuk memuat katalog online.</div>'; renderFavorites(); return; }
    const {data,error}=await sb.from("movies").select("id,title,description,poster_url,video_url,category,release_year,created_at").order("created_at",{ascending:false});
    if(error) { $("movieGrid").innerHTML='<div class="empty-state">Katalog gagal dimuat. Periksa tabel dan policy RLS di Supabase.</div>'; $("connectionStatus").textContent="Gagal memuat katalog."; console.error(error); return; }
    allMovies=data||[]; $("connectionStatus").textContent="Terhubung ke katalog online"; renderMovies(); renderFavorites(); renderAdminMovies();
  }
  function movieCard(m, favorite=false) {
    const poster=safeUrl(m.poster_url||"");
    return `<article class="movie-card"><div class="poster">${poster?`<img loading="lazy" src="${esc(poster)}" alt="Poster ${esc(m.title)}" onerror="this.remove()">`:`<span class="poster-placeholder">特撮</span>`}<span class="category-chip">${esc(m.category||"Tokusatsu")}</span></div><div class="movie-body"><h3 class="movie-title" title="${esc(m.title)}">${esc(m.title)}</h3><div class="movie-meta">${m.release_year?esc(m.release_year)+" · ":""}${esc(m.category||"Tokusatsu")}</div><p class="movie-desc">${esc(m.description||"Belum ada deskripsi.")}</p><div class="movie-actions"><button class="button button-primary" data-play="${esc(m.id)}">▶ Tonton</button><button class="icon-button ${favorites.has(String(m.id))?"saved":""}" aria-label="Favorit" data-fav="${esc(m.id)}">${favorites.has(String(m.id))?"♥":"♡"}</button></div></div></article>`;
  }
  function renderMovies() {
    const q=$("searchInput").value.trim().toLowerCase(), cat=$("categoryFilter").value;
    const list=allMovies.filter(m=>(!q||[m.title,m.description,m.category,String(m.release_year||"")].some(v=>String(v||"").toLowerCase().includes(q)))&&(!cat||m.category===cat));
    $("filmCount").textContent=`${list.length} judul`;
    const cats=[...new Set(allMovies.map(m=>m.category).filter(Boolean))], select=$("categoryFilter"), old=select.value;
    if(select.options.length!==cats.length+1){select.innerHTML='<option value="">Semua kategori</option>'+cats.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join("");select.value=cats.includes(old)?old:"";}
    $("movieGrid").innerHTML=list.length?list.map(m=>movieCard(m)).join(""):'<div class="empty-state">Belum ada film yang cocok. Coba kata kunci lain.</div>';
  }
  function renderFavorites() {
    if(!currentUser){$("favoriteGrid").innerHTML='<div class="empty-state">Masuk untuk menyimpan favorit di akunmu.</div>';return;}
    const list=allMovies.filter(m=>favorites.has(String(m.id)));
    $("favoriteGrid").innerHTML=list.length?list.map(m=>movieCard(m,true)).join(""):'<div class="empty-state">Belum ada favorit. Tekan ♡ pada film yang kamu suka.</div>';
  }
  async function loadFavorites() {
    favorites=new Set(); if(!sb||!currentUser){renderFavorites();return;}
    const {data,error}=await sb.from("favorites").select("movie_id").eq("user_id",currentUser.id);
    if(!error) favorites=new Set((data||[]).map(x=>String(x.movie_id)));
    renderMovies();renderFavorites();
  }
  async function toggleFavorite(id) {
    if(!currentUser){$("loginDialog").showModal();toast("Masuk dahulu untuk menyimpan favorit.");return;}
    const key=String(id);
    if(favorites.has(key)){
      const {error}=await sb.from("favorites").delete().eq("movie_id",id).eq("user_id",currentUser.id);
      if(error){toast("Gagal menghapus favorit.");return;} favorites.delete(key);
    } else {
      const {error}=await sb.from("favorites").insert({movie_id:id,user_id:currentUser.id});
      if(error){toast("Gagal menyimpan favorit. Pastikan tabel favorites dan RLS sudah dibuat.");return;} favorites.add(key);
    }
    renderMovies();renderFavorites();
  }
  async function refreshAuth(session) {
    currentUser=session?.user||null; admin=false;
    if(currentUser&&sb){
      const {data}=await sb.from("looksatsu_admins").select("user_id").eq("user_id",currentUser.id).maybeSingle();
      admin=!!data;
    }
    $("accountLabel").textContent=currentUser?(currentUser.email||"Akun masuk"):"Mode pengunjung";
    $("loginOpen").classList.toggle("hidden",!!currentUser);
    $("logoutBtn").classList.toggle("hidden",!currentUser);
    $("adminPanel").classList.toggle("hidden",!admin);
    if(admin) $("accountLabel").textContent=(currentUser.email||"Admin")+" · Admin";
    await loadFavorites(); renderAdminMovies();
  }
  
function openPlayer(id) {
  const m = allMovies.find(x => String(x.id) === String(id));
  if (!m) return;

  $("playerTitle").textContent = m.title;
  $("playerDescription").textContent = m.description || "";
  $("playerFrame").innerHTML = videoMarkup(m.video_url);

  $("playerDialog").showModal();

  // Muat daftar episode untuk serial yang dipilih
  loadEpisodes(m.id);
}
  function renderAdminMovies() {
    if(!admin){$("adminMovieList").innerHTML="";return;}
    $("adminMovieList").innerHTML=allMovies.length?allMovies.map(m=>`<div class="admin-item"><img class="admin-thumb" src="${esc(safeUrl(m.poster_url)||"")}" alt="" onerror="this.style.visibility='hidden'"><div class="admin-item-main"><strong>${esc(m.title)}</strong><small>${esc(m.category||"Tokusatsu")} ${m.release_year?"· "+esc(m.release_year):""}</small></div><div class="admin-item-actions"><button class="button button-ghost" data-edit="${esc(m.id)}">Edit</button><button class="button button-ghost" data-delete="${esc(m.id)}">Hapus</button></div></div>`).join(""):'<div class="empty-state">Belum ada film.</div>';
  }
  function resetMovieForm(){$("movieForm").reset();$("movieId").value="";$("movieCategory").value="Tokusatsu";$("movieFormTitle").textContent="Tambah film";$("cancelEdit").classList.add("hidden");}
  async function saveMovie(e) {
    e.preventDefault(); if(!admin){toast("Akses admin tidak tersedia.");return;}
    const id=$("movieId").value, title=$("movieTitle").value.trim(), video=safeUrl($("movieVideo").value.trim());
    if(!title||!video){$("adminMessage").textContent="Judul dan URL video valid wajib diisi.";return;}
    const year=$("movieYear").value?Number($("movieYear").value):null;
    if(year&&(!Number.isInteger(year)||year<1900||year>2100)){toast("Tahun tidak valid.");return;}
    const record={title,description:$("movieDescription").value.trim(),poster_url:safeUrl($("moviePoster").value.trim()),video_url:video,category:$("movieCategory").value.trim()||"Tokusatsu",release_year:year};
    const result=id?await sb.from("movies").update(record).eq("id",id):await sb.from("movies").insert(record);
    if(result.error){console.error(result.error);$("adminMessage").textContent="Gagal menyimpan. Periksa policy RLS.";return;}
    $("adminMessage").textContent="Film tersimpan.";resetMovieForm();await loadMovies();toast("Data film berhasil disimpan.");
  }
  function editMovie(id) {
    const m=allMovies.find(x=>String(x.id)===String(id));if(!m||!admin)return;
    $("movieId").value=m.id;$("movieTitle").value=m.title;$("movieCategory").value=m.category||"Tokusatsu";$("movieYear").value=m.release_year||"";$("moviePoster").value=m.poster_url||"";$("movieVideo").value=m.video_url||"";$("movieDescription").value=m.description||"";$("movieFormTitle").textContent="Edit film";$("cancelEdit").classList.remove("hidden");$("movieForm").scrollIntoView({behavior:"smooth",block:"start"});
  }
  async function deleteMovie(id) {
    if(!admin||!confirm("Yakin ingin menghapus film ini?"))return;
    const {error}=await sb.from("movies").delete().eq("id",id);
    if(error){toast("Tidak bisa menghapus. Periksa policy RLS.");return;}
    await loadMovies();toast("Film dihapus.");
  }
  async function searchUsers(e) {
    e.preventDefault(); if(!admin)return;
    const q=$("userSearch").value.trim();
    if(q.length<2){$("userResults").innerHTML='<div class="empty-state">Ketik minimal 2 karakter untuk mencari.</div>';return;}
    const {data,error}=await sb.from("profiles").select("id,display_name,email,created_at").or(`display_name.ilike.%${q.replace(/[,%()]/g,"")}%,email.ilike.%${q.replace(/[,%()]/g,"")}%`).limit(30);
    if(error){$("userResults").innerHTML='<div class="empty-state">Pencarian gagal. Pastikan policy admin untuk profiles sudah dipasang.</div>';return;}
    $("userResults").innerHTML=data?.length?data.map(u=>`<div class="admin-item"><div class="admin-item-main"><strong>${esc(u.display_name||"Tanpa nama")}</strong><small>${esc(u.email||"Email tidak tersedia")} · ${esc(new Date(u.created_at).toLocaleDateString("id-ID"))}</small></div></div>`).join(""):'<div class="empty-state">Pengguna tidak ditemukan.</div>';
  }
  async function authSubmit(e) {
    e.preventDefault();if(!sb){$("authMessage").textContent="Isi config.js terlebih dahulu.";return;}
    const email=$("authEmail").value.trim(),password=$("authPassword").value;
    $("authSubmit").disabled=true;$("authMessage").textContent="Memproses…";
    let result;
    if(signupMode) result=await sb.auth.signUp({email,password,options:{data:{display_name:$("displayName").value.trim()}}});
    else result=await sb.auth.signInWithPassword({email,password});
    $("authSubmit").disabled=false;
    if(result.error){$("authMessage").textContent=result.error.message;return;}
    if(signupMode&&!result.data.session){$("authMessage").textContent="Cek email untuk konfirmasi pendaftaran, lalu masuk.";return;}
    $("authMessage").textContent="Berhasil."; $("loginDialog").close();toast(signupMode?"Akun dibuat.":"Berhasil masuk.");
    await refreshAuth((await sb.auth.getSession()).data.session);
  }
  function setAuthMode(next){signupMode=next;$("authTitle").textContent=signupMode?"Daftar akun":"Masuk";$("authSubmit").textContent=signupMode?"Buat akun":"Masuk";$("authToggle").textContent=signupMode?"Sudah punya akun? Masuk":"Belum punya akun? Daftar";$("displayNameWrap").classList.toggle("hidden",!signupMode);$("authPassword").autocomplete=signupMode?"new-password":"current-password";$("authMessage").textContent="";}
  function bindEvents(){
    $("searchInput").addEventListener("input",renderMovies);$("categoryFilter").addEventListener("change",renderMovies);
    $("movieGrid").addEventListener("click",e=>{const p=e.target.closest("[data-play]"),f=e.target.closest("[data-fav]");if(p)openPlayer(p.dataset.play);if(f)toggleFavorite(f.dataset.fav);});
    $("favoriteGrid").addEventListener("click",e=>{const p=e.target.closest("[data-play]"),f=e.target.closest("[data-fav]");if(p)openPlayer(p.dataset.play);if(f)toggleFavorite(f.dataset.fav);});
    $("adminMovieList").addEventListener("click",e=>{const ed=e.target.closest("[data-edit]"),del=e.target.closest("[data-delete]");if(ed)editMovie(ed.dataset.edit);if(del)deleteMovie(del.dataset.delete);});
    $("movieForm").addEventListener("submit",saveMovie);$("cancelEdit").addEventListener("click",resetMovieForm);$("userSearchForm").addEventListener("submit",searchUsers);
    $("loginOpen").addEventListener("click",()=>{$("loginDialog").showModal();});$("loginClose").addEventListener("click",()=>$("loginDialog").close());
    $("loginForm").addEventListener("submit",authSubmit);$("authToggle").addEventListener("click",()=>setAuthMode(!signupMode));
    $("logoutBtn").addEventListener("click",async()=>{await sb.auth.signOut();await refreshAuth(null);toast("Kamu sudah keluar.");});
    $("playerClose").addEventListener("click",()=>{$("playerFrame").innerHTML="";$("playerDialog").close();});
    document.querySelectorAll(".tab").forEach(btn=>btn.addEventListener("click",()=>{document.querySelectorAll(".tab").forEach(x=>x.classList.toggle("active",x===btn));document.querySelectorAll(".tab-content").forEach(x=>x.classList.toggle("hidden",x.id!==btn.dataset.tab));}));
    $("yearNow").textContent=new Date().getFullYear();
  }
  async function init(){
    bindEvents();
    if(!sb){$("connectionStatus").textContent="Belum terhubung ke Supabase";$("movieGrid").innerHTML='<div class="empty-state">Konfigurasi Supabase belum diisi. Ikuti README.md.</div>';return;}
    sb.auth.onAuthStateChange((_event,session)=>{setTimeout(()=>refreshAuth(session),0);});
    const {data}=await sb.auth.getSession();await refreshAuth(data.session);await loadMovies();
  }
  document.addEventListener("DOMContentLoaded",init);
})();
let currentEpisodes = [];
let currentEpisodeIndex = 0;
let currentMovieId = null;

async function loadEpisodes(movieId) {
  currentMovieId = movieId;
  currentEpisodes = [];
  currentEpisodeIndex = 0;

  const frame = $("playerFrame");
  let list = $("episodeList");

  // Buat daftar episode tanpa mengubah HTML
  if (!list) {
    list = document.createElement("div");
    list.id = "episodeList";
    list.style.cssText = "margin-top:16px;display:grid;gap:8px;";
    frame.insertAdjacentElement("afterend", list);
  }

  list.innerHTML = "<p>Memuat episode...</p>";

  const { data, error } = await sb
    .from("episodes")
    .select("id,movie_id,episode_number,title,video_url")
    .eq("movie_id", movieId)
    .order("episode_number", { ascending: true });

  if (error) {
    console.error("Episode:", error);
    list.innerHTML =
      '<p class="muted">Episode belum tersedia. Pastikan tabel episodes sudah dibuat di Supabase.</p>';
    return;
  }

  currentEpisodes = data || [];

  if (!currentEpisodes.length) {
    list.innerHTML =
      '<p class="muted">Belum ada episode untuk serial ini.</p>';
    return;
  }

  list.innerHTML = `
    <h3>Daftar Episode</h3>
    <div style="display:flex;gap:8px;flex-wrap:wrap">
      ${currentEpisodes.map((ep, i) => `
        <button class="button button-ghost"
          data-episode-index="${i}">
          Episode ${esc(ep.episode_number)} — ${esc(ep.title)}
        </button>
      `).join("")}
    </div>
    <div style="display:flex;gap:8px;margin-top:8px">
      <button class="button button-ghost" id="episodePrev">← Sebelumnya</button>
      <button class="button button-primary" id="episodeNext">Selanjutnya →</button>
    </div>
  `;

  list.querySelectorAll("[data-episode-index]").forEach(btn => {
    btn.addEventListener("click", () => {
      playEpisode(Number(btn.dataset.episodeIndex));
    });
  });

  $("episodePrev").addEventListener("click", () => {
    if (currentEpisodeIndex > 0) {
      playEpisode(currentEpisodeIndex - 1);
    }
  });

  $("episodeNext").addEventListener("click", () => {
    if (currentEpisodeIndex < currentEpisodes.length - 1) {
      playEpisode(currentEpisodeIndex + 1);
    }
  });

  playEpisode(0);
}

function playEpisode(index) {
  if (index < 0 || index >= currentEpisodes.length) return;

  currentEpisodeIndex = index;
  const ep = currentEpisodes[index];

  $("playerTitle").textContent =
    `Episode ${ep.episode_number}: ${ep.title}`;

  $("playerFrame").innerHTML = videoMarkup(ep.video_url);

  const list = $("episodeList");
  if (list) {
    list.querySelectorAll("[data-episode-index]").forEach((btn, i) => {
      btn.classList.toggle("active", i === index);
    });
  }

  const prev = $("episodePrev");
  const next = $("episodeNext");

  if (prev) prev.disabled = index === 0;
  if (next) next.disabled = index === currentEpisodes.length - 1;
      }
      
