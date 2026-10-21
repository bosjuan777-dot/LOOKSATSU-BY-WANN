
"use strict";

// ==========================================
// LOOKSATSU - APLIKASI UTAMA
// Memerlukan config.js dan Supabase JS v2
// ==========================================

const db = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY
);

const $ = (id) => document.getElementById(id);

let movies = [];
let episodes = [];
let favorites = new Set();
let currentUser = null;
let isAdmin = false;
let isRegister = false;
let currentMovie = null;
let announcement = null;
let toastTimer;

// ==========================================
// UTILITAS
// ==========================================

function escapeHTML(value = "") {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

function notify(message) {
  const toast = $("toast");
  toast.textContent = message;
  toast.classList.add("show");

  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.remove("show");
  }, 3000);
}

function showMessage(id, message) {
  const element = $(id);
  if (element) element.textContent = message;
}

function openDialog(id) {
  const dialog = $(id);
  if (dialog && !dialog.open) dialog.showModal();
}

function closeDialog(id) {
  const dialog = $(id);
  if (dialog?.open) dialog.close();
}

function validURL(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function setConnection(message) {
  showMessage("connectionStatus", message);
}

// ==========================================
// AUTHENTICATION
// ==========================================

async function refreshAccount() {
  const { data, error } = await db.auth.getUser();

  if (error) console.warn("Status akun:", error.message);

  currentUser = data?.user || null;
  isAdmin = false;

  if (currentUser) {
    const { data: profile, error: profileError } = await db
      .from("profiles")
      .select("role, display_name")
      .eq("id", currentUser.id)
      .maybeSingle();

    if (profileError) {
      console.warn("Profil tidak tersedia:", profileError.message);
    }

    isAdmin = profile?.role === "admin";

    $("accountLabel").textContent =
      profile?.display_name || currentUser.email || "Pengguna";

    $("loginOpen").classList.add("hidden");
    $("logoutBtn").classList.remove("hidden");
  } else {
    $("accountLabel").textContent = "Mode pengunjung";
    $("loginOpen").classList.remove("hidden");
    $("logoutBtn").classList.add("hidden");
  }

  $("adminPanel").classList.toggle("hidden", !isAdmin);

  await loadFavorites();
}

$("loginOpen").addEventListener("click", () => {
  isRegister = false;
  updateAuthMode();
  openDialog("loginDialog");
});

$("loginClose").addEventListener("click", () => {
  closeDialog("loginDialog");
});

$("authToggle").addEventListener("click", () => {
  isRegister = !isRegister;
  updateAuthMode();
});

function updateAuthMode() {
  $("authTitle").textContent = isRegister ? "Daftar akun" : "Masuk";

  $("authSubmit").textContent = isRegister
    ? "Buat akun"
    : "Masuk";

  $("authToggle").textContent = isRegister
    ? "Sudah punya akun? Masuk"
    : "Belum punya akun? Daftar";

  $("displayNameWrap").classList.toggle("hidden", !isRegister);

  $("authPassword").autocomplete = isRegister
    ? "new-password"
    : "current-password";

  $("authPassword").minLength = isRegister ? 8 : 1;
}

$("loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();

  const email = $("authEmail").value.trim();
  const password = $("authPassword").value;
  const displayName = $("displayName").value.trim();

  $("authSubmit").disabled = true;
  showMessage("authMessage", "Memproses...");

  try {
    let result;

    if (isRegister) {
      result = await db.auth.signUp({
        email,
        password,
        options: {
          data: { display_name: displayName }
        }
      });

      if (!result.error && result.data.user) {
        if (result.data.session) {
          notify("Akun berhasil dibuat.");
        } else {
          showMessage(
            "authMessage",
            "Periksa email untuk verifikasi akun."
          );
          return;
        }
      }
    } else {
      result = await db.auth.signInWithPassword({
        email,
        password
      });
    }

    if (result.error) throw result.error;

    await refreshAccount();
    await loadMovies();
    await loadAnnouncement();

    closeDialog("loginDialog");
    $("loginForm").reset();
    notify(isRegister ? "Pendaftaran berhasil." : "Berhasil masuk.");
  } catch (error) {
    showMessage("authMessage", error.message || "Terjadi kesalahan.");
  } finally {
    $("authSubmit").disabled = false;
  }
});

