/* LOOKSATSU
   Frontend: katalog, autentikasi, favorit, episode, pengumuman.
   Keamanan admin wajib ditegakkan oleh Supabase RLS.
*/
(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const cfg = window.LOOKSATSU_CONFIG || {};

  const configured = Boolean(
    cfg.SUPABASE_URL &&
    cfg.SUPABASE_ANON_KEY &&
    !cfg.SUPABASE_URL.includes("PASTE_") &&
    !cfg.SUPABASE_ANON_KEY.includes("PASTE_")
  );

  const sb = configured && window.supabase
    ? window.supabase.createClient(
        cfg.SUPABASE_URL,
        cfg.SUPABASE_ANON_KEY,
        {
          auth: {
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: true
          }
        }
      )
    : null;

  let currentUser = null;
  let admin = false;
  let allMovies = [];
  let favorites = new Set();
  let signupMode = false;

  let currentEpisodes = [];
  let currentMovieId = null;
  let currentEpisodeIndex = 0;

  let currentAnnouncement = null;

  const esc = (value) =>
    String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    })[char]);

  function toast(message) {
    const el = $("toast");
    if (!el) return;

    el.textContent = message;
    el.classList.add("show");

    setTimeout(() => el.classList.remove("show"), 2800);
  }

  function setMessage(id, message) {
    const el = $(id);
    if (el) el.textContent = message;
  }

  function safeUrl(raw) {
    try {
      const url = new URL(raw);
      return ["https:", "http:"].includes(url.protocol)
        ? url.href
        : "";
    } catch {
      return "";
    }
  }

  function videoMarkup(raw) {
    const url = safeUrl(raw);

    if (!url) {
      return '<p class="muted">Tautan video tidak valid.</p>';
    }

    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    let videoId = "";

    // YouTube
    if (
      host === "youtube.com" ||
      host === "www.youtube.com" ||
      host === "m.youtube.com" ||
      host === "youtu.be" ||
      host === "www.youtu.be" ||
      host === "youtube-nocookie.com" ||
      host === "www.youtube-nocookie.com" ||
      host.endsWith(".youtube.com")
    ) {
      if (host === "youtu.be" || host === "www.youtu.be") {
        videoId = u.pathname.split("/")[1] || "";
      } else if (u.pathname.startsWith("/embed/")) {
        videoId = u.pathname.split("/")[2] || "";
      } else if (u.pathname.startsWith("/shorts/")) {
        videoId = u.pathname.split("/")[2] || "";
      } else {
        videoId = u.searchParams.get("v") || "";
      }

      if (/^[\w-]{11}$/.test(videoId)) {
        return `
          <iframe
            src="https://www.youtube-nocookie.com/embed/${videoId}"
            title="Video LOOKSATSU"
            allow="accelerometer; autoplay; encrypted-media; picture-in-picture"
            allowfullscreen
          ></iframe>
        `;
      }
    }

    // Video langsung: MP4, WebM, OGG
    if (/\.(mp4|webm|ogg)$/i.test(u.pathname)) {
      return `
        <video
          controls
          playsinline
          preload="metadata"
          style="width:100%;height:100%;background:#000"
        >
          <source src="${esc(url)}">
          Browser tidak mendukung video ini.
        </video>
      `;
    }

    // Jangan memasukkan situs eksternal sembarangan ke dalam iframe.
    return `
      <div class="empty-state">
        <p>Link ini tidak mendukung pemutar langsung.</p>
        <a
          class="button button-primary"
          href="${esc(url)}"
          target="_blank"
          rel="noopener noreferrer"
        >Buka video di tab baru</a>
      </div>
    `;
  }

  // =====================================================
  // KATALOG FILM
  // =====================================================

  async function loadMovies() {
    if (!sb) {
      setMessage(
        "connectionStatus",
        "Belum terhubung ke Supabase. Periksa config.js."
      );

      $("movieGrid").innerHTML =
        '<div class="empty-state">Isi konfigurasi Supabase untuk memuat katalog.</div>';

      renderFavorites();
      return;
    }

    const { data, error } = await sb
      .from("movies")
      .select(
        "id,title,description,poster_url,video_url,category,release_year,created_at"
      )
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Gagal memuat film:", error);

      $("movieGrid").innerHTML =
        '<div class="empty-state">Katalog gagal dimuat. Periksa tabel movies dan RLS.</div>';

      setMessage("connectionStatus", "Gagal memuat katalog.");
      return;
    }

    allMovies = data || [];

    setMessage("connectionStatus", "Terhubung ke katalog online");

    renderMovies();
    renderFavorites();
    renderAdminMovies();
    populateEpisodeMovieSelect();
  }

  function movieCard(movie) {
    const poster = safeUrl(movie.poster_url || "");
    const saved = favorites.has(String(movie.id));

    return `
      <article class="movie-card">
        <div class="poster">
          ${
            poster
              ? `<img loading="lazy"
                  src="${esc(poster)}"
                  alt="Poster ${esc(movie.title)}"
                  onerror="this.remove()">`
              : '<span class="poster-placeholder">特撮</span>'
          }

          <span class="category-chip">
            ${esc(movie.category || "Tokusatsu")}
          </span>
        </div>

        <div class="movie-body">
          <h3 class="movie-title" title="${esc(movie.title)}">
            ${esc(movie.title)}
          </h3>

          <div class="movie-meta">
            ${movie.release_year ? esc(movie.release_year) + " · " : ""}
            ${esc(movie.category || "Tokusatsu")}
          </div>

          <p class="movie-desc">
            ${esc(movie.description || "Belum ada deskripsi.")}
          </p>

          <div class="movie-actions">
            <button
              class="button button-primary"
              data-play="${esc(movie.id)}"
              type="button"
            >▶ Tonton</button>

            <button
              class="icon-button ${saved ? "saved" : ""}"
              aria-label="Favorit"
              data-fav="${esc(movie.id)}"
              type="button"
            >${saved ? "♥" : "♡"}</button>
          </div>
        </div>
      </article>
    `;
  }

  function renderMovies() {
    if (!$("movieGrid")) return;

    const query = $("searchInput").value.trim().toLowerCase();
    const category = $("categoryFilter").value;

    const categories = [
      ...new Set(allMovies.map((m) => m.category).filter(Boolean))
    ];

    const select = $("categoryFilter");
    const previousCategory = select.value;

    select.innerHTML =
      '<option value="">Semua kategori</option>' +
      categories.map((categoryName) => `
        <option value="${esc(categoryName)}">
          ${esc(categoryName)}
        </option>
      `).join("");

    select.value = categories.includes(previousCategory)
      ? previousCategory
      : "";

    const filtered = allMovies.filter((movie) => {
      const matchesQuery =
        !query ||
        [
          movie.title,
          movie.description,
          movie.category,
          String(movie.release_year || "")
        ].some((value) =>
          String(value || "").toLowerCase().includes(query)
        );

      return matchesQuery &&
        (!category || movie.category === category);
    });

    $("filmCount").textContent = `${filtered.length} judul`;

    $("movieGrid").innerHTML = filtered.length
      ? filtered.map(movieCard).join("")
      : '<div class="empty-state">Tidak ada film yang cocok.</div>';
  }

  function renderFavorites() {
    if (!currentUser) {
      $("favoriteGrid").innerHTML =
        '<div class="empty-state">Masuk untuk menyimpan favorit di akunmu.</div>';
      return;
    }

    const list = allMovies.filter((movie) =>
      favorites.has(String(movie.id))
    );

    $("favoriteGrid").innerHTML = list.length
      ? list.map(movieCard).join("")
      : '<div class="empty-state">Belum ada favorit. Tekan ♡ pada film yang kamu suka.</div>';
  }

  async function loadFavorites() {
    favorites = new Set();

    if (!sb || !currentUser) {
      renderFavorites();
      return;
    }

    const { data, error } = await sb
      .from("favorites")
      .select("movie_id")
      .eq("user_id", currentUser.id);

    if (error) {
      console.error("Gagal memuat favorit:", error);
    } else {
      favorites = new Set(
        (data || []).map((item) => String(item.movie_id))
      );
    }

    renderMovies();
    renderFavorites();
  }

  async function toggleFavorite(id) {
    if (!currentUser) {
      $("loginDialog").showModal();
      toast("Masuk dahulu untuk menyimpan favorit.");
      return;
    }

    const key = String(id);

    if (favorites.has(key)) {
      const { error } = await sb
        .from("favorites")
        .delete()
        .eq("movie_id", id)
        .eq("user_id", currentUser.id);

      if (error) {
        console.error(error);
        toast("Gagal menghapus favorit.");
        return;
      }

      favorites.delete(key);
    } else {
      const { error } = await sb
        .from("favorites")
        .insert({
          movie_id: id,
          user_id: currentUser.id
        });

      if (error) {
        console.error(error);
        toast("Gagal menyimpan favorit. Periksa tabel dan RLS.");
        return;
      }

      favorites.add(key);
    }

    renderMovies();
    renderFavorites();
  }

  // =====================================================
  // AUTENTIKASI DAN ADMIN
  // =====================================================

  async function refreshAuth(session) {
    currentUser = session?.user || null;
    admin = false;

    if (currentUser && sb) {
      // Sesuaikan dengan tabel admin yang digunakan proyekmu.
      const { data, error } = await sb
        .from("looksatsu_admins")
        .select("user_id")
        .eq("user_id", currentUser.id)
        .maybeSingle();

      if (error) {
        console.warn(
          "Status admin tidak dapat diperiksa. Periksa tabel looksatsu_admins dan RLS.",
          error
        );
      }

      admin = Boolean(data);
    }

    $("accountLabel").textContent = currentUser
      ? (currentUser.email || "Akun masuk")
      : "Mode pengunjung";

    $("loginOpen").classList.toggle("hidden", Boolean(currentUser));
    $("logoutBtn").classList.toggle("hidden", !currentUser);
    $("adminPanel").classList.toggle("hidden", !admin);

    if (admin) {
      $("accountLabel").textContent =
        (currentUser.email || "Admin") + " · Admin";
    }

    await loadFavorites();
    renderAdminMovies();

    if (admin) {
      await loadAdminEpisodes();
      await loadAnnouncementForAdmin();
    }
  }

  async function authSubmit(event) {
    event.preventDefault();

    if (!sb) {
      setMessage("authMessage", "Isi config.js terlebih dahulu.");
      return;
    }

    const email = $("authEmail").value.trim();
    const password = $("authPassword").value;

    $("authSubmit").disabled = true;
    setMessage("authMessage", "Memproses…");

    let result;

    try {
      if (signupMode) {
        result = await sb.auth.signUp({
          email,
          password,
          options: {
            data: {
              display_name: $("displayName").value.trim()
            }
          }
        });
      } else {
        result = await sb.auth.signInWithPassword({
          email,
          password
        });
      }
    } catch (error) {
      result = { error };
    }

    $("authSubmit").disabled = false;

    if (result.error) {
      setMessage("authMessage", result.error.message);
      return;
    }

    if (signupMode && !result.data.session) {
      setMessage(
        "authMessage",
        "Periksa email untuk konfirmasi pendaftaran sebelum masuk."
      );
      return;
    }

    $("loginDialog").close();
    toast(signupMode ? "Akun berhasil dibuat." : "Berhasil masuk.");

    const { data } = await sb.auth.getSession();
    await refreshAuth(data.session);
  }

  function setAuthMode(next) {
    signupMode = next;

    $("authTitle").textContent = signupMode ? "Daftar akun" : "Masuk";
    $("authSubmit").textContent = signupMode ? "Buat akun" : "Masuk";

    $("authToggle").textContent = signupMode
      ? "Sudah punya akun? Masuk"
      : "Belum punya akun? Daftar";

    $("displayNameWrap").classList.toggle("hidden", !signupMode);

    $("authPassword").autocomplete = signupMode
      ? "new-password"
      : "current-password";

    setMessage("authMessage", "");
  }

  // =====================================================
  // PEMUTAR FILM
  // =====================================================

  function openPlayer(id) {
    const movie = allMovies.find(
      (item) => String(item.id) === String(id)
    );

    if (!movie) return;

    currentMovieId = movie.id;
    currentEpisodes = [];
    currentEpisodeIndex = 0;

    $("playerTitle").textContent = movie.title;
    $("playerDescription").textContent = movie.description || "";
    $("playerFrame").innerHTML = videoMarkup(movie.video_url);

    $("episodeList").innerHTML =
      '<div class="empty-state">Memuat daftar episode…</div>';

    $("playerDialog").showModal();

    loadEpisodes(movie.id);
  }

  // =====================================================
  // KELOLA FILM ADMIN
  // =====================================================

  function renderAdminMovies() {
    if (!admin) {
      $("adminMovieList").innerHTML = "";
      return;
    }

    $("adminMovieList").innerHTML = allMovies.length
      ? allMovies.map((movie) => `
          <div class="admin-item">
            <img
              class="admin-thumb"
              src="${esc(safeUrl(movie.poster_url) || "")}"
              alt=""
              onerror="this.style.visibility='hidden'"
            >

            <div class="admin-item-main">
              <strong>${esc(movie.title)}</strong>
              <small>
                ${esc(movie.category || "Tokusatsu")}
                ${movie.release_year ? " · " + esc(movie.release_year) : ""}
              </small>
            </div>

            <div class="admin-item-actions">
              <button
                class="button button-ghost"
                data-edit="${esc(movie.id)}"
                type="button"
              >Edit</button>

              <button
                class="button button-ghost"
                data-delete="${esc(movie.id)}"
                type="button"
              >Hapus</button>
            </div>
          </div>
        `).join("")
      : '<div class="empty-state">Belum ada film.</div>';
  }

  function resetMovieForm() {
    $("movieForm").reset();
    $("movieId").value = "";
    $("movieCategory").value = "Tokusatsu";
    $("movieFormTitle").textContent = "Tambah film";
    $("cancelEdit").classList.add("hidden");
    setMessage("adminMessage", "");
  }

  async function saveMovie(event) {
    event.preventDefault();

    if (!admin) {
      toast("Akses admin tidak tersedia.");
      return;
    }

    const id = $("movieId").value;
    const title = $("movieTitle").value.trim();
    const video = safeUrl($("movieVideo").value.trim());

    if (!title || !video) {
      setMessage("adminMessage", "Judul dan URL video valid wajib diisi.");
      return;
    }

    const year = $("movieYear").value
      ? Number($("movieYear").value)
      : null;

    if (
      year !== null &&
      (!Number.isInteger(year) || year < 1900 || year > 2100)
    ) {
      toast("Tahun rilis tidak valid.");
      return;
    }

    const posterInput = $("moviePoster").value.trim();

    if (posterInput && !safeUrl(posterInput)) {
      toast("URL poster tidak valid.");
      return;
    }

    const record = {
      title,
      description: $("movieDescription").value.trim(),
      poster_url: posterInput ? safeUrl(posterInput) : null,
      video_url: video,
      category: $("movieCategory").value.trim() || "Tokusatsu",
      release_year: year
    };

    const result = id
      ? await sb.from("movies").update(record).eq("id", id)
      : await sb.from("movies").insert(record);

    if (result.error) {
      console.error(result.error);
      setMessage("adminMessage", "Gagal menyimpan. Periksa RLS.");
      return;
    }

    resetMovieForm();
    await loadMovies();
    toast("Data film berhasil disimpan.");
  }

  function editMovie(id) {
    const movie = allMovies.find(
      (item) => String(item.id) === String(id)
    );

    if (!movie || !admin) return;

    $("movieId").value = movie.id;
    $("movieTitle").value = movie.title;
    $("movieCategory").value = movie.category || "Tokusatsu";
    $("movieYear").value = movie.release_year || "";
    $("moviePoster").value = movie.poster_url || "";
    $("movieVideo").value = movie.video_url || "";
    $("movieDescription").value = movie.description || "";

    $("movieFormTitle").textContent = "Edit film";
    $("cancelEdit").classList.remove("hidden");

    $("movieForm").scrollIntoView({
      behavior: "smooth",
      block: "start"
    });
  }

  async function deleteMovie(id) {
    if (!admin || !confirm("Yakin ingin menghapus film ini?")) return;

    const { error } = await sb
      .from("movies")
      .delete()
      .eq("id", id);

    if (error) {
      console.error(error);
      toast("Gagal menghapus film. Periksa RLS.");
      return;
    }

    await loadMovies();
    toast("Film dihapus.");
  }

  // =====================================================
  // EPISODE: TAMPILAN PEMUTAR DAN ADMIN
  // =====================================================

  function populateEpisodeMovieSelect() {
    const select = $("episodeMovieId");
    if (!select) return;

    const previous = select.value;

    select.innerHTML =
      '<option value="">Pilih film terlebih dahulu</option>' +
      allMovies.map((movie) => `
        <option value="${esc(movie.id)}">${esc(movie.title)}</option>
      `).join("");

    if (allMovies.some((movie) => String(movie.id) === previous)) {
      select.value = previous;
    }
  }

  async function loadEpisodes(movieId) {
    currentMovieId = movieId;
    currentEpisodes = [];
    currentEpisodeIndex = 0;

    const list = $("episodeList");
    list.innerHTML =
      '<div class="empty-state">Memuat daftar episode…</div>';

    if (!sb) return;

    const { data, error } = await sb
      .from("episodes")
      .select("id,movie_id,episode_number,title,video_url")
      .eq("movie_id", movieId)
      .order("episode_number", { ascending: true });

    if (error) {
      console.error("Gagal memuat episode:", error);

      list.innerHTML =
        '<div class="empty-state">Episode belum tersedia. Periksa tabel episodes dan RLS.</div>';

      return;
    }

    currentEpisodes = data || [];

    if (!currentEpisodes.length) {
      list.innerHTML =
        '<div class="empty-state">Belum ada episode untuk film ini.</div>';
      return;
    }

    renderEpisodeList();
  }

  function renderEpisodeList() {
    const list = $("episodeList");

    if (!currentEpisodes.length) {
      list.innerHTML =
        '<div class="empty-state">Belum ada episode.</div>';
      return;
    }

    list.innerHTML = currentEpisodes.map((episode, index) => `
      <div class="admin-item">
        <div class="admin-item-main">
          <strong>
            Episode ${esc(episode.episode_number)}:
            ${esc(episode.title)}
          </strong>
        </div>

        <div class="admin-item-actions">
          <button
            class="button button-primary"
            type="button"
            data-play-episode="${index}"
          >▶ Putar</button>
        </div>
      </div>
    `).join("");
  }

  function playEpisode(index) {
    if (index < 0 || index >= currentEpisodes.length) return;

   
