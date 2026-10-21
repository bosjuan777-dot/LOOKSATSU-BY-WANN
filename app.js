// ===============================
// LOOKSATSU — app.js
// ===============================

const $ = (id) => document.getElementById(id);
const $$ = (selector) => document.querySelectorAll(selector);

let supabase = null;
let currentUser = null;
let currentProfile = null;
let isAdmin = false;

let movies = [];
let episodes = [];
let favorites = [];
let editingMovieId = null;
let editingEpisodeId = null;
let authMode = "login";

// ===============================
// INIT
// ===============================

document.addEventListener("DOMContentLoaded", async () => {
  $("yearNow").textContent = new Date().getFullYear();

  if (typeof SUPABASE_URL === "undefined" || typeof SUPABASE_ANON_KEY === "undefined") {
    setConnectionStatus("Konfigurasi Supabase belum ditemukan di config.js", true);
    return;
  }

  if (!window.supabase?.createClient) {
    setConnectionStatus("Library Supabase gagal dimuat", true);
    return;
  }

  supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  bindGlobalEvents();
  bindAuthEvents();
  bindAdminEvents();

  await restoreSession();
  await loadAnnouncement();
  await loadMovies();
  await loadFavorites();

  if (isAdmin) {
    await loadAdminMovies();
    await loadAdminEpisodes();
  }
});

function setConnectionStatus(message, isError = false) {
  const el = $("connectionStatus");
  el.textContent = message;
  el.style.color = isError ? "#ff6b6b" : "";
}

// ===============================
// SESSION & PROFILE
// ===============================

async function restoreSession() {
  const { data, error } = await supabase.auth.getSession();

  if (error) {
    console.error(error);
    setConnectionStatus("Gagal memeriksa sesi pengguna", true);
    return;
  }

  currentUser = data.session?.user || null;

  if (currentUser) {
    await loadProfile();
  }

  updateAccountUI();

  supabase.auth.onAuthStateChange(async (_event, session) => {
    currentUser = session?.user || null;

    if (currentUser) {
      await loadProfile();
    } else {
      currentProfile = null;
      isAdmin = false;
      favorites = [];
    }

    updateAccountUI();
    await loadFavorites();

    if (isAdmin) {
      $("adminPanel").classList.remove("hidden");
      await loadAdminMovies();
      await loadAdminEpisodes();
    } else {
      $("adminPanel").classList.add("hidden");
    }
  });
}

async function loadProfile() {
  if (!currentUser) return;

  const { data, error } = await supabase
    .from("profiles")
    .select("id, username, display_name, role")
    .eq("id", currentUser.id)
    .maybeSingle();

  if (error) {
    console.error("Gagal memuat profil:", error.message);
    currentProfile = null;
    isAdmin = false;
    return;
  }

  currentProfile = data || null;
  isAdmin = currentProfile?.role === "admin";

  if (isAdmin) {
    $("adminPanel").classList.remove("hidden");
  } else {
    $("adminPanel").classList.add("hidden");
  }
}

function updateAccountUI() {
  const label = $("accountLabel");
  const loginBtn = $("loginOpen");
  const logoutBtn = $("logoutBtn");

  if (currentUser) {
    const name =
      currentProfile?.display_name ||
      currentProfile?.username ||
      currentUser.email;

    label.textContent = `Halo, ${name}`;
    loginBtn.classList.add("hidden");
    logoutBtn.classList.remove("hidden");
  } else {
    label.textContent = "Mode pengunjung";
    loginBtn.classList.remove("hidden");
    logoutBtn.classList.add("hidden");
  }
}

// ===============================
// AUTH / LOGIN
// ===============================