$("logoutBtn").addEventListener("click", async () => {
  const { error } = await db.auth.signOut();

  if (error) {
    notify("Gagal keluar: " + error.message);
    return;
  }

  await refreshAccount();
  await loadMovies();
  notify("Kamu sudah keluar.");
});

db.auth.onAuthStateChange((event) => {
  if (event === "SIGNED_IN" || event === "SIGNED_OUT") {
    setTimeout(async () => {
      await refreshAccount();
      await loadMovies();
    }, 0);
  }
});

// ==========================================
// KATALOG DAN PENCARIAN
// ==========================================

async function loadMovies() {
  $("movieGrid").innerHTML =
    '<div class="empty-state">Memuat katalog...</div>';

  const { data, error } = await db
    .from("movies")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    $("movieGrid").innerHTML =
      '<div class="empty-state">Katalog gagal dimuat.</div>';

    setConnection("Gagal terhubung ke katalog.");
    console.error(error);
    return;
  }

  movies = data || [];
  renderMovies();
  populateMovieSelect();
  renderAdminMovies();

  setConnection("Katalog berhasil dimuat.");
}

function renderMovies() {
  const query = $("searchInput").value.trim().toLowerCase();
  const category = $("categoryFilter").value;

  const filtered = movies.filter((movie) => {
    const searchable = [
      movie.title,
      movie.category,
      movie.year,
      movie.description
    ].join(" ").toLowerCase();

    return searchable.includes(query) &&
      (!category || movie.category === category);
  });

  $("filmCount").textContent = `${filtered.length} judul`;

  const categories = [...new Set(
    movies.map((m) => m.category).filter(Boolean)
  )].sort();

  const previousCategory = $("categoryFilter").value;

  $("categoryFilter").innerHTML =
    '<option value="">Semua kategori</option>' +
    categories.map((cat) =>
      `<option value="${escapeHTML(cat)}">${escapeHTML(cat)}</option>`
    ).join("");

  if (categories.includes(previousCategory)) {
    $("categoryFilter").value = previousCategory;
  }

  if (!filtered.length) {
    $("movieGrid").innerHTML =
      '<div class="empty-state">Film tidak ditemukan.</div>';
    return;
  }

  $("movieGrid").innerHTML = filtered.map((movie) => `
    <article class="movie-card">
      <button class="movie-poster"
        type="button"
        data-play="${escapeHTML(movie.id)}"
        aria-label="Putar ${escapeHTML(movie.title)}">
        ${
          validURL(movie.poster_url || "")
            ? `<img src="${escapeHTML(movie.poster_url)}"
                alt="Poster ${escapeHTML(movie.title)}"
                loading="lazy">`
            : '<span class="poster-placeholder">特撮</span>'
        }
      </button>

      <div class="movie-details">
        <p class="eyebrow">${escapeHTML(movie.category || "Tokusatsu")}</p>
        <h3>${escapeHTML(movie.title)}</h3>
        <p class="muted small">${escapeHTML(movie.year || "Tahun tidak diketahui")}</p>

        <div class="movie-actions">
          <button class="button button-primary"
            type="button" data-play="${escapeHTML(movie.id)}">
            Tonton
          </button>

          <button class="button button-ghost"
            type="button" data-favorite="${escapeHTML(movie.id)}">
            ${favorites.has(String(movie.id)) ? "♥ Favorit" : "♡ Favorit"}
          </button>
        </div>
      </div>
    </article>
  `).join("");
}

$("searchInput").addEventListener("input", renderMovies);
$("categoryFilter").addEventListener("change", renderMovies);

// ==========================================
// FAVORIT
// ==========================================

async function loadFavorites() {
  favorites.clear();

  if (currentUser) {
    const { data, error } = await db
      .from("favorites")
      .select("movie_id")
      .eq("user_id", currentUser.id);

    if (!error) {
      (data || []).forEach((row) => {
        favorites.add(String(row.movie_id));
      });
    } else {
      console.warn("Favorit gagal dimuat:", error.message);
    }
  }

  renderMovies();
  renderFavoriteMovies();
}

