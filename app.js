
(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);

  const config = window.LOOKSATSU_CONFIG || {};
  const supabaseLib = window.supabase;

  let sb = null;
  let signupMode = false;
  let currentUser = null;
  let currentEpisodes = [];
  let currentMovie = null;
  let movies = [];
  let favorites = new Set();
  let isAdmin = false;

  // =========================
  // INISIALISASI SUPABASE
  // =========================

  if (
    supabaseLib &&
    config.SUPABASE_URL &&
    config.SUPABASE_ANON_KEY
  ) {
    sb = supabaseLib.createClient(
      config.SUPABASE_URL,
      config.SUPABASE_ANON_KEY
    );
  }

  function toast(message) {
    const el = $("toast");

    if (el) {
      el.textContent = message;
      el.hidden = false;

      setTimeout(() => {
        el.hidden = true;
      }, 3000);
    } else {
      alert(message);
    }
  }

  function setMessage(id, message) {
    const el = $(id);
    if (el) el.textContent = message;
  }

  function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    })[char]);
  }

  function setStatus(message) {
    const el = $("connectionStatus");
    if (el) el.textContent = message;
  }

  // =========================
  // LOGIN DAN DAFTAR
  // =========================

  function setAuthMode(isSignup) {
    signupMode = isSignup;

    if ($("authTitle")) {
      $("authTitle").textContent =
        signupMode ? "Daftar Akun" : "Login LOOKSATSU";
    }

    if ($("authSubmit")) {
      $("authSubmit").textContent =
        signupMode ? "Daftar" : "Login";
    }

    if ($("displayNameWrap")) {
      $("displayNameWrap").hidden = !signupMode;
    }

    if ($("authToggle")) {
      $("authToggle").textContent =
        signupMode
          ? "Sudah punya akun? Login"
          : "Belum punya akun? Daftar";
    }

    setMessage("authMessage", "");
  }

  async function authSubmit(event) {
    event.preventDefault();

    if (!sb) {
      setMessage(
        "authMessage",
        "Supabase belum terhubung. Periksa config.js."
      );
      return;
    }

    const email = $("authEmail")?.value.trim();
    const password = $("authPassword")?.value;
    const displayName = $("displayName")?.value.trim();

    if (!email || !password) {
      setMessage("authMessage", "Isi email dan password.");
      return;
    }

    if (signupMode && password.length < 6) {
      setMessage(
        "authMessage",
        "Password minimal 6 karakter."
      );
      return;
    }

    const submitButton = $("authSubmit");
    if (submitButton) submitButton.disabled = true;

    setMessage("authMessage", "Memproses...");

    try {
      let result;

      if (signupMode) {
        result = await sb.auth.signUp({
          email,
          password,
          options: {
            data: {
              display_name: displayName || ""
            }
          }
        });
      } else {
        result = await sb.auth.signInWithPassword({
          email,
          password
        });
      }

      if (result.error) throw result.error;

      if (
        signupMode &&
        !result.data.session
      ) {
        setMessage(
          "authMessage",
          "Pendaftaran berhasil. Periksa email untuk verifikasi."
        );
        return;
      }

      setMessage("authMessage", "Berhasil!");
      $("loginDialog")?.close();
      $("loginForm")?.reset();

      await refreshAuth(result.data.session);
      toast(signupMode ? "Akun berhasil dibuat." : "Login berhasil.");
    } catch (error) {
      setMessage(
        "authMessage",
        error.message || "Login gagal."
      );
    } finally {
      if (submitButton) submitButton.disabled = false;
    }
  }

  async function logout() {
    if (!sb) {
      toast("Supabase belum terhubung.");
      return;
    }

    const { error } = await sb.auth.signOut();

    if (error) {
      toast("Gagal logout: " + error.message);
      return;
    }

    toast("Kamu sudah logout.");
    await refreshAuth(null);
  }

  async function refreshAuth(session) {
    currentUser = session?.user || null;

    if ($("accountLabel")) {
      $("accountLabel").textContent = currentUser
        ? currentUser.email
        : "Pengunjung";
    }

    if ($("loginOpen")) {
      $("loginOpen").hidden = !!currentUser;
    }

    if ($("logoutBtn")) {
      $("logoutBtn").hidden = !currentUser;
    }

    isAdmin = false;

    // Hak admin harus diverifikasi lewat database.
    if (currentUser && sb) {
      try {
        const { data, error } = await sb
          .from("profiles")
          .select("role")
          .eq("id", currentUser.id)
          .maybeSingle();

        if (!error && data?.role === "admin") {
          isAdmin = true;
        }
      } catch (error) {
        console.error("Pemeriksaan admin gagal:", error);
      }
    }

    if ($("adminPanel")) {
      $("adminPanel").hidden = !isAdmin;
    }

    if (currentUser) {
      await loadFavorites();
    } else {
      favorites.clear();
      renderFavorites();
    }

    await loadMovies();
  }

  // =========================
  // FILM
  // =========================

  async function loadMovies() {
    if (!sb) {
      setStatus("Supabase belum terhubung.");
      renderMovies();
      return;
    }

    setStatus("Memuat film...");

    const { data, error } = await sb
      .from("movies")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Gagal memuat film:", error);
      setStatus("Gagal memuat film. Periksa tabel dan izin akses.");
      movies = [];
      renderMovies();
      return;
    }

    movies = data || [];
    setStatus("Terhubung ke Supabase.");
    renderMovies();
  }

  function renderMovies() {
    const grid = $("movieGrid");
    if (!grid) return;

    const query = ($("searchInput")?.value || "")
      .trim()
      .toLowerCase();

    const category = $("categoryFilter")?.value || "";

    const filtered = movies.filter((movie) => {
      const text = [
        movie.title,
        movie.description,
        movie.category
      ].join(" ").toLowerCase();

      return (
        text.includes(query) &&
        (!category || movie.category === category)
      );
    });

    grid.innerHTML = filtered.length
      ? filtered.map((movie) => `
          <article class="movie-card">
            <img
              src="${escapeHTML(movie.poster_url || "")}"
              alt="${escapeHTML(movie.title)}"
              loading="lazy"
            >
            <h3>${escapeHTML(movie.title)}</h3>
            <p>${escapeHTML(movie.category || "Lainnya")} ·
               ${escapeHTML(movie.year || "-")}</p>
            <button type="button"
              data-action="watch"
              data-id="${escapeHTML(movie.id)}">
              Lihat Episode
            </button>
            <button type="button"
              data-action="favorite"
              data-id="${escapeHTML(movie.id)}">
              ${favorites.has(String(movie.id)) ? "★ Favorit" : "☆ Favorit"}
            </button>
          </article>
        `).join("")
      : "<p>Film tidak ditemukan.</p>";

    if ($("filmCount")) {
      $("filmCount").textContent =
        `${filtered.length} film`;
    }
  }

  // =========================
  // FAVORIT
  // =========================

  async function loadFavorites() {
    favorites.clear();

    if (!sb || !currentUser) {
      renderFavorites();
      return;
    }

    const { data, error } = await sb
      .from("favorites")
      .select("movie_id")
      .eq("user_id", currentUser.id);

    if (error) {
      console.warn("Favorit belum dapat dimuat:", error.message);
      renderFavorites();
      return;
    }

    (data || []).forEach((item) => {
      favorites.add(String(item.movie_id));
    });

    renderFavorites();
    renderMovies();
  }

  async function toggleFavorite(movieId) {
    if (!currentUser || !sb) {
      toast("Login terlebih dahulu untuk menyimpan favorit.");
      return;
    }

    const id = String(movieId);

    if (favorites.has(id)) {
      const { error } = await sb
        .from("favorites")
        .delete()
        .eq("user_id", currentUser.id)
        .eq("movie_id", movieId);

      if (error) {
        toast("Gagal menghapus favorit.");
        return;
      }

      favorites.delete(id);
    } else {
      const { error } = await sb
        .from("favorites")
        .insert({
          user_id: currentUser.id,
          movie_id: movieId
        });

      if (error) {
        toast("Gagal menambah favorit.");
        return;
      }

      favorites.add(id);
    }

    renderMovies();
    renderFavorites();
  }

  function renderFavorites() {
    const grid = $("favoriteGrid");
    if (!grid) return;

    const list = movies.filter((movie) =>
      favorites.has(String(movie.id))
    );

    grid.innerHTML = list.length
      ? list.map((movie) => `
          <article class="movie-card">
            <img src="${escapeHTML(movie.poster_url || "")}"
              alt="${escapeHTML(movie.title)}">
            <h3>${escapeHTML(movie.title)}</h3>
            <button type="button"
              data-action="watch"
              data-id="${escapeHTML(movie.id)}">
              Lihat Episode
            </button>
          </article>
        `).join("")
      : "<p>Belum ada film favorit.</p>";
  }

  // =========================
  // EPISODE DAN PEMUTAR
  // =========================

  async function openMovie(movieId) {
    if (!sb) {
      toast("Supabase belum terhubung.");
      return;
    }

    currentMovie = movies.find(
      (movie) => String(movie.id) === String(movieId)
    );

    if (!currentMovie) {
      toast("Film tidak ditemukan.");
      return;
    }

    const { data, error } = await sb
      .from("episodes")
      .select("*")
      .eq("movie_id", movieId)
      .order("episode_number", { ascending: true });

    if (error) {
      toast("Gagal memuat episode. Periksa tabel episodes.");
      console.error(error);
      return;
    }

    currentEpisodes = data || [];

    if ($("playerTitle")) {
      $("playerTitle").textContent = currentMovie.title;
    }

    if ($("playerDescription")) {
      $("playerDescription").textContent =
        currentMovie.description || "";
    }

    renderEpisodes();
    $("playerDialog")?.showModal();
  }

  function renderEpisodes() {
    const list = $("episodeList");
    if (!list) return;

    list.innerHTML = currentEpisodes.length
      ? currentEpisodes.map((episode, index) => `
          <button type="button"
            data-action="episode"
            data-index="${index}">
            Episode ${escapeHTML(episode.episode_number)}:
            ${escapeHTML(episode.title || "")}
          </button>
        `).join("")
      : "<p>Belum ada episode untuk film ini.</p>";
  }

  function playEpisode(index) {
    if (index < 0 || index >= currentEpisodes.length) return;

    const episode = currentEpisodes[index];
    const url = episode.video_url;

    if (!url) {
      toast("URL video episode belum diisi.");
      return;
    }

    let parsed;

    try {
      parsed = new URL(url);
    } catch {
      toast("URL video tidak valid.");
      return;
    }

    if (!["https:", "http:"].includes(parsed.protocol)) {
      toast("Protokol URL video tidak diizinkan.");
      return;
    }

    const frame = $("playerFrame");
    if (frame) {
      frame.src = parsed.href;
      frame.title = episode.title || "Pemutar episode";
    }

    if ($("playerTitle")) {
      $("playerTitle").textContent =
        `${currentMovie?.title || "Film"} — Episode ${episode.episode_number}`;
    }
  }

  function closePlayer() {
    const frame = $("playerFrame");
    if (frame) frame.src = "about:blank";

    $("playerDialog")?.close();
  }

  // =========================
  // ADMIN: FILM
  // =========================

  async function saveMovie(event) {
    event.preventDefault();

    if (!isAdmin || !sb) {
      toast("Akses admin diperlukan.");
      return;
    }

    const id = $("movieId")?.value;
    const payload = {
      title: $("movieTitle")?.value.trim(),
      category: $("movieCategory")?.value,
      year: Number($("movieYear")?.value) || null,
      poster_url: $("moviePoster")?.value.trim() || null,
      video_url: $("movieVideo")?.value.trim() || null,
      description: $("movieDescription")?.value.trim() || ""
    };

    if (!payload.title) {
      setMessage("adminMessage", "Judul film wajib diisi.");
      return;
    }

    const query = id
      ? sb.from("movies").update(payload).eq("id", id)
      : sb.from("movies").insert(payload);

    const { error } = await query;

    if (error) {
      setMessage("adminMessage", "Gagal menyimpan: " + error.message);
      return;
    }

    $("movieForm")?.reset();
    if ($("movieId")) $("movieId").value = "";
    setMessage("adminMessage", "Film berhasil disimpan.");

    await loadMovies();
    await renderAdminMovies();
  }

  async function deleteMovie(id) {
    if (!isAdmin || !sb) return;

    if (!confirm("Hapus film ini?")) return;

    const { error } = await sb
      .from("movies")
      .delete()
      .eq("id", id);

    if (error) {
      toast("Gagal menghapus film: " + error.message);
      return;
    }

    toast("Film dihapus.");
    await loadMovies();
    await renderAdminMovies();
  }

  async function renderAdminMovies() {
    const list = $("adminMovieList");
    if (!list || !sb || !isAdmin) return;

    const { data, error } = await sb
      .from("movies")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      list.textContent = "Gagal memuat daftar film.";
      return;
    }

    list.innerHTML = (data || []).map((movie) => `
      <div class="admin-item">
        <span>${escapeHTML(movie.title)}</span>
        <button type="button" data-action="edit-movie"
          data-id="${escapeHTML(movie.id)}">Edit</button>
        <button type="button" data-action="delete-movie"
          data-id="${escapeHTML(movie.id)}">Hapus</button>
      </div>
    `).join("") || "<p>Belum ada film.</p>";
  }

  function editMovie(id) {
    const movie = movies.find((item) => String(item.id) === String(id));
    if (!movie) return;

    $("movieId").value = movie.id;
    $("movieTitle").value = movie.title || "";
    $("movieCategory").value = movie.category || "";
    $("movieYear").value = movie.year || "";
    $("moviePoster").value = movie.poster_url || "";
    $("movieVideo").value = movie.video_url || "";
    $("movieDescription").value = movie.description || "";

    if ($("movieFormTitle")) {
      $("movieFormTitle").textContent = "Edit Film";
    }
  }

  // =========================
  // ADMIN: EPISODE
  // =========================

  async function saveEpisode(event) {
    event.preventDefault();

    if (!isAdmin || !sb) {
      toast("Akses admin diperlukan.");
      return;
    }

    const id = $("episodeId")?.value;
    const movieId = $("episodeMovieId")?.value;
    const episodeNumber = Number($("episodeNumber")?.value);
    const title = $("episodeTitle")?.value.trim();
    const videoUrl = $("episodeVideo")?.value.trim();

    if (!movieId || !episodeNumber || !videoUrl) {
      setMessage("episodeMessage", "Film, nomor episode, dan URL wajib diisi.");
      return;
    }

    const payload = {
      movie_id: movieId,
      episode_number: episodeNumber,
      title: title || `Episode ${episodeNumber}`,
      video_url: videoUrl
    };

    const query = id
      ? sb.from("episodes").update(payload).eq("id", id)
      : sb.from("episodes").insert(payload);

    const { error } = await query;

    if (error) {
      setMessage("episodeMessage", "Gagal menyimpan: " + error.message);
      return;
    }

    $("episodeForm")?.reset();
    if ($("episodeId")) $("episodeId").value = "";
    setMessage("episodeMessage", "Episode berhasil disimpan.");
    await renderAdminEpisodes();
  }

  async function renderAdminEpisodes() {
    const list = $("adminEpisodeList");
    if (!list || !sb || !isAdmin) return;

    const { data, error } = await sb
      .from("episodes")
      .select("id, movie_id, episode_number, title")
      .order("episode_number", { ascending: true });

    if (error) {
      list.textContent = "Gagal memuat episode.";
      return;
    }

    list.innerHTML = (data || []).map((episode) => `
      <div class="admin-item">
        <span>${escapeHTML(episode.title)} (#${escapeHTML(episode.episode_number)})</span>
        <button type="button" data-action="delete-episode"
          data-id="${escapeHTML(episode.id)}">Hapus</button>
      </div>
    `).join("") || "<p>Belum ada episode.</p>";
  }

  async function deleteEpisode(id) {
    if (!isAdmin || !sb) return;
    if (!confirm("Hapus episode ini?")) return;

    const { error } = await sb
      .from("episodes")
      .delete()
      .eq("id", id);

    if (error) {
      toast("Gagal menghapus episode.");
      return;
    }

    toast("Episode dihapus.");
    await renderAdminEpisodes();
  }

  // =========================
  // ADMIN: PENGUMUMAN
  // =========================

  async function saveAnnouncement(event) {
    event.preventDefault();

    if (!isAdmin || !sb) {
      toast("Akses admin diperlukan.");
      return;
    }

    const payload = {
      title: $("announcementTitle")?.value.trim(),
      message: $("announcementText")?.value.trim(),
      is_hidden: !!$("announcementHide")?.checked
    };

    if (!payload.title || !payload.message) {
      setMessage("announcementMessage", "Judul dan isi wajib diisi.");
      return;
    }

    const { error } = await sb
      .from("announcements")
      .insert(payload);

    if (error) {
      setMessage("announcementMessage", "Gagal menyimpan pengumuman: " + error.message);
      return;
    }

    $("announcementForm")?.reset();
    setMessage("announcementMessage", "Pengumuman berhasil dibuat.");
    await loadAnnouncement();
  }

  async function loadAnnouncement() {
    if (!sb) return;

    const { data, error } = await sb
      .from("announcements")
      .select("*")
      .eq("is_hidden", false)
      .order("created_at", { ascending: false })
      .limit(1);

    if (error || !data?.length) return;

    const announcement = data[0];

    if ($("announcementDisplayTitle")) {
      $("announcementDisplayTitle").textContent = announcement.title;
    }

    if ($("announcementDisplayText")) {
      $("announcementDisplayText").textContent = announcement.message;
    }

    $("announcementDialog")?.showModal();
  }

  // =========================
  // ADMIN: CARI PENGGUNA
  // =========================

  async function searchUsers(event) {
    event.preventDefault();

    if (!isAdmin || !sb) {
      toast("Akses admin diperlukan.");
      return;
    }

    const query = $("userSearch")?.value.trim();
    const results = $("userResults");

    if (!results) return;
    if (!query) {
      results.textContent = "Masukkan ID pengguna untuk mencari profil.";
      return;
    }

    // Tidak mengambil email atau data sensitif pengguna.
    const { data, error } = await sb
      .from("profiles")
      .select("id, display_name, role")
      .eq("id", query)
      .limit(1);

    if (error) {
      results.textContent = "Pencarian gagal. Periksa izin tabel profiles.";
      return;
    }

    results.innerHTML = data?.length
      ? data.map((user) => `
          <p>Nama: ${escapeHTML(user.display_name || "Pengguna")}
          — Peran: ${escapeHTML(user.role || "user")}</p>
        `).join("")
      : "Profil tidak ditemukan.";
  }

  // =========================
  // EVENT LISTENER
  // =========================

  $("loginForm")?.addEventListener("submit", authSubmit);

  $("loginOpen")?.addEventListener("click", () => {
    if (!sb) {
      toast("Supabase belum terhubung. Periksa config.js.");
    }
     
      $("loginDialog")?.showModal();
    });

  $("loginClose")?.addEventListener("click", () => {
    $("loginDialog")?.close();
  });

  $("authToggle")?.addEventListener("click", () => {
    setAuthMode(!signupMode);
  });

  $("logoutBtn")?.addEventListener("click", logout);

  $("searchInput")?.addEventListener("input", renderMovies);
  $("categoryFilter")?.addEventListener("change", renderMovies);

  $("movieGrid")?.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;

    const id = button.dataset.id;

    if (button.dataset.action === "watch") {
      openMovie(id);
    }

    if (button.dataset.action === "favorite") {
      toggleFavorite(id);
    }
  });

  $("favoriteGrid")?.addEventListener("click", (event) => {
    const button = event.target.closest(
      'button[data-action="watch"]'
    );

    if (button) openMovie(button.dataset.id);
  });

  $("episodeList")?.addEventListener("click", (event) => {
    const button = event.target.closest(
      'button[data-action="episode"]'
    );

    if (button) {
      playEpisode(Number(button.dataset.index));
    }
  });

  $("playerClose")?.addEventListener("click", closePlayer);

  $("movieForm")?.addEventListener("submit", saveMovie);
  $("episodeForm")?.addEventListener("submit", saveEpisode);
  $("announcementForm")?.addEventListener(
    "submit",
    saveAnnouncement
  );
  $("userSearchForm")?.addEventListener(
    "submit",
    searchUsers
  );

  $("cancelEdit")?.addEventListener("click", () => {
    $("movieForm")?.reset();
    if ($("movieId")) $("movieId").value = "";
  });

  $("cancelEpisodeEdit")?.addEventListener("click", () => {
    $("episodeForm")?.reset();
    if ($("episodeId")) $("episodeId").value = "";
  });

  $("adminMovieList")?.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;

    if (button.dataset.action === "edit-movie") {
      editMovie(button.dataset.id);
    }

    if (button.dataset.action === "delete-movie") {
      deleteMovie(button.dataset.id);
    }
  });

  $("adminEpisodeList")?.addEventListener("click", (event) => {
    const button = event.target.closest(
      'button[data-action="delete-episode"]'
    );

    if (button) deleteEpisode(button.dataset.id);
  });

  $("announcementClose")?.addEventListener("click", () => {
    $("announcementDialog")?.close();
  });

  $("announcementOk")?.addEventListener("click", () => {
    $("announcementDialog")?.close();
  });

  // =========================
  // MULAI APLIKASI
  // =========================

  async function init() {
    const year = $("yearNow");

    if (year) {
      year.textContent = new Date().getFullYear();
    }

    setAuthMode(false);

    if (!sb) {
      setStatus("Supabase belum terkonfigurasi.");
      renderMovies();
      return;
    }

    const { data, error } = await sb.auth.getSession();

    if (error) {
      console.error("Gagal membaca sesi:", error);
    }

    await refreshAuth(data?.session || null);
    await loadAnnouncement();
    await renderAdminMovies();
    await renderAdminEpisodes();

    sb.auth.onAuthStateChange((_event, session) => {
      setTimeout(() => {
        refreshAuth(session);
      }, 0);
    });
  }

  init().catch((error) => {
    console.error("LOOKSATSU gagal dimulai:", error);
    setStatus("Aplikasi gagal dimulai. Periksa Console.");
  });

})();
 