function bindAuthEvents() {
  const loginDialog = $("loginDialog");

  $("loginOpen").addEventListener("click", () => {
    setAuthMode("login");
    loginDialog.showModal();
  });

  $("loginClose").addEventListener("click", () => {
    loginDialog.close();
  });

  $("authToggle").addEventListener("click", () => {
    setAuthMode(authMode === "login" ? "register" : "login");
  });

  $("authSubmit").addEventListener("click", async (event) => {
    event.preventDefault();
    await handleAuthSubmit();
  });

  $("loginForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    await handleAuthSubmit();
  });

  $("logoutBtn").addEventListener("click", async () => {
    await supabase.auth.signOut();
    showToast("Berhasil keluar");
  });
}

function setAuthMode(mode) {
  authMode = mode;

  const isRegister = mode === "register";

  $("authTitle").textContent = isRegister ? "Daftar" : "Masuk";
  $("authSubmit").textContent = isRegister ? "Buat akun" : "Masuk";
  $("authToggle").textContent = isRegister
    ? "Sudah punya akun? Masuk"
    : "Belum punya akun? Daftar";

  $("displayNameWrap").classList.toggle("hidden", !isRegister);
  $("authPassword").autocomplete = isRegister ? "new-password" : "current-password";
  $("authMessage").textContent = "";
}

async function handleAuthSubmit() {
  const email = $("authEmail").value.trim();
  const password = $("authPassword").value;
  const displayName = $("displayName").value.trim();
  const message = $("authMessage");

  if (!email || !password) {
    message.textContent = "Email dan password wajib diisi.";
    message.style.color = "#ff6b6b";
    return;
  }

  $("authSubmit").disabled = true;
  message.textContent = authMode === "login" ? "Memproses masuk…" : "Membuat akun…";
  message.style.color = "";

  try {
    if (authMode === "login") {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) throw error;

      $("loginDialog").close();
      showToast("Berhasil masuk");
    } else {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            display_name: displayName || null,
          },
        },
      });

      if (error) throw error;

      if (data.user) {
        await ensureProfile(data.user, displayName);
      }

      message.textContent =
        "Pendaftaran berhasil. Jika email konfirmasi aktif, periksa inbox kamu sebelum masuk.";
      message.style.color = "#7ee787";

      if (!data.session) {
        setAuthMode("login");
      } else {
        $("loginDialog").close();
        showToast("Akun berhasil dibuat");
      }
    }
  } catch (error) {
    console.error(error);
    message.textContent = error.message || "Terjadi kesalahan.";
    message.style.color = "#ff6b6b";
  } finally {
    $("authSubmit").disabled = false;
  }
}

async function ensureProfile(user, displayName) {
  const { data: existing } = await supabase
    .from("profiles")
    .select("id")
    .eq("id", user.id)
    .maybeSingle();

  if (existing) return;

  const username =
    user.email?.split("@")[0].replace(/[^a-z0-9_]/gi, "").toLowerCase() ||
    `user_${Date.now()}`;

  await supabase.from("profiles").insert({
    id: user.id,
    username,
    display_name: displayName || username,
    role: "user",
  });
}

// ===============================
// GLOBAL EVENTS
// ===============================

function bindGlobalEvents() {
  $("searchInput").addEventListener("input", renderMovies);
  $("categoryFilter").addEventListener("change", renderMovies);

  $("announcementOpen").addEventListener("click", () => {
    $("announcementDialog").showModal();
  });

  $("announcementClose").addEventListener("click", () => {
    $("announcementDialog").close();
  });

  $("announcementOk").addEventListener("click", () => {
    $("announcementDialog").close();
  });

  $("playerClose").addEventListener("click", () => {
    $("playerDialog").close();
    $("playerFrame").innerHTML = "";
  });

  $$("nav a, .hero a").forEach((link) => {
    link.addEventListener("click", (event) => {
      const targetId = link.getAttribute("href")?.replace("#", "");
      const target = targetId ? $(targetId) : null;

      if (target) {
        event.preventDefault();
        target.scrollIntoView({ behavior: "smooth" });
      }
    });
  });
}

// ===============================
// MOVIES
// ===============================