async function toggleFavorite(movieId) {
  if (!currentUser) {
    notify("Masuk terlebih dahulu untuk menyimpan favorit.");
    openDialog("loginDialog");
    return;
  }

  const id = String(movieId);
  const exists = favorites.has(id);

  if (exists) {
    const { error } = await db
      .from("favorites")
      .delete()
      .eq("user_id", currentUser.id)
      .eq("movie_id", movieId);

    if (error) {
      notify("Gagal menghapus favorit.");
      return;
    }

    favorites.delete(id);
  } else {
    const { error } = await db
      .from("favorites")
      .insert({
        user_id: currentUser.id,
        movie_id: movieId
      });

    if (error) {
      notify("Gagal menyimpan favorit.");
      return;
    }

    favorites.add(id);
  }

  renderMovies();
  renderFavoriteMovies();
}

function renderFavoriteMovies() {
  const list = movies.filter((m) => favorites.has(String(m.id)));

  $("favoriteGrid").innerHTML = list.length
    ? list.map((movie) => `
        <article class="movie-card">
          <h3>${escapeHTML(movie.title)}</h3>
          <p class="muted small">${escapeHTML(movie.category || "")}</p>
          <button class="button button-primary"
            data-play="${escapeHTML(movie.id)}" type="button">
            Tonton
          </button>
          <button class="button button-ghost"
            data-favorite="${escapeHTML(movie.id)}" type="button">
            Hapus favorit
          </button>
        </article>
      `).join("")
    : '<div class="empty-state">Belum ada film favorit.</div>';
}

// ==========================================
// PEMUTAR FILM DAN EPISODE
// ==========================================

function safeVideoURL(value) {
  if (!validURL(value || "")) return null;

  const url = new URL(value);

  const allowedHosts = [
    "youtube.com",
    "www.youtube.com",
    "youtu.be",
    "www.youtube-nocookie.com",
    "player.vimeo.com",
    "vimeo.com"
  ];

  if (allowedHosts.includes(url.hostname)) {
    if (url.hostname === "youtu.be") {
      const id = url.pathname.slice(1);
      return /^[\w-]{11}$/.test(id)
        ? `https://www.youtube-nocookie.com/embed/${id}`
        : null;
    }

    if (url.hostname.includes("youtube")) {
      const id = url.searchParams.get("v") ||
        url.pathname.match(/\/embed\/([\w-]{11})/)?.[1];

      return id && /^[\w-]{11}$/.test(id)
        ? `https://www.youtube-nocookie.com/embed/${id}`
        : null;
    }

    return url.hostname === "player.vimeo.com"
      ? url.href
      : null;
  }

  // Tautan video langsung hanya jika berupa MP4/WebM.
  if (/\.(mp4|webm|ogg)$/i.test(url.pathname)) {
    return url.href;
  }

  return null;
}

async function playMovie(movieId) {
  currentMovie = movies.find((m) => String(m.id) === String(movieId));
  if (!currentMovie) return;

  $("playerTitle").textContent = currentMovie.title;
  $("playerDescription").textContent = currentMovie.description || "";

  renderVideo(currentMovie.video_url);
  openDialog("playerDialog");
  await loadEpisodes(currentMovie.id);
}

function renderVideo(videoURL) {
  const frame = $("playerFrame");
  frame.replaceChildren();

  const safeURL = safeVideoURL(videoURL);

  if (!safeURL) {
    frame.textContent =
      "Tautan video tidak didukung. Gunakan URL YouTube, Vimeo, MP4, atau WebM yang sah.";
    return;
  }

  if (/\.(mp4|webm|ogg)(\?.*)?$/i.test(safeURL)) {
    const video = document.createElement("video");
    video.controls = true;
    video.playsInline = true;
    video.preload = "metadata";
    video.src = safeURL;
    video.style.width = "100%";
    frame.appendChild(video);
  } else {
    const iframe = document.createElement("iframe");
    iframe.src = safeURL;
    iframe.title = "Pemutar video LOOKSATSU";
    iframe.allow =
      "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture";
    iframe.allowFullscreen = true;
    iframe.referrerPolicy = "strict-origin-when-cross-origin";
    frame.appendChild(iframe);
  }
}

async function loadEpisodes(movieId) {
  const { data, error } = await db
    .from("episodes")
    .select("*")
    .eq("movie_id", movieId)
    .order("episode_number", { ascending: true });

  if (error) {
    $("episodeList").textContent = "Gagal memuat episode.";
    return;
  }

  episodes = data || [];

  $("episodeList").innerHTML = episodes.length
    ? episodes.map((ep) => `
        <button type="button" class="admin-row"
          data-episode="${escapeHTML(ep.id)}">
          <strong>Episode ${escapeHTML(ep.episode_number)}</strong>
          <span>${escapeHTML(ep.title)}</span>
        </button>
      `).join("")
    : '<div class="empty-state">Belum ada episode.</div>';
}