async function loadMovies() {
  const grid = $("movieGrid");
  grid.innerHTML = `<div class="empty-state">Sedang memuat katalog…</div>`;

  const { data, error } = await supabase
    .from("movies")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    console.error(error);
    grid.innerHTML = `<div class="empty-state">Gagal memuat katalog: ${escapeHtml(error.message)}</div>`;
    return;
  }

  movies = data || [];
  fillCategoryFilter();
  renderMovies();
  setConnectionStatus("Terhubung ke LOOKSATSU");
}

function fillCategoryFilter() {
  const select = $("categoryFilter");
  const current = select.value;
  const categories = [...new Set(movies.map((m) => m.category).filter(Boolean))];

  select.innerHTML = `<option value="">Semua kategori</option>`;

  categories.forEach((category) => {
    const option = document.createElement("option");
    option.value = category;
    option.textContent = category;
    select.appendChild(option);
  });

  select.value = current;
}

function renderMovies() {
  const grid = $("movieGrid");
  const query = $("searchInput").value.trim().toLowerCase();
  const category = $("categoryFilter").value;

  const filtered = movies.filter((movie) => {
    const matchQuery =
      !query ||
      [movie.title, movie.category, movie.year, movie.description]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(query);

    const matchCategory = !category || movie.category === category;

    return matchQuery && matchCategory;
  });

  $("filmCount").textContent = `${filtered.length} judul`;

  if (!filtered.length) {
    grid.innerHTML = `<div class="empty-state">Tidak ada film yang cocok.</div>`;
    return;
  }

  grid.innerHTML = filtered.map(movieCard).join("");
  bindMovieCardEvents();
}

function movieCard(movie) {
  const isFavorite = favorites.some((f) => f.movie_id === movie.id);
  const poster = movie.poster_url
    ? `<img src="${escapeHtml(movie.poster_url)}" alt="${escapeHtml(movie.title)}" loading="lazy">`
    : `<div class="poster-fallback">${escapeHtml(movie.title.slice(0, 2).toUpperCase())}</div>`;

  return `
    <article class="movie-card" data-id="${movie.id}">
      <div class="movie-poster">
        ${poster}
        <button
          class="favorite-btn ${isFavorite ? "active" : ""}"
          data-favorite="${movie.id}"
          type="button"
          title="${isFavorite ? "Hapus dari favorit" : "Tambah ke favorit"}"
        >
          ${isFavorite ? "★" : "☆"}
        </button>
      </div>

      <div class="movie-body">
        <h3>${escapeHtml(movie.title)}</h3>
        <p class="muted small">
          ${escapeHtml(movie.category || "Tokusatsu")}
          ${movie.year ? `• ${escapeHtml(movie.year)}` : ""}
        </p>

        <p class="movie-description">
          ${escapeHtml(movie.description || "Belum ada deskripsi.")}
        </p>

        <button class="button button-primary full" data-play="${movie.id}" type="button">
          Tonton
        </button>
      </div>
    </article>
  `;
}

function bindMovieCardEvents() {
  $$("[data-play]").forEach((button) => {
    button.addEventListener("click", () => openPlayer(button.dataset.play));
  });

  $$("[data-favorite]").forEach((button) => {
    button.addEventListener("click", () => toggleFavorite(button.dataset.favorite));
  });
}

// ===============================
// PLAYER & EPISODES
// ===============================

async function openPlayer(movieId) {
  const movie = movies.find((m) => String(m.id) === String(movieId));

  if (!movie) {
    showToast("Film tidak ditemukan");
    return;
  }

  $("playerTitle").textContent = movie.title;
  $("playerDescription").textContent = movie.description || "";
  $("playerFrame").innerHTML = createEmbed(movie.video_url);

  $("episodeList").innerHTML = `<div class="empty-state">Memuat daftar episode…</div>`;
  $("playerDialog").showModal();

  await loadEpisodesForMovie(movie.id);
}

function createEmbed(url) {
  if (!url) return `<div class="empty-state">Tautan video tidak tersedia.</div>`;

  const youtube = url.match(
    /(?:youtube.com/(?:watch?v=|embed/)|youtu.be/)([A-Za-z0-9_-]{6,})/
  );

  if (youtube) {
    return `
      <iframe
        src="https://www.youtube.com/embed/${youtube[1]}"
        title="Video"
        allowfullscreen
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
      ></iframe>
    `;
  }

  return `
    <iframe
      src="${escapeHtml(url)}"
      title="Video"
      allowfullscreen
      allow="autoplay; fullscreen; encrypted-media"
    ></iframe>
  `;
}

async function loadEpisodesForMovie(movieId) {
  const { data, error } = await supabase
    .from("episodes")
    .select("*")
    .eq("movie_id", movieId)
    .order("episode_number", { ascending: true });

  const list = $("episodeList");

  if (error) {
    console.error(error);
    list.innerHTML = `<div class="empty-state">Gagal memuat episode.</div>`;
    return;
  }

  episodes = data || [];

  if (!episodes.length) {
    list.innerHTML = `<div class="empty-state">Belum ada episode untuk film ini.</div>`;
    return;
  }

  list.innerHTML = episodes
    .map(
      (episode) => `
        <button class="admin-item episode-item" data-episode="${episode.id}" type="button">
          <strong>EP ${escapeHtml(episode.episode_number)}</strong>
          <span>${escapeHtml(episode.title)}</span>
        </button>
      `
    )
    .join("");

  $$("[data-episode]").forEach((button) => {
    button.addEventListener("click", () => {
      const episode = episodes.find((e) => String(e.id) === button.dataset.episode);

      if (episode) {
        $("playerFrame").innerHTML = createEmbed(episode.video_url);
        $("playerTitle").textContent = `${episode.title}`;
      }
    });
  });
}

// ===============================
// FAVORITES
// ===============================

async function loadFavorites() {
  const grid = $("favoriteGrid");

  if (!currentUser) {
    favorites = [];
    grid.innerHTML = `<div class="empty-state">Masuk untuk menyimpan favorit di akunmu.</div>`;
    return;
  }

  const { data, error } = await supabase
    .from("favorites")
    .select("id, movie_id, movies(*)")
    .eq("user_id", currentUser.id);

  if (error) {
    console.error(error);
    grid.innerHTML = `<div class="empty-state">Gagal memuat favorit.</div>`;
    return;
  }

  favorites = data || [];

  if (!favorites.length) {
    grid.innerHTML = `<div class="empty-state">Belum ada film favorit.</div>`;
    return;
  }

  grid.innerHTML = favorites
    .map((favorite) => movieCard(favorite.movies))
    .join("");

  bindMovieCardEvents();
}

async function toggleFavorite(movieId) {
  if (!currentUser) {
    showToast("Masuk dulu untuk menyimpan favorit");
    $("loginDialog").showModal();
    return;
  }

  const existing = favorites.find((f) => String(f.movie_id) === String(movieId));

  if (existing) {
    const { error } = await supabase
      .from("favorites")
      .delete()
      .eq("id", existing.id);

    if (error) {
      showToast("Gagal menghapus favorit");
      return;
    }

    showToast("Dihapus dari favorit");
  } else {
    const { error } = await supabase
      .from("favorites")
      .insert({ user_id: currentUser.id, movie_id: movieId });

    if (error) {
      showToast("Gagal menambahkan favorit");
      return;
    }

    showToast("Ditambahkan ke favorit");
  }

  await loadFavorites();
  renderMovies();
}

// ===============================
// ADMIN
// ===============================