$("playerClose").addEventListener("click", () => {
  $("playerFrame").replaceChildren();
  closeDialog("playerDialog");
});

$("episodeList").addEventListener("click", (event) => {
  const button = event.target.closest("[data-episode]");
  if (!button) return;

  const episode = episodes.find(
    (ep) => String(ep.id) === button.dataset.episode
  );

  if (!episode) return;

  $("playerTitle").textContent =
    `${currentMovie?.title || "Film"} — ${episode.title}`;

  renderVideo(episode.video_url);
});

// ==========================================
// EVENT KATALOG
// ==========================================

document.addEventListener("click", (event) => {
  const playButton = event.target.closest("[data-play]");
  const favoriteButton = event.target.closest("[data-favorite]");

  if (playButton) playMovie(playButton.dataset.play);
  if (favoriteButton) toggleFavorite(favoriteButton.dataset.favorite);
});

// ==========================================
// TAB ADMIN
// ==========================================

document.querySelectorAll("[data-tab]").forEach((button) => {
  button.addEventListener("click", () => {
    if (!isAdmin) return;

    document.querySelectorAll("[data-tab]").forEach((tab) => {
      tab.classList.toggle("active", tab === button);
    });

    document.querySelectorAll(".tab-content").forEach((panel) => {
      panel.classList.toggle("hidden", panel.id !== button.dataset.tab);
    });
  });
});

// ==========================================
// FORM FILM ADMIN
// ==========================================

function resetMovieForm() {
  $("movieForm").reset();
  $("movieId").value = "";
  $("movieCategory").value = "Tokusatsu";
  $("movieFormTitle").textContent = "Tambah film";
}

$("cancelEdit").addEventListener("click", resetMovieForm);

$("movieForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!isAdmin) return notify("Akses admin diperlukan.");

  const id = $("movieId").value;
  const title = $("movieTitle").value.trim();
  const video = $("movieVideo").value.trim();
  const poster = $("moviePoster").value.trim();

  if (!validURL(video) || (poster && !validURL(poster))) {
    return showMessage("adminMessage", "URL tidak valid.");
  }

  const payload = {
    title,
    category: $("movieCategory").value.trim() || "Tokusatsu",
    year: $("movieYear").value ? Number($("movieYear").value) : null,
    poster_url: poster || null,
    video_url: video,
    description: $("movieDescription").value.trim()
  };

  const query = id
    ? db.from("movies").update(payload).eq("id", id)
    : db.from("movies").insert(payload);

  const { error } = await query;

  if (error) {
    showMessage("adminMessage", "Gagal: " + error.message);
    return;
  }

  resetMovieForm();
  showMessage("adminMessage", "Film berhasil disimpan.");
  await loadMovies();
  notify("Katalog diperbarui.");
});

function renderAdminMovies() {
  $("adminMovieList").innerHTML = movies.length
    ? movies.map((movie) => `
        <div class="admin-row">
          <div>
            <strong>${escapeHTML(movie.title)}</strong>
            <p class="muted small">${escapeHTML(movie.category || "")}</p>
          </div>
          <button class="button button-ghost"
            type="button" data-edit-movie="${escapeHTML(movie.id)}">
            Edit
          </button>
          <button class="button button-ghost"
            type="button" data-delete-movie="${escapeHTML(movie.id)}">
            Hapus
          </button>
        </div>
      `).join("")
    : '<div class="empty-state">Belum ada film.</div>';

  populateMovieSelect();
}

$("adminMovieList").addEventListener("click", async (event) => {
  const edit = event.target.closest("[data-edit-movie]");
  const remove = event.target.closest("[data-delete-movie]");

  if (!isAdmin) return;

  if (edit) {
    const movie = movies.find(
      (m) => String(m.id) === edit.dataset.editMovie
    );

    if (!movie) return;

    $("movieId").value = movie.id;
    $("movieTitle").value = movie.title || "";
    $("movieCategory").value = movie.category || "Tokusatsu";
    $("movieYear").value = movie.year || "";
    $("moviePoster").value = movie.poster_url || "";
    $("movieVideo").value = movie.video_url || "";
    $("movieDescription").value = movie.description || "";
    $("movieFormTitle").textContent = "Edit film";

    $("movieForm").scrollIntoView({ behavior: "smooth" });
  }

  if (remove && confirm("Hapus film ini beserta episode terkait?")) {
    const { error } = await db.from("movies")
      .delete().eq("id", remove.dataset.deleteMovie);

    if (error) return notify("Gagal menghapus film: " + error.message);

    await loadMovies();
    notify("Film dihapus jika diizinkan oleh database.");
  }
});