function bindAdminEvents() {
  $$(".admin-tabs .tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      $$(".admin-tabs .tab").forEach((item) => item.classList.remove("active"));
      tab.classList.add("active");

      $$(".tab-content").forEach((content) => content.classList.add("hidden"));
      $(tab.dataset.tab).classList.remove("hidden");
    });
  });

  $("movieForm").addEventListener("submit", saveMovie);
  $("cancelEdit").addEventListener("click", resetMovieForm);

  $("episodeForm").addEventListener("submit", saveEpisode);
  $("cancelEpisodeEdit").addEventListener("click", resetEpisodeForm);

  $("announcementForm").addEventListener("submit", saveAnnouncement);

  $("announcementPreview").addEventListener("click", () => {
    $("announcementDisplayTitle").textContent =
      $("announcementTitle").value || "Pengumuman";
    $("announcementDisplayText").textContent =
      $("announcementText").value || "Belum ada isi pengumuman.";
    $("announcementDialog").showModal();
  });

  $("userSearchForm").addEventListener("submit", searchUsers);
}

async function isAdminUser() {
  if (!currentUser) return false;

  const { data } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", currentUser.id)
    .maybeSingle();

  return data?.role === "admin";
}

async function loadAdminMovies() {
  if (!(await isAdminUser())) return;

  const list = $("adminMovieList");
  list.innerHTML = `<div class="empty-state">Memuat film…</div>`;

  const { data, error } = await supabase
    .from("movies")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    list.innerHTML = `<div class="empty-state">Gagal memuat film.</div>`;
    return;
  }

  movies = data || [];
  fillCategoryFilter();

  list.innerHTML = movies.length
    ? movies
        .map(
          (movie) => `
            <div class="admin-item">
              <div>
                <strong>${escapeHtml(movie.title)}</strong>
                <p class="muted small">
                  ${escapeHtml(movie.category || "-")} • ${escapeHtml(movie.year || "-")}
                </p>
              </div>

              <div class="admin-actions">
                <button data-edit-movie="${movie.id}" type="button">Edit</button>
                <button data-delete-movie="${movie.id}" type="button">Hapus</button>
              </div>
            </div>
          `
        )
        .join("")
    : `<div class="empty-state">Belum ada film.</div>`;

  $$("[data-edit-movie]").forEach((button) => {
    button.addEventListener("click", () => editMovie(button.dataset.editMovie));
  });

  $$("[data-delete-movie]").forEach((button) => {
    button.addEventListener("click", () => deleteMovie(button.dataset.deleteMovie));
  });
}

async function saveMovie(event) {
  event.preventDefault();

  if (!(await isAdminUser())) {
    showToast("Hanya admin yang dapat mengelola film");
    return;
  }

  const payload = {
    title: $("movieTitle").value.trim(),
    category: $("movieCategory").value.trim() || "Tokusatsu",
    year: $("movieYear").value ? Number($("movieYear").value) : null,
    poster_url: $("moviePoster").value.trim() || null,
    video_url: $("movieVideo").value.trim(),
    description: $("movieDescription").value.trim() || null,
  };

  const message = $("adminMessage");
  message.textContent = "Menyimpan…";

  let query = supabase.from("movies");

  if (editingMovieId) {
    query = query.update(payload).eq("id", editingMovieId);
  } else {
    query = query.insert(payload);
  }

  const { error } = await query.select();

  if (error) {
    message.textContent = error.message;
    message.style.color = "#ff6b6b";
    return;
  }

  message.textContent = "Film berhasil disimpan.";
  message.style.color = "#7ee787";
  resetMovieForm();
  await loadAdminMovies();
  await loadMovies();
  showToast("Film berhasil disimpan");
}

function editMovie(movieId) {
  const movie = movies.find((m) => String(m.id) === String(movieId));
  if (!movie) return;

  editingMovieId = movie.id;

  $("movieFormTitle").textContent = "Edit film";
  $("movieId").value = movie.id;
  $("movieTitle").value = movie.title || "";
  $("movieCategory").value = movie.category || "";
  $("movieYear").value = movie.year || "";
  $("moviePoster").value = movie.poster_url || "";
    $("moviePoster").value = movie.poster_url || "";
  $("movieVideo").value = movie.video_url || "";
  $("movieDescription").value = movie.description || "";

  $("movieForm").scrollIntoView({ behavior: "smooth" });
}