function populateMovieSelect() {
  const select = $("episodeMovieId");
  const previous = select.value;

  select.innerHTML =
    '<option value="">Pilih film terlebih dahulu</option>' +
    movies.map((m) =>
      `<option value="${escapeHTML(m.id)}">${escapeHTML(m.title)}</option>`
    ).join("");

  if (movies.some((m) => String(m.id) === previous)) {
    select.value = previous;
  }
}

// ==========================================
// FORM EPISODE ADMIN
// ==========================================

function resetEpisodeForm() {
  $("episodeForm").reset();
  $("episodeId").value = "";
  $("episodeFormTitle").textContent = "Tambah episode";
}

$("cancelEpisodeEdit").addEventListener("click", resetEpisodeForm);

$("episodeForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!isAdmin) return notify("Akses admin diperlukan.");

  const id = $("episodeId").value;
  const video = $("episodeVideo").value.trim();

  if (!validURL(video)) {
    return showMessage("episodeMessage", "URL video tidak valid.");
  }

  const payload = {
    movie_id: $("episodeMovieId").value,
    episode_number: Number($("episodeNumber").value),
    title: $("episodeTitle").value.trim(),
    video_url: video
  };

  const query = id
    ? db.from("episodes").update(payload).eq("id", id)
    : db.from("episodes").insert(payload);

  const { error } = await query;

  if (error) {
    showMessage("episodeMessage", "Gagal: " + error.message);
    return;
  }

  resetEpisodeForm();
  showMessage("episodeMessage", "Episode berhasil disimpan.");
  
  await loadAdminEpisodes();
  notify("Daftar episode diperbarui.");
});

// ==========================================
// MEMUAT DAFTAR EPISODE UNTUK ADMIN
// ==========================================

async function loadAdminEpisodes() {
  const { data, error } = await db
    .from("episodes")
    .select("*, movies(title)")
    .order("movie_id")
    .order("episode_number");

  if (error) {
    $("adminEpisodeList").textContent = "Gagal memuat episode.";
    console.error(error);
    return;
  }

  $("adminEpisodeList").innerHTML = (data || []).map((ep) => `
    <div class="admin-row">
      <div>
        <strong>${escapeHTML(ep.movies?.title || "Film")}</strong>
        <p>Episode ${escapeHTML(ep.episode_number)} — ${escapeHTML(ep.title)}</p>
      </div>
      <button type="button" class="button button-ghost"
        data-edit-episode="${escapeHTML(ep.id)}">Edit</button>
      <button type="button" class="button button-ghost"
        data-delete-episode="${escapeHTML(ep.id)}">Hapus</button>
    </div>
  `).join("") || '<div class="empty-state">Belum ada episode.</div>';
}

$("adminEpisodeList").addEventListener("click", async (event) => {
  if (!isAdmin) return;

  const edit = event.target.closest("[data-edit-episode]");
  const remove = event.target.closest("[data-delete-episode]");

  if (edit) {
    const { data, error } = await db
      .from("episodes")
      .select("*")
      .eq("id", edit.dataset.editEpisode)
      .single();

    if (error || !data) {
      notify("Episode tidak ditemukan.");
      return;
    }

    $("episodeId").value = data.id;
    $("episodeMovieId").value = data.movie_id;
    $("episodeNumber").value = data.episode_number;
    $("episodeTitle").value = data.title;
    $("episodeVideo").value = data.video_url;
    $("episodeFormTitle").textContent = "Edit episode";

    $("episodeForm").scrollIntoView({ behavior: "smooth" });
  }

  if (remove && confirm("Yakin ingin menghapus episode ini?")) {
    const { error } = await db
      .from("episodes")
      .delete()
      .eq("id", remove.dataset.deleteEpisode);

    if (error) {
      notify("Gagal menghapus episode.");
      return;
    }

    await loadAdminEpisodes();

    if (currentMovie) {
      await loadEpisodes(currentMovie.id);
    }

    notify("Episode berhasil dihapus.");
  }
});

// ==========================================
// PENGUMUMAN
// ==========================================

async function loadAnnouncement() {
  const { data, error } = await db
    .from("announcements")
    .select("*")
    .order("updated_at", { ascending: false })
    .limit(1);

  if (error) {
    console.error("Pengumuman gagal dimuat:", error);
    return;
  }

  announcement = data?.[0] || null;

  if (announcement) {
    $("announcementTitle").value = announcement.title || "";
    $("announcementText").value = announcement.content || "";
    $("announcementHide").checked = !!announcement.is_hidden;

    $("announcementDisplayTitle").textContent = announcement.title;
    $("announcementDisplayText").textContent = announcement.content;
  }
}

function showAnnouncement() {
  if (!announcement || announcement.is_hidden) {
    $("announcementDisplayTitle").textContent = "Pengumuman";
    $("announcementDisplayText").textContent =
      "Belum ada pengumuman aktif.";
  } else {
    $("announcementDisplayTitle").textContent = announcement.title;
    $("announcementDisplayText").textContent = announcement.content;
  }

  openDialog("announcementDialog");
}

$("announcementOpen").addEventListener("click", showAnnouncement);

$("announcementClose").addEventListener("click", () => {
  closeDialog("announcementDialog");
});

$("announcementOk").addEventListener("click", () => {
  closeDialog("announcementDialog");
});

$("announcementPreview").addEventListener("click", () => {
  $("announcementDisplayTitle").textContent =
    $("announcementTitle").value || "Pengumuman";

  $("announcementDisplayText").textContent =
    $("announcementText").value || "Belum ada isi pengumuman.";

  openDialog("announcementDialog");
});

$("announcementForm").addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!isAdmin) {
    notify("Akses admin diperlukan.");
    return;
  }

  const payload = {
    title: $("announcementTitle").value.trim(),
    content: $("announcementText").value.trim(),
    is_hidden: $("announcementHide").checked,
    updated_at: new Date().toISOString()
  };

  const query = announcement
    ? db.from("announcements").update(payload)
        .eq("id", announcement.id)
    : db.from("announcements").insert(payload);

  const { error } = await query;

  if (error) {
    showMessage("announcementMessage", "Gagal menyimpan pengumuman.");
    console.error(error);
    return;
  }

  await loadAnnouncement();
  showMessage("announcementMessage", "Pengumuman berhasil disimpan.");
  notify("Pengumuman diperbarui.");
});

// ==========================================
// PENCARIAN PENGGUNA
// ==========================================

$("userSearchForm").addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!isAdmin) {
    notify("Akses admin diperlukan.");
    return;
  }

  const term = $("userSearch").value.trim();

  if (term.length < 2) {
    $("userResults").textContent =
      "Masukkan minimal 2 karakter.";
    return;
  }

  // Karakter khusus dibuang untuk menghindari
  // kesalahan format filter PostgREST.
  const safeTerm = term.replace(/[%_,().]/g, " ");

  const { data, error } = await db
    .from("profiles")
    .select("id, display_name, username")
    .or(
      `display_name.ilike.%${safeTerm}%,username.ilike.%${safeTerm}%`
    )
    .limit(20);

  if (error) {
    $("userResults").textContent =
      "Pencarian gagal. Periksa izin tabel profiles.";
    console.error(error);
    return;
  }

  $("userResults").innerHTML = (data || []).map((user) => `
    <div class="admin-row">
      <div>
        <strong>${escapeHTML(user.display_name || "Pengguna")}</strong>
        <p class="muted small">${escapeHTML(user.username || "")}</p>
      </div>
    </div>
  `).join("") || '<div class="empty-state">Pengguna tidak ditemukan.</div>';
});

// ==========================================
// INISIALISASI WEBSITE
// ==========================================

async function init() {
  $("yearNow").textContent = new Date().getFullYear();

  if (!window.supabase ||
      typeof SUPABASE_URL === "undefined" ||
      typeof SUPABASE_ANON_KEY === "undefined") {
    setConnection("Konfigurasi Supabase belum tersedia.");
    return;
  }

  try {
    await refreshAccount();

    await Promise.all([
      loadMovies(),
      loadAnnouncement(),
      loadAdminEpisodes()
    ]);
  } catch (error) {
    console.error("Gagal memulai LOOKSATSU:", error);
    setConnection("Gagal memuat website. Periksa koneksi dan konfigurasi.");
  }
}

init();
    