function resetMovieForm() {
  editingMovieId = null;
  $("movieForm").reset();
  $("movieFormTitle").textContent = "Tambah film";
  $("movieId").value = "";
  $("movieCategory").value = "Tokusatsu";
  $("adminMessage").textContent = "";
}

async function deleteMovie(movieId) {
  if (!(await isAdminUser())) return;

  if (!confirm("Hapus film ini?")) return;

  const { error } = await supabase.from("movies").delete().eq("id", movieId);

  if (error) {
    showToast("Gagal menghapus film");
    return;
  }

  await loadAdminMovies();
  await loadMovies();
  showToast("Film dihapus");
}

// ===============================
// ADMIN — EPISODE
// ===============================

async function loadAdminEpisodes() {
  if (!(await isAdminUser())) return;

  const list = $("adminEpisodeList");
  list.innerHTML = `<div class="empty-state">Memuat episode…</div>`;

  const { data: movieData, error: movieError } = await supabase
    .from("movies")
    .select("id, title")
    .order("title");

  if (movieError) {
    list.innerHTML = `<div class="empty-state">Gagal memuat pilihan film.</div>`;
    return;
  }

  const movieSelect = $("episodeMovieId");
  movieSelect.innerHTML = `<option value="">Pilih film terlebih dahulu</option>`;

  movieData.forEach((movie) => {
    const option = document.createElement("option");
    option.value = movie.id;
    option.textContent = movie.title;
    movieSelect.appendChild(option);
  });

  const { data, error } = await supabase
    .from("episodes")
    .select("*, movies(title)")
    .order("movie_id")
    .order("episode_number");

  if (error) {
    list.innerHTML = `<div class="empty-state">Gagal memuat episode.</div>`;
    return;
  }

  episodes = data || [];

  list.innerHTML = episodes.length
    ? episodes
        .map(
          (episode) => `
            <div class="admin-item">
              <div>
                <strong>${escapeHtml(episode.title)}</strong>
                <p class="muted small">
                  ${escapeHtml(episode.movies?.title || "Film tidak ditemukan")} •
                  EP ${escapeHtml(episode.episode_number)}
                </p>
              </div>

              <div class="admin-actions">
                <button data-edit-episode="${episode.id}" type="button">Edit</button>
                <button data-delete-episode="${episode.id}" type="button">Hapus</button>
              </div>
            </div>
          `
        )
        .join("")
    : `<div class="empty-state">Belum ada episode.</div>`;

  $$("[data-edit-episode]").forEach((button) => {
    button.addEventListener("click", () => editEpisode(button.dataset.editEpisode));
  });

  $$("[data-delete-episode]").forEach((button) => {
    button.addEventListener("click", () => deleteEpisode(button.dataset.deleteEpisode));
  });
}

async function saveEpisode(event) {
  event.preventDefault();

  if (!(await isAdminUser())) {
    showToast("Hanya admin yang dapat mengelola episode");
    return;
  }

  const payload = {
    movie_id: $("episodeMovieId").value,
    episode_number: Number($("episodeNumber").value),
    title: $("episodeTitle").value.trim(),
    video_url: $("episodeVideo").value.trim(),
  };

  const message = $("episodeMessage");
  message.textContent = "Menyimpan…";

  let query = supabase.from("episodes");

  if (editingEpisodeId) {
    query = query.update(payload).eq("id", editingEpisodeId);
  } else {
    query = query.insert(payload);
  }

  const { error } = await query.select();

  if (error) {
    message.textContent = error.message;
    message.style.color = "#ff6b6b";
    return;
  }

  message.textContent = "Episode berhasil disimpan.";
  message.style.color = "#7ee787";
  resetEpisodeForm();
  await loadAdminEpisodes();
  showToast("Episode berhasil disimpan");
}

function editEpisode(episodeId) {
  const episode = episodes.find((e) => String(e.id) === String(episodeId));
  if (!episode) return;

  editingEpisodeId = episode.id;

  $("episodeFormTitle").textContent = "Edit episode";
  $("episodeId").value = episode.id;
  $("episodeMovieId").value = episode.movie_id;
  $("episodeNumber").value = episode.episode_number;
  $("episodeTitle").value = episode.title;
  $("episodeVideo").value = episode.video_url;
}

function resetEpisodeForm() {
  editingEpisodeId = null;
  $("episodeForm").reset();
  $("episodeFormTitle").textContent = "Tambah episode";
  $("episodeId").value = "";
  $("episodeMessage").textContent = "";
}

async function deleteEpisode(episodeId) {
  if (!(await isAdminUser())) return;

  if (!confirm("Hapus episode ini?")) return;

  const { error } = await supabase.from("episodes").delete().eq("id", episodeId);

  if (error) {
    showToast("Gagal menghapus episode");
    return;
  }

  await loadAdminEpisodes();
  showToast("Episode dihapus");
}

// ===============================
// ADMIN — PENGUMUMAN
// ===============================

async function loadAnnouncement() {
  const { data, error } = await supabase
    .from("announcements")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data || data.is_hidden) {
    $("announcementDisplayTitle").textContent = "Pengumuman";
    $("announcementDisplayText").textContent = "Belum ada pengumuman.";
    return;
  }

  $("announcementDisplayTitle").textContent = data.title || "Pengumuman";
  $("announcementDisplayText").textContent = data.content || "";
}

async function saveAnnouncement(event) {
  event.preventDefault();

  if (!(await isAdminUser())) {
    showToast("Hanya admin yang dapat mengatur pengumuman");
    return;
  }

  const payload = {
    title: $("announcementTitle").value.trim(),
    content: $("announcementText").value.trim(),
    is_hidden: $("announcementHide").checked,
  };

  const { error } = await supabase.from("announcements").insert(payload);

  if (error) {
    $("announcementMessage").textContent = error.message;
    $("announcementMessage").style.color = "#ff6b6b";
    return;
  }

  $("announcementMessage").textContent = "Pengumuman disimpan.";
  $("announcementMessage").style.color = "#7ee787";
  await loadAnnouncement();
  showToast("Pengumuman disimpan");
}

// ===============================
// ADMIN — CARI PENGGUNA
// ===============================

async function searchUsers(event) {
  event.preventDefault();

  if (!(await isAdminUser())) {
    showToast("Hanya admin yang dapat mencari pengguna");
    return;
  }

  const query = $("userSearch").value.trim();
  const results = $("userResults");

  if (!query) {
    results.innerHTML = `<div class="empty-state">Masukkan kata kunci pencarian.</div>`;
    return;
  }

  results.innerHTML = `<div class="empty-state">Mencari pengguna…</div>`;

  const { data, error } = await supabase
    .from("profiles")
    .select("id, username, display_name, role")
    .or(`username.ilike.%${query}%,display_name.ilike.%${query}%`)
    .limit(30);

  if (error) {
    results.innerHTML = `<div class="empty-state">Gagal mencari pengguna.</div>`;
    return;
  }

  results.innerHTML = data.length
    ? data
        .map(
          (user) => `
            <div class="admin-item">
              <div>
                <strong>${escapeHtml(user.display_name || user.username)}</strong>
                <p class="muted small">
                  @${escapeHtml(user.username || "-")} • ${escapeHtml(user.role || "user")}
                </p>
              </div>
            </div>
          `
        )
        .join("")
    : `<div class="empty-state">Pengguna tidak ditemukan.</div>`;
}

// ===============================
// UTILITIES
// ===============================

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

let toastTimer;

function showToast(message) {
  const toast = $("toast");
  toast.textContent = message;
  toast.classList.add("show");

  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.remove("show");
  }, 2800);
}
